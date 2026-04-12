import { getRedis } from '../store/redis.js';
import { config } from '../config.js';

let intervalHandle = null;

/**
 * TTL Manager — scans Redis for workflows approaching expiry and archives them.
 *
 * Runs on a configurable interval (default 60s). For each expiring workflow:
 * 1. Reads the full checkpoint history and state from Redis
 * 2. Delegates archival to the archiver service (which uploads to R2 + writes Postgres record)
 * 3. After successful archival, deletes the Redis keys
 * 4. Fires a webhook event `workflow.archived`
 */
export const ttlManager = {
  start() {
    if (intervalHandle) return; // already running
    intervalHandle = setInterval(_runScan, config.ttlManager.intervalMs);
    console.error(JSON.stringify({ level: 'info', msg: 'TTL manager started', intervalMs: config.ttlManager.intervalMs }));
  },

  stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  },

  /** Expose for manual triggering in tests */
  runScan: _runScan,
};

async function _runScan() {
  const redis = getRedis();

  try {
    // Scan for all wf:*:latest keys — these represent active workflows
    let cursor = '0';
    const workflowIds = [];

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'wf:*:latest', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        // Extract workflow_id from key pattern wf:{workflow_id}:latest
        const match = key.match(/^wf:(.+):latest$/);
        if (match) workflowIds.push(match[1]);
      }
    } while (cursor !== '0');

    for (const workflowId of workflowIds) {
      await _maybeArchive(redis, workflowId);
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'TTL manager scan failed', err: err.message }));
  }
}

async function _maybeArchive(redis, workflowId) {
  const latestKey = `wf:${workflowId}:latest`;

  try {
    const ttl = await redis.ttl(latestKey);

    // ttl === -1 means no expiry set; ttl === -2 means key doesn't exist
    if (ttl === -1 || ttl === -2) return;
    if (ttl > config.ttlManager.archiveThresholdSeconds) return;

    // Lazy import to avoid circular dependency issues at startup
    const { archiveWorkflow } = await import('./archiver.js');
    await archiveWorkflow(workflowId, redis);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Failed to archive workflow', workflowId, err: err.message }));
  }
}
