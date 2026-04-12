import { createHash } from 'node:crypto';
import { getRedis } from '../store/redis.js';
import { getPool } from '../store/postgres.js';
import { sendError, ErrorCodes } from '../utils/errors.js';
import { config } from '../config.js';

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Fastify preHandler: validates Bearer token.
 *
 * Lookup order:
 * 1. Redis cache (5-minute TTL) for hot-path performance
 * 2. Postgres api_keys + accounts tables
 *
 * Attaches request.account (account row) and request.apiKey (api_key row).
 * Falls back to legacy Redis SET lookup when Postgres is unavailable (e.g. tests).
 */
export async function authMiddleware(request, reply) {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Missing or malformed Authorization header');
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'API key is empty');
  }

  const keyHash = hashKey(rawKey);
  const redis = getRedis();
  const cacheKey = `auth_cache:${keyHash}`;

  // 1. Check Redis cache
  const cached = await redis.get(cacheKey);
  if (cached === 'invalid') {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Invalid API key');
  }
  if (cached) {
    try {
      const { account, apiKey } = JSON.parse(cached);
      request.account = account;
      request.apiKey = apiKey;
      return;
    } catch {
      // corrupted cache entry — fall through to Postgres
    }
  }

  // 2. Try Postgres lookup
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT
         k.id AS key_id, k.account_id, k.key_hash, k.key_prefix, k.label,
         k.scopes, k.last_used_at, k.expires_at, k.revoked_at,
         a.id AS account_id, a.email, a.name, a.plan, a.status, a.stripe_customer_id
       FROM api_keys k
       JOIN accounts a ON a.id = k.account_id
       WHERE k.key_hash = $1`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      await redis.set(cacheKey, 'invalid', 'EX', 60); // cache miss for 1 min
      return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Invalid API key');
    }

    const row = result.rows[0];

    if (row.revoked_at) {
      await redis.set(cacheKey, 'invalid', 'EX', 60);
      return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'API key has been revoked');
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await redis.set(cacheKey, 'invalid', 'EX', 60);
      return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'API key has expired');
    }
    if (row.status !== 'active') {
      return sendError(reply, 403, ErrorCodes.FORBIDDEN, 'Account is not active');
    }

    const account = {
      id: row.account_id,
      email: row.email,
      name: row.name,
      plan: row.plan,
      status: row.status,
      stripeCustomerId: row.stripe_customer_id,
    };
    const apiKey = {
      id: row.key_id,
      accountId: row.account_id,
      keyPrefix: row.key_prefix,
      label: row.label,
      scopes: row.scopes,
    };

    // Cache result
    await redis.set(cacheKey, JSON.stringify({ account, apiKey }), 'EX', config.authCacheTtlSeconds);

    // Update last_used_at non-blocking
    pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.key_id]).catch(() => {});

    request.account = account;
    request.apiKey = apiKey;
    return;
  } catch (pgErr) {
    // Postgres unavailable — fall back to legacy Redis SET (for Phase 1 tests)
    const isMember = await redis.sismember('api_keys', rawKey);
    if (!isMember) {
      return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Invalid API key');
    }
    // Attach minimal stubs so downstream code doesn't crash
    request.account = { id: null };
    request.apiKey = rawKey;
    return;
  }
}

/**
 * Invalidate cached auth for a specific raw API key.
 * Call this when revoking a key.
 */
export async function invalidateAuthCache(rawKey) {
  const redis = getRedis();
  const keyHash = hashKey(rawKey);
  await redis.del(`auth_cache:${keyHash}`);
}
