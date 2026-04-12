/**
 * Send a standardized error response.
 *
 * @param {import('fastify').FastifyReply} reply
 * @param {number} statusCode
 * @param {string} code - Machine-readable error code
 * @param {string} message - Human-readable message
 */
export function sendError(reply, statusCode, code, message) {
  return reply.code(statusCode).send({ error: { code, message } });
}

export const ErrorCodes = {
  // Generic HTTP errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_SERVER_ERROR',          // kept for backward compatibility
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Identifier validation
  INVALID_WORKFLOW_ID: 'INVALID_WORKFLOW_ID',
  INVALID_AGENT_ID: 'INVALID_AGENT_ID',

  // Phase 3 — Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  INVALID_EMAIL: 'INVALID_EMAIL',
  WEAK_PASSWORD: 'WEAK_PASSWORD',

  // Phase 3 — Keys
  MAX_KEYS_REACHED: 'MAX_KEYS_REACHED',
  KEY_REVOKED: 'KEY_REVOKED',

  // Phase 3 — Agents
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  MAX_AGENTS_REACHED: 'MAX_AGENTS_REACHED',
};
