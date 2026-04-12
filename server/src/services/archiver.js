import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getRedis } from '../store/redis.js';
import { uploadArchive } from '../store/r2.js';
import { getPool } from '../store/postgres.js';
import { emitEvent } from './event-emitter.js';

const gzipAsync = promisify(gzip);

/**
 * Archive a single workflow from Redis to R2, then delete the Redis keys.
 *
 * Process (one workflow at a time to avoid memory spikes):
 * 1. Read full checkpoint history from the Redis Stream
 * 2. Read latest state and metadata hashes
 * 3. Bundle into a single archive document
 * 4. gzip compress + upload to R2
 * 5. Write Postgres archived_workflows record
 * 6. Delete Redis keys
 * 7. Emit webhook event workflow.archived
 *
 * @param {string} workflowId
 * @param {import('ioredis').Redis} [redis]
 */
export async function archiveWorkflow(workflowId, redis) {
  const r = redis ?? getRedis();

  const latestKey = `wf:${workflowId}:latest`;
  const logKey = `wf:${workflowId}:log`;
  const metaKey = `wf:${workflowId}:meta`;

  // Read all data from Redis
  const [latestHash, metaHash, streamEntries] = await Promise.all([
    r.hgetall(latestKey),
    r.hgetall(metaKey),
    r.xrange(logKey, '-', '+'),
  ]);

  if (!latestHash || Object.keys(latestHash).length === 0) return; // already gone

  // Parse stream into checkpoint list (without decompressing state — keep it compact)
  const checkpoints = (streamEntries ?? []).map(([, fields]) => {
    const obj = streamFieldsToObj(fields);
    return {
      checkpoint_id: obj.checkpoint_id,
      workflow_id: obj.workflow_id,
      step: parseInt(obj.step, 10),
      label: obj.label || null,
      state_compressed_b64: obj.state_compressed, // preserve compressed form in archive
      metadata: obj.metadata ? JSON.parse(obj.metadata) : null,
      created_at: obj.created_at,
      etag: obj.etag,
    };
  });

  // Look up account_id from Postgres api_keys if available
  let accountId = null;
  try {
    const pool = getPool();
    // We don't have the API key here — attempt to find via existing archival record or skip
    const existing = await pool.query(
      'SELECT account_id FROM archived_workflows WHERE workflow_id = $1',
      [workflowId]
    );
    if (existing.rows.length > 0) {
      // Already archived
      return;
    }
  } catch {
    // Postgres unavailable — proceed without account linkage
  }

  const archive = {
    workflow_id: workflowId,
    archived_at: new Date().toISOString(),
    meta: {
      started_at: metaHash?.started_at ?? null,
      last_activity_at: metaHash?.last_activity_at ?? null,
      total_checkpoints: parseInt(metaHash?.total_checkpoints ?? '0', 10),
    },
    checkpoints,
  };

  const archiveJson = JSON.stringify(archive);
  const compressed = await gzipAsync(Buffer.from(archiveJson, 'utf8'));
  const r2Key = `archives/${accountId ?? 'unknown'}/${workflowId}.json.gz`;

  // Upload to R2
  await uploadArchive(r2Key, compressed);

  // Write Postgres record
  const firstCp = checkpoints[0];
  const lastCp = checkpoints[checkpoints.length - 1];

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO archived_workflows
         (account_id, workflow_id, r2_key, total_checkpoints, total_size_bytes, first_checkpoint_at, last_checkpoint_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workflow_id) DO NOTHING`,
      [
        accountId,
        workflowId,
        r2Key,
        checkpoints.length,
        compressed.length,
        firstCp?.created_at ?? new Date().toISOString(),
        lastCp?.created_at ?? new Date().toISOString(),
      ]
    );
  } catch {
    // Postgres unavailable — R2 archive is still valid, proceed
  }

  // Delete Redis keys only after successful R2 upload
  await r.del(latestKey, logKey, metaKey);

  // Fire webhook event (fire-and-forget, scoped to all API keys that watch this workflow)
  // Since we don't have API key context here, we broadcast to all registered webhooks
  // that include workflow.archived event. In Phase 3 this would be account-scoped.
  emitEvent('workflow.archived', { workflow_id: workflowId, r2_key: r2Key }, '__system__').catch(() => {});
}

function streamFieldsToObj(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj;
}
