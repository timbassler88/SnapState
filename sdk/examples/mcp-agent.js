/**
 * Example: using the MCP server instead of the SDK directly.
 *
 * This shows what an MCP-compatible agent runtime does internally when
 * the `snapstate` MCP server is configured. You would NOT write this
 * code yourself — the MCP client (Claude Desktop, Cline, etc.) handles it.
 *
 * For illustration purposes only.
 */

// When configured as an MCP server, the agent runtime calls these tools:
//
// 1. At the start of a task:
//    resume_workflow({ workflow_id: "wf_research_001" })
//    → Returns the last saved state, or null if new workflow
//
// 2. After each meaningful step:
//    save_checkpoint({
//      workflow_id: "wf_research_001",
//      step: 1,
//      label: "initialized",
//      state: { query: "AI trends 2026", sources: [] }
//    })
//    → Returns { checkpoint_id, etag, step, created_at, diff_from_previous }
//
// 3. For debugging:
//    get_workflow_history({
//      workflow_id: "wf_research_001",
//      from_step: 1
//    })
//    → Returns ordered list of all checkpoints

// ---------------------------------------------------------------------------
// The MCP server config you add to claude_desktop_config.json:
// ---------------------------------------------------------------------------

const CLAUDE_DESKTOP_CONFIG_EXAMPLE = {
  mcpServers: {
    snapstate: {
      command: 'node',
      args: ['./mcp-server/src/index.js'],
      env: {
        SNAPSTATE_API_URL: 'https://snapstate.dev',
        SNAPSTATE_API_KEY: 'snp_your_api_key_here',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Direct MCP tool call simulation (for testing the MCP server without a client)
// ---------------------------------------------------------------------------

import { handleTool } from '../../mcp-server/src/tools.js';

const WORKFLOW_ID = `wf_mcp_demo_${Date.now()}`;

// Check for existing state
const resumed = await handleTool('resume_workflow', { workflow_id: WORKFLOW_ID });
console.log('Resume result:', resumed.latest_checkpoint ? 'found' : 'new workflow');

// Save step 1
const cp1 = await handleTool('save_checkpoint', {
  workflow_id: WORKFLOW_ID,
  step: 1,
  label: 'initialized',
  state: { query: 'AI trends 2026', sources: [], status: 'started' },
});
console.log('Checkpoint 1 saved:', cp1.checkpoint_id);

// Save step 2
const cp2 = await handleTool('save_checkpoint', {
  workflow_id: WORKFLOW_ID,
  step: 2,
  label: 'fetched_sources',
  state: {
    query: 'AI trends 2026',
    sources: ['https://example.com/ai-2026'],
    status: 'in_progress',
  },
});
console.log('Checkpoint 2 saved:', cp2.checkpoint_id);
console.log('Changes:', cp2.diff_from_previous);

// Get history
const history = await handleTool('get_workflow_history', { workflow_id: WORKFLOW_ID });
console.log(`\nHistory: ${history.total} checkpoints`);
for (const cp of history.checkpoints) {
  console.log(`  [${cp.step}] ${cp.label}`);
}
