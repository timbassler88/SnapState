import { getPool } from '../store/postgres.js';
import { config } from '../config.js';

export const agentService = {
  /**
   * Register or update an agent (upsert by account_id + agent_id).
   * Enforces MAX_AGENTS_PER_ACCOUNT on new registrations.
   *
   * @param {number} accountId
   * @param {{ agentId: string, name?: string, description?: string, capabilities?: string[], metadata?: object }} params
   * @returns {Promise<object>} agent record
   */
  async registerAgent(accountId, { agentId, name, description, capabilities, metadata }) {
    const pool = getPool();

    // Check if this agent_id already exists for this account (upsert case)
    const existing = await pool.query(
      `SELECT id FROM agents WHERE account_id = $1 AND agent_id = $2`,
      [accountId, agentId]
    );

    if (existing.rows.length === 0) {
      // New agent — enforce limit
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM agents WHERE account_id = $1`,
        [accountId]
      );
      const count = parseInt(countResult.rows[0].count, 10);
      if (count >= config.maxAgentsPerAccount) {
        const err = new Error(`Maximum of ${config.maxAgentsPerAccount} agents allowed per account`);
        err.code = 'MAX_AGENTS_REACHED';
        throw err;
      }
    }

    const result = await pool.query(
      `INSERT INTO agents (account_id, agent_id, name, description, capabilities, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, agent_id) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             capabilities = EXCLUDED.capabilities,
             metadata = EXCLUDED.metadata
       RETURNING id, agent_id, name, description, capabilities, metadata, last_seen_at, created_at`,
      [
        accountId,
        agentId,
        name ?? null,
        description ?? null,
        JSON.stringify(capabilities ?? []),
        JSON.stringify(metadata ?? {}),
      ]
    );

    return result.rows[0];
  },

  /**
   * Get a single agent by agent_id for an account.
   *
   * @param {number} accountId
   * @param {string} agentId
   * @returns {Promise<object|null>}
   */
  async getAgent(accountId, agentId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, agent_id, name, description, capabilities, metadata, last_seen_at, created_at
       FROM agents WHERE account_id = $1 AND agent_id = $2`,
      [accountId, agentId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * List all agents for an account, ordered by last_seen_at desc.
   *
   * @param {number} accountId
   * @returns {Promise<object[]>}
   */
  async listAgents(accountId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, agent_id, name, description, capabilities, metadata, last_seen_at, created_at
       FROM agents WHERE account_id = $1
       ORDER BY last_seen_at DESC NULLS LAST, created_at DESC`,
      [accountId]
    );
    return result.rows;
  },

  /**
   * Update last_seen_at to NOW() for an agent.
   * Non-critical — callers use setImmediate.
   *
   * @param {number} accountId
   * @param {string} agentId
   */
  async updateLastSeen(accountId, agentId) {
    const pool = getPool();
    await pool.query(
      `UPDATE agents SET last_seen_at = NOW()
       WHERE account_id = $1 AND agent_id = $2`,
      [accountId, agentId]
    );
  },

  /**
   * Update agent fields (name, description, capabilities, metadata).
   *
   * @param {number} accountId
   * @param {string} agentId
   * @param {{ name?: string, description?: string, capabilities?: string[], metadata?: object }} updates
   * @returns {Promise<object|null>} updated record or null if not found
   */
  async updateAgent(accountId, agentId, updates) {
    const pool = getPool();

    const setClauses = [];
    const values = [];
    let i = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${i++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${i++}`);
      values.push(updates.description);
    }
    if (updates.capabilities !== undefined) {
      setClauses.push(`capabilities = $${i++}`);
      values.push(JSON.stringify(updates.capabilities));
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${i++}`);
      values.push(JSON.stringify(updates.metadata));
    }

    if (setClauses.length === 0) return null;

    values.push(accountId, agentId);
    const result = await pool.query(
      `UPDATE agents SET ${setClauses.join(', ')}
       WHERE account_id = $${i++} AND agent_id = $${i++}
       RETURNING id, agent_id, name, description, capabilities, metadata, last_seen_at, created_at`,
      values
    );
    return result.rows[0] ?? null;
  },

  /**
   * Hard delete an agent.
   *
   * @param {number} accountId
   * @param {string} agentId
   * @returns {Promise<boolean>} true if deleted, false if not found
   */
  async deleteAgent(accountId, agentId) {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM agents WHERE account_id = $1 AND agent_id = $2`,
      [accountId, agentId]
    );
    return result.rowCount > 0;
  },
};
