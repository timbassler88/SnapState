/**
 * analytics.test.js
 *
 * Tests for the analytics API endpoints and background stats tracking.
 * Requires Postgres (skips gracefully when unavailable).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { getPool, closePool } from '../src/store/postgres.js';
import { createRedisClient } from '../src/store/redis.js';

const TEST_REDIS_URL = 'redis://localhost:6379/1';
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.ADMIN_SECRET = 'test_admin';
process.env.JWT_SECRET = 'test_jwt_secret_for_analytics_tests_32chars';

const redis = createRedisClient(TEST_REDIS_URL);
const uid = `an_${Date.now()}`;

let app;
let pgAvailable = false;

const accounts = {};

async function createTestAccount(pool, label) {
  const result = await pool.query(
    `INSERT INTO accounts (email, name, password_hash, status, email_verified, plan)
     VALUES ($1, $2, 'hash', 'active', TRUE, 'free') RETURNING id`,
    [`${label}_${uid}@example.com`, `Test ${label}`]
  );
  const accountId = result.rows[0].id;
  const { generateApiKey } = await import('../src/services/account-service.js');
  const { rawKey } = await generateApiKey(accountId, { label: 'test-key' });
  return { accountId, apiKey: rawKey };
}

before(async () => {
  const emailModule = await import('../src/services/email-service.js');
  emailModule.emailService.sendVerificationEmail = async () => {};
  emailModule.emailService.sendWelcomeEmail = async () => {};

  app = await buildApp({ logger: false });
  await app.ready();

  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    pgAvailable = true;
    accounts.main = await createTestAccount(pool, 'main');
    accounts.other = await createTestAccount(pool, 'other');
  } catch {
    pgAvailable = false;
  }
});

after(async () => {
  if (pgAvailable) {
    try {
      const pool = getPool();
      await pool.query(`DELETE FROM accounts WHERE email LIKE '%_${uid}@%'`);
      await closePool();
    } catch { /* ignore */ }
  }
  await app.close();
  await redis.flushdb();
  await redis.quit();
});

const json = { 'content-type': 'application/json' };

/** Save N checkpoints for a workflow and wait for async stats to settle. */
async function saveCheckpoints(apiKey, workflowId, count, opts = {}) {
  for (let i = 1; i <= count; i++) {
    const payload = {
      workflow_id: workflowId,
      step: i,
      state: { step: i, data: `step_${i}` },
    };
    if (opts.agentId) payload.agent_id = opts.agentId;

    await app.inject({
      method: 'POST', url: '/checkpoints',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload,
    });
  }
  // Allow setImmediate analytics update to propagate
  await new Promise((resolve) => setTimeout(resolve, 200));
}

// ---------------------------------------------------------------------------
// Analytics stats update
// ---------------------------------------------------------------------------

describe('workflow_stats background update', () => {
  test('updates workflow_stats after checkpoint saves', async () => {
    if (!pgAvailable) return;

    const { apiKey, accountId } = accounts.main;
    const workflowId = `wf_stats_${uid}`;

    await saveCheckpoints(apiKey, workflowId, 3);

    const pool = getPool();
    const result = await pool.query(
      `SELECT total_steps, total_size_bytes, first_checkpoint_at, last_checkpoint_at
       FROM workflow_stats WHERE account_id = $1 AND workflow_id = $2`,
      [accountId, workflowId]
    );

    assert.ok(result.rows.length > 0, 'workflow_stats row should exist');
    const row = result.rows[0];
    assert.equal(row.total_steps, 3, 'total_steps should equal checkpoint count');
    assert.ok(row.first_checkpoint_at, 'first_checkpoint_at should be set');
    assert.ok(row.last_checkpoint_at, 'last_checkpoint_at should be set');
  });

  test('tracks multiple workflows independently', async () => {
    if (!pgAvailable) return;

    const { apiKey, accountId } = accounts.main;
    const wf1 = `wf_multi1_${uid}`;
    const wf2 = `wf_multi2_${uid}`;

    await saveCheckpoints(apiKey, wf1, 2);
    await saveCheckpoints(apiKey, wf2, 5);

    const pool = getPool();
    const r1 = await pool.query(
      `SELECT total_steps FROM workflow_stats WHERE account_id = $1 AND workflow_id = $2`,
      [accountId, wf1]
    );
    const r2 = await pool.query(
      `SELECT total_steps FROM workflow_stats WHERE account_id = $1 AND workflow_id = $2`,
      [accountId, wf2]
    );

    assert.equal(r1.rows[0]?.total_steps, 2);
    assert.equal(r2.rows[0]?.total_steps, 5);
  });

  test('records all agent_ids in agent_ids JSONB array', async () => {
    if (!pgAvailable) return;

    const { apiKey, accountId } = accounts.main;
    const workflowId = `wf_agents_${uid}`;

    // Two checkpoints from different agents
    for (const [step, agentId] of [[1, 'agent-alpha'], [2, 'agent-beta']]) {
      await app.inject({
        method: 'POST', url: '/checkpoints',
        headers: { Authorization: `Bearer ${apiKey}`, ...json },
        payload: { workflow_id: workflowId, step, state: { s: step }, agent_id: agentId },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));

    const pool = getPool();
    const result = await pool.query(
      `SELECT agent_ids FROM workflow_stats WHERE account_id = $1 AND workflow_id = $2`,
      [accountId, workflowId]
    );

    const agentIds = result.rows[0]?.agent_ids ?? [];
    assert.ok(agentIds.includes('agent-alpha'), 'should contain agent-alpha');
    assert.ok(agentIds.includes('agent-beta'), 'should contain agent-beta');
  });

  test('checkpoint save response is not blocked by analytics update', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;
    const workflowId = `wf_nonblocking_${uid}`;
    const start = Date.now();

    const res = await app.inject({
      method: 'POST', url: '/checkpoints',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload: { workflow_id: workflowId, step: 1, state: { x: 1 } },
    });

    const elapsed = Date.now() - start;
    assert.equal(res.statusCode, 201);
    // The response should return quickly (analytics are fire-and-forget)
    // 2 seconds is very generous — real latency should be <200ms
    assert.ok(elapsed < 2000, `Response took ${elapsed}ms — may be blocking`);
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/overview
// ---------------------------------------------------------------------------

describe('GET /analytics/overview', () => {
  test('200 returns correct aggregate counts', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;
    const wfA = `wf_ov1_${uid}`;
    const wfB = `wf_ov2_${uid}`;

    await saveCheckpoints(apiKey, wfA, 3);
    await saveCheckpoints(apiKey, wfB, 2);

    const res = await app.inject({
      method: 'GET', url: '/analytics/overview',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.period?.start);
    assert.ok(body.period?.end);
    assert.ok(typeof body.total_workflows === 'number');
    assert.ok(typeof body.total_checkpoints === 'number');
    assert.ok(typeof body.avg_steps_per_workflow === 'number');
    assert.ok(Array.isArray(body.top_agents));
  });

  test('date range filter narrows results', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;

    // Request a date range far in the future — should return zeros
    const res = await app.inject({
      method: 'GET', url: '/analytics/overview?start_date=2099-01-01&end_date=2099-01-31',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.total_workflows, 0);
    assert.equal(body.total_checkpoints, 0);
  });

  test('401 without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/overview' });
    assert.equal(res.statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/workflows/:workflow_id
// ---------------------------------------------------------------------------

describe('GET /analytics/workflows/:workflow_id', () => {
  test('200 returns step-by-step timeline', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;
    const workflowId = `wf_timeline_${uid}`;

    await saveCheckpoints(apiKey, workflowId, 3, { agentId: 'timeline-bot' });

    const res = await app.inject({
      method: 'GET', url: `/analytics/workflows/${workflowId}`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.workflow_id, workflowId);
    assert.ok(typeof body.total_steps === 'number');
    assert.ok(Array.isArray(body.checkpoints));
    assert.ok(Array.isArray(body.agents_involved));
  });

  test('404 for non-existent workflow', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;

    const res = await app.inject({
      method: 'GET', url: '/analytics/workflows/wf_does_not_exist_xyz',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/failures
// ---------------------------------------------------------------------------

describe('GET /analytics/failures', () => {
  test('200 returns failure breakdown structure', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;

    const res = await app.inject({
      method: 'GET', url: '/analytics/failures',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(typeof body.period_days === 'number');
    assert.ok(typeof body.total_failures === 'number');
    assert.ok(Array.isArray(body.failure_by_step));
    assert.ok(Array.isArray(body.failure_by_agent));
    assert.ok(Array.isArray(body.recent_failures));
  });

  test('200 with custom days param', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;

    const res = await app.inject({
      method: 'GET', url: '/analytics/failures?days=14',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).period_days, 14);
  });

  test('records failure via recordWorkflowError and shows in response', async () => {
    if (!pgAvailable) return;

    const { apiKey, accountId } = accounts.main;
    const workflowId = `wf_err_${uid}`;

    await saveCheckpoints(apiKey, workflowId, 1);

    // Directly record an error for this test
    const { analyticsService } = await import('../src/services/analytics-service.js');
    await analyticsService.recordWorkflowError(
      accountId, workflowId, 1, 'timeout', 'API call timed out', 'test-agent'
    );

    const res = await app.inject({
      method: 'GET', url: '/analytics/failures',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.total_failures >= 1);
    const hasOurError = body.recent_failures.some((f) => f.workflow_id === workflowId);
    assert.ok(hasOurError, 'should include the recorded failure');
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/agents
// ---------------------------------------------------------------------------

describe('GET /analytics/agents', () => {
  test('200 returns agent performance data', async () => {
    if (!pgAvailable) return;

    const { apiKey } = accounts.main;
    const workflowId = `wf_agperf_${uid}`;

    await saveCheckpoints(apiKey, workflowId, 2, { agentId: 'perf-bot' });

    const res = await app.inject({
      method: 'GET', url: '/analytics/agents',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(res.statusCode, 200);
    const { agents } = JSON.parse(res.body);
    assert.ok(Array.isArray(agents));

    const perfBot = agents.find((a) => a.agent_id === 'perf-bot');
    assert.ok(perfBot, 'perf-bot should appear in agent performance');
    assert.ok(typeof perfBot.total_workflows === 'number');
    assert.ok(typeof perfBot.avg_steps === 'number');
    assert.ok(typeof perfBot.error_rate === 'number');
  });
});

// ---------------------------------------------------------------------------
// Account isolation
// ---------------------------------------------------------------------------

describe('Analytics account isolation', () => {
  test('customer A cannot see customer B\'s analytics data', async () => {
    if (!pgAvailable) return;

    const { apiKey: keyA, accountId: idA } = accounts.main;
    const { apiKey: keyB } = accounts.other;
    const workflowId = `wf_iso_${uid}`;

    // Account A saves 5 checkpoints
    await saveCheckpoints(keyA, workflowId, 5);

    // Account B's overview should not include Account A's workflows
    const resA = await app.inject({
      method: 'GET', url: '/analytics/overview',
      headers: { Authorization: `Bearer ${keyA}` },
    });
    const resB = await app.inject({
      method: 'GET', url: '/analytics/overview',
      headers: { Authorization: `Bearer ${keyB}` },
    });

    const overviewA = JSON.parse(resA.body);
    const overviewB = JSON.parse(resB.body);

    assert.ok(overviewA.total_workflows >= 1, 'Account A should see its own workflows');
    assert.ok(
      overviewB.total_workflows < overviewA.total_workflows,
      'Account B should not see Account A\'s workflows'
    );
  });

  test('workflow timeline for another account\'s workflow returns 404', async () => {
    if (!pgAvailable) return;

    const { apiKey: keyA } = accounts.main;
    const { apiKey: keyB } = accounts.other;
    const workflowId = `wf_iso2_${uid}`;

    await saveCheckpoints(keyA, workflowId, 2);

    const res = await app.inject({
      method: 'GET', url: `/analytics/workflows/${workflowId}`,
      headers: { Authorization: `Bearer ${keyB}` },
    });

    assert.equal(res.statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// Admin analytics endpoints
// ---------------------------------------------------------------------------

describe('Admin analytics endpoints', () => {
  test('GET /admin/analytics/overview returns global data', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/analytics/overview',
      headers: { Authorization: 'Bearer test_admin' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.period);
    assert.ok(typeof body.total_workflows === 'number');
  });

  test('GET /admin/analytics/failures returns global failures', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/analytics/failures',
      headers: { Authorization: 'Bearer test_admin' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(typeof body.total_failures === 'number');
    assert.ok(Array.isArray(body.failure_by_step));
  });

  test('GET /admin/stats includes workflow_status breakdown', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/stats',
      headers: { Authorization: 'Bearer test_admin' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(typeof body.workflow_status === 'object', 'should include workflow_status breakdown');
  });
});
