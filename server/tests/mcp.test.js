/**
 * mcp.test.js
 *
 * Tests for MCP tool handlers — mocks HTTP calls to the Checkpoint API.
 * Does not require a running server.
 */

import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// Set env vars before importing tools
process.env.SNAPSTATE_API_URL = 'http://localhost:3000';
process.env.SNAPSTATE_API_KEY = 'snp_test_mcp_key_00000000000000000';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

let mockFetchResponse = null;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (mockFetchResponse) {
    const { status, body } = mockFetchResponse;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }
  throw new Error('fetch not mocked');
};

after(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(status, body) {
  mockFetchResponse = { status, body };
}

// ---------------------------------------------------------------------------
// Tool tests
// ---------------------------------------------------------------------------

describe('TOOL_DEFINITIONS', () => {
  test('exports exactly 3 tool definitions', async () => {
    const { TOOL_DEFINITIONS } = await import('../../mcp-server/src/tools.js');
    assert.equal(TOOL_DEFINITIONS.length, 3);
  });

  test('all tools have name, description, and inputSchema', async () => {
    const { TOOL_DEFINITIONS } = await import('../../mcp-server/src/tools.js');
    for (const tool of TOOL_DEFINITIONS) {
      assert.ok(tool.name, `Tool missing name`);
      assert.ok(tool.description, `Tool ${tool.name} missing description`);
      assert.ok(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(Array.isArray(tool.inputSchema.required) || !tool.inputSchema.required);
    }
  });

  test('save_checkpoint requires workflow_id, step, state', async () => {
    const { TOOL_DEFINITIONS } = await import('../../mcp-server/src/tools.js');
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'save_checkpoint');
    assert.ok(tool.inputSchema.required.includes('workflow_id'));
    assert.ok(tool.inputSchema.required.includes('step'));
    assert.ok(tool.inputSchema.required.includes('state'));
  });

  test('resume_workflow requires workflow_id', async () => {
    const { TOOL_DEFINITIONS } = await import('../../mcp-server/src/tools.js');
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'resume_workflow');
    assert.ok(tool.inputSchema.required.includes('workflow_id'));
  });

  test('get_workflow_history requires workflow_id', async () => {
    const { TOOL_DEFINITIONS } = await import('../../mcp-server/src/tools.js');
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'get_workflow_history');
    assert.ok(tool.inputSchema.required.includes('workflow_id'));
  });
});

describe('handleTool — save_checkpoint', () => {
  test('returns checkpoint data on success', async () => {
    mockFetch(201, {
      checkpoint_id: 'cp_wf_test_001',
      etag: '"abc123"',
      step: 1,
      created_at: '2026-04-08T12:00:00Z',
      size_bytes: 128,
      diff_from_previous: { added: ['state.query'], removed: [], changed: [] },
    });

    const { handleTool } = await import('../../mcp-server/src/tools.js');
    const result = await handleTool('save_checkpoint', {
      workflow_id: 'wf_test',
      step: 1,
      state: { query: 'hello' },
    });

    assert.equal(result.checkpoint_id, 'cp_wf_test_001');
    assert.equal(result.step, 1);
    assert.ok(result.etag);
    assert.ok(result.diff_from_previous);
  });

  test('throws on API error', async () => {
    mockFetch(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });

    const { handleTool } = await import('../../mcp-server/src/tools.js');
    await assert.rejects(
      () => handleTool('save_checkpoint', { workflow_id: 'wf_x', step: 1, state: {} }),
      /Invalid API key/
    );
  });
});

describe('handleTool — resume_workflow', () => {
  test('returns latest checkpoint when found', async () => {
    mockFetch(200, {
      workflow_id: 'wf_test',
      latest_checkpoint: { step: 3, state: { x: 1 }, created_at: '2026-04-08T12:00:00Z' },
      total_checkpoints: 3,
    });

    const { handleTool } = await import('../../mcp-server/src/tools.js');
    const result = await handleTool('resume_workflow', { workflow_id: 'wf_test' });
    assert.equal(result.workflow_id, 'wf_test');
    assert.equal(result.latest_checkpoint.step, 3);
  });

  test('returns null latest_checkpoint on 404 (new workflow)', async () => {
    mockFetch(404, { error: { code: 'NOT_FOUND', message: 'No checkpoints found for workflow wf_new' } });

    const { handleTool } = await import('../../mcp-server/src/tools.js');
    const result = await handleTool('resume_workflow', { workflow_id: 'wf_new' });
    assert.equal(result.latest_checkpoint, null);
    assert.ok(result.message);
  });
});

describe('handleTool — get_workflow_history', () => {
  test('returns checkpoint list', async () => {
    mockFetch(200, {
      workflow_id: 'wf_test',
      checkpoints: [
        { checkpoint_id: 'cp_wf_test_001', step: 1, label: 'init', created_at: '2026-04-08T12:00:00Z' },
        { checkpoint_id: 'cp_wf_test_002', step: 2, label: 'done', created_at: '2026-04-08T12:01:00Z' },
      ],
      total: 2,
      has_more: false,
    });

    const { handleTool } = await import('../../mcp-server/src/tools.js');
    const result = await handleTool('get_workflow_history', { workflow_id: 'wf_test' });
    assert.equal(result.workflow_id, 'wf_test');
    assert.equal(result.total, 2);
    assert.equal(result.checkpoints.length, 2);
  });

  test('passes from_step and to_step in query string', async () => {
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ workflow_id: 'wf_x', checkpoints: [], total: 0, has_more: false }) };
    };

    const { handleTool } = await import('../../mcp-server/src/tools.js');
    await handleTool('get_workflow_history', { workflow_id: 'wf_x', from_step: 2, to_step: 5 });
    assert.ok(capturedUrl.includes('from_step=2'));
    assert.ok(capturedUrl.includes('to_step=5'));

    // Restore mock
    globalThis.fetch = async (url, init) => {
      if (mockFetchResponse) {
        const { status, body } = mockFetchResponse;
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      }
      throw new Error('fetch not mocked');
    };
  });
});

describe('handleTool — unknown tool', () => {
  test('throws for unknown tool name', async () => {
    const { handleTool } = await import('../../mcp-server/src/tools.js');
    await assert.rejects(
      () => handleTool('nonexistent_tool', {}),
      /Unknown tool/
    );
  });
});
