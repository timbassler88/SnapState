import { createHash } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { getRedis } from '../store/redis.js';
import { diffState } from '../utils/diff.js';
import { config } from '../config.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Compress a JSON-serializable value to a Buffer.
 */
async function compress(value) {
  const json = JSON.stringify(value);
  return gzipAsync(Buffer.from(json, 'utf8'));
}

/**
 * Decompress a Buffer back to a JS value.
 */
async function decompress(buf) {
  const decompressed = await gunzipAsync(buf);
  return JSON.parse(decompressed.toString('utf8'));
}

function makeEtag(stateJson) {
  return `"${createHash('sha256').update(stateJson).digest('hex').slice(0, 16)}"`;
}

/**
 * Build the canonical checkpoint ID.
 * Format: cp_{workflow_id}_{step_zero_padded}
 */
export function buildCheckpointId(workflowId, step) {
  return `cp_${workflowId}_${String(step).padStart(3, '0')}`;
}

/**
 * Save a checkpoint to Redis.
 *
 * @param {object} params
 * @param {string} params.workflowId
 * @param {number} params.step
 * @param {string} [params.label]
 * @param {object} params.state
 * @param {object} [params.metadata]
 * @param {number} [params.ttlSeconds]
 * @param {string} [params.ifMatch]  - ETag for optimistic concurrency
 * @param {import('ioredis').Redis} [params.redis]  - injected for testing
 * @param {number|null} [params.accountId]  - for usage metering (Phase 2)
 * @param {number|null} [params.apiKeyId]   - for usage metering (Phase 2)
 * @returns {Promise<object>} saved checkpoint data
 */
export async function saveCheckpoint({ workflowId, step, label, state, metadata, ttlSeconds, ifMatch, redis: _redis, accountId, apiKeyId }) {
  const redis = _redis ?? getRedis();
  const checkpointId = buildCheckpointId(workflowId, step);
  const stateJson = JSON.stringify(state);
  const sizeBytes = Buffer.byteLength(stateJson, 'utf8');

  if (sizeBytes > config.maxStateBytes) {
    const err = new Error('State payload exceeds 1MB limit');
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }

  const etag = makeEtag(stateJson);
  const now = new Date().toISOString();
  const effectiveTtl = ttlSeconds ?? config.defaultTtlSeconds;

  // Keys
  const latestKey = `wf:${workflowId}:latest`;
  const logKey = `wf:${workflowId}:log`;
  const metaKey = `wf:${workflowId}:meta`;
  const checkpointKey = `cp:${checkpointId}`;

  // Check for existing checkpoint (idempotency / optimistic concurrency)
  const existingData = await redis.get(checkpointKey);
  if (existingData) {
    const existing = await decompress(Buffer.from(existingData, 'base64'));
    if (ifMatch) {
      if (ifMatch !== existing.etag) {
        const err = new Error('ETag mismatch — checkpoint was modified');
        err.code = 'CONFLICT';
        throw err;
      }
      // If-Match matches — idempotent re-save, return existing
      return existing;
    }
    const err = new Error(`Checkpoint ${checkpointId} already exists`);
    err.code = 'CONFLICT';
    err.existing = existing;
    throw err;
  }

  // Retrieve previous checkpoint state for diffing
  let prevState = null;
  const latestRaw = await redis.hget(latestKey, 'state_compressed');
  if (latestRaw) {
    try {
      prevState = await decompress(Buffer.from(latestRaw, 'base64'));
    } catch {
      prevState = null;
    }
  }

  const diff = diffState(prevState, state);
  const stateCompressed = await compress(state);
  const stateCompressedB64 = stateCompressed.toString('base64');

  const checkpointRecord = {
    checkpoint_id: checkpointId,
    workflow_id: workflowId,
    step,
    label: label ?? null,
    state,
    metadata: metadata ?? null,
    etag,
    created_at: now,
    expires_at: new Date(Date.now() + effectiveTtl * 1000).toISOString(),
    diff_from_previous: diff,
    size_bytes: sizeBytes,
  };

  const compressedRecord = await compress(checkpointRecord);

  const pipeline = redis.pipeline();

  // Store full checkpoint record (compressed)
  pipeline.set(checkpointKey, compressedRecord.toString('base64'));
  pipeline.expire(checkpointKey, effectiveTtl);

  // Update latest hash
  pipeline.hset(latestKey,
    'checkpoint_id', checkpointId,
    'step', String(step),
    'label', label ?? '',
    'state_compressed', stateCompressedB64,
    'metadata', JSON.stringify(metadata ?? {}),
    'etag', etag,
    'created_at', now,
  );
  pipeline.expire(latestKey, effectiveTtl);

  // Append to stream log (store key fields as stream entry)
  pipeline.xadd(logKey, '*',
    'checkpoint_id', checkpointId,
    'workflow_id', workflowId,
    'step', String(step),
    'label', label ?? '',
    'state_compressed', stateCompressedB64,
    'metadata', JSON.stringify(metadata ?? {}),
    'created_at', now,
    'etag', etag,
  );
  pipeline.expire(logKey, effectiveTtl);

  // Update workflow meta
  const exists = await redis.exists(metaKey);
  if (!exists) {
    pipeline.hset(metaKey, 'started_at', now);
  }
  pipeline.hset(metaKey,
    'last_activity_at', now,
  );
  pipeline.hincrby(metaKey, 'total_checkpoints', 1);
  pipeline.expire(metaKey, effectiveTtl);

  await pipeline.exec();

  // Phase 2: fire usage metering non-blocking
  if (accountId != null && apiKeyId != null) {
    setImmediate(async () => {
      try {
        const { usageTracker } = await import('./usage-tracker.js');
        await usageTracker.track(accountId, apiKeyId, 'checkpoint.write', {
          workflow_id: workflowId,
          checkpoint_size_bytes: stateCompressed.length,
        });
      } catch {
        // non-blocking — never fail the checkpoint save
      }
    });
  }

  return checkpointRecord;
}

/**
 * Retrieve a single checkpoint by ID.
 *
 * @param {string} checkpointId
 * @param {import('ioredis').Redis} [redis]
 */
export async function getCheckpoint(checkpointId, redis) {
  const r = redis ?? getRedis();
  const raw = await r.get(`cp:${checkpointId}`);
  if (!raw) return null;
  return decompress(Buffer.from(raw, 'base64'));
}
