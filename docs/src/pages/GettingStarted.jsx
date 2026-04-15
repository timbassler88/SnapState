import { CodeBlock } from '../components/CodeBlock.jsx';

function H1({ children }) {
  return <h1 className="text-4xl font-bold text-gray-900 mb-3 tracking-tight">{children}</h1>;
}
function H2({ id, children }) {
  return (
    <h2 id={id} className="text-2xl font-bold text-gray-900 mt-12 mb-4 scroll-mt-8">
      <a href={`#${id}`} className="hover:text-indigo-600 transition-colors">{children}</a>
    </h2>
  );
}
function H3({ children }) {
  return <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{children}</h3>;
}
function P({ children }) {
  return <p className="text-gray-600 leading-relaxed mb-4">{children}</p>;
}
function Step({ n, title, children }) {
  return (
    <div className="flex gap-4 mb-8">
      <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const SIGNUP_TABS = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST https://snapstate.dev/auth/signup \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "you@example.com",
    "password": "yourpassword",
    "name": "Your Name"
  }'`,
  },
];

const INSTALL_TABS = [
  { label: 'npm', language: 'bash', code: 'npm install @snapstate/sdk' },
  { label: 'pip', language: 'bash', code: 'pip install snapstate-sdk' },
];

const SAVE_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `import { SnapStateClient } from '@snapstate/sdk';

const client = new SnapStateClient({
  apiKey: 'snp_your_key_here',
  baseUrl: 'https://snapstate.dev',
});

// Save state after completing a step
const result = await client.save({
  workflowId: 'wf_research_001',
  step: 1,
  label: 'sources_gathered',
  state: {
    topic: 'quantum computing',
    sources: ['arxiv.org/123', 'nature.com/456'],
    progress: 0.25,
  },
});

console.log('Saved:', result.checkpointId);
console.log('ETag:', result.etag);`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `from snapstate_sdk import SnapStateClient

client = SnapStateClient(
    api_key="snp_your_key_here",
    base_url="https://snapstate.dev",
)

result = client.save(
    workflow_id="wf_research_001",
    step=1,
    label="sources_gathered",
    state={
        "topic": "quantum computing",
        "sources": ["arxiv.org/123", "nature.com/456"],
        "progress": 0.25,
    },
)

print(f"Saved: {result.checkpoint_id}")
print(f"ETag:  {result.etag}")
client.close()`,
  },
];

const RESUME_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `// At the start of your agent — check for existing state
try {
  const resumed = await client.resume('wf_research_001');
  const { step, state } = resumed.latestCheckpoint;
  console.log(\`Resuming from step \${step}\`);
  // Continue from where we left off
  await continueWorkflow(state);
} catch (err) {
  if (err.code === 'NOT_FOUND') {
    // No prior state — start fresh
    await startWorkflow();
  }
}`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `from snapstate_sdk.errors import NotFoundError

# At the start of your agent — check for existing state
try:
    resumed = client.resume("wf_research_001")
    step = resumed.latest_checkpoint.step
    state = resumed.latest_checkpoint.state
    print(f"Resuming from step {step}")
    continue_workflow(state)
except NotFoundError:
    # No prior state — start fresh
    start_workflow()`,
  },
];

export function GettingStarted() {
  return (
    <div>
      {/* Hero */}
      <div className="mb-12">
        <H1>SnapState</H1>
        <p className="text-xl text-gray-500 leading-relaxed">
          Universal workflow state that works across any agent framework, any language, any
          platform. Save, resume, and replay multi-step workflows across sessions, crashes,
          and agent handoffs.
        </p>
      </div>

      <H2 id="quickstart">Quickstart</H2>
      <P>Get your first checkpoint saved in under 5 minutes.</P>

      <Step n="1" title="Create an account">
        <P>Sign up for a SnapState account to get your API key.</P>
        <CodeBlock tabs={SIGNUP_TABS} />
        <P>
          Check your email for a verification link. Once verified, your API key (beginning
          with <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">snp_</code>) will be

          returned in the response.
        </P>
      </Step>

      <Step n="2" title="Install the SDK">
        <P>Choose the SDK for your language:</P>
        <CodeBlock tabs={INSTALL_TABS} />
      </Step>

      <Step n="3" title="Save your first checkpoint">
        <P>
          Initialize the client with your API key, then call <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">save()</code> after
          each meaningful step in your workflow.
        </P>
        <CodeBlock tabs={SAVE_TABS} />
      </Step>

      <H2 id="resume">Resume a workflow</H2>
      <P>
        At the start of every agent run, call <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">resume()</code> to
        check whether prior state exists. If it does, skip completed steps and continue from
        the latest checkpoint.
      </P>
      <CodeBlock tabs={RESUME_TABS} />

      <H2 id="next">What's next?</H2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
        {[
          { title: 'API Reference', desc: 'Explore all endpoints with interactive examples.', href: '#/api' },
          { title: 'JavaScript SDK', desc: 'Full SDK docs including async usage and webhooks.', href: '#/sdk/javascript' },
          { title: 'Python SDK', desc: 'Sync and async clients, typed exceptions, context managers.', href: '#/sdk/python' },
          { title: 'Agent Identity', desc: 'Tag checkpoints with agent IDs for multi-agent workflows.', href: '#/guides/agents' },
          { title: 'MCP Setup', desc: 'Use SnapState with Claude Desktop and Cline.', href: '#/guides/mcp' },
          { title: 'Pricing', desc: 'Free tier details and usage-based pricing calculator.', href: '#/pricing' },
        ].map((card) => (
          <a
            key={card.title}
            href={card.href}
            className="block p-4 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors group"
          >
            <p className="font-semibold text-gray-900 group-hover:text-indigo-700 text-sm">{card.title} →</p>
            <p className="text-xs text-gray-500 mt-1">{card.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
