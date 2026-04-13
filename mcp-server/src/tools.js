/**
 * Tool definitions for the SnapState MCP server.
 *
 * Each tool maps to an existing SnapState API endpoint.
 * The server authenticates to the API using SNAPSTATE_API_KEY env var.
 */

import 'dotenv/config';

const API_URL = (process.env.SNAPSTATE_API_URL ?? 'https://snapstate.dev').replace(/\/$/, '');
const API_KEY = process.env.SNAPSTATE_API_KEY ?? '';

async function callApi(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Tool definitions (MCP ListTools format)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: 'save_checkpoint',
    description:
      'Save the current state of a multi-step workflow so it can be resumed later if interrupted. Call this after completing each meaningful step.',
    inputSchema: {
      type: 'object',
      required: ['workflow_id', 'step', 'state'],
      properties: {
        workflow_id: {
          type: 'string',
          description: 'Unique identifier for this workflow run',
        },
        step: {
          type: 'integer',
          description: 'Sequential step number (1, 2, 3...)',
        },
        label: {
          type: 'string',
          description: "Short human-readable label for this step, e.g. 'fetched_sources'",
        },
        state: {
          type: 'object',
          description:
            'The full workflow state to persist — include everything needed to resume from this point',
        },
        agent_id: {
          type: 'string',
          description: 'Optional: agent identity tag for this checkpoint',
        },
        metadata: {
          type: 'object',
          description: 'Optional: additional metadata (agent name, model, etc.)',
        },
      },
    },
  },
  {
    name: 'register_agent',
    description:
      'Register this agent with the checkpoint service. Call once at the start of a session to establish identity for checkpoint tagging.',
    inputSchema: {
      type: 'object',
      required: ['agent_id', 'name'],
      properties: {
        agent_id: {
          type: 'string',
          description: "Unique identifier for this agent (e.g. 'research-bot-v2')",
        },
        name: {
          type: 'string',
          description: 'Human-readable name for this agent',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: "List of agent capabilities (e.g. ['web_search', 'summarization'])",
        },
      },
    },
  },
  {
    name: 'resume_workflow',
    description:
      'Retrieve the last saved checkpoint for a workflow to resume from where it left off. Call this at the start of a workflow to check if there is prior state to resume from.',
    inputSchema: {
      type: 'object',
      required: ['workflow_id'],
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID to resume',
        },
      },
    },
  },
  {
    name: 'get_workflow_history',
    description:
      'Get the full ordered history of checkpoints for a workflow. Useful for debugging or auditing what steps an agent took.',
    inputSchema: {
      type: 'object',
      required: ['workflow_id'],
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID to get history for',
        },
        from_step: {
          type: 'integer',
          description: 'Optional: start from this step number',
        },
        to_step: {
          type: 'integer',
          description: 'Optional: end at this step number',
        },
        limit: {
          type: 'integer',
          description: 'Max checkpoints to return (default 100, max 1000)',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleTool(name, args) {
  switch (name) {
    case 'save_checkpoint': {
      const { workflow_id, step, label, state, agent_id, metadata } = args;
      const result = await callApi('POST', '/checkpoints', {
        workflow_id,
        step,
        label,
        state,
        ...(agent_id !== undefined && { agent_id }),
        ...(metadata !== undefined && { metadata }),
      });
      return {
        checkpoint_id: result.checkpoint_id,
        etag: result.etag,
        step: result.step,
        created_at: result.created_at,
        size_bytes: result.size_bytes,
        diff_from_previous: result.diff_from_previous,
      };
    }

    case 'resume_workflow': {
      const { workflow_id } = args;
      try {
        return await callApi('GET', `/workflows/${encodeURIComponent(workflow_id)}/resume`);
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('not found')) {
          return {
            workflow_id,
            latest_checkpoint: null,
            message: 'No checkpoints found — this is a new workflow.',
          };
        }
        throw err;
      }
    }

    case 'register_agent': {
      const { agent_id, name, capabilities } = args;
      return callApi('POST', '/agents', { agent_id, name, capabilities });
    }

    case 'get_workflow_history': {
      const { workflow_id, from_step, to_step, limit } = args;
      const params = new URLSearchParams();
      if (from_step !== undefined) params.set('from_step', String(from_step));
      if (to_step !== undefined) params.set('to_step', String(to_step));
      if (limit !== undefined) params.set('limit', String(limit));
      const qs = params.size ? `?${params}` : '';
      return callApi('GET', `/workflows/${encodeURIComponent(workflow_id)}/replay${qs}`);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
