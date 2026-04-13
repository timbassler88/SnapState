# @snapstate/mcp-server

MCP (Model Context Protocol) server for SnapState. Exposes checkpoint tools to any MCP-compatible agent — no SDK installation required.

## Tools

| Tool | Description |
|------|-------------|
| `save_checkpoint` | Save workflow state after each step |
| `resume_workflow` | Retrieve the last checkpoint to resume a workflow |
| `get_workflow_history` | Get ordered checkpoint history for debugging |

## Setup

### Prerequisites

1. SnapState must be running (`npm start` in `server/`)
2. You need a valid API key (run `npm run seed` in `server/`)

### Install

```bash
cd mcp-server && npm install
```

### Environment variables

```bash
SNAPSTATE_API_URL=https://snapstate.dev   # SnapState URL
SNAPSTATE_API_KEY=snp_your_key_here      # Valid API key
```

Copy `.env.example` from the server package and set these vars.

---

## Transports

### stdio (local agents)

The default transport. The MCP client launches this as a subprocess and communicates via stdin/stdout.

```bash
node src/index.js
```

### HTTP + SSE (remote agents)

For deploying as a shared service that multiple agents connect to remotely.

```bash
PORT=3001 node src/transport.js
```

Agents connect to `http://your-mcp-host:3001/sse` and post messages to `http://your-mcp-host:3001/message?sessionId=...`.

---

## Client configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "snapstate": {
      "command": "node",
      "args": ["/absolute/path/to/snapstate/mcp-server/src/index.js"],
      "env": {
        "SNAPSTATE_API_URL": "https://snapstate.dev",
        "SNAPSTATE_API_KEY": "snp_your_api_key_here"
      }
    }
  }
}
```

### Cline (VS Code extension)

In Cline settings → MCP Servers → Add:

```json
{
  "snapstate": {
    "command": "node",
    "args": ["/absolute/path/to/mcp-server/src/index.js"],
    "env": {
      "SNAPSTATE_API_URL": "https://snapstate.dev",
      "SNAPSTATE_API_KEY": "snp_your_api_key_here"
    }
  }
}
```

### Via npx (after publishing to npm)

```json
{
  "mcpServers": {
    "snapstate": {
      "command": "npx",
      "args": ["-y", "@snapstate/mcp-server"],
      "env": {
        "SNAPSTATE_API_URL": "https://snapstate.dev",
        "SNAPSTATE_API_KEY": "snp_your_api_key_here"
      }
    }
  }
}
```

---

## Usage in an agent

Once configured, MCP-compatible agents can use these tools without any SDK:

```
# The agent automatically has access to:
save_checkpoint(workflow_id, step, state, label?, metadata?)
resume_workflow(workflow_id)
get_workflow_history(workflow_id, from_step?, to_step?, limit?)
```

### Example agent instructions

```
At the start of each task, call resume_workflow with the current workflow_id to check for existing state.
After completing each significant step, call save_checkpoint with the full current state.
If interrupted, the next run will automatically resume from the last checkpoint.
```

---

## Debugging

The server logs all tool calls to stderr in JSON format:

```json
{"level":"info","msg":"tool_call","tool":"save_checkpoint","args":{"workflow_id":"wf_123","step":1}}
```

To see logs when running via Claude Desktop, check the MCP server log file:
- macOS: `~/Library/Logs/Claude/mcp-server-snapstate.log`
- Windows: `%APPDATA%\Claude\logs\mcp-server-snapstate.log`
