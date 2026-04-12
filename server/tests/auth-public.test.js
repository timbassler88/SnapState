/**
 * auth-public.test.js
 *
 * Tests for public auth routes: signup, email verification, login,
 * forgot/reset password, and auth rate limiting.
 *
 * Requires Postgres at DATABASE_URL. Tests are skipped gracefully when unavailable.
 * Email sending is verified via side-effects on the DB (token stored), not SMTP.
 */

import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { getPool, closePool } from '../src/store/postgres.js';
import { createRedisClient } from '../src/store/redis.js';

const TEST_REDIS_URL = 'redis://localhost:6379/1';
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.ADMIN_SECRET = 'test_admin';
process.env.JWT_SECRET = 'test_jwt_secret_for_auth_tests_minimum_32_chars_ok';

const redis = createRedisClient(TEST_REDIS_URL);
const uid = `auth_${Date.now()}`;

let app;
let pgAvailable = false;

// Silence email sending in tests
const emailMock = { sent: [] };
const mockEmail = async (type, email, token) => emailMock.sent.push({ type, email, token });

before(async () => {
  // Patch email service before app starts
  const emailModule = await import('../src/services/email-service.js');
  emailModule.emailService.sendVerificationEmail = (e, t) => mockEmail('verify', e, t);
  emailModule.emailService.sendWelcomeEmail = (e) => mockEmail('welcome', e);
  emailModule.emailService.sendPasswordResetEmail = (e, t) => mockEmail('reset', e, t);

  app = await buildApp({ logger: false });
  await app.ready();

  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    pgAvailable = true;
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

function testEmail(n) { return `test_${n}_${uid}@example.com`; }

// ---------------------------------------------------------------------------
// POST /auth/signup
// ---------------------------------------------------------------------------

describe('POST /auth/signup', () => {
  test('201 with valid email and password', async () => {
    if (!pgAvailable) return;

    const res = await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email: testEmail('signup1'), password: 'password123', name: 'Test User' },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.match(body.message, /verify/i);
    // No sensitive data leaked
    assert.equal(body.id, undefined);
    assert.equal(body.api_key, undefined);
  });

  test('409 EMAIL_ALREADY_EXISTS on duplicate email', async () => {
    if (!pgAvailable) return;

    const email = testEmail('dup');
    await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email, password: 'password123' },
    });
    const res = await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email, password: 'password123' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error.code, 'EMAIL_ALREADY_EXISTS');
  });

  test('400 INVALID_EMAIL for bad email format', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email: 'not-an-email', password: 'password123' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'INVALID_EMAIL');
  });

  test('400 WEAK_PASSWORD for short password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email: testEmail('weak'), password: 'short' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'WEAK_PASSWORD');
  });

  test('400 WEAK_PASSWORD for exactly 7-char password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email: testEmail('weak2'), password: '1234567' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'WEAK_PASSWORD');
  });
});

// ---------------------------------------------------------------------------
// POST /auth/verify-email
// ---------------------------------------------------------------------------

describe('POST /auth/verify-email', () => {
  test('200, account activated, API key returned', async () => {
    if (!pgAvailable) return;

    const email = testEmail('verify1');
    await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email, password: 'password123' },
    });

    // Get the token from DB
    const pool = getPool();
    const result = await pool.query(
      `SELECT verification_token FROM accounts WHERE LOWER(email) = $1`,
      [email.toLowerCase()]
    );
    const token = result.rows[0]?.verification_token;
    assert.ok(token, 'verification_token should be set after signup');

    const res = await app.inject({
      method: 'POST', url: '/auth/verify-email', headers: json,
      payload: { token },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.api_key?.startsWith('snp_'), 'api_key should be returned');
    assert.match(body.message, /verified/i);

    // Verify account is now active
    const acc = await pool.query(`SELECT status, email_verified FROM accounts WHERE LOWER(email) = $1`, [email.toLowerCase()]);
    assert.equal(acc.rows[0].status, 'active');
    assert.equal(acc.rows[0].email_verified, true);
  });

  test('400 TOKEN_EXPIRED for expired token', async () => {
    if (!pgAvailable) return;

    const pool = getPool();
    const email = testEmail('expired_token');
    await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email, password: 'password123' },
    });
    // Manually expire the token
    await pool.query(
      `UPDATE accounts SET verification_expires_at = NOW() - INTERVAL '1 hour'
       WHERE LOWER(email) = $1`,
      [email.toLowerCase()]
    );
    const row = await pool.query(`SELECT verification_token FROM accounts WHERE LOWER(email) = $1`, [email.toLowerCase()]);
    const token = row.rows[0]?.verification_token;

    const res = await app.inject({
      method: 'POST', url: '/auth/verify-email', headers: json,
      payload: { token },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'TOKEN_EXPIRED');
  });

  test('400 for invalid token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/verify-email', headers: json,
      payload: { token: 'completely_invalid_token_xyz' },
    });
    assert.equal(res.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  let verifiedEmail;

  before(async () => {
    if (!pgAvailable) return;
    verifiedEmail = testEmail('login_user');
    await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email: verifiedEmail, password: 'mypassword1' },
    });
    const pool = getPool();
    // Verify directly in DB
    await pool.query(
      `UPDATE accounts SET email_verified = TRUE, status = 'active',
       verification_token = NULL, verification_expires_at = NULL
       WHERE LOWER(email) = $1`,
      [verifiedEmail.toLowerCase()]
    );
  });

  test('200 with valid credentials, returns JWT', async () => {
    if (!pgAvailable) return;

    const res = await app.inject({
      method: 'POST', url: '/auth/login', headers: json,
      payload: { email: verifiedEmail, password: 'mypassword1' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.token);
    assert.ok(typeof body.expires_in === 'number');
    // Validate JWT structure
    const parts = body.token.split('.');
    assert.equal(parts.length, 3);
  });

  test('401 INVALID_CREDENTIALS for wrong password', async () => {
    if (!pgAvailable) return;

    const res = await app.inject({
      method: 'POST', url: '/auth/login', headers: json,
      payload: { email: verifiedEmail, password: 'wrongpassword' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error.code, 'INVALID_CREDENTIALS');
  });

  test('401 INVALID_CREDENTIALS for unknown email', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login', headers: json,
      payload: { email: 'nobody@nowhere.com', password: 'password123' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error.code, 'INVALID_CREDENTIALS');
  });

  test('403 EMAIL_NOT_VERIFIED for unverified account', async () => {
    if (!pgAvailable) return;

    const email = testEmail('unverified');
    await app.inject({
      method: 'POST', url: '/auth/signup', headers: json,
      payload: { email, password: 'password123' },
    });
    const res = await app.inject({
      method: 'POST', url: '/auth/login', headers: json,
      payload: { email, password: 'password123' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error.code, 'EMAIL_NOT_VERIFIED');
  });
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password
// ---------------------------------------------------------------------------

describe('POST /auth/forgot-password', () => {
  test('200 for existing email', async () => {
    if (!pgAvailable) return;
    const email = testEmail('forgot');
    await app.inject({ method: 'POST', url: '/auth/signup', headers: json, payload: { email, password: 'password123' } });
    const pool = getPool();
    await pool.query(`UPDATE accounts SET email_verified = TRUE, status = 'active' WHERE LOWER(email) = $1`, [email.toLowerCase()]);

    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password', headers: json,
      payload: { email },
    });
    assert.equal(res.statusCode, 200);
    assert.match(JSON.parse(res.body).message, /reset link/i);
  });

  test('200 for non-existing email (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/forgot-password', headers: json,
      payload: { email: `nonexistent_${uid}@example.com` },
    });
    assert.equal(res.statusCode, 200);
    // Same message
    assert.match(JSON.parse(res.body).message, /reset link/i);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// ---------------------------------------------------------------------------

describe('POST /auth/reset-password', () => {
  test('200 with valid token, can login with new password', async () => {
    if (!pgAvailable) return;

    const email = testEmail('reset');
    await app.inject({ method: 'POST', url: '/auth/signup', headers: json, payload: { email, password: 'oldpassword1' } });
    const pool = getPool();
    await pool.query(`UPDATE accounts SET email_verified = TRUE, status = 'active' WHERE LOWER(email) = $1`, [email.toLowerCase()]);

    // Generate reset token
    const { authService } = await import('../src/services/auth-service.js');
    const resetResult = await authService.generateResetToken(email);
    assert.ok(resetResult?.token);

    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password', headers: json,
      payload: { token: resetResult.token, password: 'newpassword1' },
    });
    assert.equal(res.statusCode, 200);

    // Login with new password
    const loginRes = await app.inject({
      method: 'POST', url: '/auth/login', headers: json,
      payload: { email, password: 'newpassword1' },
    });
    assert.equal(loginRes.statusCode, 200);
  });

  test('400 TOKEN_EXPIRED for expired reset token', async () => {
    if (!pgAvailable) return;

    const email = testEmail('reset_expired');
    await app.inject({ method: 'POST', url: '/auth/signup', headers: json, payload: { email, password: 'password123' } });
    const pool = getPool();
    await pool.query(`UPDATE accounts SET email_verified = TRUE, status = 'active' WHERE LOWER(email) = $1`, [email.toLowerCase()]);

    const { authService } = await import('../src/services/auth-service.js');
    const resetResult = await authService.generateResetToken(email);

    // Expire the token
    await pool.query(`UPDATE accounts SET reset_expires_at = NOW() - INTERVAL '1 hour' WHERE LOWER(email) = $1`, [email.toLowerCase()]);

    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password', headers: json,
      payload: { token: resetResult.token, password: 'newpassword1' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'TOKEN_EXPIRED');
  });

  test('400 for invalid reset token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password', headers: json,
      payload: { token: 'badtoken_xyz', password: 'newpassword1' },
    });
    assert.equal(res.statusCode, 400);
  });

  test('400 WEAK_PASSWORD for short new password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password', headers: json,
      payload: { token: 'anytoken', password: 'short' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'WEAK_PASSWORD');
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('Auth rate limiting', () => {
  test('429 after 10 rapid requests to /auth/signup', async () => {
    // Fire 11 requests quickly — 11th should be rate-limited
    const requests = Array.from({ length: 11 }, () =>
      app.inject({
        method: 'POST', url: '/auth/signup', headers: json,
        payload: { email: `ratelimit_${Math.random()}@example.com`, password: 'password123' },
      })
    );
    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.statusCode);
    assert.ok(statuses.some((s) => s === 429), `Expected at least one 429, got: ${statuses.join(', ')}`);
  });
});
