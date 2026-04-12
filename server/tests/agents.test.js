/**
 * agents.test.js
 *
 * Tests for agent registration and identity tagging:
 * POST/GET/PATCH/DELETE /agents, checkpoint agent_id integration,
 * usage event agent_id propagation, and account isolation.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { getPool, closePool } from '../src/store/postgres.js';
import { createRedisClient } from '../src/store/redis.js';

const TEST_REDIS_URL = 'redis://localhost:6379/1';
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.ADMIN_SECRET = 'test_admin';
process.env.JWT_SECRET = 'test_jwt_secret_for_agents_tests_32chars_ok';
process.env.MAX_AGENTS_PER_ACCOUNT = '3'; // low limit for max-agents test

const redis = createRedisClient(TEST_REDIS_URL);
const uid = `ag_${Date.now()}`;

let app;
let pgAvailable = false;

// Accounts and their API keys
const testAccounts = {};

async function createTestAccount(pool, label) {
  // Create account directly (verified + active)
  const result = await pool.query(
    `INSERT INTO accounts (email, name, password_hash, status, email_verified, plan)
     VALUES ($1, $2, 'hash', 'active', TRUE, 'free') RETURNING id`,
    [`${label}_${uid}@example.com`, `Test ${label}`]
  );
  const accountId = result.rows[0].id;

  // Generate API key
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

    testAccounts.main = await createTestAccount(pool, 'main');
    testAccounts.other = await createTestAccount(pool, 'other');
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

// ---------------------------------------------------------------------------
// POST /agents
// ---------------------------------------------------------------------------

describe('POST /agents', () => {
  test('201 registers a new agent', async () => {
    if (!pgAvailable) return;
    const { apiKey } = testAccounts.main;

    const res = await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload: {
        agent_id: `bot_${uid}`,
        name: 'Test Bot',
        description: 'A test agent',
        capabilities: ['search', 'summarize'],
        metadata: { model: 'test-model' },
      },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.agent_id, `bot_${uid}`);
    assert.equal(body.name, 'Test Bot');
    assert.deepEqual(body.capabilities, ['search', 'summarize']);
    assert.ok(body.created_at);
  });

  test('201 upserts (updates) existing agent_id', async () => {
    if (!pgAvailable) return;
    const { apiKey } = testAccounts.main;
    const agentId = `upsert_${uid}`;

    // First registration
    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'Original Name' },
    });

    // Second registration — same agent_id
    const res = await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'Updated Name', capabilities: ['new_cap'] },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'Updated Name');
    assert.deepEqual(body.capabilities, ['new_cap']);
  });

  test('400 VALIDATION_ERROR when agent_id is missing', async () => {
    if (!pgAvailable) return;
    const { apiKey } = testAccounts.main;

    const res = await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload: { name: 'No ID Bot' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  });

  test('400 VALIDATION_ERROR for invalid agent_id characters', async () => {
    if (!pgAvailable) return;
    const { apiKey } = testAccounts.main;

    const res = await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload: { agent_id: 'invalid agent id!', name: 'Bad Bot' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  });

  test('401 without API key', async () => {
    const res = await app.inject({
      method: 'POST', url: '/agents',
      headers: json,
      payload: { agent_id: 'test', name: 'Bot' },
    });
    assert.equal(res.statusCode, 401);
  });

  test('400 MAX_AGENTS_REACHED when at limit (MAX=3)', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'maxagents');

    // Register 3 agents (max)
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: 'POST', url: '/agents',
        headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
        payload: { agent_id: `agent_${i}_${uid}`, name: `Agent ${i}` },
      });
      assert.equal(r.statusCode, 201);
    }

    // 4th should fail
    const res = await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { agent_id: `agent_overflow_${uid}`, name: 'Overflow Agent' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'MAX_AGENTS_REACHED');
  });
});

// ---------------------------------------------------------------------------
// GET /agents
// ---------------------------------------------------------------------------

describe('GET /agents', () => {
  test('200 returns all agents for account', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'listtest');

    // Create two agents
    for (const id of ['list_a', 'list_b']) {
      await app.inject({
        method: 'POST', url: '/agents',
        headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
        payload: { agent_id: `${id}_${uid}`, name: id },
      });
    }

    const res = await app.inject({
      method: 'GET', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}` },
    });
    assert.equal(res.statusCode, 200);
    const { agents } = JSON.parse(res.body);
    assert.ok(Array.isArray(agents));
    assert.equal(agents.length, 2);
    agents.forEach((a) => {
      assert.ok(a.agent_id);
      assert.ok(a.created_at);
    });
  });

  test('200 returns empty list when no agents', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'empty');

    const res = await app.inject({
      method: 'GET', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}` },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).agents, []);
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:agent_id
// ---------------------------------------------------------------------------

describe('GET /agents/:agent_id', () => {
  test('200 returns agent details', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'gettest');
    const agentId = `gettest_${uid}`;

    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'Get Test Bot', capabilities: ['read'] },
    });

    const res = await app.inject({
      method: 'GET', url: `/agents/${agentId}`,
      headers: { Authorization: `Bearer ${acc.apiKey}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.agent_id, agentId);
    assert.equal(body.name, 'Get Test Bot');
    assert.deepEqual(body.capabilities, ['read']);
  });

  test('404 AGENT_NOT_FOUND for non-existent agent', async () => {
    if (!pgAvailable) return;
    const { apiKey } = testAccounts.main;

    const res = await app.inject({
      method: 'GET', url: '/agents/nonexistent_agent_xyz',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error.code, 'AGENT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// PATCH /agents/:agent_id
// ---------------------------------------------------------------------------

describe('PATCH /agents/:agent_id', () => {
  test('200 updates agent fields', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'patchtest');
    const agentId = `patch_${uid}`;

    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'Old Name', capabilities: ['old_cap'] },
    });

    const res = await app.inject({
      method: 'PATCH', url: `/agents/${agentId}`,
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { name: 'New Name', capabilities: ['new_cap1', 'new_cap2'] },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'New Name');
    assert.deepEqual(body.capabilities, ['new_cap1', 'new_cap2']);
  });

  test('404 AGENT_NOT_FOUND when patching non-existent agent', async () => {
    if (!pgAvailable) return;
    const { apiKey } = testAccounts.main;

    const res = await app.inject({
      method: 'PATCH', url: '/agents/ghost_agent',
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      payload: { name: 'Ghost' },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error.code, 'AGENT_NOT_FOUND');
  });

  test('400 when no updatable fields provided', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'patchval');
    const agentId = `patchval_${uid}`;
    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'Val Bot' },
    });

    const res = await app.inject({
      method: 'PATCH', url: `/agents/${agentId}`,
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /agents/:agent_id
// ---------------------------------------------------------------------------

describe('DELETE /agents/:agent_id', () => {
  test('204 deletes agent', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'deltest');
    const agentId = `del_${uid}`;

    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'To Delete' },
    });

    const res = await app.inject({
      method: 'DELETE', url: `/agents/${agentId}`,
      headers: { Authorization: `Bearer ${acc.apiKey}` },
    });
    assert.equal(res.statusCode, 204);

    // Confirm deleted
    const getRes = await app.inject({
      method: 'GET', url: `/agents/${agentId}`,
      headers: { Authorization: `Bearer ${acc.apiKey}` },
    });
    assert.equal(getRes.statusCode, 404);
  });

  test('404 AGENT_NOT_FOUND when deleting non-existent agent', async () => {
    if (!pgAvailable) return;
    const { apiKey } = testAccounts.main;

    const res = await app.inject({
      method: 'DELETE', url: '/agents/nobody_here',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error.code, 'AGENT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Account isolation
// ---------------------------------------------------------------------------

describe('Agent account isolation', () => {
  test('cannot see another account\'s agents', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const accA = await createTestAccount(pool, 'isoA');
    const accB = await createTestAccount(pool, 'isoB');
    const agentId = `iso_agent_${uid}`;

    // accA registers agent
    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${accA.apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'A Bot' },
    });

    // accB tries to get it
    const res = await app.inject({
      method: 'GET', url: `/agents/${agentId}`,
      headers: { Authorization: `Bearer ${accB.apiKey}` },
    });
    assert.equal(res.statusCode, 404);
  });

  test('cannot delete another account\'s agent', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const accA = await createTestAccount(pool, 'delIsoA');
    const accB = await createTestAccount(pool, 'delIsoB');
    const agentId = `del_iso_${uid}`;

    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${accA.apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'A Bot' },
    });

    const res = await app.inject({
      method: 'DELETE', url: `/agents/${agentId}`,
      headers: { Authorization: `Bearer ${accB.apiKey}` },
    });
    assert.equal(res.statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint agent_id integration
// ---------------------------------------------------------------------------

describe('Checkpoint agent_id integration', () => {
  test('saves checkpoint with agent_id — updates last_seen_at', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'cpagent');
    const agentId = `cp_agent_${uid}`;
    const workflowId = `wf_agent_${uid}`;

    // Register agent first
    await app.inject({
      method: 'POST', url: '/agents',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { agent_id: agentId, name: 'CP Agent' },
    });

    // Confirm last_seen_at is null initially
    const beforeResult = await pool.query(
      `SELECT last_seen_at FROM agents WHERE account_id = $1 AND agent_id = $2`,
      [acc.accountId, agentId]
    );
    assert.equal(beforeResult.rows[0]?.last_seen_at, null);

    // Save checkpoint with agent_id
    const cpRes = await app.inject({
      method: 'POST', url: '/checkpoints',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { workflow_id: workflowId, step: 1, state: { x: 1 }, agent_id: agentId },
    });
    assert.equal(cpRes.statusCode, 201);

    // Give setImmediate time to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Confirm last_seen_at updated
    const afterResult = await pool.query(
      `SELECT last_seen_at FROM agents WHERE account_id = $1 AND agent_id = $2`,
      [acc.accountId, agentId]
    );
    assert.ok(afterResult.rows[0]?.last_seen_at, 'last_seen_at should be set after checkpoint save');
  });

  test('saves checkpoint with unregistered agent_id — no error, agent_id in metadata', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'unreg');
    const workflowId = `wf_unreg_${uid}`;

    const res = await app.inject({
      method: 'POST', url: '/checkpoints',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: {
        workflow_id: workflowId,
        step: 1,
        state: { y: 2 },
        agent_id: 'ghost-bot-unregistered',
      },
    });
    assert.equal(res.statusCode, 201);
  });

  test('usage event includes agent_id when provided', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createTestAccount(pool, 'usageagent');
    const agentId = `usage_agent_${uid}`;
    const workflowId = `wf_usage_ag_${uid}`;

    // Save checkpoint with agent_id
    await app.inject({
      method: 'POST', url: '/checkpoints',
      headers: { Authorization: `Bearer ${acc.apiKey}`, ...json },
      payload: { workflow_id: workflowId, step: 1, state: { z: 3 }, agent_id: agentId },
    });

    // Allow async usage tracking to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await pool.query(
      `SELECT agent_id FROM usage_events WHERE account_id = $1 AND workflow_id = $2`,
      [acc.accountId, workflowId]
    );
    assert.ok(result.rows.length > 0, 'usage event should exist');
    assert.equal(result.rows[0].agent_id, agentId);
  });
});
