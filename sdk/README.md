# @snapstate/sdk

Zero-dependency, isomorphic JavaScript SDK for [SnapState](../README.md).

Works with any agent framework — LangChain, CrewAI, AutoGen, Claude Desktop, or custom agents. No framework lock-in.

Works in Node.js 18+ and modern browsers via native `fetch`.

## Installation

```bash
npm install @snapstate/sdk
```

## Quick start

```javascript
import { SnapStateClient } from '@snapstate/sdk';

const cp = new SnapStateClient({
  apiKey: 'snp_abc123...',
  baseUrl: 'https://snapstate.dev',   // or your production URL
});

// Save a checkpoint
await cp.save({
  workflowId: 'wf_research_001',
  step: 1,
  label: 'initialized',
  state: { query: 'AI trends 2026', sources: [] },
  metadata: { agentName: 'research-bot', model: 'claude-sonnet-4-6' },
});

// Resume from where we left off
const resumed = await cp.resume('wf_research_001');
console.log(resumed.latestCheckpoint.state);

// Get full history for debugging
const history = await cp.replay('wf_research_001');

// Paginated replay
const page = await cp.replay('wf_research_001', { fromStep: 2, limit: 10 });

// Register a webhook
const hook = await cp.registerWebhook({
  url: 'https://myapp.com/hook',
  events: ['checkpoint.saved', 'workflow.resumed'],
  secret: 'my-signing-secret',       // optional
});

// Delete a webhook
await cp.deleteWebhook(hook.webhookId);
```

## API Reference

### `new SnapStateClient({ apiKey, baseUrl? })`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | `string` | required | API key prefixed with `snp_` |
| `baseUrl` | `string` | `https://snapstate.dev` | Service base URL |

### `cp.save(params)`

Save a checkpoint. Auto-retries on 429 with exponential backoff (max 3 retries).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowId` | `string` | yes | Client-generated unique workflow ID |
| `step` | `number` | yes | Step number (integer ≥ 0) |
| `label` | `string` | no | Human-readable step name |
| `state` | `object` | yes | Arbitrary JSON state (max 1MB) |
| `metadata` | `object` | no | Indexed metadata |
| `ttlSeconds` | `number` | no | Override TTL in seconds |
| `ifMatch` | `string` | no | ETag for optimistic concurrency |

**Returns:** `{ checkpointId, workflowId, step, etag, createdAt, diffFromPrevious, sizeBytes }`

### `cp.get(checkpointId)`

Retrieve a specific checkpoint by ID.

**Returns:** Full checkpoint object including `state`, `metadata`, `etag`, `expiresAt`.

### `cp.resume(workflowId)`

Get the latest checkpoint for resuming a workflow.

**Returns:** `{ workflowId, latestCheckpoint, totalCheckpoints, workflowStartedAt, lastActivityAt }`

### `cp.replay(workflowId, opts?)`

Get ordered checkpoint history.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fromStep` | `number` | — | Start from this step |
| `toStep` | `number` | — | End at this step |
| `limit` | `number` | 100 | Max results (max 1000) |

**Returns:** `{ workflowId, checkpoints, total, hasMore }`

### `cp.registerWebhook({ url, events, secret? })`

Register a webhook.

**Events:** `checkpoint.saved` | `workflow.resumed` | `workflow.expired`

**Returns:** `{ webhookId, url, events, createdAt }`

### `cp.deleteWebhook(webhookId)`

Delete a webhook. Returns `null`.

### `cp.health()`

Check service health. Returns `{ status, redis, timestamp }`.

## Error handling

All methods throw `SnapStateError` on failure:

```javascript
import { SnapStateClient, SnapStateError } from '@snapstate/sdk';

try {
  const resumed = await cp.resume('wf_missing');
} catch (err) {
  if (err instanceof SnapStateError) {
    console.log(err.code);       // 'NOT_FOUND'
    console.log(err.statusCode); // 404
    console.log(err.message);    // 'No checkpoints found for workflow wf_missing'
  }
}
```

## Idempotency & optimistic concurrency

Use `ifMatch` with a saved ETag to implement optimistic concurrency:

```javascript
const saved = await cp.save({ workflowId, step: 1, state: { v: 1 } });

// Later, only overwrite if nobody else changed it:
await cp.save({
  workflowId,
  step: 1,
  state: { v: 2 },
  ifMatch: saved.etag,   // throws SnapStateError(409) if ETag changed
});
```

## CommonJS usage

```javascript
const { SnapStateClient } = require('@snapstate/sdk');
```

> Requires the `dist/index.cjs` build. Run `npm run build` in the SDK package first.

## Backward compatibility

`CheckpointClient` and `CheckpointError` are exported as deprecated aliases for `SnapStateClient` and `SnapStateError` respectively.
