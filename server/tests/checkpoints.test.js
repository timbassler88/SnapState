import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { createRedisClient } from '../src/store/redis.js';

// Use Redis db 1 for tests
const TEST_REDIS_URL = 'redis://localhost:6379/1';
const TEST_API_KEY = 'snp_test_checkpoints_0000000000000000';

// Override the redis singleton for tests by injecting via env
process.env.REDIS_URL = TEST_REDIS_URL;

const redis = createRedisClient(TEST_REDIS_URL);

let app;

before(async () => {
  // Seed the test API key
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
  // Flush between tests to keep state clean
  await redis.flushdb();
  await redis.sadd('api_keys', TEST_API_KEY);
});

const authHeader = { Authorization: `Bearer ${TEST_API_KEY}` };

describe('POST /checkpoints', () => {
  test('creates a checkpoint and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: {
        workflow_id: 'wf_test_001',
        step: 1,
        label: 'initialized',
        state: { foo: 'bar', count: 1 },
        metadata: { agent: 'test-bot' },
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.checkpoint_id.startsWith('cp_wf_test_001_'));
    assert.equal(body.workflow_id, 'wf_test_001');
    assert.equal(body.step, 1);
    assert.ok(body.etag);
    assert.ok(body.created_at);
    assert.ok(body.diff_from_previous);
    assert.ok(typeof body.size_bytes === 'number');
    assert.ok(res.headers['x-request-id']);
  });

  test('first checkpoint has all state as "added" in diff', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: {
        workflow_id: 'wf_diff_test',
        step: 1,
        state: { a: 1, b: 'hello' },
      },
    });

    const body = JSON.parse(res.body);
    assert.deepEqual(body.diff_from_previous.removed, []);
    assert.deepEqual(body.diff_from_previous.changed, []);
    assert.ok(body.diff_from_previous.added.length > 0);
  });

  test('second checkpoint diff reflects changes', async () => {
    const base = {
      workflow_id: 'wf_diff2',
      headers: { ...authHeader, 'content-type': 'application/json' },
    };
    await app.inject({ method: 'POST', url: '/checkpoints', ...base, payload: { workflow_id: 'wf_diff2', step: 1, state: { a: 1, b: 2 } } });
    const res = await app.inject({ method: 'POST', url: '/checkpoints', ...base, payload: { workflow_id: 'wf_diff2', step: 2, state: { a: 99, b: 2, c: 3 } } });

    const body = JSON.parse(res.body);
    assert.ok(body.diff_from_previous.changed.includes('a'));
    assert.ok(body.diff_from_previous.added.includes('c'));
    assert.deepEqual(body.diff_from_previous.removed, []);
  });

  test('rejects missing required fields (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: { workflow_id: 'wf_x' }, // missing step and state
    });
    assert.equal(res.statusCode, 400);
  });

  test('rejects unauthenticated request (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { 'content-type': 'application/json' },
      payload: { workflow_id: 'wf_x', step: 1, state: {} },
    });
    assert.equal(res.statusCode, 401);
  });

  test('rejects invalid API key (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { Authorization: 'Bearer snp_invalid_key', 'content-type': 'application/json' },
      payload: { workflow_id: 'wf_x', step: 1, state: {} },
    });
    assert.equal(res.statusCode, 401);
  });

  test('returns 409 on duplicate checkpoint_id', async () => {
    const payload = { workflow_id: 'wf_dup', step: 1, state: { x: 1 } };
    const headers = { ...authHeader, 'content-type': 'application/json' };

    const first = await app.inject({ method: 'POST', url: '/checkpoints', headers, payload });
    assert.equal(first.statusCode, 201);

    const second = await app.inject({ method: 'POST', url: '/checkpoints', headers, payload });
    assert.equal(second.statusCode, 409);
    const body = JSON.parse(second.body);
    assert.equal(body.error.code, 'CONFLICT');
  });

  test('idempotent re-save succeeds when If-Match matches ETag', async () => {
    const payload = { workflow_id: 'wf_idempotent', step: 1, state: { x: 1 } };
    const headers = { ...authHeader, 'content-type': 'application/json' };

    const first = await app.inject({ method: 'POST', url: '/checkpoints', headers, payload });
    const { etag } = JSON.parse(first.body);

    const second = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { ...headers, 'If-Match': etag },
      payload,
    });
    assert.equal(second.statusCode, 201);
  });

  test('If-Match mismatch returns 409', async () => {
    const payload = { workflow_id: 'wf_etag_mismatch', step: 1, state: { x: 1 } };
    const headers = { ...authHeader, 'content-type': 'application/json' };

    await app.inject({ method: 'POST', url: '/checkpoints', headers, payload });

    const second = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { ...headers, 'If-Match': '"wrong_etag"' },
      payload,
    });
    assert.equal(second.statusCode, 409);
  });

  test('respects X-Checkpoint-TTL header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { ...authHeader, 'content-type': 'application/json', 'X-Checkpoint-TTL': '3600' },
      payload: { workflow_id: 'wf_ttl', step: 1, state: { x: 1 } },
    });
    assert.equal(res.statusCode, 201);
  });

  test('rate limiting returns 429 after exceeding limit', async () => {
    // Manually stuff the rate limit counter to near the limit
    const windowMs = 60000;
    const max = 100;
    const key = `rate_limit:${TEST_API_KEY}`;
    const now = Date.now();
    const pipeline = redis.pipeline();
    for (let i = 0; i < max; i++) {
      pipeline.zadd(key, now - i, `existing-${i}`);
    }
    pipeline.expire(key, Math.ceil(windowMs / 1000));
    await pipeline.exec();

    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: { workflow_id: 'wf_rl', step: 1, state: {} },
    });
    assert.equal(res.statusCode, 429);
    assert.ok(res.headers['retry-after']);
  });
});

describe('GET /checkpoints/:checkpoint_id', () => {
  test('retrieves an existing checkpoint', async () => {
    const headers = { ...authHeader, 'content-type': 'application/json' };
    const saved = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers,
      payload: { workflow_id: 'wf_get', step: 1, state: { data: 'test' } },
    });
    const { checkpoint_id } = JSON.parse(saved.body);

    const res = await app.inject({
      method: 'GET',
      url: `/checkpoints/${checkpoint_id}`,
      headers: authHeader,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.checkpoint_id, checkpoint_id);
    assert.deepEqual(body.state, { data: 'test' });
  });

  test('returns 404 for unknown checkpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/checkpoints/cp_nonexistent_001',
      headers: authHeader,
    });
    assert.equal(res.statusCode, 404);
  });

  test('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/checkpoints/cp_x' });
    assert.equal(res.statusCode, 401);
  });
});

describe('GET /health', () => {
  test('returns 200 when Redis is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'ok');
    assert.equal(body.redis, 'connected');
  });
});
