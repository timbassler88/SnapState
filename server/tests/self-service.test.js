/**
 * self-service.test.js
 *
 * Tests for JWT-authenticated self-service routes:
 * GET/PATCH /account, GET/POST/DELETE /account/keys, GET /account/usage
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { getPool, closePool } from '../src/store/postgres.js';
import { createRedisClient } from '../src/store/redis.js';

const TEST_REDIS_URL = 'redis://localhost:6379/1';
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.ADMIN_SECRET = 'test_admin';
process.env.JWT_SECRET = 'test_jwt_secret_for_self_service_tests_32chars';
process.env.MAX_API_KEYS_PER_ACCOUNT = '3'; // low limit for max-keys test

const redis = createRedisClient(TEST_REDIS_URL);
const uid = `ss_${Date.now()}`;

let app;
let pgAvailable = false;

// Track test account state
const testAccounts = {};

async function createVerifiedAccount(pool, label, email, password = 'password123') {
  const { authService } = await import('../src/services/auth-service.js');
  const hash = await authService.hashPassword(password);
  const result = await pool.query(
    `INSERT INTO accounts (email, name, password_hash, status, email_verified, plan)
     VALUES ($1, $2, $3, 'active', TRUE, 'free') RETURNING id`,
    [email, `Test ${label}`, hash]
  );
  const accountId = result.rows[0].id;
  const token = authService.generateJWT(accountId);
  return { accountId, token, email };
}

before(async () => {
  // Silence emails
  const emailModule = await import('../src/services/email-service.js');
  emailModule.emailService.sendVerificationEmail = async () => {};
  emailModule.emailService.sendWelcomeEmail = async () => {};

  app = await buildApp({ logger: false });
  await app.ready();

  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    pgAvailable = true;

    // Create test accounts
    testAccounts.main = await createVerifiedAccount(pool, 'main', `main_${uid}@example.com`);
    testAccounts.other = await createVerifiedAccount(pool, 'other', `other_${uid}@example.com`);
  } catch {
    pgAvailable = false;
  }
});

after(async () => {
  if (pgAvailable) {
    try {
      const pool = getPool();
      await pool.query(`DELETE FROM accounts WHERE email LIKE '%${uid}%'`);
      await closePool();
    } catch { /* ignore */ }
  }
  await app.close();
  await redis.flushdb();
  await redis.quit();
});

// ---------------------------------------------------------------------------
// GET /account
// ---------------------------------------------------------------------------

describe('GET /account', () => {
  test('200 returns own account without password_hash', async () => {
    if (!pgAvailable) return;
    const { token } = testAccounts.main;

    const res = await app.inject({
      method: 'GET', url: '/account',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.id);
    assert.ok(body.email);
    assert.equal(body.password_hash, undefined);
    assert.equal(body.verification_token, undefined);
    assert.equal(body.reset_token, undefined);
  });

  test('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/account' });
    assert.equal(res.statusCode, 401);
  });

  test('401 with invalid JWT', async () => {
    const res = await app.inject({
      method: 'GET', url: '/account',
      headers: { Authorization: 'Bearer totally.invalid.jwt' },
    });
    assert.equal(res.statusCode, 401);
  });

  test('401 with expired JWT', async () => {
    const jwt = await import('jsonwebtoken');
    // Sign a token that expired 1 hour ago
    const expiredToken = jwt.default.sign(
      { sub: 99999 },
      process.env.JWT_SECRET,
      { expiresIn: -3600 }
    );
    const res = await app.inject({
      method: 'GET', url: '/account',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(res.statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /account
// ---------------------------------------------------------------------------

describe('PATCH /account', () => {
  test('200 updates name', async () => {
    if (!pgAvailable) return;
    const { token } = testAccounts.main;

    const res = await app.inject({
      method: 'PATCH', url: '/account',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'Updated Name' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'Updated Name');
  });

  test('400 when no updatable fields provided', async () => {
    if (!pgAvailable) return;
    const { token } = testAccounts.main;

    const res = await app.inject({
      method: 'PATCH', url: '/account',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });

  test('sanitizes name — strips control characters', async () => {
    if (!pgAvailable) return;
    const { token } = testAccounts.main;

    const res = await app.inject({
      method: 'PATCH', url: '/account',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'Clean\x00Name\x07Here' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(!body.name.includes('\x00'));
    assert.ok(!body.name.includes('\x07'));
  });
});

// ---------------------------------------------------------------------------
// GET /account/keys
// ---------------------------------------------------------------------------

describe('GET /account/keys', () => {
  test('200 returns keys without full key or key_hash', async () => {
    if (!pgAvailable) return;
    const { token, accountId } = testAccounts.main;

    // Create a key first
    await app.inject({
      method: 'POST', url: '/account/keys',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { label: 'list-test' },
    });

    const res = await app.inject({
      method: 'GET', url: '/account/keys',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    const { keys } = JSON.parse(res.body);
    assert.ok(Array.isArray(keys));
    // No full key or hash
    keys.forEach((k) => {
      assert.equal(k.api_key, undefined);
      assert.equal(k.key_hash, undefined);
      assert.ok(k.key_prefix);
      assert.ok(typeof k.revoked === 'boolean');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /account/keys
// ---------------------------------------------------------------------------

describe('POST /account/keys', () => {
  test('201 generates a new API key (shown once)', async () => {
    if (!pgAvailable) return;
    const { token } = testAccounts.main;

    const res = await app.inject({
      method: 'POST', url: '/account/keys',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { label: 'new-key' },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.api_key?.startsWith('snp_'));
    assert.ok(body.note?.includes('once'));
  });

  test('400 MAX_KEYS_REACHED when at limit (MAX=3)', async () => {
    if (!pgAvailable) return;

    // Create a fresh account
    const pool = getPool();
    const acc = await createVerifiedAccount(pool, 'maxkeys', `maxkeys_${uid}@example.com`);

    // Generate 3 keys (max)
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST', url: '/account/keys',
        headers: { Authorization: `Bearer ${acc.token}`, 'content-type': 'application/json' },
        payload: { label: `key-${i}` },
      });
    }

    // 4th should fail
    const res = await app.inject({
      method: 'POST', url: '/account/keys',
      headers: { Authorization: `Bearer ${acc.token}`, 'content-type': 'application/json' },
      payload: { label: 'overflow' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'MAX_KEYS_REACHED');
  });
});

// ---------------------------------------------------------------------------
// DELETE /account/keys/:key_id
// ---------------------------------------------------------------------------

describe('DELETE /account/keys/:key_id', () => {
  test('204 revokes own key', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createVerifiedAccount(pool, 'revoke', `revoke_${uid}@example.com`);

    // Create a key
    const createRes = await app.inject({
      method: 'POST', url: '/account/keys',
      headers: { Authorization: `Bearer ${acc.token}`, 'content-type': 'application/json' },
      payload: { label: 'to-revoke' },
    });
    const { id: keyId } = JSON.parse(createRes.body);

    const delRes = await app.inject({
      method: 'DELETE', url: `/account/keys/${keyId}`,
      headers: { Authorization: `Bearer ${acc.token}` },
    });
    assert.equal(delRes.statusCode, 204);

    // Verify revoked in DB
    const dbResult = await pool.query('SELECT revoked_at FROM api_keys WHERE id = $1', [keyId]);
    assert.ok(dbResult.rows[0]?.revoked_at);
  });

  test('404 when trying to revoke another account\'s key', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc1 = await createVerifiedAccount(pool, 'crossA', `cross_a_${uid}@example.com`);
    const acc2 = await createVerifiedAccount(pool, 'crossB', `cross_b_${uid}@example.com`);

    // acc1 creates a key
    const createRes = await app.inject({
      method: 'POST', url: '/account/keys',
      headers: { Authorization: `Bearer ${acc1.token}`, 'content-type': 'application/json' },
      payload: { label: 'acc1-key' },
    });
    const { id: keyId } = JSON.parse(createRes.body);

    // acc2 tries to revoke acc1's key
    const delRes = await app.inject({
      method: 'DELETE', url: `/account/keys/${keyId}`,
      headers: { Authorization: `Bearer ${acc2.token}` },
    });
    assert.equal(delRes.statusCode, 404);
  });

  test('404 for already-revoked key', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const acc = await createVerifiedAccount(pool, 'rr', `rr_${uid}@example.com`);
    const createRes = await app.inject({
      method: 'POST', url: '/account/keys',
      headers: { Authorization: `Bearer ${acc.token}`, 'content-type': 'application/json' },
      payload: { label: 'double-revoke' },
    });
    const { id: keyId } = JSON.parse(createRes.body);

    await app.inject({ method: 'DELETE', url: `/account/keys/${keyId}`, headers: { Authorization: `Bearer ${acc.token}` } });

    const res = await app.inject({
      method: 'DELETE', url: `/account/keys/${keyId}`,
      headers: { Authorization: `Bearer ${acc.token}` },
    });
    assert.equal(res.statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// GET /account/usage
// ---------------------------------------------------------------------------

describe('GET /account/usage', () => {
  test('200 returns usage breakdown', async () => {
    if (!pgAvailable) return;
    const { token } = testAccounts.main;

    const res = await app.inject({
      method: 'GET', url: '/account/usage',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.period?.start);
    assert.ok(body.usage?.checkpoint_writes);
    assert.ok(body.estimated_charge);
  });

  test('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/account/usage' });
    assert.equal(res.statusCode, 401);
  });
});
