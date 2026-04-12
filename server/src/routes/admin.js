import { adminAuthMiddleware } from '../middleware/admin-auth.js';
import { checkRedisHealth } from '../store/redis.js';
import { checkPostgresHealth, getPool } from '../store/postgres.js';
import { checkR2Health } from '../store/r2.js';
import { analyticsService } from '../services/analytics-service.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', adminAuthMiddleware);

  /**
   * GET /admin/stats
   * Aggregate overview stats for the dashboard.
   */
  fastify.get('/stats', async (request, reply) => {
    const [redisOk, pgOk, r2Ok] = await Promise.all([
      checkRedisHealth(),
      checkPostgresHealth(),
      checkR2Health().catch(() => false),
    ]);

    let stats = {
      active_workflows: 0,
      checkpoints_today: 0,
      total_accounts: 0,
      storage_used_mb: 0,
      redis_connected: redisOk,
      postgres_connected: pgOk,
      r2_reachable: r2Ok,
    };

    if (pgOk) {
      const pool = getPool();
      const today = new Date().toISOString().slice(0, 10);

      const [accountCount, todayUsage, storageTotal, workflowStatusBreakdown] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM accounts'),
        pool.query(
          `SELECT COALESCE(SUM(checkpoint_writes + checkpoint_reads), 0)::int AS total
           FROM usage_daily WHERE date = $1`,
          [today]
        ),
        pool.query(
          `SELECT COALESCE(SUM(total_size_bytes), 0)::bigint AS total_bytes
           FROM archived_workflows`
        ),
        pool.query(
          `SELECT status, COUNT(*)::int AS count FROM workflow_stats GROUP BY status`
        ).catch(() => ({ rows: [] })),
      ]);

      stats.total_accounts = parseInt(accountCount.rows[0].count, 10);
      stats.checkpoints_today = parseInt(todayUsage.rows[0].total, 10);
      stats.storage_used_mb = Math.round(Number(storageTotal.rows[0].total_bytes) / (1024 * 1024));

      // Workflow status breakdown from analytics table
      stats.workflow_status = Object.fromEntries(
        workflowStatusBreakdown.rows.map((r) => [r.status, r.count])
      );
    }

    return reply.send(stats);
  });

  /**
   * GET /admin/workflows
   * Paginated workflow list with optional search.
   * Query: q, account_id, status, page, limit
   */
  fastify.get('/workflows', async (request, reply) => {
    const pgOk = await checkPostgresHealth();
    if (!pgOk) return sendError(reply, 503, ErrorCodes.INTERNAL, 'Postgres unavailable');

    const pool = getPool();
    const page = Math.max(1, parseInt(request.query.page ?? '1', 10));
    const limit = Math.min(100, parseInt(request.query.limit ?? '20', 10));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];
    let pi = 1;

    if (request.query.account_id) {
      conditions.push(`account_id = $${pi++}`);
      params.push(parseInt(request.query.account_id, 10));
    }
    if (request.query.q) {
      conditions.push(`workflow_id ILIKE $${pi++}`);
      params.push(`%${request.query.q}%`);
    }
    if (request.query.status === 'archived') {
      // only archived_workflows table
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await pool.query(
        `SELECT workflow_id, account_id, total_checkpoints, last_checkpoint_at AS last_activity,
                'archived' AS status
         FROM archived_workflows ${where}
         ORDER BY archived_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset]
      );
      return reply.send({ workflows: result.rows, page, limit });
    }

    // Default: return archived workflows as a proxy (no live workflow table in Phase 2)
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT workflow_id, account_id, total_checkpoints,
              last_checkpoint_at AS last_activity, 'archived' AS status,
              archived_at
       FROM archived_workflows ${where}
       ORDER BY archived_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ workflows: result.rows, page, limit });
  });

  /**
   * GET /admin/activity
   * Recent usage events feed.
   */
  fastify.get('/activity', async (request, reply) => {
    const pgOk = await checkPostgresHealth();
    if (!pgOk) return reply.send({ events: [] });

    const pool = getPool();
    const limit = Math.min(100, parseInt(request.query.limit ?? '20', 10));

    const result = await pool.query(
      `SELECT ue.id, ue.account_id, a.email, ue.event_type,
              ue.workflow_id, ue.checkpoint_size_bytes, ue.created_at
       FROM usage_events ue
       LEFT JOIN accounts a ON a.id = ue.account_id
       ORDER BY ue.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return reply.send({ events: result.rows });
  });

  /**
   * GET /admin/analytics/overview
   * Aggregate overview across ALL accounts (no account_id filter).
   */
  fastify.get('/analytics/overview', async (request, reply) => {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const startDate = request.query.start_date ?? thirtyDaysAgo;
    const endDate = request.query.end_date ?? today;

    const overview = await analyticsService.getAccountOverview(null, startDate, endDate);
    return reply.send(overview);
  });

  /**
   * GET /admin/analytics/failures
   * Failure patterns across ALL accounts.
   */
  fastify.get('/analytics/failures', async (request, reply) => {
    const days = Math.min(90, Math.max(1, parseInt(request.query.days ?? '7', 10)));
    const patterns = await analyticsService.getFailurePatterns(null, days);
    return reply.send(patterns);
  });
}
