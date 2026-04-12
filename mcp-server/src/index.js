#!/usr/bin/env node
/**
 * SnapState MCP Server — stdio transport (default).
 *
 * Exposes checkpoint tools to any MCP-compatible agent client:
 *   - save_checkpoint
 *   - resume_workflow
 *   - get_workflow_history
 *
 * Usage:
 *   SNAPSTATE_API_URL=http://localhost:3000 \
 *   SNAPSTATE_API_KEY=snp_... \
 *   node src/index.js
 *
 * Or via npx:
 *   npx @snapstate/mcp-server
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DEFINITIONS, handleTool } from './tools.js';

const server = new Server(
  {
    name: 'snapstate',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

// Execute a tool call
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  console.error(JSON.stringify({ level: 'info', msg: 'tool_call', tool: name, args }));

  try {
    const result = await handleTool(name, args ?? {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'tool_call_failed', tool: name, err: err.message }));
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(JSON.stringify({ level: 'info', msg: 'SnapState MCP server started (stdio)' }));
