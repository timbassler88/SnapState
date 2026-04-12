import { v4 as uuidv4 } from 'uuid';
import { replayQuerySchema } from '../store/schemas.js';
import { getLatestCheckpoint, replayCheckpoints } from '../services/resume-engine.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

export async function workflowRoutes(fastify) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rateLimitMiddleware);

  fastify.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader('X-Request-Id')) {
      reply.header('X-Request-Id', uuidv4());
    }
  });

  /**
   * GET /workflows/:workflow_id/resume
   */
  fastify.get('/:workflow_id/resume', async (request, reply) => {
    const { workflow_id } = request.params;
    const result = await getLatestCheckpoint(workflow_id);

    if (!result) {
      return sendError(reply, 404, ErrorCodes.NOT_FOUND, `No checkpoints found for workflow ${workflow_id}`);
    }

    // Track usage (non-blocking)
    if (request.account?.id) {
      const { usageTracker } = await import('../services/usage-tracker.js');
      setImmediate(() => {
        usageTracker.track(request.account.id, request.apiKey?.id, 'workflow.resume', {
          workflow_id,
        });
      });
    }

    return reply.send(result);
  });

  /**
   * GET /workflows/:workflow_id/replay
   */
  fastify.get('/:workflow_id/replay', {
    schema: { querystring: replayQuerySchema },
  }, async (request, reply) => {
    const { workflow_id } = request.params;
    const { from_step, to_step, limit } = request.query;

    const result = await replayCheckpoints(workflow_id, {
      fromStep: from_step,
      toStep: to_step,
      limit,
    });

    // Track usage (non-blocking)
    if (request.account?.id) {
      const { usageTracker } = await import('../services/usage-tracker.js');
      setImmediate(() => {
        usageTracker.track(request.account.id, request.apiKey?.id, 'workflow.replay', {
          workflow_id,
        });
      });
    }

    return reply.send({
      workflow_id,
      ...result,
    });
  });
}
