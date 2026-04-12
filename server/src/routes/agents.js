import { authMiddleware } from '../middleware/auth.js';
import { agentService } from '../services/agent-service.js';
import { validateAgentId, sanitizeString } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

export async function agentRoutes(fastify) {
  fastify.addHook('preHandler', authMiddleware);

  /**
   * POST /agents
   * Register or update an agent (upsert).
   */
  fastify.post('/', async (request, reply) => {
    const { agent_id: rawAgentId, name: rawName, description, capabilities, metadata } = request.body ?? {};

    if (!rawAgentId) {
      return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'agent_id is required');
    }

    if (!validateAgentId(rawAgentId)) {
      return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'agent_id must be 1–255 alphanumeric characters, underscores, or hyphens');
    }
    const agentId = rawAgentId;

    const name = rawName ? sanitizeString(rawName, 255) : undefined;

    let agent;
    try {
      agent = await agentService.registerAgent(request.account.id, {
        agentId,
        name,
        description,
        capabilities,
        metadata,
      });
    } catch (err) {
      if (err.code === 'MAX_AGENTS_REACHED') {
        return sendError(reply, 400, ErrorCodes.MAX_AGENTS_REACHED, err.message);
      }
      throw err;
    }

    return reply.code(201).send(agent);
  });

  /**
   * GET /agents
   * List all agents for this account.
   */
  fastify.get('/', async (request, reply) => {
    const agents = await agentService.listAgents(request.account.id);
    return reply.send({ agents });
  });

  /**
   * GET /agents/:agent_id
   * Get a specific agent.
   */
  fastify.get('/:agent_id', async (request, reply) => {
    const { agent_id } = request.params;
    const agent = await agentService.getAgent(request.account.id, agent_id);

    if (!agent) {
      return sendError(reply, 404, ErrorCodes.AGENT_NOT_FOUND, `Agent '${agent_id}' not found`);
    }

    return reply.send(agent);
  });

  /**
   * PATCH /agents/:agent_id
   * Update agent fields.
   */
  fastify.patch('/:agent_id', async (request, reply) => {
    const { agent_id } = request.params;
    const { name: rawName, description, capabilities, metadata } = request.body ?? {};

    const updates = {};
    if (rawName !== undefined) updates.name = sanitizeString(rawName, 255);
    if (description !== undefined) updates.description = description;
    if (capabilities !== undefined) updates.capabilities = capabilities;
    if (metadata !== undefined) updates.metadata = metadata;

    if (Object.keys(updates).length === 0) {
      return sendError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'No updatable fields provided');
    }

    // Verify agent exists first
    const existing = await agentService.getAgent(request.account.id, agent_id);
    if (!existing) {
      return sendError(reply, 404, ErrorCodes.AGENT_NOT_FOUND, `Agent '${agent_id}' not found`);
    }

    const updated = await agentService.updateAgent(request.account.id, agent_id, updates);
    return reply.send(updated);
  });

  /**
   * DELETE /agents/:agent_id
   * Delete an agent.
   */
  fastify.delete('/:agent_id', async (request, reply) => {
    const { agent_id } = request.params;
    const deleted = await agentService.deleteAgent(request.account.id, agent_id);

    if (!deleted) {
      return sendError(reply, 404, ErrorCodes.AGENT_NOT_FOUND, `Agent '${agent_id}' not found`);
    }

    return reply.code(204).send();
  });
}
