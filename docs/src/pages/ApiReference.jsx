import { EndpointCard } from '../components/EndpointCard.jsx';
import { TryIt } from '../components/TryIt.jsx';
import { CodeBlock } from '../components/CodeBlock.jsx';

function H1({ children }) {
  return <h1 className="text-3xl font-bold text-gray-900 mb-3">{children}</h1>;
}
function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-4 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600 transition-colors">{children}</a>
    </h2>
  );
}
function P({ children }) {
  return <p className="text-gray-600 leading-relaxed mb-3">{children}</p>;
}

const AUTH_EXAMPLE = `# All requests require an API key in the Authorization header
curl https://snapstate.dev/checkpoints \\
  -H "Authorization: Bearer snp_your_key_here"`;

export function ApiReference() {
  return (
    <div>
      <H1>API Reference</H1>
      <P>
        The SnapState REST API is organized around standard HTTP verbs and returns
        JSON responses. All endpoints require authentication unless marked otherwise.
      </P>

      <H2 id="auth">Authentication</H2>
      <P>
        Pass your API key in the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">Authorization</code> header
        as a Bearer token. Keys begin with <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">snp_</code> (SnapState API keys).
      </P>
      <CodeBlock code={AUTH_EXAMPLE} language="bash" />

      <H2 id="rate-limits">Rate Limiting</H2>
      <P>
        All endpoints are limited to 100 requests/minute per API key. Auth endpoints
        (signup, login) are limited to 10 requests/minute per IP. When exceeded, the API
        returns <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">429 Too Many Requests</code> with
        a <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">Retry-After</code> header.
      </P>

      <H2 id="checkpoints">Checkpoints</H2>

      <EndpointCard
        method="POST" path="/checkpoints"
        description="Save the current state of a workflow step."
        headers={[
          { name: 'Authorization', required: true, description: 'Bearer snp_...' },
          { name: 'Content-Type', required: true, description: 'application/json' },
          { name: 'X-Checkpoint-TTL', required: false, description: 'Override TTL in seconds (default: 7 days)' },
          { name: 'If-Match', required: false, description: 'ETag for optimistic concurrency — 409 on mismatch' },
        ]}
        body={[
          { field: 'workflow_id', type: 'string', required: true, description: 'Unique workflow identifier (max 128 chars)' },
          { field: 'step', type: 'integer', required: true, description: 'Sequential step number (≥ 0)' },
          { field: 'state', type: 'object', required: true, description: 'Full workflow state to persist (max 1 MB)' },
          { field: 'label', type: 'string', required: false, description: 'Human-readable step label (max 256 chars)' },
          { field: 'agent_id', type: 'string', required: false, description: 'Agent identity tag for this checkpoint' },
          { field: 'metadata', type: 'object', required: false, description: 'Arbitrary metadata stored alongside checkpoint' },
        ]}
        response={{ checkpoint_id: 'cp_wf_001_0001', workflow_id: 'wf_001', step: 1, etag: 'abc123', created_at: '2026-04-11T00:00:00Z', diff_from_previous: { added: [], removed: [], changed: [] }, size_bytes: 128 }}
        errors={[
          { status: 401, code: 'UNAUTHORIZED', description: 'Invalid or missing API key' },
          { status: 409, code: 'CONFLICT', description: 'ETag mismatch — state was modified by another writer' },
          { status: 413, code: 'PAYLOAD_TOO_LARGE', description: 'State exceeds 1 MB limit' },
          { status: 429, code: 'RATE_LIMITED', description: 'Too many requests — back off and retry' },
        ]}
        curl={`curl -X POST https://snapstate.dev/checkpoints \\
  -H "Authorization: Bearer snp_..." \\
  -H "Content-Type: application/json" \\
  -d '{"workflow_id":"wf_001","step":1,"state":{"progress":0}}'`}
      />

      <EndpointCard
        method="GET" path="/checkpoints/:checkpoint_id"
        description="Retrieve a specific checkpoint by ID."
        headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
        response={{ checkpoint_id: 'cp_wf_001_0001', workflow_id: 'wf_001', step: 1, label: 'init', state: { progress: 0 }, metadata: null, etag: 'abc123', created_at: '2026-04-11T00:00:00Z' }}
        errors={[
          { status: 401, code: 'UNAUTHORIZED', description: 'Invalid or missing API key' },
          { status: 404, code: 'NOT_FOUND', description: 'Checkpoint not found' },
        ]}
        curl={`curl https://snapstate.dev/checkpoints/cp_wf_001_0001 \\
  -H "Authorization: Bearer snp_..."`}
      />

      <H2 id="workflows">Workflows</H2>

      <EndpointCard
        method="GET" path="/workflows/:workflow_id/resume"
        description="Get the latest checkpoint for a workflow — use this to resume an interrupted run."
        headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
        response={{ workflow_id: 'wf_001', latest_checkpoint: { checkpoint_id: 'cp_wf_001_0003', step: 3, label: 'fetched', state: {} }, total_checkpoints: 3, workflow_started_at: '2026-04-11T00:00:00Z', last_activity_at: '2026-04-11T00:01:00Z' }}
        errors={[
          { status: 404, code: 'NOT_FOUND', description: 'No checkpoints found for this workflow' },
        ]}
        curl={`curl https://snapstate.dev/workflows/wf_001/resume \\
  -H "Authorization: Bearer snp_..."`}
      />

      <EndpointCard
        method="GET" path="/workflows/:workflow_id/replay"
        description="Get the full ordered checkpoint history for a workflow."
        headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
        body={[
          { field: 'from_step', type: 'integer (query)', required: false, description: 'Return checkpoints at or after this step' },
          { field: 'to_step', type: 'integer (query)', required: false, description: 'Return checkpoints at or before this step' },
          { field: 'limit', type: 'integer (query)', required: false, description: 'Max results (default 100, max 1000)' },
        ]}
        response={{ workflow_id: 'wf_001', checkpoints: [{ step: 1 }, { step: 2 }], total: 2, has_more: false }}
        curl={`curl "https://snapstate.dev/workflows/wf_001/replay?limit=50" \\
  -H "Authorization: Bearer snp_..."`}
      />

      <H2 id="agents">Agents</H2>

      <EndpointCard
        method="POST" path="/agents"
        description="Register or update an agent identity (upsert by agent_id)."
        headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
        body={[
          { field: 'agent_id', type: 'string', required: true, description: 'Unique agent identifier (alphanumeric, _ -)' },
          { field: 'name', type: 'string', required: false, description: 'Display name' },
          { field: 'description', type: 'string', required: false, description: 'What this agent does' },
          { field: 'capabilities', type: 'string[]', required: false, description: 'List of capability strings' },
          { field: 'metadata', type: 'object', required: false, description: 'Arbitrary metadata (model, version, etc.)' },
        ]}
        response={{ agent_id: 'research-bot', name: 'Research Bot', capabilities: ['web_search'], created_at: '2026-04-11T00:00:00Z' }}
        errors={[
          { status: 400, code: 'MAX_AGENTS_REACHED', description: 'Account agent limit reached (default: 50)' },
          { status: 400, code: 'VALIDATION_ERROR', description: 'Invalid agent_id format' },
        ]}
        curl={`curl -X POST https://snapstate.dev/agents \\
  -H "Authorization: Bearer snp_..." \\
  -H "Content-Type: application/json" \\
  -d '{"agent_id":"research-bot","name":"Research Bot","capabilities":["web_search"]}'`}
      />

      {[
        { method: 'GET', path: '/agents', description: 'List all agents for this account.' },
        { method: 'GET', path: '/agents/:agent_id', description: 'Get a specific agent by ID.' },
        { method: 'PATCH', path: '/agents/:agent_id', description: 'Update agent name, description, capabilities, or metadata.' },
        { method: 'DELETE', path: '/agents/:agent_id', description: 'Delete an agent (hard delete).' },
      ].map((ep) => (
        <EndpointCard key={ep.path + ep.method}
          {...ep}
          headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
          errors={[{ status: 404, code: 'AGENT_NOT_FOUND', description: 'Agent not found or belongs to another account' }]}
          curl={`curl https://snapstate.dev${ep.path.replace(':agent_id', 'research-bot')} \\\n  -H "Authorization: Bearer snp_..."`}
        />
      ))}

      <H2 id="analytics">Analytics</H2>

      {[
        { method: 'GET', path: '/analytics/overview', description: 'Aggregate workflow stats for the last 30 days (or custom date range).', response: { period: { start: '2026-03-11', end: '2026-04-11' }, total_workflows: 47, completed_workflows: 38, total_checkpoints: 312, avg_steps_per_workflow: 6.6, top_agents: [] } },
        { method: 'GET', path: '/analytics/workflows/:workflow_id', description: 'Step-by-step timeline and stats for a single workflow.' },
        { method: 'GET', path: '/analytics/failures', description: 'Failure pattern analysis: hotspots by step and agent.' },
        { method: 'GET', path: '/analytics/agents', description: 'Per-agent performance metrics: workflows, avg steps, error rate.' },
      ].map((ep) => (
        <EndpointCard key={ep.path}
          {...ep}
          headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
          curl={`curl https://snapstate.dev${ep.path.replace(':workflow_id', 'wf_001')} \\\n  -H "Authorization: Bearer snp_..."`}
        />
      ))}

      <H2 id="webhooks">Webhooks</H2>

      <EndpointCard
        method="POST" path="/webhooks"
        description="Register a webhook URL to receive event notifications."
        headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
        body={[
          { field: 'url', type: 'string', required: true, description: 'HTTPS endpoint to receive POST requests' },
          { field: 'events', type: 'string[]', required: true, description: 'checkpoint.saved | workflow.resumed | workflow.expired' },
          { field: 'secret', type: 'string', required: false, description: 'HMAC signing secret for request verification' },
        ]}
        response={{ webhook_id: 'wh_abc123', url: 'https://example.com/hook', events: ['checkpoint.saved'], created_at: '2026-04-11T00:00:00Z' }}
        curl={`curl -X POST https://snapstate.dev/webhooks \\
  -H "Authorization: Bearer snp_..." \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/hook","events":["checkpoint.saved"]}'`}
      />

      <EndpointCard
        method="DELETE" path="/webhooks/:webhook_id"
        description="Remove a webhook registration."
        headers={[{ name: 'Authorization', required: true, description: 'Bearer snp_...' }]}
        errors={[{ status: 404, code: 'NOT_FOUND', description: 'Webhook not found' }]}
        curl={`curl -X DELETE https://snapstate.dev/webhooks/wh_abc123 \\
  -H "Authorization: Bearer snp_..."`}
      />

      <H2 id="try-it">Interactive Playground</H2>
      <P>Try the API directly from your browser. Make sure your Checkpoint server is running locally.</P>
      <TryIt />
    </div>
  );
}
