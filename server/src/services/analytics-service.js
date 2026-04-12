import { getPool } from '../store/postgres.js';

export const analyticsService = {
  /**
   * Upsert workflow_stats after each checkpoint save.
   * Called via setImmediate — must not throw.
   *
   * @param {number} accountId
   * @param {string} workflowId
   * @param {{ step: number, size_bytes: number, agent_id: string|null, created_at: string }} data
   */
  async updateWorkflowStats(accountId, workflowId, { step, size_bytes = 0, agent_id = null, created_at }) {
    if (!accountId) return;

    const pool = getPool();
    const ts = created_at ?? new Date().toISOString();

    await pool.query(
      `INSERT INTO workflow_stats
         (account_id, workflow_id, total_steps, total_size_bytes,
          first_checkpoint_at, last_checkpoint_at, duration_seconds, agent_ids, updated_at)
       VALUES
         ($1, $2, 1, $3, $4::timestamptz, $4::timestamptz, 0,
          CASE WHEN $5::text IS NOT NULL THEN jsonb_build_array($5::text) ELSE '[]'::jsonb END,
          NOW())
       ON CONFLICT (account_id, workflow_id) DO UPDATE SET
         total_steps       = workflow_stats.total_steps + 1,
         total_size_bytes  = workflow_stats.total_size_bytes + EXCLUDED.total_size_bytes,
         last_checkpoint_at = EXCLUDED.last_checkpoint_at,
         first_checkpoint_at = COALESCE(workflow_stats.first_checkpoint_at, EXCLUDED.first_checkpoint_at),
         duration_seconds  = GREATEST(0, EXTRACT(EPOCH FROM (
           EXCLUDED.last_checkpoint_at -
           COALESCE(workflow_stats.first_checkpoint_at, EXCLUDED.last_checkpoint_at)
         ))::integer),
         agent_ids = CASE
           WHEN $5::text IS NOT NULL
                AND NOT (workflow_stats.agent_ids @> jsonb_build_array($5::text))
           THEN workflow_stats.agent_ids || jsonb_build_array($5::text)
           ELSE workflow_stats.agent_ids
         END,
         updated_at = NOW()`,
      [accountId, workflowId, size_bytes, ts, agent_id]
    );
  },

  /**
   * Record a workflow error and increment error_count in workflow_stats.
   *
   * @param {number} accountId
   * @param {string} workflowId
   * @param {number|null} step
   * @param {string} errorType
   * @param {string} errorMessage
   * @param {string|null} agentId
   */
  async recordWorkflowError(accountId, workflowId, step, errorType, errorMessage, agentId = null) {
    const pool = getPool();

    await pool.query(
      `INSERT INTO workflow_errors (account_id, workflow_id, step, error_type, error_message, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [accountId, workflowId, step, errorType, errorMessage, agentId]
    );

    await pool.query(
      `UPDATE workflow_stats SET error_count = error_count + 1, updated_at = NOW()
       WHERE account_id = $1 AND workflow_id = $2`,
      [accountId, workflowId]
    );
  },

  /**
   * Get stats + errors for a single workflow.
   *
   * @param {number} accountId
   * @param {string} workflowId
   * @returns {Promise<object|null>}
   */
  async getWorkflowAnalytics(accountId, workflowId) {
    const pool = getPool();

    const [statsResult, errorsResult] = await Promise.all([
      pool.query(
        `SELECT * FROM workflow_stats WHERE account_id = $1 AND workflow_id = $2`,
        [accountId, workflowId]
      ),
      pool.query(
        `SELECT step, error_type, error_message, agent_id, created_at
         FROM workflow_errors WHERE account_id = $1 AND workflow_id = $2
         ORDER BY created_at DESC`,
        [accountId, workflowId]
      ),
    ]);

    if (statsResult.rows.length === 0) return null;

    return {
      ...statsResult.rows[0],
      errors: errorsResult.rows,
    };
  },

  /**
   * Aggregate overview for an account over a date range.
   *
   * @param {number|null} accountId  — null = all accounts (admin)
   * @param {string} startDate  ISO date string
   * @param {string} endDate    ISO date string
   */
  async getAccountOverview(accountId, startDate, endDate) {
    const pool = getPool();

    const accountFilter = accountId ? 'AND ws.account_id = $1' : '';
    const params = accountId ? [accountId, startDate, endDate] : [startDate, endDate];
    const p = accountId ? { start: '$2', end: '$3' } : { start: '$1', end: '$2' };

    const statsResult = await pool.query(
      `SELECT
         COUNT(*)                                                   AS total_workflows,
         COUNT(*) FILTER (WHERE status = 'completed')              AS completed_workflows,
         COUNT(*) FILTER (WHERE error_count > 0)                   AS failed_workflows,
         COUNT(*) FILTER (WHERE status = 'active')                 AS active_workflows,
         COALESCE(SUM(total_steps), 0)::bigint                     AS total_checkpoints,
         COALESCE(AVG(total_steps)::float, 0)                      AS avg_steps,
         COALESCE(AVG(NULLIF(duration_seconds, 0))::float, 0)      AS avg_duration_seconds
       FROM workflow_stats ws
       WHERE last_checkpoint_at >= ${p.start}::timestamptz
         AND last_checkpoint_at <= ${p.end}::timestamptz
         ${accountFilter}`,
      params
    );

    const agentsResult = await pool.query(
      `SELECT
         t.agent_id,
         COUNT(*)::int            AS workflows,
         AVG(ws.total_steps)::float AS avg_steps
       FROM workflow_stats ws,
       LATERAL jsonb_array_elements_text(ws.agent_ids) AS t(agent_id)
       WHERE ws.last_checkpoint_at >= ${p.start}::timestamptz
         AND ws.last_checkpoint_at <= ${p.end}::timestamptz
         ${accountFilter}
       GROUP BY t.agent_id
       ORDER BY workflows DESC
       LIMIT 10`,
      params
    );

    const s = statsResult.rows[0];
    return {
      period: { start: startDate, end: endDate },
      total_workflows: parseInt(s.total_workflows, 10),
      completed_workflows: parseInt(s.completed_workflows, 10),
      failed_workflows: parseInt(s.failed_workflows, 10),
      active_workflows: parseInt(s.active_workflows, 10),
      total_checkpoints: parseInt(s.total_checkpoints, 10),
      avg_steps_per_workflow: Math.round(parseFloat(s.avg_steps) * 10) / 10,
      avg_workflow_duration_seconds: Math.round(parseFloat(s.avg_duration_seconds)),
      top_agents: agentsResult.rows.map((r) => ({
        agent_id: r.agent_id,
        workflows: r.workflows,
        avg_steps: Math.round(parseFloat(r.avg_steps) * 10) / 10,
      })),
    };
  },

  /**
   * Failure pattern analysis.
   *
   * @param {number|null} accountId  — null = all accounts (admin)
   * @param {number} days
   */
  async getFailurePatterns(accountId, days = 7) {
    const pool = getPool();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const accountFilter = accountId ? 'AND account_id = $2' : '';
    const params = accountId ? [since, accountId] : [since];

    // By step
    const byStep = await pool.query(
      `SELECT step, COUNT(*)::int AS count
       FROM workflow_errors
       WHERE created_at >= $1::timestamptz ${accountFilter}
       GROUP BY step ORDER BY count DESC LIMIT 10`,
      params
    );

    // By agent
    const byAgent = await pool.query(
      `SELECT agent_id, COUNT(*)::int AS count
       FROM workflow_errors
       WHERE created_at >= $1::timestamptz ${accountFilter} AND agent_id IS NOT NULL
       GROUP BY agent_id ORDER BY count DESC LIMIT 10`,
      params
    );

    // Agent workflow totals for error rate calculation
    const agentWorkflowFilter = accountId ? 'WHERE ws.account_id = $1' : '';
    const agentWfParams = accountId ? [accountId] : [];
    const agentWorkflows = await pool.query(
      `SELECT t.agent_id, COUNT(*)::int AS wf_count
       FROM workflow_stats ws,
       LATERAL jsonb_array_elements_text(ws.agent_ids) AS t(agent_id)
       ${agentWorkflowFilter}
       GROUP BY t.agent_id`,
      agentWfParams
    );
    const wfCountMap = Object.fromEntries(
      agentWorkflows.rows.map((r) => [r.agent_id, r.wf_count])
    );

    // Recent failures
    const recent = await pool.query(
      `SELECT workflow_id, step, agent_id, error_type, error_message, created_at
       FROM workflow_errors
       WHERE created_at >= $1::timestamptz ${accountFilter}
       ORDER BY created_at DESC LIMIT 20`,
      params
    );

    const totalFailures = byStep.rows.reduce((s, r) => s + r.count, 0);

    return {
      period_days: days,
      total_failures: totalFailures,
      failure_by_step: byStep.rows,
      failure_by_agent: byAgent.rows.map((r) => ({
        agent_id: r.agent_id,
        count: r.count,
        error_rate: wfCountMap[r.agent_id]
          ? Math.round((r.count / wfCountMap[r.agent_id]) * 100) / 100
          : 0,
      })),
      recent_failures: recent.rows,
    };
  },

  /**
   * Per-agent performance metrics over a date range.
   *
   * @param {number} accountId
   * @param {string} startDate
   * @param {string} endDate
   */
  async getAgentPerformance(accountId, startDate, endDate) {
    const pool = getPool();

    const statsResult = await pool.query(
      `SELECT
         t.agent_id,
         COUNT(*)::int                                               AS total_workflows,
         COUNT(*) FILTER (WHERE ws.status = 'active')::int          AS active_workflows,
         AVG(ws.total_steps)::float                                  AS avg_steps,
         AVG(NULLIF(ws.duration_seconds, 0))::float                  AS avg_duration_seconds,
         COALESCE(SUM(ws.total_steps), 0)::int                       AS total_checkpoints
       FROM workflow_stats ws,
       LATERAL jsonb_array_elements_text(ws.agent_ids) AS t(agent_id)
       WHERE ws.account_id = $1
         AND ws.last_checkpoint_at >= $2::timestamptz
         AND ws.last_checkpoint_at <= $3::timestamptz
       GROUP BY t.agent_id
       ORDER BY total_workflows DESC`,
      [accountId, startDate, endDate]
    );

    if (statsResult.rows.length === 0) return { agents: [] };

    // Error counts per agent
    const errorResult = await pool.query(
      `SELECT agent_id, COUNT(*)::int AS error_count
       FROM workflow_errors
       WHERE account_id = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz
       GROUP BY agent_id`,
      [accountId, startDate, endDate]
    );
    const errorMap = Object.fromEntries(errorResult.rows.map((r) => [r.agent_id, r.error_count]));

    // Agent names from agents table
    const agentIds = statsResult.rows.map((r) => r.agent_id);
    const agentResult = await pool.query(
      `SELECT agent_id, name, last_seen_at FROM agents
       WHERE account_id = $1 AND agent_id = ANY($2)`,
      [accountId, agentIds]
    );
    const agentMeta = Object.fromEntries(agentResult.rows.map((r) => [r.agent_id, r]));

    return {
      agents: statsResult.rows.map((r) => {
        const errCount = errorMap[r.agent_id] ?? 0;
        return {
          agent_id: r.agent_id,
          name: agentMeta[r.agent_id]?.name ?? r.agent_id,
          total_workflows: r.total_workflows,
          active_workflows: r.active_workflows,
          avg_steps: Math.round(parseFloat(r.avg_steps || 0) * 10) / 10,
          avg_duration_seconds: Math.round(parseFloat(r.avg_duration_seconds || 0)),
          total_checkpoints: r.total_checkpoints,
          error_rate: r.total_workflows > 0
            ? Math.round((errCount / r.total_workflows) * 100) / 100
            : 0,
          last_seen_at: agentMeta[r.agent_id]?.last_seen_at ?? null,
        };
      }),
    };
  },

  /**
   * Step-by-step workflow timeline — DB stats + live checkpoint data.
   *
   * @param {number} accountId
   * @param {string} workflowId
   */
  async getWorkflowTimeline(accountId, workflowId) {
    const pool = getPool();

    const statsResult = await pool.query(
      `SELECT * FROM workflow_stats WHERE account_id = $1 AND workflow_id = $2`,
      [accountId, workflowId]
    );
    const stats = statsResult.rows[0] ?? null;

    // Load checkpoint details from Redis / archive
    let checkpoints = [];
    try {
      const { replayCheckpoints } = await import('./resume-engine.js');
      const replay = await replayCheckpoints(workflowId, { limit: 1000 });
      checkpoints = replay.checkpoints ?? [];
    } catch {
      // Service unavailable — return stats-only response without timeline
    }

    // Compute time_since_previous_ms for each checkpoint
    const timeline = checkpoints.map((cp, idx) => {
      const prev = checkpoints[idx - 1];
      const timeSincePrev = (prev?.created_at && cp.created_at)
        ? Math.max(0, new Date(cp.created_at) - new Date(prev.created_at))
        : 0;
      const meta = cp.metadata ?? {};
      return {
        step: cp.step,
        label: cp.label ?? null,
        size_bytes: cp.size_bytes ?? 0,
        time_since_previous_ms: timeSincePrev,
        agent_id: meta.agent_id ?? null,
        created_at: cp.created_at ?? null,
      };
    });

    return {
      workflow_id: workflowId,
      total_steps: stats?.total_steps ?? timeline.length,
      total_size_bytes: stats?.total_size_bytes ?? 0,
      duration_seconds: stats?.duration_seconds ?? 0,
      status: stats?.status ?? 'active',
      agents_involved: stats?.agent_ids ?? [],
      checkpoints: timeline,
      resumed: (stats?.resumed_count ?? 0) > 0,
      error_count: stats?.error_count ?? 0,
      first_checkpoint_at: stats?.first_checkpoint_at ?? null,
      last_checkpoint_at: stats?.last_checkpoint_at ?? null,
    };
  },
};
