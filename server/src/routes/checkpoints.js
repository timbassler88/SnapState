import { v4 as uuidv4 } from 'uuid';
import { checkpointBodySchema } from '../store/schemas.js';
import { saveCheckpoint, getCheckpoint } from '../services/checkpoint-writer.js';
import { emitEvent } from '../services/event-emitter.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { sendError, ErrorCodes } from '../utils/errors.js';
import { config } from '../config.js';

export async function checkpointRoutes(fastify) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rateLimitMiddleware);

  // Add X-Request-Id to every response
  fastify.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader('X-Request-Id')) {
      reply.header('X-Request-Id', uuidv4());
    }
  });

  /**
   * POST /checkpoints
   */
  fastify.post('/', {
    schema: {
      body: checkpointBodySchema,
    },
  }, async (request, reply) => {
    const { workflow_id, step, label, state, agent_id, metadata } = request.body;

    // Parse optional TTL from header
    let ttlSeconds = config.defaultTtlSeconds;
    const ttlHeader = request.headers['x-checkpoint-ttl'];
    if (ttlHeader) {
      const parsed = parseInt(ttlHeader, 10);
      if (!isNaN(parsed) && parsed > 0) ttlSeconds = parsed;
    }

    const ifMatch = request.headers['if-match'];

    let checkpoint;
    try {
      // Merge agent_id into metadata so it is persisted with the checkpoint
      const enrichedMetadata = agent_id
        ? { ...metadata, agent_id }
        : metadata;

      checkpoint = await saveCheckpoint({
        workflowId: workflow_id,
        step,
        label,
        state,
        metadata: enrichedMetadata,
        ttlSeconds,
        ifMatch,
      });
    } catch (err) {
      if (err.code === 'PAYLOAD_TOO_LARGE') {
        return sendError(reply, 413, ErrorCodes.PAYLOAD_TOO_LARGE, err.message);
      }
      if (err.code === 'CONFLICT') {
        return reply.code(409).send({
          error: { code: ErrorCodes.CONFLICT, message: err.message },
          existing: err.existing ? { checkpoint_id: err.existing.checkpoint_id, etag: err.existing.etag } : undefined,
        });
      }
      throw err;
    }
    // Track usage and update agent last_seen (non-blocking)
    if (request.account?.id) {
      const { usageTracker } = await import('../services/usage-tracker.js');
      setImmediate(() => {
        usageTracker.track(request.account.id, request.apiKey?.id, 'checkpoint.write', {
          workflow_id: checkpoint.workflow_id,
          checkpoint_size_bytes: checkpoint.size_bytes,
          agent_id: agent_id ?? null,
        });
      });

      if (agent_id) {
        const { agentService } = await import('../services/agent-service.js');
        setImmediate(() => {
          agentService.updateLastSeen(request.account.id, agent_id).catch(() => {});
        });
      }

      // Track analytics (non-blocking)
      const { analyticsService } = await import('../services/analytics-service.js');
      setImmediate(() => {
        analyticsService.updateWorkflowStats(request.account.id, checkpoint.workflow_id, {
          step: checkpoint.step,
          size_bytes: checkpoint.size_bytes,
          agent_id: agent_id ?? null,
          created_at: checkpoint.created_at,
        }).catch(() => {});
      });
    }
    // Fire-and-forget webhook
    emitEvent('checkpoint.saved', {
      workflow_id: checkpoint.workflow_id,
      checkpoint_id: checkpoint.checkpoint_id,
      step: checkpoint.step,
    }, request.apiKey);

    return reply.code(201).send({
      checkpoint_id: checkpoint.checkpoint_id,
      workflow_id: checkpoint.workflow_id,
      step: checkpoint.step,
      etag: checkpoint.etag,
      created_at: checkpoint.created_at,
      diff_from_previous: checkpoint.diff_from_previous,
      size_bytes: checkpoint.size_bytes,
    });
  });

  /**
   * GET /checkpoints/:checkpoint_id
   */
  fastify.get('/:checkpoint_id', async (request, reply) => {
    const { checkpoint_id } = request.params;
    const checkpoint = await getCheckpoint(checkpoint_id);

    if (!checkpoint) {
      return sendError(reply, 404, ErrorCodes.NOT_FOUND, `Checkpoint ${checkpoint_id} not found`);
    }

    return reply.send(checkpoint);
  });
}
