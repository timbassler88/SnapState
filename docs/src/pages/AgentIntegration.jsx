import { CodeBlock } from '../components/CodeBlock.jsx';

function H1({ children }) {
  return <h1 className="text-4xl font-bold text-gray-900 mb-3 tracking-tight">{children}</h1>;
}
function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-4 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600 transition-colors">{children}</a>
    </h2>
  );
}
function P({ children }) {
  return <p className="text-gray-600 leading-relaxed mb-4">{children}</p>;
}
function Note({ children }) {
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 my-4 text-sm text-indigo-800 leading-relaxed">
      {children}
    </div>
  );
}
function BulletList({ items }) {
  return (
    <ul className="space-y-3 my-4">
      {items.map(({ label, desc }, i) => (
        <li key={i} className="flex gap-2 text-sm text-gray-600 leading-relaxed">
          <span className="text-indigo-500 mt-0.5 flex-shrink-0">•</span>
          <span><strong className="text-gray-800">{label}</strong> — {desc}</span>
        </li>
      ))}
    </ul>
  );
}

const SYSTEM_PROMPT = `You have access to SnapState for persistent workflow state. Follow these rules:

1. RESUME: At the start of every task, check if prior state exists by calling resume_workflow
   with the workflow_id. If state exists, continue from where you left off — do not repeat
   completed steps.

2. SAVE: After completing each meaningful step (data gathered, analysis done, file created,
   etc.), save a checkpoint with save_checkpoint. Include:
   - workflow_id: a unique ID for this task (e.g., "wf_research_ai_agents")
   - step: the sequential step number
   - label: a short description of what was completed
   - state: all data needed to resume later (sources found, decisions made, outputs so far)

3. STATE DESIGN: Save everything needed to continue without repeating work. Include:
   - What steps have been completed
   - Any data collected or generated
   - Decisions made and their reasoning
   - The current plan or next steps

4. FAILURE RECOVERY: If you encounter an error, save a checkpoint with the error details
   before stopping. This lets you or another agent diagnose and resume.`;

const MCP_CONFIG = `{
  "mcpServers": {
    "snapstate": {
      "command": "node",
      "args": ["/path/to/snapstate/mcp-server/src/index.js"],
      "env": {
        "SNAPSTATE_API_URL": "https://snapstate.dev",
        "SNAPSTATE_API_KEY": "snp_your_key_here"
      }
    }
  }
}`;

const SDK_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `import { SnapStateClient } from 'snapstate-sdk';

const client = new SnapStateClient({ apiKey: 'snp_your_key' });
const WORKFLOW_ID = 'wf_research_task';

async function runAgent() {
  // Step 0: Check for existing state
  let state = { step: 0, sources: [], analysis: null, report: null };
  try {
    const resumed = await client.resume(WORKFLOW_ID);
    state = resumed.latestCheckpoint.state;
    console.log(\`Resuming from step \${state.step}\`);
  } catch (e) {
    console.log('Starting fresh');
  }

  // Step 1: Gather sources
  if (state.step < 1) {
    state.sources = await gatherSources();
    state.step = 1;
    await client.save({
      workflowId: WORKFLOW_ID, step: 1,
      label: 'sources_gathered', state,
    });
  }

  // Step 2: Analyze
  if (state.step < 2) {
    state.analysis = await analyze(state.sources);
    state.step = 2;
    await client.save({
      workflowId: WORKFLOW_ID, step: 2,
      label: 'analysis_complete', state,
    });
  }

  // Step 3: Generate report
  if (state.step < 3) {
    state.report = await generateReport(state.analysis);
    state.step = 3;
    await client.save({
      workflowId: WORKFLOW_ID, step: 3,
      label: 'report_generated', state,
    });
  }

  return state.report;
}`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `from snapstate_sdk import SnapStateClient

client = SnapStateClient(api_key="snp_your_key")
WORKFLOW_ID = "wf_research_task"

def run_agent():
    # Step 0: Check for existing state
    state = {"step": 0, "sources": [], "analysis": None, "report": None}
    try:
        resumed = client.resume(WORKFLOW_ID)
        state = resumed.latest_checkpoint.state
        print(f"Resuming from step {state['step']}")
    except Exception:
        print("Starting fresh")

    # Step 1: Gather sources
    if state["step"] < 1:
        state["sources"] = gather_sources()
        state["step"] = 1
        client.save(
            workflow_id=WORKFLOW_ID, step=1,
            label="sources_gathered", state=state,
        )

    # Step 2: Analyze
    if state["step"] < 2:
        state["analysis"] = analyze(state["sources"])
        state["step"] = 2
        client.save(
            workflow_id=WORKFLOW_ID, step=2,
            label="analysis_complete", state=state,
        )

    # Step 3: Generate report
    if state["step"] < 3:
        state["report"] = generate_report(state["analysis"])
        state["step"] = 3
        client.save(
            workflow_id=WORKFLOW_ID, step=3,
            label="report_generated", state=state,
        )

    return state["report"]`,
  },
];

const BEST_PRACTICES = [
  {
    label: 'Use descriptive workflow IDs',
    desc: '`wf_research_ai_agents` is better than `wf_001`. IDs should be unique per task so workflows don\'t collide.',
  },
  {
    label: 'Save meaningful state',
    desc: 'Don\'t just save "step 3 done." Save the actual data needed to continue: sources found, API responses, intermediate results.',
  },
  {
    label: 'Design for resumability',
    desc: 'Structure your workflow so each step checks `if state.step < N` before running. This makes resume automatic and idempotent.',
  },
  {
    label: 'Save before risky operations',
    desc: 'About to call an expensive API or run a long computation? Save a checkpoint first so you can retry without re-running earlier steps.',
  },
  {
    label: 'Include error context',
    desc: 'If a step fails, save the error details before stopping. This lets you or another agent diagnose and resume without re-running everything.',
  },
];

export function AgentIntegration() {
  return (
    <div>
      <div className="mb-10">
        <H1>Integrating SnapState into Your Agent</H1>
        <p className="text-lg text-gray-500 leading-relaxed">
          SnapState gives your agent persistent memory, but the agent needs to know it's
          available. The simplest and most effective approach is adding checkpoint instructions
          to your agent's system prompt.
        </p>
      </div>

      <H2 id="system-prompt">System Prompt Template</H2>
      <P>
        Add these instructions to your agent's system prompt. This works with Claude, GPT,
        or any LLM — the agent will automatically resume from prior state and save progress
        after each step.
      </P>
      <CodeBlock code={SYSTEM_PROMPT} language="bash" />

      <H2 id="mcp">Claude Desktop / Cline (MCP)</H2>
      <P>
        If you're using Claude Desktop or Cline with the SnapState MCP server, the tools
        are automatically available — no SDK installation needed. Just add the system prompt
        instructions above to your project's custom instructions or conversation.
      </P>
      <Note>
        <strong>Claude Desktop:</strong> Settings → Custom Instructions<br />
        <strong>Cline:</strong> Add to your <code className="bg-indigo-100 px-1 rounded text-xs">.clinerules</code> file or project instructions
      </Note>
      <P>MCP server config (add to your Claude Desktop or Cline settings):</P>
      <CodeBlock code={MCP_CONFIG} language="json" />
      <P>
        See <a href="#/guides/mcp" className="text-indigo-600 hover:underline">MCP Setup →</a> for
        full installation instructions.
      </P>

      <H2 id="sdk">SDK Integration Pattern</H2>
      <P>
        If you're building a custom agent with the SDK, wrap your workflow steps with
        checkpoint logic. The pattern is: resume at the start, save after each step,
        skip completed steps with <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">if state.step &lt; N</code>.
      </P>
      <CodeBlock tabs={SDK_TABS} />

      <H2 id="best-practices">Best Practices</H2>
      <BulletList items={BEST_PRACTICES} />
    </div>
  );
}
