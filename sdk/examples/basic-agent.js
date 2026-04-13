/**
 * Example: a simple research agent that uses the SnapState SDK
 * to save and resume multi-step workflow state.
 *
 * Run with:
 *   node examples/basic-agent.js
 *
 * Prerequisites:
 *   - SnapState service running at https://snapstate.dev
 *   - A valid API key in the SNAPSTATE_API_KEY env var
 */

import { SnapStateClient, SnapStateError } from '../src/index.js';

const API_KEY = process.env.SNAPSTATE_API_KEY ?? 'snp_replace_me';
const WORKFLOW_ID = `wf_research_${Date.now()}`;

const cp = new SnapStateClient({
  apiKey: API_KEY,
  baseUrl: 'https://snapstate.dev',
});

async function runAgent() {
  console.log(`Starting workflow: ${WORKFLOW_ID}`);

  // Try to resume from an existing checkpoint
  let startStep = 1;
  let existingState = {};

  try {
    const resumed = await cp.resume(WORKFLOW_ID);
    startStep = resumed.latestCheckpoint.step + 1;
    existingState = resumed.latestCheckpoint.state;
    console.log(`Resuming from step ${startStep}`, existingState);
  } catch (err) {
    if (err instanceof SnapStateError && err.statusCode === 404) {
      console.log('No existing checkpoint — starting fresh');
    } else {
      throw err;
    }
  }

  // Step 1: Initialize
  if (startStep <= 1) {
    const state = { query: 'AI trends 2026', sources: [], status: 'initialized' };
    await cp.save({
      workflowId: WORKFLOW_ID,
      step: 1,
      label: 'initialized',
      state,
      metadata: { agentName: 'research-bot', model: 'claude-sonnet-4-6' },
    });
    console.log('Step 1 saved: initialized');
  }

  // Step 2: Fetch sources (simulated)
  if (startStep <= 2) {
    const state = {
      query: 'AI trends 2026',
      sources: ['https://example.com/ai-2026', 'https://example.com/llm-trends'],
      status: 'sources_fetched',
    };
    await cp.save({
      workflowId: WORKFLOW_ID,
      step: 2,
      label: 'fetched_sources',
      state,
      metadata: { agentName: 'research-bot', model: 'claude-sonnet-4-6' },
    });
    console.log('Step 2 saved: fetched_sources');
  }

  // Step 3: Summarize (simulated)
  if (startStep <= 3) {
    const state = {
      query: 'AI trends 2026',
      sources: ['https://example.com/ai-2026', 'https://example.com/llm-trends'],
      summary: 'AI in 2026 is characterized by multimodal agents and persistent state management.',
      status: 'completed',
    };
    await cp.save({
      workflowId: WORKFLOW_ID,
      step: 3,
      label: 'summarized',
      state,
      metadata: { agentName: 'research-bot', model: 'claude-sonnet-4-6' },
    });
    console.log('Step 3 saved: summarized');
  }

  // Retrieve full history
  const history = await cp.replay(WORKFLOW_ID);
  console.log(`\nWorkflow complete. ${history.total} checkpoints recorded:`);
  for (const c of history.checkpoints) {
    console.log(`  [${c.step}] ${c.label} — ${c.createdAt}`);
  }

  // Register a webhook (optional)
  try {
    const hook = await cp.registerWebhook({
      url: 'https://example.com/my-webhook',
      events: ['checkpoint.saved'],
      secret: 'my-signing-secret',
    });
    console.log(`\nWebhook registered: ${hook.webhookId}`);
  } catch (err) {
    console.warn('Webhook registration skipped:', err.message);
  }
}

runAgent().catch((err) => {
  console.error('Agent failed:', err.message);
  process.exit(1);
});
