import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import { config } from './config.js';
import { getRedis, checkRedisHealth } from './store/redis.js';
import { closePool, checkPostgresHealth } from './store/postgres.js';
import { checkR2Health } from './store/r2.js';
import { checkpointRoutes } from './routes/checkpoints.js';
import { workflowRoutes } from './routes/workflows.js';
import { webhookRoutes } from './routes/webhooks.js';
import { accountRoutes } from './routes/accounts.js';
import { billingRoutes } from './routes/billing.js';
import { adminRoutes } from './routes/admin.js';
import { authPublicRoutes } from './routes/auth-public.js';
import { selfServiceRoutes } from './routes/self-service.js';
import { agentRoutes } from './routes/agents.js';
import { analyticsRoutes } from './routes/analytics.js';
import { ttlManager } from './services/ttl-manager.js';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger ?? {
      level: 'info',
      serializers: {
        req(request) {
          return { method: request.method, url: request.url, reqId: request.id };
        },
      },
    },
    genReqId: () => crypto.randomUUID(),
    ajv: {
      customOptions: {
        coerceTypes: 'array',
        useDefaults: true,
        removeAdditional: false,
      },
    },
    ...opts,
  });

  // Landing page
  const landingHtml = fs.readFileSync(path.join(__dirname, 'landing.html'), 'utf8');
  fastify.get('/', (request, reply) => {
    reply.type('text/html').send(landingHtml);
  });

  // Get Started onboarding page
  const getStartedHtml = fs.readFileSync(path.join(__dirname, 'get-started.html'), 'utf8');
  fastify.get('/get-started', (request, reply) => {
    reply.type('text/html').send(getStartedHtml);
  });

  // Attach request ID as X-Request-Id on all responses
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  // Health endpoint — no auth required
  fastify.get('/health', async (request, reply) => {
    const [redisOk, pgOk, r2Ok] = await Promise.all([
      checkRedisHealth(),
      checkPostgresHealth(),
      checkR2Health(),
    ]);
    const allOk = redisOk && pgOk;
    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      version: '3.0.0',
      uptime_seconds: Math.round(process.uptime()),
      redis: redisOk ? 'connected' : 'disconnected',
      postgres: pgOk ? 'connected' : 'disconnected',
      r2: r2Ok ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness endpoint — used by load balancers; 503 if core deps are down
  fastify.get('/ready', async (request, reply) => {
    const [redisOk, pgOk] = await Promise.all([checkRedisHealth(), checkPostgresHealth()]);
    if (redisOk && pgOk) {
      return reply.code(200).send({ status: 'ready' });
    }
    return reply.code(503).send({
      status: 'not_ready',
      redis: redisOk ? 'ok' : 'down',
      postgres: pgOk ? 'ok' : 'down',
    });
  });

  // API route plugins
  fastify.register(checkpointRoutes, { prefix: '/checkpoints' });
  fastify.register(workflowRoutes, { prefix: '/workflows' });
  fastify.register(webhookRoutes, { prefix: '/webhooks' });
  fastify.register(accountRoutes, { prefix: '/admin' });
  fastify.register(billingRoutes, { prefix: '' });
  fastify.register(adminRoutes, { prefix: '/admin' });
  fastify.register(authPublicRoutes, { prefix: '' });
  fastify.register(selfServiceRoutes, { prefix: '/account' });
  fastify.register(agentRoutes, { prefix: '/agents' });
  fastify.register(analyticsRoutes, { prefix: '/analytics' });

  // Serve built dashboard and docs as static files (production)
  try {
    const { default: staticPlugin } = await import('@fastify/static');
    const dashboardDist = path.join(__dirname, '../../dashboard/dist');
    if (fs.existsSync(dashboardDist)) {
      fastify.register(staticPlugin, {
        root: dashboardDist,
        prefix: '/dashboard/',
        decorateReply: false,
      });
    }
    const docsDist = path.join(__dirname, '../../docs/dist');
    if (fs.existsSync(docsDist)) {
      fastify.register(staticPlugin, {
        root: docsDist,
        prefix: '/docs/',
        decorateReply: false,
      });
    }
  } catch {
    // Static plugin not available or assets not built — skip in dev
  }

  return fastify;
}

// Only start the server when this file is run directly (not imported in tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`SnapState listening on port ${config.port}`);
    ttlManager.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'Shutdown signal received');

    // Force-exit after 10 seconds if clean shutdown hangs
    const forceExit = setTimeout(() => {
      app.log.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      ttlManager.stop();
      await app.close();
      await getRedis().quit();
      await closePool();
      app.log.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

