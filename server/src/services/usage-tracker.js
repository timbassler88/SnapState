import { getPool } from '../store/postgres.js';

const EVENT_COLUMN_MAP = {
  'checkpoint.write': 'checkpoint_writes',
  'checkpoint.read': 'checkpoint_reads',
  'workflow.resume': 'resume_calls',
  'workflow.replay': 'replay_calls',
  'webhook.delivery': 'webhook_deliveries',
};

export const usageTracker = {
  /**
   * Record a usage event and update daily aggregate.
   * Non-blocking — callers fire-and-forget via setImmediate.
   *
   * @param {number} accountId
   * @param {number} apiKeyId
   * @param {string} eventType - one of the EVENT_COLUMN_MAP keys
   * @param {object} [metadata] - { workflow_id?, checkpoint_size_bytes?, agent_id? }
   */
  async track(accountId, apiKeyId, eventType, metadata = {}) {
    if (!accountId) return; // gracefully skip when no Postgres account

    const pool = getPool();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dailyColumn = EVENT_COLUMN_MAP[eventType];
    const sizeBytes = metadata.checkpoint_size_bytes ?? 0;

    // Insert usage_events row
    await pool.query(
      `INSERT INTO usage_events (account_id, api_key_id, event_type, workflow_id, checkpoint_size_bytes, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [accountId, apiKeyId, eventType, metadata.workflow_id ?? null, sizeBytes, metadata.agent_id ?? null]
    );

    // Upsert daily aggregate
    if (dailyColumn) {
      await pool.query(
        `INSERT INTO usage_daily (account_id, date, ${dailyColumn}, storage_bytes_written)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (account_id, date) DO UPDATE
           SET ${dailyColumn} = usage_daily.${dailyColumn} + 1,
               storage_bytes_written = usage_daily.storage_bytes_written + $3`,
        [accountId, today, sizeBytes]
      );
    }
  },
};
