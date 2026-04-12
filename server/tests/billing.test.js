/**
 * billing.test.js
 *
 * Tests for usage tracking, daily aggregation, free-tier calculation,
 * and billing route responses. Postgres is required for most tests.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { getPool, closePool } from '../src/store/postgres.js';
import { createRedisClient } from '../src/store/redis.js';

const TEST_REDIS_URL = 'redis://localhost:6379/1';
const ADMIN_SECRET = 'test_billing_admin_secret';
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.ADMIN_SECRET = ADMIN_SECRET;

const redis = createRedisClient(TEST_REDIS_URL);
const uid = `billing_${Date.now()}`;

let app;
let testAccountId;

before(async () => {
  app = buildApp({ logger: false });
  await app.ready();

  try {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO accounts (email, name) VALUES ($1, $2) RETURNING id`,
      [`test_${uid}@example.com`, 'Billing Test Account']
    );
    testAccountId = result.rows[0].id;
  } catch {
    testAccountId = null;
  }
});

after(async () => {
  try {
    if (testAccountId) {
      const pool = getPool();
      await pool.query('DELETE FROM usage_daily WHERE account_id = $1', [testAccountId]);
      await pool.query('DELETE FROM usage_events WHERE account_id = $1', [testAccountId]);
      await pool.query('DELETE FROM accounts WHERE id = $1', [testAccountId]);
    }
    await closePool();
  } catch { /* pg unavailable */ }
  await app.close();
  await redis.flushdb();
  await redis.quit();
});

const adminHeader = { Authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' };

describe('usageTracker.track', () => {
  test('records usage_events and updates usage_daily', async () => {
    if (!testAccountId) return;

    const { usageTracker } = await import('../src/services/usage-tracker.js');
    await usageTracker.track(testAccountId, null, 'checkpoint.write', {
      workflow_id: 'wf_billing_test',
      checkpoint_size_bytes: 1024,
    });

    const pool = getPool();
    const eventsResult = await pool.query(
      'SELECT * FROM usage_events WHERE account_id = $1 AND event_type = $2',
      [testAccountId, 'checkpoint.write']
    );
    assert.ok(eventsResult.rows.length > 0);
    assert.equal(eventsResult.rows[0].workflow_id, 'wf_billing_test');

    const today = new Date().toISOString().slice(0, 10);
    const dailyResult = await pool.query(
      'SELECT checkpoint_writes FROM usage_daily WHERE account_id = $1 AND date = $2',
      [testAccountId, today]
    );
    assert.ok(dailyResult.rows.length > 0);
    assert.ok(parseInt(dailyResult.rows[0].checkpoint_writes, 10) >= 1);
  });

  test('tracks resume calls separately from writes', async () => {
    if (!testAccountId) return;

    const { usageTracker } = await import('../src/services/usage-tracker.js');
    await usageTracker.track(testAccountId, null, 'workflow.resume', { workflow_id: 'wf_resume' });

    const pool = getPool();
    const today = new Date().toISOString().slice(0, 10);
    const result = await pool.query(
      'SELECT resume_calls FROM usage_daily WHERE account_id = $1 AND date = $2',
      [testAccountId, today]
    );
    assert.ok(parseInt(result.rows[0]?.resume_calls ?? '0', 10) >= 1);
  });

  test('handles missing accountId gracefully (no-op)', async () => {
    const { usageTracker } = await import('../src/services/usage-tracker.js');
    // Should not throw with null accountId
    await assert.doesNotReject(() => usageTracker.track(null, null, 'checkpoint.write', {}));
  });
});

describe('billingService.getCurrentUsage', () => {
  test('returns usage breakdown with free tier calculations', async () => {
    if (!testAccountId) return;

    const { billingService } = await import('../src/services/billing-service.js');
    const usage = await billingService.getCurrentUsage(testAccountId);

    assert.ok(usage.period.start);
    assert.ok(usage.period.end);
    assert.ok(usage.usage.checkpoint_writes);
    assert.ok(typeof usage.usage.checkpoint_writes.count === 'number');
    assert.ok(typeof usage.usage.checkpoint_writes.free_remaining === 'number');
    assert.ok(typeof usage.usage.checkpoint_writes.billable === 'number');
    assert.ok(usage.estimated_charge.startsWith('$'));
  });

  test('free tier: writes below 10k show zero billable', async () => {
    if (!testAccountId) return;

    const { billingService } = await import('../src/services/billing-service.js');
    const usage = await billingService.getCurrentUsage(testAccountId);

    // Test account has < 10 writes — should be in free tier
    assert.equal(usage.usage.checkpoint_writes.billable, 0);
    assert.equal(usage.estimated_charge, '$0.00');
  });

  test('free remaining is calculated correctly', async () => {
    if (!testAccountId) return;

    const { billingService } = await import('../src/services/billing-service.js');
    const usage = await billingService.getCurrentUsage(testAccountId);

    const { count, free_remaining, billable } = usage.usage.checkpoint_writes;
    assert.equal(free_remaining + count, Math.max(count, free_remaining + billable));
    // free_remaining + billable = free_tier (10000) when count <= 10000
    if (count <= 10000) {
      assert.equal(free_remaining + count, 10000);
    }
  });
});

describe('GET /admin/accounts/:id/usage', () => {
  test('returns 200 with usage breakdown', async () => {
    if (!testAccountId) return;

    const res = await app.inject({
      method: 'GET',
      url: `/admin/accounts/${testAccountId}/usage`,
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.period);
    assert.ok(body.usage);
    assert.ok(body.estimated_charge);
  });

  test('returns 401 without admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/accounts/1/usage',
    });
    assert.equal(res.statusCode, 401);
  });

  test('returns 400 for invalid account ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/accounts/not_a_number/usage',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('POST /billing/stripe-webhook', () => {
  test('returns 200 when Stripe is not configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/billing/stripe-webhook',
      headers: { 'content-type': 'application/json' },
      payload: { type: 'invoice.paid', data: { object: {} } },
    });
    // When STRIPE_SECRET_KEY is not set, webhook is accepted and ignored
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.received, true);
  });

  test('returns 400 with invalid Stripe signature when configured', async () => {
    // Only tests signature rejection when Stripe IS configured
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return;

    const res = await app.inject({
      method: 'POST',
      url: '/billing/stripe-webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1234,v1=invalid_sig',
      },
      payload: { type: 'invoice.paid' },
    });
    assert.equal(res.statusCode, 400);
  });
});
