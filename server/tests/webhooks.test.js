import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { createRedisClient } from '../src/store/redis.js';

const TEST_REDIS_URL = 'redis://localhost:6379/1';
const TEST_API_KEY = 'snp_test_webhooks_00000000000000000';

process.env.REDIS_URL = TEST_REDIS_URL;

const redis = createRedisClient(TEST_REDIS_URL);

let app;

before(async () => {
  await redis.sadd('api_keys', TEST_API_KEY);
  app = buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
  await redis.flushdb();
  await redis.quit();
});

beforeEach(async () => {
  await redis.flushdb();
  await redis.sadd('api_keys', TEST_API_KEY);
});

const authHeader = { Authorization: `Bearer ${TEST_API_KEY}` };
const jsonHeaders = { ...authHeader, 'content-type': 'application/json' };

describe('POST /webhooks', () => {
  test('registers a webhook and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: {
        url: 'https://example.com/webhook',
        events: ['checkpoint.saved'],
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.webhook_id.startsWith('wh_'));
    assert.equal(body.url, 'https://example.com/webhook');
    assert.deepEqual(body.events, ['checkpoint.saved']);
    assert.ok(body.created_at);
    // Secret should not be returned
    assert.equal(body.secret, undefined);
  });

  test('registers webhook with multiple events', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: {
        url: 'https://example.com/hook2',
        events: ['checkpoint.saved', 'workflow.resumed', 'workflow.expired'],
        secret: 'my-secret',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.events.length, 3);
    assert.equal(body.secret, undefined);
  });

  test('rejects invalid URL (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: {
        url: 'not-a-url',
        events: ['checkpoint.saved'],
      },
    });
    assert.equal(res.statusCode, 400);
  });

  test('rejects unknown event type (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: {
        url: 'https://example.com/hook',
        events: ['unknown.event'],
      },
    });
    assert.equal(res.statusCode, 400);
  });

  test('rejects missing required fields (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: { url: 'https://example.com/hook' }, // missing events
    });
    assert.equal(res.statusCode, 400);
  });

  test('rejects unauthenticated request (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: { 'content-type': 'application/json' },
      payload: { url: 'https://example.com/hook', events: ['checkpoint.saved'] },
    });
    assert.equal(res.statusCode, 401);
  });

  test('webhook is persisted in Redis', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: { url: 'https://example.com/persistent', events: ['checkpoint.saved'] },
    });
    const { webhook_id } = JSON.parse(res.body);

    const raw = await redis.hget(`webhooks:${TEST_API_KEY}`, webhook_id);
    assert.ok(raw);
    const stored = JSON.parse(raw);
    assert.equal(stored.url, 'https://example.com/persistent');
  });
});

describe('DELETE /webhooks/:webhook_id', () => {
  test('deletes an existing webhook and returns 204', async () => {
    // Register first
    const create = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: { url: 'https://example.com/to-delete', events: ['checkpoint.saved'] },
    });
    const { webhook_id } = JSON.parse(create.body);

    const del = await app.inject({
      method: 'DELETE',
      url: `/webhooks/${webhook_id}`,
      headers: authHeader,
    });
    assert.equal(del.statusCode, 204);
    assert.equal(del.body, '');
  });

  test('returns 404 for unknown webhook', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/webhooks/wh_nonexistent',
      headers: authHeader,
    });
    assert.equal(res.statusCode, 404);
  });

  test('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/webhooks/wh_any',
    });
    assert.equal(res.statusCode, 401);
  });

  test('deleted webhook is removed from Redis', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: { url: 'https://example.com/gone', events: ['checkpoint.saved'] },
    });
    const { webhook_id } = JSON.parse(create.body);

    await app.inject({ method: 'DELETE', url: `/webhooks/${webhook_id}`, headers: authHeader });

    const raw = await redis.hget(`webhooks:${TEST_API_KEY}`, webhook_id);
    assert.equal(raw, null);
  });

  test('one API key cannot delete another key\'s webhook', async () => {
    const otherKey = 'snp_other_key_000000000000000000000';
    await redis.sadd('api_keys', otherKey);

    // Register under the other key
    const create = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${otherKey}`, 'content-type': 'application/json' },
      payload: { url: 'https://example.com/other', events: ['checkpoint.saved'] },
    });
    const { webhook_id } = JSON.parse(create.body);

    // Try to delete with our key
    const del = await app.inject({
      method: 'DELETE',
      url: `/webhooks/${webhook_id}`,
      headers: authHeader,
    });
    assert.equal(del.statusCode, 404);
  });
});

describe('Webhook payload validation', () => {
  test('POST /webhooks includes X-Request-Id header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: jsonHeaders,
      payload: { url: 'https://example.com/req-id', events: ['checkpoint.saved'] },
    });
    assert.ok(res.headers['x-request-id']);
  });
});
