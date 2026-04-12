import { CodeBlock } from '../components/CodeBlock.jsx';

function H1({ children }) { return <h1 className="text-3xl font-bold text-gray-900 mb-3">{children}</h1>; }
function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-3 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600">{children}</a>
    </h2>
  );
}
function P({ children }) { return <p className="text-gray-600 leading-relaxed mb-3">{children}</p>; }

export function PythonSdk() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Python SDK</h1>
      <P>Sync and async client for Python 3.9+. Requires <code className="bg-gray-100 px-1 rounded text-sm">httpx&gt;=0.25</code>.</P>

      <H2 id="install">Installation</H2>
      <CodeBlock code="pip install snapstate-sdk" language="bash" />

      <H2 id="sync">Sync usage</H2>
      <CodeBlock language="python" code={`from snapstate_sdk import SnapStateClient

client = SnapStateClient(
    api_key="snp_your_key_here",
    base_url="http://localhost:3000",
    timeout=30.0,    # optional, default shown
    max_retries=3,   # optional — retries on 429
)

# Save a checkpoint
result = client.save(
    workflow_id="wf_001",
    step=1,
    state={"progress": 0},
    label="init",
    agent_id="my-bot",         # optional
    metadata={"tokens": 340},  # optional
    ttl_seconds=86400,         # optional
)
print(f"Saved: {result.checkpoint_id}")

# Resume
resumed = client.resume("wf_001")
state = resumed.latest_checkpoint.state

# Replay
history = client.replay("wf_001", from_step=1, to_step=5, limit=50)
for cp in history.checkpoints:
    print(f"Step {cp.step}: {cp.label}")

client.close()`} />

      <H2 id="async">Async usage</H2>
      <CodeBlock language="python" code={`import asyncio
from snapstate_sdk import SnapStateClient

async def main():
    client = SnapStateClient(api_key="snp_...", base_url="http://localhost:3000")

    result = await client.async_save(
        workflow_id="wf_001",
        step=1,
        state={"x": 1},
        agent_id="async-bot",
    )
    print(f"Saved: {result.checkpoint_id}")

    resumed = await client.async_resume("wf_001")
    history = await client.async_replay("wf_001")

    await client.async_close()

asyncio.run(main())`} />

      <H2 id="context">Context managers</H2>
      <CodeBlock language="python" code={`# Sync — closes automatically on exit
with SnapStateClient(api_key="snp_...") as client:
    result = client.save(workflow_id="wf_001", step=1, state={})

# Async
import asyncio

async def run():
    async with SnapStateClient(api_key="snp_...") as client:
        result = await client.async_save(workflow_id="wf_001", step=1, state={})

asyncio.run(run())`} />

      <H2 id="agents">Agent identity</H2>
      <CodeBlock language="python" code={`# Register at startup (upsert — safe to call every run)
agent = client.register_agent(
    agent_id="research-bot",
    name="Research Bot",
    capabilities=["web_search", "summarization"],
    metadata={"model": "claude-sonnet-4-6"},
)

# Tag checkpoints with agent identity
client.save(
    workflow_id="wf_collab",
    step=1,
    state={"findings": []},
    agent_id="research-bot",
)

# List all agents
agents = client.list_agents()
for a in agents:
    print(f"{a.agent_id}: {a.name}")`} />

      <H2 id="errors">Error handling</H2>
      <CodeBlock language="python" code={`from snapstate_sdk.errors import (
    SnapStateError,   # base class
    AuthError,         # 401
    NotFoundError,     # 404
    ConflictError,     # 409 — ETag mismatch
    PayloadTooLargeError,  # 413 — state > 1 MB
    RateLimitError,    # 429 — after all retries
    ValidationError,   # 400
)

try:
    client.save(workflow_id="wf_001", step=1, state={}, if_match="old-etag")
except ConflictError:
    print("ETag mismatch — re-read state and retry")
except NotFoundError:
    print("Workflow not found — starting fresh")
except RateLimitError as e:
    print(f"Rate limited — retry after {e.retry_after}s")
except PayloadTooLargeError:
    print("State too large — compress before saving")
except SnapStateError as e:
    print(f"Error {e.status_code} [{e.code}]: {e}")`} />

      <H2 id="types">Return types</H2>
      <P>All methods return typed dataclasses:</P>
      <CodeBlock language="python" code={`from snapstate_sdk.types import (
    SaveResult,      # checkpoint_id, workflow_id, step, etag, created_at, size_bytes, diff_from_previous
    Checkpoint,      # checkpoint_id, workflow_id, step, label, state, metadata, etag, created_at, agent_id
    WorkflowResume,  # workflow_id, latest_checkpoint, total_checkpoints, workflow_started_at, last_activity_at
    WorkflowReplay,  # workflow_id, checkpoints, total, has_more
    Agent,           # agent_id, name, description, capabilities, metadata, last_seen_at, created_at
)`} />
    </div>
  );
}
