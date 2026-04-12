import { createHash, randomBytes } from 'node:crypto';
import { getPool } from '../store/postgres.js';
import { config } from '../config.js';

/**
 * Create a new account.
 *
 * @param {{ email: string, name?: string }} params
 * @returns {Promise<object>} account row
 */
export async function createAccount({ email, name }) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO accounts (email, name)
     VALUES ($1, $2)
     RETURNING id, email, name, plan, status, stripe_customer_id, created_at, updated_at`,
    [email, name ?? null]
  );
  return result.rows[0];
}

/**
 * Get an account by ID, with current-period usage summary.
 *
 * @param {number} accountId
 * @returns {Promise<object|null>}
 */
export async function getAccount(accountId) {
  const pool = getPool();
  const [accountResult, usageResult] = await Promise.all([
    pool.query(
      `SELECT id, email, name, plan, status, stripe_customer_id, created_at, updated_at
       FROM accounts WHERE id = $1`,
      [accountId]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(checkpoint_writes), 0) AS checkpoint_writes,
         COALESCE(SUM(checkpoint_reads), 0) AS checkpoint_reads,
         COALESCE(SUM(resume_calls), 0) AS resume_calls,
         COALESCE(SUM(replay_calls), 0) AS replay_calls,
         COALESCE(SUM(storage_bytes_written), 0) AS storage_bytes_written
       FROM usage_daily
       WHERE account_id = $1
         AND date >= date_trunc('month', NOW())`,
      [accountId]
    ),
  ]);

  if (accountResult.rows.length === 0) return null;

  return {
    ...accountResult.rows[0],
    usage_this_month: usageResult.rows[0],
  };
}

/**
 * List all accounts with basic usage summary.
 *
 * @param {{ page?: number, limit?: number }} opts
 */
export async function listAccounts({ page = 1, limit = 50 } = {}) {
  const pool = getPool();
  const offset = (page - 1) * limit;
  const result = await pool.query(
    `SELECT id, email, name, plan, status, created_at
     FROM accounts
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await pool.query('SELECT COUNT(*) FROM accounts');
  return {
    accounts: result.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Generate a new API key for an account.
 * Stores only the SHA-256 hash — returns the raw key to the caller (shown once).
 *
 * @param {number} accountId
 * @param {{ label?: string, scopes?: string[], expiresAt?: Date }} params
 * @returns {Promise<{ rawKey: string, record: object }>}
 */
export async function generateApiKey(accountId, { label, scopes, expiresAt } = {}) {
  const rawKey = `${config.apiKeyPrefix}${randomBytes(16).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);
  const defaultScopes = ['checkpoints:write', 'checkpoints:read', 'webhooks:manage'];

  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO api_keys (account_id, key_hash, key_prefix, label, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, account_id, key_prefix, label, scopes, expires_at, created_at`,
    [accountId, keyHash, keyPrefix, label ?? null, JSON.stringify(scopes ?? defaultScopes), expiresAt ?? null]
  );

  return { rawKey, record: result.rows[0] };
}

/**
 * Revoke an API key (sets revoked_at, does not delete the row).
 * Also invalidates the Redis auth cache for this key.
 *
 * @param {number} accountId
 * @param {number} keyId
 * @returns {Promise<boolean>} true if revoked, false if not found
 */
export async function revokeApiKey(accountId, keyId) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE api_keys
     SET revoked_at = NOW()
     WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [keyId, accountId]
  );
  return result.rows.length > 0;
}

/**
 * List API keys for an account (never returns key_hash).
 *
 * @param {number} accountId
 */
export async function listApiKeys(accountId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, key_prefix, label, scopes, last_used_at, expires_at, revoked_at, created_at
     FROM api_keys
     WHERE account_id = $1
     ORDER BY created_at DESC`,
    [accountId]
  );
  return result.rows;
}

/**
 * Update account Stripe customer ID after Stripe customer creation.
 */
export async function setStripeCustomerId(accountId, stripeCustomerId) {
  const pool = getPool();
  await pool.query(
    'UPDATE accounts SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
    [stripeCustomerId, accountId]
  );
}

/**
 * Update account plan and status (used by Stripe webhook handler).
 */
export async function updateAccountPlan(accountId, { plan, status }) {
  const pool = getPool();
  await pool.query(
    'UPDATE accounts SET plan = $1, status = $2, updated_at = NOW() WHERE id = $3',
    [plan, status, accountId]
  );
}
