import { authMiddleware } from '../middleware/auth.js';
import { analyticsService } from '../services/analytics-service.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

// Default date helpers
function defaultStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString();
}

export async function analyticsRoutes(fastify) {
  fastify.addHook('preHandler', authMiddleware);

  /**
   * GET /analytics/overview
   * Account-level aggregate stats for the current billing period.
   */
  fastify.get('/overview', async (request, reply) => {
    const startDate = request.query.start_date ?? defaultStartDate();
    const endDate = request.query.end_date ?? defaultEndDate();

    const overview = await analyticsService.getAccountOverview(
      request.account.id,
      startDate,
      endDate
    );

    return reply.send(overview);
  });

  /**
   * GET /analytics/workflows/:workflow_id
   * Step-by-step timeline for a specific workflow.
   */
  fastify.get('/workflows/:workflow_id', async (request, reply) => {
    const { workflow_id } = request.params;

    const analytics = await analyticsService.getWorkflowAnalytics(
      request.account.id,
      workflow_id
    );

    if (!analytics) {
      // Check timeline (may exist in Redis without a stats row yet)
      const timeline = await analyticsService.getWorkflowTimeline(
        request.account.id,
        workflow_id
      );

      if (!timeline || (timeline.checkpoints.length === 0 && !timeline.first_checkpoint_at)) {
        return sendError(reply, 404, ErrorCodes.NOT_FOUND, `Workflow '${workflow_id}' not found`);
      }

      return reply.send(timeline);
    }

    // Merge DB stats with live checkpoint timeline
    const timeline = await analyticsService.getWorkflowTimeline(
      request.account.id,
      workflow_id
    );

    return reply.send(timeline);
  });

  /**
   * GET /analytics/failures
   * Failure pattern breakdown for this account.
   */
  fastify.get('/failures', async (request, reply) => {
    const days = Math.min(90, Math.max(1, parseInt(request.query.days ?? '7', 10)));
    const patterns = await analyticsService.getFailurePatterns(request.account.id, days);

    // Optional agent_id filter on recent_failures
    const agentFilter = request.query.agent_id;
    if (agentFilter) {
      patterns.recent_failures = patterns.recent_failures.filter(
        (f) => f.agent_id === agentFilter
      );
    }

    return reply.send(patterns);
  });

  /**
   * GET /analytics/agents
   * Per-agent performance metrics.
   */
  fastify.get('/agents', async (request, reply) => {
    const startDate = request.query.start_date ?? defaultStartDate();
    const endDate = request.query.end_date ?? defaultEndDate();

    const performance = await analyticsService.getAgentPerformance(
      request.account.id,
      startDate,
      endDate
    );

    return reply.send(performance);
  });
}
