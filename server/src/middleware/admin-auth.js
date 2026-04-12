import { config } from '../config.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

/**
 * Fastify preHandler: validates admin Bearer token against ADMIN_SECRET.
 *
 * Phase 2 placeholder — Phase 3 will add session-based auth.
 */
export async function adminAuthMiddleware(request, reply) {
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7).trim();
  if (token !== config.adminSecret) {
    return sendError(reply, 401, ErrorCodes.UNAUTHORIZED, 'Invalid admin secret');
  }
}
