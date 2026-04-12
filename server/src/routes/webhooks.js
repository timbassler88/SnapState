import { v4 as uuidv4 } from 'uuid';
import { webhookBodySchema } from '../store/schemas.js';
import { registerWebhook, deleteWebhook } from '../services/event-emitter.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

export async function webhookRoutes(fastify) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rateLimitMiddleware);

  fastify.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader('X-Request-Id')) {
      reply.header('X-Request-Id', uuidv4());
    }
  });

  /**
   * POST /webhooks
   */
  fastify.post('/', {
    schema: { body: webhookBodySchema },
  }, async (request, reply) => {
    const { url, events, secret } = request.body;

    const webhook = await registerWebhook(request.apiKey, { url, events, secret });

    return reply.code(201).send(webhook);
  });

  /**
   * DELETE /webhooks/:webhook_id
   */
  fastify.delete('/:webhook_id', async (request, reply) => {
    const { webhook_id } = request.params;
    const deleted = await deleteWebhook(request.apiKey, webhook_id);

    if (!deleted) {
      return sendError(reply, 404, ErrorCodes.NOT_FOUND, `Webhook ${webhook_id} not found`);
    }

    return reply.code(204).send();
  });
}
