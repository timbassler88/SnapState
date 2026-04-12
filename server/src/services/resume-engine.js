import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getRedis } from '../store/redis.js';

const gunzipAsync = promisify(gunzip);

async function decompress(b64) {
  const buf = Buffer.from(b64, 'base64');
  const raw = await gunzipAsync(buf);
  return JSON.parse(raw.toString('utf8'));
}

/**
 * Return the latest checkpoint for a workflow (resume flow).
 *
 * Lookup order:
 * 1. Redis latest hash (hot path)
 * 2. Postgres archived_workflows + R2 (Phase 2 cold storage fallback)
 *
 * @param {string} workflowId
 * @param {import('ioredis').Redis} [redis]
 * @returns {Promise<object|null>}
 */
export async function getLatestCheckpoint(workflowId, redis) {
  const r = redis ?? getRedis();
  const latestKey = `wf:${workflowId}:latest`;
  const metaKey = `wf:${workflowId}:meta`;

  const [latestHash, metaHash] = await Promise.all([
    r.hgetall(latestKey),
    r.hgetall(metaKey),
  ]);

  if (latestHash && Object.keys(latestHash).length > 0) {
    let state = null;
    if (latestHash.state_compressed) {
      state = await decompress(latestHash.state_compressed);
    }

    return {
      workflow_id: workflowId,
      latest_checkpoint: {
        checkpoint_id: latestHash.checkpoint_id,
        step: parseInt(latestHash.step, 10),
        label: latestHash.label || null,
        state,
        metadata: latestHash.metadata ? JSON.parse(latestHash.metadata) : null,
        created_at: latestHash.created_at,
      },
      total_checkpoints: parseInt(metaHash?.total_checkpoints ?? '0', 10),
      workflow_started_at: metaHash?.started_at ?? null,
      last_activity_at: metaHash?.last_activity_at ?? latestHash.created_at,
    };
  }

  // Phase 2: fall back to cold storage (R2 via Postgres archive record)
  return _fetchFromArchive(workflowId);
}

/**
 * Attempt to retrieve a workflow from R2 cold storage.
 * Returns null without throwing if Postgres/R2 are unavailable.
 */
async function _fetchFromArchive(workflowId) {
  try {
    const { getPool } = await import('../store/postgres.js');
    const pool = getPool();
    const result = await pool.query(
      'SELECT r2_key, total_checkpoints, first_checkpoint_at, last_checkpoint_at FROM archived_workflows WHERE workflow_id = $1',
      [workflowId]
    );
    if (result.rows.length === 0) return null;

    const { r2_key, total_checkpoints, first_checkpoint_at, last_checkpoint_at } = result.rows[0];

    const { downloadArchive } = await import('../store/r2.js');
    const archive = await downloadArchive(r2_key);

    const latestCp = archive.checkpoints[archive.checkpoints.length - 1];

    return {
      workflow_id: workflowId,
      latest_checkpoint: {
        checkpoint_id: latestCp.checkpoint_id,
        step: latestCp.step,
        label: latestCp.label,
        state: latestCp.state,
        metadata: latestCp.metadata,
        created_at: latestCp.created_at,
      },
      total_checkpoints,
      workflow_started_at: first_checkpoint_at,
      last_activity_at: last_checkpoint_at,
      source: 'archive',
    };
  } catch {
    // Postgres/R2 unavailable — not found
    return null;
  }
}

/**
 * Return ordered checkpoint history from the Redis Stream (replay flow).
 * Falls back to R2 archive if the stream is gone.
 *
 * @param {string} workflowId
 * @param {{ fromStep?: number, toStep?: number, limit?: number }} opts
 * @param {import('ioredis').Redis} [redis]
 */
export async function replayCheckpoints(workflowId, { fromStep, toStep, limit = 100 } = {}, redis) {
  const r = redis ?? getRedis();
  const logKey = `wf:${workflowId}:log`;

  // XRANGE returns up to `limit` entries (Redis stream entries are chronological)
  const entries = await r.xrange(logKey, '-', '+', 'COUNT', limit);
  if (!entries || entries.length === 0) {
    // Phase 2: try archive fallback
    return _replayFromArchive(workflowId, { fromStep, toStep, limit });
  }

  // Parse stream entries into checkpoint objects
  const all = await Promise.all(entries.map(async ([, fields]) => {
    const obj = streamFieldsToObj(fields);
    let state = null;
    if (obj.state_compressed) {
      state = await decompress(obj.state_compressed);
    }
    return {
      checkpoint_id: obj.checkpoint_id,
      step: parseInt(obj.step, 10),
      label: obj.label || null,
      state,
      metadata: obj.metadata ? JSON.parse(obj.metadata) : null,
      created_at: obj.created_at,
    };
  }));

  // Filter by step range
  let filtered = all;
  if (fromStep !== undefined) filtered = filtered.filter((c) => c.step >= fromStep);
  if (toStep !== undefined) filtered = filtered.filter((c) => c.step <= toStep);

  // Apply limit after step filtering and check has_more
  const hasMore = filtered.length > limit;
  const page = filtered.slice(0, limit);

  return {
    checkpoints: page,
    total: page.length,
    has_more: hasMore,
  };
}

async function _replayFromArchive(workflowId, { fromStep, toStep, limit }) {
  try {
    const { getPool } = await import('../store/postgres.js');
    const pool = getPool();
    const result = await pool.query(
      'SELECT r2_key FROM archived_workflows WHERE workflow_id = $1',
      [workflowId]
    );
    if (result.rows.length === 0) {
      return { checkpoints: [], total: 0, has_more: false };
    }

    const { downloadArchive } = await import('../store/r2.js');
    const archive = await downloadArchive(result.rows[0].r2_key);

    let checkpoints = archive.checkpoints ?? [];
    if (fromStep !== undefined) checkpoints = checkpoints.filter((c) => c.step >= fromStep);
    if (toStep !== undefined) checkpoints = checkpoints.filter((c) => c.step <= toStep);

    const hasMore = checkpoints.length > limit;
    const page = checkpoints.slice(0, limit);
    return { checkpoints: page, total: page.length, has_more: hasMore };
  } catch {
    return { checkpoints: [], total: 0, has_more: false };
  }
}

/** Convert Redis stream field array [k, v, k, v, ...] to plain object */
function streamFieldsToObj(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj;
}
