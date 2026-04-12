import { CodeBlock } from '../components/CodeBlock.jsx';

function H1({ children }) { return <h1 className="text-3xl font-bold text-gray-900 mb-3">{children}</h1>; }
function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-3 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600">{children}</a>
    </h2>
  );
}
function H3({ children }) { return <h3 className="text-base font-semibold text-gray-800 mt-6 mb-2">{children}</h3>; }
function P({ children }) { return <p className="text-gray-600 leading-relaxed mb-3">{children}</p>; }

export function JsSdk() {
  return (
    <div>
      <H1>JavaScript SDK</H1>
      <P>Zero-dependency, isomorphic SDK for Node.js 18+ and modern browsers.</P>

      <H2 id="install">Installation</H2>
      <CodeBlock code="npm install @snapstate/sdk" language="bash" />

      <H2 id="init">Initialization</H2>
      <CodeBlock language="javascript" code={`import { SnapStateClient } from '@snapstate/sdk';

const client = new SnapStateClient({
  apiKey: process.env.SNAPSTATE_API_KEY, // required
  baseUrl: 'http://localhost:3000',        // optional, default shown
});`} />

      <H2 id="save">save()</H2>
      <P>Save workflow state after completing a step.</P>
      <CodeBlock language="javascript" code={`const result = await client.save({
  workflowId: 'wf_001',   // required
  step: 1,                // required
  state: { progress: 0 }, // required — full state object (max 1 MB)
  label: 'init',          // optional — human-readable step name
  agentId: 'my-bot',      // optional — agent identity tag
  metadata: { tokens: 340 }, // optional — arbitrary metadata
  ttlSeconds: 86400,      // optional — override default TTL (7 days)
  ifMatch: result.etag,   // optional — optimistic concurrency
});

// result: { checkpointId, workflowId, step, etag, createdAt, sizeBytes, diffFromPrevious }`} />

      <H2 id="resume">resume()</H2>
      <P>Get the latest checkpoint to resume an interrupted workflow.</P>
      <CodeBlock language="javascript" code={`import { SnapStateError } from '@snapstate/sdk';

try {
  const resumed = await client.resume('wf_001');
  const { step, state, etag } = resumed.latestCheckpoint;
  console.log(\`Resuming from step \${step}\`);
  // resumed: { workflowId, latestCheckpoint, totalCheckpoints,
  //            workflowStartedAt, lastActivityAt }
} catch (err) {
  if (err.code === 'NOT_FOUND') {
    // No prior state — start fresh
  }
}`} />

      <H2 id="replay">replay()</H2>
      <P>Get the full ordered checkpoint history for debugging or auditing.</P>
      <CodeBlock language="javascript" code={`const history = await client.replay('wf_001', {
  fromStep: 2,  // optional
  toStep: 8,    // optional
  limit: 50,    // optional, default 100
});

// history: { workflowId, checkpoints: [...], total, hasMore }
history.checkpoints.forEach(cp => {
  console.log(\`Step \${cp.step}: \${cp.label}\`);
});`} />

      <H2 id="agents">registerAgent()</H2>
      <CodeBlock language="javascript" code={`// Call once at startup — safe to call every run (upsert)
await client.registerAgent({
  agentId: 'research-bot',
  name: 'Research Bot',
  description: 'Searches and summarizes sources',
  capabilities: ['web_search', 'summarization'],
  metadata: { model: 'claude-sonnet-4-6', version: '1.0.0' },
});

// List all registered agents
const { agents } = await client.listAgents();`} />

      <H2 id="webhooks">registerWebhook()</H2>
      <CodeBlock language="javascript" code={`const webhook = await client.registerWebhook({
  url: 'https://example.com/checkpoint-hook',
  events: ['checkpoint.saved', 'workflow.resumed'],
  secret: process.env.WEBHOOK_SECRET, // optional HMAC signing
});

// Remove it later
await client.deleteWebhook(webhook.webhookId);`} />

      <H2 id="errors">Error handling</H2>
      <CodeBlock language="javascript" code={`import { SnapStateClient, SnapStateError } from '@snapstate/sdk';

try {
  await client.save({ workflowId: 'wf_001', step: 1, state: {} });
} catch (err) {
  if (err instanceof SnapStateError) {
    console.error(\`\${err.code}: \${err.message} (HTTP \${err.statusCode})\`);

    switch (err.code) {
      case 'NOT_FOUND':     // 404
      case 'CONFLICT':      // 409 — ETag mismatch
      case 'RATE_LIMITED':  // 429 — auto-retried up to 3× with backoff
      case 'PAYLOAD_TOO_LARGE':  // 413 — state > 1 MB
      case 'UNAUTHORIZED':  // 401 — invalid key
    }
  }
}`} />

      <H2 id="types">TypeScript / JSDoc types</H2>
      <P>The SDK ships with JSDoc annotations. TypeScript projects get full type inference automatically.</P>
      <CodeBlock language="javascript" code={`/**
 * @typedef {Object} SaveParams
 * @property {string} workflowId
 * @property {number} step
 * @property {object} state
 * @property {string} [label]
 * @property {string} [agentId]
 * @property {object} [metadata]
 * @property {number} [ttlSeconds]
 * @property {string} [ifMatch]
 */

/**
 * @typedef {Object} SaveResult
 * @property {string} checkpointId
 * @property {string} workflowId
 * @property {number} step
 * @property {string} etag
 * @property {string} createdAt
 * @property {number} sizeBytes
 * @property {object} diffFromPrevious
 */`} />
    </div>
  );
}
