import { authService } from '../services/auth-service.js';
import { getPool } from '../store/postgres.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

/**
 * Fastify preHandler: validates a JWT Bearer token and attaches request.account.
 *
 * - Extracts token from Authorization: Bearer <jwt>
 * - Verifies JWT signature and expiry via authService.verifyJWT
 * - Loads fresh account row from Postgres (so revocation/disable is reflected)
 * - Checks account.status === 'active'
 * - Attaches request.account
 */
export async function sessionAuthMiddleware(request, reply) {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Token is empty');
  }

  let accountId;
  try {
    accountId = authService.verifyJWT(token);
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return sendError(
      reply,
      401,
      isExpired ? ErrorCodes.TOKEN_EXPIRED : ErrorCodes.UNAUTHORIZED,
      isExpired ? 'Session token has expired' : 'Invalid session token'
    );
  }

  let account;
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, name, plan, status, email_verified, last_login_at, created_at
       FROM accounts WHERE id = $1`,
      [accountId]
    );
    account = result.rows[0];
  } catch {
    return sendError(reply, 503, ErrorCodes.INTERNAL, 'Service temporarily unavailable');
  }

  if (!account) {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Account not found');
  }

  if (account.status !== 'active') {
    return sendError(reply, 403, ErrorCodes.ACCOUNT_DISABLED, 'Account is not active');
  }

  request.account = account;
}
