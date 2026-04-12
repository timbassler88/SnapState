/**
 * HTTP + SSE transport for remote MCP hosting.
 *
 * Agents connect via a URL instead of launching a subprocess.
 * Useful for deploying the MCP server as a shared service.
 *
 * Usage:
 *   PORT=3001 \
 *   SNAPSTATE_API_URL=http://localhost:3000 \
 *   SNAPSTATE_API_KEY=snp_... \
 *   node src/transport.js
 */

import 'dotenv/config';
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DEFINITIONS, handleTool } from './tools.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Map of session ID → { server, transport }
const sessions = new Map();

function createMcpServer() {
  const server = new Server(
    { name: 'snapstate', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.error(JSON.stringify({ level: 'info', msg: 'tool_call', tool: name }));
    try {
      const result = await handleTool(name, args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // SSE endpoint — agent opens a long-lived connection here
  if (req.method === 'GET' && url.pathname === '/sse') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const transport = new SSEServerTransport('/message', res);
    const server = createMcpServer();
    sessions.set(transport.sessionId, { server, transport });

    req.on('close', () => {
      sessions.delete(transport.sessionId);
    });

    await server.connect(transport);
    return;
  }

  // Message endpoint — agent POSTs MCP messages here
  if (req.method === 'POST' && url.pathname === '/message') {
    const sessionId = url.searchParams.get('sessionId');
    const session = sessions.get(sessionId);

    if (!session) {
      res.writeHead(404).end('Session not found');
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;

    await session.transport.handlePostMessage(req, res, body);
    return;
  }

  // Health
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
    return;
  }

  res.writeHead(404).end();
});

httpServer.listen(PORT, () => {
  console.error(JSON.stringify({ level: 'info', msg: `SnapState MCP server (HTTP+SSE) listening on port ${PORT}` }));
});
