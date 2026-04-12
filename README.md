# SnapState

A production-ready checkpoint and state-persistence API that AI agents use to save and resume multi-step workflows. Agents write checkpoints at each step; if a workflow is interrupted, it resumes from the last saved state rather than restarting.

**Phase 1** — Core API, Redis state store, JavaScript SDK  
**Phase 2** — MCP server, Cloudflare R2 cold storage, Postgres accounts + billing, admin dashboard  
**Phase 3** — Agent identity + analytics, Python SDK, public docs site, production hardening

---

## Quick start

### 1. Start infrastructure

```bash
docker-compose up -d
# Starts Redis 7 (port 6379) + Postgres 16 (port 5432)
```

### 2. Install server dependencies

```bash
cd server && npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — defaults work with Docker Compose for local dev
```

### 4. Run database migrations

```bash
npm run migrate
# Applies all migrations (001 through 007)
```

### 5. Create an admin account + API key

```bash
npm start &

curl -X POST http://localhost:3000/admin/accounts \
  -H "Authorization: Bearer admin_dev_secret_change_me" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "name": "Your Name"}'

# Generate API key (save it — shown once)
curl -X POST http://localhost:3000/admin/accounts/1/keys \
  -H "Authorization: Bearer admin_dev_secret_change_me" \
  -H "Content-Type: application/json" \
  -d '{"label": "development"}'
```

### 6. Start the dashboard (optional)

```bash
cd dashboard && npm install && npm run dev
# Opens at http://localhost:5173
```

### 7. View the docs site (optional)

```bash
cd docs && npm install && npm run dev
# Opens at http://localhost:5174
```

---

## Architecture

```
HTTP request
  → Fastify (v3.0.0)
    → Auth middleware (Postgres key lookup + Redis 5-min cache)
    → Rate limit (Redis sliding window)
    → Route handler
      → checkpoint-writer  (Redis pipeline: HASH + STREAM + meta)
          ↳ usageTracker.track      (setImmediate, non-blocking)
          ↳ analyticsService.update (setImmediate, non-blocking)
          ↳ agentService.updateLastSeen (setImmediate, non-blocking)
          ↳ emitEvent               (fire-and-forget webhooks)
      → resume-engine  (Redis → Postgres → R2 fallback chain)

TTL Manager (background, every 60 s)
  → Scan wf:*:latest keys with TTL < 1 hour
  → archiver: read stream + gzip + R2 upload + Postgres record + delete Redis keys

Graceful shutdown (SIGTERM / SIGINT)
  → 10-second hard timeout
  → ttlManager.stop → app.close → Redis.quit → Postgres pool close
```

### Redis key structure

| Key | Type | Contents |
|-----|------|----------|
| `auth_cache:{key_hash}` | STRING | Cached auth result (5-min TTL) |
| `cp:{checkpoint_id}` | STRING | Compressed checkpoint record |
| `wf:{workflow_id}:latest` | HASH | Latest checkpoint state |
| `wf:{workflow_id}:log` | STREAM | Ordered checkpoint event log |
| `wf:{workflow_id}:meta` | HASH | Workflow metadata |
| `webhooks:{api_key}` | HASH | Registered webhooks |
| `rate_limit:{api_key}` | ZSET | Sliding-window timestamps |

---

## API reference

All endpoints require:
```
Authorization: Bearer <api_key>
Content-Type: application/json
```

All responses include `X-Request-Id` (UUID v4).

### Core checkpoint endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/checkpoints` | Save a checkpoint |
| `GET` | `/checkpoints/:id` | Get a checkpoint |
| `GET` | `/workflows/:id/resume` | Resume (latest checkpoint) |
| `GET` | `/workflows/:id/replay` | Full checkpoint history |

**Save a checkpoint**

```bash
curl -X POST http://localhost:3000/checkpoints \
  -H "Authorization: Bearer $SNAPSTATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_id": "wf_001",
    "step": 1,
    "label": "research_complete",
    "state": {"findings": []},
    "agent_id": "research-bot"
  }'
```

Optional headers: `X-Checkpoint-TTL: 3600`, `If-Match: "<etag>"` (optimistic concurrency).

### Agent identity endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/agents` | Register an agent (upsert) |
| `GET` | `/agents` | List all agents |
| `GET` | `/agents/:agent_id` | Get agent details |
| `PATCH` | `/agents/:agent_id` | Update agent metadata |
| `DELETE` | `/agents/:agent_id` | Delete agent |

### Analytics endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/analytics/overview` | Account-level workflow stats |
| `GET` | `/analytics/workflows/:id` | Per-workflow checkpoint timeline |
| `GET` | `/analytics/failures` | Failure pattern breakdown |
| `GET` | `/analytics/agents` | Per-agent performance metrics |

### Webhook endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks` | Register a webhook |
| `GET` | `/webhooks` | List webhooks |
| `DELETE` | `/webhooks/:id` | Delete a webhook |

### Health endpoints

```bash
curl http://localhost:3000/health
# { status, version, uptime_seconds, redis, postgres, r2, timestamp }

curl http://localhost:3000/ready
# 200 { status: "ready" } or 503 { status: "not_ready", redis, postgres }
```

### Admin API

All admin routes require `Authorization: Bearer <ADMIN_SECRET>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/accounts` | Create account |
| `GET` | `/admin/accounts` | List accounts |
| `GET` | `/admin/accounts/:id` | Account + usage summary |
| `POST` | `/admin/accounts/:id/keys` | Generate API key |
| `GET` | `/admin/accounts/:id/keys` | List API keys |
| `DELETE` | `/admin/accounts/:id/keys/:key_id` | Revoke API key |
| `GET` | `/admin/accounts/:id/usage` | Usage + free tier |
| `GET` | `/admin/accounts/:id/invoices` | Stripe invoices |
| `GET` | `/admin/stats` | Dashboard overview |
| `GET` | `/admin/workflows` | Paginated workflow list |
| `GET` | `/admin/activity` | Recent usage events |
| `GET` | `/admin/analytics/overview` | Global analytics (all accounts) |
| `GET` | `/admin/analytics/failures` | Global failure patterns |
| `POST` | `/billing/stripe-webhook` | Stripe webhook receiver |

---

## SDKs

### JavaScript SDK

```bash
npm install @snapstate/sdk
```

```javascript
import { SnapStateClient } from '@snapstate/sdk';

const cp = new SnapStateClient({ apiKey: 'snp_...', baseUrl: 'http://localhost:3000' });

// Register an agent (upsert — safe to call every startup)
await cp.registerAgent({
  agentId: 'research-bot',
  name: 'Research Bot',
  capabilities: ['web_search', 'summarization'],
  metadata: { model: 'claude-sonnet-4-6', version: '2.1.0' },
});

// Save a checkpoint
await cp.save({ workflowId: 'wf_001', step: 1, state: { query: 'hello' }, agentId: 'research-bot' });

// Resume from last checkpoint
const { latestCheckpoint } = await cp.resume('wf_001');

// Replay history
const { checkpoints } = await cp.replay('wf_001', { fromStep: 1 });
```

See [sdk/](sdk/) for source.

### Python SDK

```bash
pip install snapstate-sdk
```

```python
from snapstate_sdk import SnapStateClient

with SnapStateClient(api_key="snp_...", base_url="http://localhost:3000") as client:
    result = client.save(workflow_id="wf_001", step=1, state={"query": "hello"}, agent_id="research-bot")
    resumed = client.resume("wf_001")
    history = client.replay("wf_001", from_step=1)
```

Async support via `async_save` / `async_resume` / `async_replay` and `async with` context manager.

See [sdk-python/](sdk-python/) for source and [sdk-python/examples/](sdk-python/examples/) for usage examples.

---

## MCP Server

Exposes checkpoint tools to any MCP-compatible agent (Claude Desktop, Cline, Cursor) without requiring SDK installation.

```bash
cd mcp-server && npm install
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "snapstate": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/src/index.js"],
      "env": {
        "SNAPSTATE_API_URL": "http://localhost:3000",
        "SNAPSTATE_API_KEY": "snp_your_key_here"
      }
    }
  }
}
```

| Tool | Description |
|------|-------------|
| `save_checkpoint` | Save state after each workflow step |
| `resume_workflow` | Retrieve last checkpoint to resume from |
| `get_workflow_history` | Full ordered checkpoint history |
| `register_agent` | Register this agent with the service |

---

## Documentation site

The public docs site (`docs/`) is a React + Vite + Tailwind app with 8 documentation pages:

- **Getting Started** — quickstart guide, first checkpoint in 5 minutes
- **API Reference** — all endpoints with interactive Try It playground
- **JavaScript SDK** — full method reference with code examples
- **Python SDK** — sync + async usage, error handling, typed dataclasses
- **MCP Setup** — Claude Desktop, Cline, and Cursor configuration
- **Agent Identity** — multi-agent coordination walkthrough
- **Webhooks** — event types, signature verification, best practices
- **Pricing** — free tier details, usage rates, interactive cost calculator

Build for production:

```bash
cd docs && npm install && npm run build
# Output: docs/dist/ (served at /docs/ by the API server)
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `DATABASE_URL` | `postgres://checkpoint:checkpoint_dev@localhost:5432/snapstate` | Postgres connection |
| `ADMIN_SECRET` | `admin_dev_secret_change_me` | Admin API bearer token |
| `DEFAULT_TTL_SECONDS` | `604800` | Checkpoint TTL (7 days) |
| `RATE_LIMIT_MAX` | `100` | Requests/minute per key |
| `R2_ACCOUNT_ID` | — | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | — | R2 access key |
| `R2_SECRET_ACCESS_KEY` | — | R2 secret key |
| `R2_BUCKET_NAME` | `checkpoint-archives` | R2 bucket name |
| `R2_ENDPOINT` | — | R2 S3-compatible endpoint URL |
| `STRIPE_SECRET_KEY` | — | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret |
| `JWT_SECRET` | — | JWT signing secret (auth) |
| `SMTP_HOST` | — | SMTP host for email |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | From address for emails |
| `FRONTEND_URL` | `http://localhost:5173` | Dashboard URL (email links) |

---

## Running tests

```bash
cd server
npm test                                    # Full test suite
node --test tests/checkpoints.test.js       # Core checkpoint tests
node --test tests/agents.test.js            # Agent identity tests
node --test tests/analytics.test.js         # Analytics tests
```

```bash
cd sdk-python
pip install -e ".[dev]"
pytest                                      # Python SDK tests (18 tests, no server needed)
```

Tests use Redis db 1 for isolation. Postgres tests require a running database.
