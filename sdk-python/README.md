# snapstate-sdk (Python)

Python SDK for [SnapState](https://snapstate.dev) — universal workflow state for AI agents.

Works with any agent framework — LangChain, CrewAI, AutoGen, Claude Desktop, or custom agents. No framework lock-in.

Save and resume multi-step work across interruptions, crashes, and handoffs between agents.

## Installation

```bash
pip install snapstate-sdk
```

Requires Python 3.9+ and `httpx>=0.25.0` (installed automatically).

## Quick start (sync)

```python
from snapstate_sdk import SnapStateClient

client = SnapStateClient(
    api_key="snp_your_key_here",
    base_url="https://snapstate.dev",
)

# Save state after each step
result = client.save(
    workflow_id="wf_research_001",
    step=1,
    label="sources_gathered",
    state={"sources": ["arxiv.org/123"], "progress": 0.25},
)
print(f"Saved: {result.checkpoint_id} (etag: {result.etag})")

# Resume a workflow — get the latest state
resumed = client.resume("wf_research_001")
print(f"Resuming from step {resumed.latest_checkpoint.step}")
state = resumed.latest_checkpoint.state

# Get full checkpoint history
history = client.replay("wf_research_001")
for cp in history.checkpoints:
    print(f"  Step {cp.step}: {cp.label}")

client.close()
```

## Async usage

Every method has an `async_` prefixed equivalent:

```python
import asyncio
from snapstate_sdk import SnapStateClient

async def main():
    client = SnapStateClient(api_key="snp_...", base_url="https://snapstate.dev")

    result = await client.async_save(
        workflow_id="wf_001",
        step=1,
        state={"status": "running"},
    )
    print(f"Saved: {result.checkpoint_id}")

    resumed = await client.async_resume("wf_001")
    print(f"Latest step: {resumed.latest_checkpoint.step}")

    await client.async_close()

asyncio.run(main())
```

Context managers are supported for both sync and async usage:

```python
# Sync
with SnapStateClient(api_key="snp_...") as client:
    client.save(workflow_id="wf_001", step=1, state={})

# Async
async with SnapStateClient(api_key="snp_...") as client:
    await client.async_save(workflow_id="wf_001", step=1, state={})
```

## Agent identity

Register your agent once at startup, then tag checkpoints with `agent_id`:

```python
client = SnapStateClient(api_key="snp_...", base_url="https://snapstate.dev")

# Register agent identity
client.register_agent(
    agent_id="research-bot",
    name="Research Bot",
    description="Searches and summarizes sources",
    capabilities=["web_search", "summarization"],
    metadata={"model": "claude-sonnet-4-6", "version": "2.0.0"},
)

# Tag checkpoints with agent identity
client.save(
    workflow_id="wf_collab_001",
    step=1,
    state={"findings": [...]},
    agent_id="research-bot",    # identity tag
)

# Another agent picks up the workflow
resumed = client.resume("wf_collab_001")
prior_agent = resumed.latest_checkpoint.metadata.get("agent_id")
print(f"Picking up from: {prior_agent}")
```

## Error handling

```python
from snapstate_sdk import SnapStateClient
from snapstate_sdk.errors import (
    AuthError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    PayloadTooLargeError,
    ValidationError,
    SnapStateError,  # base class
)

client = SnapStateClient(api_key="snp_...", base_url="https://snapstate.dev")

try:
    resumed = client.resume("wf_missing")
except NotFoundError:
    print("No prior state — starting fresh")

try:
    client.save(
        workflow_id="wf_001",
        step=2,
        state={"data": "..."},
        if_match="old-etag",       # optimistic concurrency
    )
except ConflictError:
    print("State was modified by another agent — re-read and retry")

try:
    client.save(workflow_id="wf_001", step=1, state={})
except AuthError:
    print("Check your API key")
except RateLimitError as e:
    print(f"Rate limited — retry after {e.retry_after}s")
except PayloadTooLargeError:
    print("State exceeds 1 MB limit — consider compressing")
except SnapStateError as e:
    print(f"Unexpected error: {e} (HTTP {e.status_code}, code={e.code})")
```

## API reference

### `SnapStateClient(api_key, base_url, timeout, max_retries)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api_key` | `str` | required | API key starting with `snp_` |
| `base_url` | `str` | `https://snapstate.dev` | SnapState base URL |
| `timeout` | `float` | `30.0` | Request timeout in seconds |
| `max_retries` | `int` | `3` | Retry attempts on 429 before raising `RateLimitError` |

---

### Checkpoint methods

#### `save(workflow_id, step, state, label, metadata, agent_id, ttl_seconds, if_match) → SaveResult`

Save state for a workflow step.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `workflow_id` | `str` | required | Unique workflow identifier |
| `step` | `int` | required | Sequential step number |
| `state` | `dict` | required | Full state to persist (max 1 MB) |
| `label` | `str` | `None` | Human-readable step label |
| `metadata` | `dict` | `None` | Arbitrary metadata |
| `agent_id` | `str` | `None` | Agent identity tag |
| `ttl_seconds` | `int` | `None` | Override default TTL |
| `if_match` | `str` | `None` | ETag for optimistic concurrency |

Returns `SaveResult(checkpoint_id, workflow_id, step, etag, created_at, diff_from_previous, size_bytes)`.

#### `get(checkpoint_id) → Checkpoint`

Fetch a specific checkpoint by ID.

#### `resume(workflow_id) → WorkflowResume`

Get the latest checkpoint for a workflow. Raises `NotFoundError` if no checkpoints exist.

Returns `WorkflowResume(workflow_id, latest_checkpoint, total_checkpoints, workflow_started_at, last_activity_at)`.

#### `replay(workflow_id, from_step, to_step, limit) → WorkflowReplay`

Get the full ordered checkpoint history.

Returns `WorkflowReplay(workflow_id, checkpoints, total, has_more)`.

---

### Agent methods

#### `register_agent(agent_id, name, description, capabilities, metadata) → Agent`

Register or update an agent (upsert). Safe to call on every startup.

#### `list_agents() → list[Agent]`

List all agents for this account.

---

### Webhook methods

#### `register_webhook(url, events, secret) → dict`

Register a webhook URL. `events` is a list of `checkpoint.saved`, `workflow.resumed`, `workflow.expired`.

---

### Lifecycle

#### `close()`

Close the sync HTTP client.

#### `async_close()`

Close the async HTTP client.

---

### Async equivalents

Every method above has an `async_` prefixed version:
`async_save`, `async_get`, `async_resume`, `async_replay`, `async_register_agent`, `async_list_agents`.

---

### Return types

| Type | Fields |
|------|--------|
| `Checkpoint` | `checkpoint_id, workflow_id, step, label, state, metadata, etag, created_at, diff_from_previous, size_bytes, agent_id` |
| `WorkflowResume` | `workflow_id, latest_checkpoint, total_checkpoints, workflow_started_at, last_activity_at` |
| `WorkflowReplay` | `workflow_id, checkpoints, total, has_more` |
| `Agent` | `agent_id, name, description, capabilities, metadata, last_seen_at, created_at` |
| `SaveResult` | `checkpoint_id, workflow_id, step, etag, created_at, diff_from_previous, size_bytes` |

### Error types

| Exception | HTTP status | When raised |
|-----------|-------------|-------------|
| `AuthError` | 401 | Invalid or missing API key |
| `NotFoundError` | 404 | Resource not found |
| `ConflictError` | 409 | ETag mismatch (optimistic concurrency) |
| `PayloadTooLargeError` | 413 | State exceeds 1 MB |
| `RateLimitError` | 429 | Rate limit exceeded after all retries |
| `ValidationError` | 400 | Invalid input |
| `SnapStateError` | any | Base class for all SDK errors |

All exceptions expose `.status_code` (int) and `.code` (str, machine-readable error code).  
`RateLimitError` additionally exposes `.retry_after` (int, seconds).

## Running tests

```bash
pip install "snapstate-sdk[dev]"
pytest tests/
```
