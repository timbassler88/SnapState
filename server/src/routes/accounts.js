import { v4 as uuidv4 } from 'uuid';
import { adminAuthMiddleware } from '../middleware/admin-auth.js';
import {
  createAccount,
  getAccount,
  listAccounts,
  generateApiKey,
  revokeApiKey,
  listApiKeys,
} from '../services/account-service.js';
import { billingService } from '../services/billing-service.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

const createAccountSchema = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    name: { type: 'string', maxLength: 255 },
  },
};

const createKeySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string', maxLength: 255 },
    scopes: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['checkpoints:write', 'checkpoints:read', 'webhooks:manage'],
      },
    },
  },
};

export async function accountRoutes(fastify) {
  fastify.addHook('preHandler', adminAuthMiddleware);

  fastify.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader('X-Request-Id')) reply.header('X-Request-Id', uuidv4());
  });

  /** POST /admin/accounts */
  fastify.post('/accounts', { schema: { body: createAccountSchema } }, async (request, reply) => {
    const { email, name } = request.body;
    const account = await createAccount({ email, name });

    // Create Stripe customer non-blocking
    billingService.createCustomer(account).catch(() => {});

    return reply.code(201).send(account);
  });

  /** GET /admin/accounts */
  fastify.get('/accounts', async (request, reply) => {
    const page = parseInt(request.query.page ?? '1', 10);
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 200);
    return reply.send(await listAccounts({ page, limit }));
  });

  /** GET /admin/accounts/:id */
  fastify.get('/accounts/:id', async (request, reply) => {
    const accountId = parseInt(request.params.id, 10);
    if (isNaN(accountId)) return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid account ID');

    const account = await getAccount(accountId);
    if (!account) return sendError(reply, 404, ErrorCodes.NOT_FOUND, `Account ${accountId} not found`);

    return reply.send(account);
  });

  /** POST /admin/accounts/:id/keys */
  fastify.post('/accounts/:id/keys', { schema: { body: createKeySchema } }, async (request, reply) => {
    const accountId = parseInt(request.params.id, 10);
    if (isNaN(accountId)) return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid account ID');

    const account = await getAccount(accountId);
    if (!account) return sendError(reply, 404, ErrorCodes.NOT_FOUND, `Account ${accountId} not found`);

    const { label, scopes } = request.body;
    const { rawKey, record } = await generateApiKey(accountId, { label, scopes });

    return reply.code(201).send({
      ...record,
      // Raw key shown exactly once
      api_key: rawKey,
      note: 'Store this key securely — it will not be shown again.',
    });
  });

  /** GET /admin/accounts/:id/keys */
  fastify.get('/accounts/:id/keys', async (request, reply) => {
    const accountId = parseInt(request.params.id, 10);
    if (isNaN(accountId)) return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid account ID');

    const keys = await listApiKeys(accountId);
    return reply.send({ keys });
  });

  /** DELETE /admin/accounts/:id/keys/:key_id */
  fastify.delete('/accounts/:id/keys/:key_id', async (request, reply) => {
    const accountId = parseInt(request.params.id, 10);
    const keyId = parseInt(request.params.key_id, 10);
    if (isNaN(accountId) || isNaN(keyId)) {
      return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'Invalid ID');
    }

    const revoked = await revokeApiKey(accountId, keyId);
    if (!revoked) return sendError(reply, 404, ErrorCodes.NOT_FOUND, `API key ${keyId} not found`);

    return reply.code(204).send();
  });
}
