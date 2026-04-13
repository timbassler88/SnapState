import { CodeBlock } from '../components/CodeBlock.jsx';

function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-3 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600">{children}</a>
    </h2>
  );
}
function P({ children }) { return <p className="text-gray-600 leading-relaxed mb-3">{children}</p>; }

const REGISTER_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `// Call once at startup — upsert, safe to call every run
await client.registerAgent({
  agentId: 'research-bot',
  name: 'Research Bot',
  description: 'Searches and summarizes sources',
  capabilities: ['web_search', 'summarization', 'citation'],
  metadata: {
    model: 'claude-sonnet-4-6',
    framework: 'direct',
    version: '2.1.0',
  },
});`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `client.register_agent(
    agent_id="research-bot",
    name="Research Bot",
    description="Searches and summarizes sources",
    capabilities=["web_search", "summarization", "citation"],
    metadata={
        "model": "claude-sonnet-4-6",
        "framework": "direct",
        "version": "2.1.0",
    },
)`,
  },
];

const TAG_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `await client.save({
  workflowId: 'wf_collab_001',
  step: 1,
  label: 'research_complete',
  state: { findings: [...], next_agent: 'writer-bot' },
  agentId: 'research-bot',   // ← identity tag
});`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `client.save(
    workflow_id="wf_collab_001",
    step=1,
    label="research_complete",
    state={"findings": [...], "next_agent": "writer-bot"},
    agent_id="research-bot",  # ← identity tag
)`,
  },
];

const HANDOFF_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `// Research Bot — saves state and signals next agent
await client.save({
  workflowId: 'wf_collab_001',
  step: 1,
  state: { topic: 'quantum computing', sources: [...], next_agent: 'writer-bot' },
  agentId: 'research-bot',
});

// Writer Bot — picks up where Research Bot left off
const resumed = await client.resume('wf_collab_001');
const { state } = resumed.latestCheckpoint;
console.log('Handed off from:', state.next_agent); // "research-bot" via metadata

await client.save({
  workflowId: 'wf_collab_001',
  step: 2,
  state: { ...state, draft: 'Quantum computing is...', status: 'done' },
  agentId: 'writer-bot',
});`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `# Research Bot
client.save(
    workflow_id="wf_collab_001",
    step=1,
    state={"topic": "quantum computing", "sources": [...], "next_agent": "writer-bot"},
    agent_id="research-bot",
)

# Writer Bot
resumed = client.resume("wf_collab_001")
state = resumed.latest_checkpoint.state

client.save(
    workflow_id="wf_collab_001",
    step=2,
    state={**state, "draft": "Quantum computing is...", "status": "done"},
    agent_id="writer-bot",
)`,
  },
];

export function AgentIdentity() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Agent Identity</h1>
      <p className="text-gray-600 leading-relaxed mb-4">
        Tag checkpoints with agent identifiers to enable multi-agent coordination,
        workflow auditing, and per-agent analytics.
      </p>

      <H2 id="why">Why agent identity matters</H2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-4">
        {[
          { icon: '🤝', title: 'Multi-agent coordination', desc: 'One agent saves state with a handoff signal; another resumes and picks up exactly there.' },
          { icon: '🔍', title: 'Auditing', desc: "Every checkpoint records which agent created it — full traceability of who did what in a workflow." },
          { icon: '📊', title: 'Analytics', desc: 'Track per-agent error rates, step counts, and performance over time from the analytics endpoints.' },
        ].map((c) => (
          <div key={c.title} className="border border-gray-200 rounded-xl p-4">
            <div className="text-2xl mb-2">{c.icon}</div>
            <p className="font-semibold text-gray-800 text-sm mb-1">{c.title}</p>
            <p className="text-gray-500 text-xs leading-relaxed">{c.desc}</p>
          </div>
        ))}
      </div>

      <H2 id="register">Registering an agent</H2>
      <P>
        Register each agent once at startup. The call is an upsert — calling it every run
        keeps the agent's metadata current without duplicating records.
      </P>
      <CodeBlock tabs={REGISTER_TABS} />

      <H2 id="tag">Tagging checkpoints</H2>
      <P>
        Pass <code className="bg-gray-100 px-1 rounded text-sm">agentId</code> (JS) or{' '}
        <code className="bg-gray-100 px-1 rounded text-sm">agent_id</code> (Python) to any
        checkpoint save call. The service stores it in checkpoint metadata and updates the
        agent's <code className="bg-gray-100 px-1 rounded text-sm">last_seen_at</code> timestamp automatically.
      </P>
      <CodeBlock tabs={TAG_TABS} />

      <H2 id="multi-agent">Multi-agent workflow walkthrough</H2>
      <div className="relative my-6 pl-6 border-l-2 border-indigo-200 space-y-6">
        {[
          { agent: 'research-bot', step: 1, label: 'research_complete', desc: 'Gathers sources, stores findings in state, signals next_agent = "writer-bot".' },
          { agent: 'writer-bot', step: 2, label: 'draft_complete', desc: 'Resumes workflow, reads findings, produces draft, signals next_agent = "editor-bot".' },
          { agent: 'editor-bot', step: 3, label: 'final_published', desc: 'Resumes workflow, polishes draft, publishes — marks status = "complete".' },
        ].map((s) => (
          <div key={s.step} className="relative">
            <div className="absolute -left-9 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white" />
            <p className="text-xs font-mono text-indigo-600 mb-0.5">{s.agent} · step {s.step} · {s.label}</p>
            <p className="text-sm text-gray-600">{s.desc}</p>
          </div>
        ))}
      </div>
      <CodeBlock tabs={HANDOFF_TABS} />

      <H2 id="analytics">Querying agent analytics</H2>
      <CodeBlock language="bash" code={`# Per-agent performance over the last 30 days
curl https://snapstate.dev/analytics/agents \\
  -H "Authorization: Bearer snp_..."

# Response includes per-agent:
# - total_workflows, active_workflows
# - avg_steps, avg_duration_seconds
# - error_rate, last_seen_at`} />

      <H2 id="best-practices">Best practices</H2>
      <ul className="space-y-2 text-gray-600 text-sm leading-relaxed list-none">
        {[
          ['Stable IDs', 'Use lowercase, hyphen-separated IDs that describe the role: research-bot, code-reviewer-v2. Avoid UUIDs or session-scoped IDs.'],
          ['Register every run', 'Calling registerAgent on every startup is safe (upsert) and keeps version/model metadata fresh.'],
          ['Capabilities list', 'Be specific: ["web_search", "python_execution"] is more useful than ["general"]. These appear in the analytics dashboard.'],
          ['Version in metadata', 'Include model and version in metadata so you can trace behavior changes over time when you upgrade.'],
          ['State handoff signals', 'Use a next_agent field in state to signal which agent should pick up next. This is a convention, not enforced by the API.'],
        ].map(([title, desc]) => (
          <li key={title} className="flex gap-2">
            <span className="text-indigo-500 flex-shrink-0">▸</span>
            <span><strong className="text-gray-800">{title}:</strong> {desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
