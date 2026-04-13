/**
 * multi-agent.js
 *
 * Example: two agents collaborating on a single workflow.
 *
 * Research Bot gathers data and saves a checkpoint tagged with its identity.
 * Writer Bot resumes the workflow and continues from where Research Bot left off.
 *
 * Run:
 *   SNAPSTATE_API_KEY=snp_... node sdk/examples/multi-agent.js
 */

import { SnapStateClient } from '@snapstate/sdk';

const cp = new SnapStateClient({
  apiKey: process.env.SNAPSTATE_API_KEY ?? 'snp_your_key_here',
  baseUrl: process.env.SNAPSTATE_API_URL ?? 'https://snapstate.dev',
});

const WORKFLOW_ID = `wf_collab_${Date.now()}`;

// ---------------------------------------------------------------------------
// Register both agents at the start of the session
// ---------------------------------------------------------------------------

console.log('Registering agents...');

await cp.registerAgent({
  agentId: 'research-bot',
  name: 'Research Bot',
  description: 'Researches topics across multiple sources and produces summaries',
  capabilities: ['web_search', 'summarization', 'citation'],
  metadata: {
    model: 'claude-sonnet-4-6',
    framework: 'direct',
    version: '1.0.0',
  },
});

await cp.registerAgent({
  agentId: 'writer-bot',
  name: 'Writer Bot',
  description: 'Takes research data and produces polished written content',
  capabilities: ['drafting', 'editing', 'formatting'],
  metadata: {
    model: 'claude-sonnet-4-6',
    framework: 'direct',
    version: '1.0.0',
  },
});

console.log('Agents registered.');

// ---------------------------------------------------------------------------
// Agent 1: Research Bot gathers data and saves checkpoint
// ---------------------------------------------------------------------------

console.log('\nResearch Bot: gathering data...');

const researchCheckpoint = await cp.save({
  workflowId: WORKFLOW_ID,
  step: 1,
  label: 'research_complete',
  agentId: 'research-bot',
  state: {
    topic: 'quantum computing',
    sources: [
      'arxiv.org/abs/2301.00001',
      'nature.com/articles/s41586-023-0001',
    ],
    raw_data: {
      key_findings: [
        'Quantum error correction improved by 40% in 2024',
        'Commercial quantum advantage demonstrated in optimization tasks',
      ],
      relevance_scores: { 'arxiv.org/abs/2301.00001': 0.92, 'nature.com/articles/s41586-023-0001': 0.87 },
    },
    next_agent: 'writer-bot',
  },
  metadata: {
    duration_ms: 3200,
    sources_evaluated: 12,
  },
});

console.log(`Research Bot: checkpoint saved — step ${researchCheckpoint.step}, etag ${researchCheckpoint.etag}`);

// ---------------------------------------------------------------------------
// Agent 2: Writer Bot resumes and continues
// ---------------------------------------------------------------------------

console.log('\nWriter Bot: resuming workflow...');

const resumed = await cp.resume(WORKFLOW_ID);
const researchState = resumed.latestCheckpoint.state;

console.log(`Writer Bot: picked up at step ${resumed.latestCheckpoint.step}, topic: "${researchState.topic}"`);

const draftCheckpoint = await cp.save({
  workflowId: WORKFLOW_ID,
  step: 2,
  label: 'draft_complete',
  agentId: 'writer-bot',
  state: {
    ...researchState,
    draft: `Quantum computing is undergoing a pivotal transformation. ${researchState.raw_data.key_findings[0]}. ` +
      `Researchers at leading institutions have now demonstrated ${researchState.raw_data.key_findings[1]}.`,
    word_count: 45,
    next_agent: 'editor-bot',
  },
  metadata: {
    duration_ms: 1800,
    model_tokens_used: 512,
  },
});

console.log(`Writer Bot: draft saved — step ${draftCheckpoint.step}, size ${draftCheckpoint.sizeBytes} bytes`);

// ---------------------------------------------------------------------------
// Show full workflow history
// ---------------------------------------------------------------------------

console.log('\nWorkflow history:');
const history = await cp.replay(WORKFLOW_ID);
for (const cp_entry of history.checkpoints) {
  const agentTag = cp_entry.metadata?.agent_id ?? 'unknown';
  console.log(`  Step ${cp_entry.step} [${cp_entry.label}] — agent: ${agentTag}`);
}

console.log(`\nDone. Workflow ID: ${WORKFLOW_ID}`);
