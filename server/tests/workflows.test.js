import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { createRedisClient } from '../src/store/redis.js';

const TEST_REDIS_URL = 'redis://localhost:6379/1';
const TEST_API_KEY = 'snp_test_workflows_0000000000000000';

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

async function seedCheckpoints(workflowId, count) {
  const checkpoints = [];
  for (let step = 1; step <= count; step++) {
    const res = await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: jsonHeaders,
      payload: { workflow_id: workflowId, step, label: `step_${step}`, state: { step, data: `value_${step}` } },
    });
    checkpoints.push(JSON.parse(res.body));
  }
  return checkpoints;
}

describe('GET /workflows/:workflow_id/resume', () => {
  test('returns latest checkpoint for existing workflow', async () => {
    await seedCheckpoints('wf_resume_001', 3);

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_resume_001/resume',
      headers: authHeader,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);

    assert.equal(body.workflow_id, 'wf_resume_001');
    assert.ok(body.latest_checkpoint);
    assert.equal(body.latest_checkpoint.step, 3);
    assert.equal(body.latest_checkpoint.label, 'step_3');
    assert.deepEqual(body.latest_checkpoint.state, { step: 3, data: 'value_3' });
    assert.ok(typeof body.total_checkpoints === 'number');
    assert.ok(body.workflow_started_at);
    assert.ok(body.last_activity_at);
  });

  test('returns 404 for unknown workflow', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_nonexistent/resume',
      headers: authHeader,
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  test('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/workflows/wf_x/resume' });
    assert.equal(res.statusCode, 401);
  });

  test('state is preserved exactly through the round-trip', async () => {
    const state = {
      nested: { a: [1, 2, 3], b: { deep: true } },
      count: 42,
      flag: false,
      label: 'hello',
    };
    await app.inject({
      method: 'POST',
      url: '/checkpoints',
      headers: jsonHeaders,
      payload: { workflow_id: 'wf_roundtrip', step: 1, state },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_roundtrip/resume',
      headers: authHeader,
    });
    const body = JSON.parse(res.body);
    assert.deepEqual(body.latest_checkpoint.state, state);
  });
});

describe('GET /workflows/:workflow_id/replay', () => {
  test('returns all checkpoints in order', async () => {
    await seedCheckpoints('wf_replay_001', 5);

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_replay_001/replay',
      headers: authHeader,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);

    assert.equal(body.workflow_id, 'wf_replay_001');
    assert.ok(Array.isArray(body.checkpoints));
    assert.equal(body.total, 5);
    assert.equal(body.has_more, false);

    // Verify ordering
    for (let i = 0; i < 5; i++) {
      assert.equal(body.checkpoints[i].step, i + 1);
    }
  });

  test('filters by from_step', async () => {
    await seedCheckpoints('wf_replay_from', 5);

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_replay_from/replay?from_step=3',
      headers: authHeader,
    });
    const body = JSON.parse(res.body);
    assert.ok(body.checkpoints.every((c) => c.step >= 3));
  });

  test('filters by to_step', async () => {
    await seedCheckpoints('wf_replay_to', 5);

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_replay_to/replay?to_step=3',
      headers: authHeader,
    });
    const body = JSON.parse(res.body);
    assert.ok(body.checkpoints.every((c) => c.step <= 3));
  });

  test('filters by from_step and to_step range', async () => {
    await seedCheckpoints('wf_replay_range', 10);

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_replay_range/replay?from_step=3&to_step=7',
      headers: authHeader,
    });
    const body = JSON.parse(res.body);
    assert.ok(body.checkpoints.every((c) => c.step >= 3 && c.step <= 7));
    assert.equal(body.total, 5);
  });

  test('respects limit param', async () => {
    await seedCheckpoints('wf_replay_limit', 5);

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_replay_limit/replay?limit=2',
      headers: authHeader,
    });
    const body = JSON.parse(res.body);
    assert.equal(body.checkpoints.length, 2);
    assert.equal(body.has_more, true);
  });

  test('returns empty result for unknown workflow', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_unknown_replay/replay',
      headers: authHeader,
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.checkpoints, []);
    assert.equal(body.total, 0);
    assert.equal(body.has_more, false);
  });

  test('rejects invalid query params (400)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workflows/wf_x/replay?limit=9999999',
      headers: authHeader,
    });
    assert.equal(res.statusCode, 400);
  });
});
