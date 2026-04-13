import { SnapStateClient } from 'snapstate-sdk';

const client = new SnapStateClient({
  apiKey: 'snp_5ed09759e3c135ed02ec299f3914a34a',
  baseUrl: 'https://snapstate.dev'
});

async function run() {
  // Save checkpoint
  const result = await client.save({
    workflowId: 'wf_sdk_test',
    step: 1,
    label: 'sdk_init',
    state: { method: 'javascript_sdk', working: true }
  });
  console.log('Saved:', result.checkpoint_id);

  // Save step 2
  await client.save({
    workflowId: 'wf_sdk_test',
    step: 2,
    label: 'sdk_complete',
    state: { method: 'javascript_sdk', working: true, steps_done: 2 }
  });
  console.log('Step 2 saved');

  // Resume
  const resumed = await client.resume('wf_sdk_test');
  console.log('Resumed from step:', resumed.latestCheckpoint.step);
  console.log('State:', JSON.stringify(resumed.latestCheckpoint.state));

  // Replay
  const history = await client.replay('wf_sdk_test');
  console.log('Total checkpoints:', history.total);

  console.log('\nAll SDK tests passed!');
}

run().catch(console.error);