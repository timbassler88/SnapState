import { sessionAuthMiddleware } from '../middleware/session-auth.js';
import { getPool } from '../store/postgres.js';
import { generateApiKey, revokeApiKey, listApiKeys } from '../services/account-service.js';
import { billingService } from '../services/billing-service.js';
import { invalidateAuthCache } from '../middleware/auth.js';
import { sanitizeString } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errors.js';
import { config } from '../config.js';

export async function selfServiceRoutes(fastify) {
  fastify.addHook('preHandler', sessionAuthMiddleware);

  /**
   * GET /account
   * Returns the authenticated account (no password_hash or tokens).
   */
  fastify.get('/', async (request, reply) => {
    const { id, email, name, plan, status, last_login_at, created_at } = request.account;
    return reply.send({ id, email, name, plan, status, last_login_at, created_at });
  });

  /**
   * PATCH /account
   * Update own display name.
   */
  fastify.patch('/', async (request, reply) => {
    const { name: rawName } = request.body ?? {};
    if (rawName === undefined) {
      return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'No updatable fields provided');
    }

    const name = sanitizeString(rawName, 255);
    const pool = getPool();
    const result = await pool.query(
      `UPDATE accounts SET name = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, name, plan, status, last_login_at, created_at`,
      [name, request.account.id]
    );

    return reply.send(result.rows[0]);
  });

  /**
   * GET /account/keys
   * List own API keys — never returns full key or key_hash.
   */
  fastify.get('/keys', async (request, reply) => {
    const keys = await listApiKeys(request.account.id);
    return reply.send({
      keys: keys.map((k) => ({
        id: k.id,
        key_prefix: k.key_prefix,
        label: k.label,
        scopes: k.scopes,
        last_used_at: k.last_used_at,
        created_at: k.created_at,
        revoked: !!k.revoked_at,
      })),
    });
  });

  /**
   * POST /account/keys
   * Generate a new API key for own account.
   */
  fastify.post('/keys', async (request, reply) => {
    const { label: rawLabel, scopes } = request.body ?? {};

    // Check key count limit
    const pool = getPool();
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM api_keys WHERE account_id = $1 AND revoked_at IS NULL`,
      [request.account.id]
    );
    const activeCount = parseInt(countResult.rows[0].count, 10);

    if (activeCount >= config.maxApiKeysPerAccount) {
      return sendError(
        reply,
        400,
        ErrorCodes.MAX_KEYS_REACHED,
        `Maximum of ${config.maxApiKeysPerAccount} active API keys allowed`
      );
    }

    const label = rawLabel ? sanitizeString(rawLabel, 255) : undefined;
    const { rawKey, record } = await generateApiKey(request.account.id, { label, scopes });

    return reply.code(201).send({
      ...record,
      api_key: rawKey,
      note: 'Store this key securely — it will not be shown again.',
    });
  });

  /**
   * DELETE /account/keys/:key_id
   * Revoke own API key by ID.
   */
  fastify.delete('/keys/:key_id', async (request, reply) => {
    const keyId = parseInt(request.params.key_id, 10);
    if (isNaN(keyId)) {
      return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid key ID');
    }

    // Fetch the key to get the prefix for cache invalidation
    const pool = getPool();
    const keyResult = await pool.query(
      `SELECT key_hash FROM api_keys
       WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL`,
      [keyId, request.account.id]
    );

    if (keyResult.rows.length === 0) {
      return sendError(reply, 404, ErrorCodes.NOT_FOUND, 'API key not found or already revoked');
    }

    const revoked = await revokeApiKey(request.account.id, keyId);
    if (!revoked) {
      return sendError(reply, 404, ErrorCodes.NOT_FOUND, 'API key not found');
    }

    // Invalidate Redis auth cache — we have the hash directly
    const keyHash = keyResult.rows[0].key_hash;
    const redis = (await import('../store/redis.js')).getRedis();
    await redis.del(`auth_cache:${keyHash}`);

    return reply.code(204).send();
  });

  /**
   * GET /account/usage
   * Own usage for the current billing period.
   */
  fastify.get('/usage', async (request, reply) => {
    const usage = await billingService.getCurrentUsage(request.account.id);
    return reply.send(usage);
  });
}
