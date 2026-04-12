import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379/0',
  apiKeyPrefix: process.env.API_KEY_PREFIX ?? 'snp_',
  defaultTtlSeconds: parseInt(process.env.DEFAULT_TTL_SECONDS ?? '604800', 10),
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  },
  maxStateBytes: 1_048_576, // 1MB

  // Phase 2 additions
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://checkpoint:checkpoint_dev@localhost:5432/snapstate',
  adminSecret: process.env.ADMIN_SECRET ?? 'admin_dev_secret_change_me',
  authCacheTtlSeconds: 300, // 5 minutes

  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucketName: process.env.R2_BUCKET_NAME ?? 'checkpoint-archives',
    endpoint: process.env.R2_ENDPOINT ?? '',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    prices: {
      checkpointWrite: process.env.STRIPE_PRICE_CHECKPOINT_WRITE ?? '',
      storageGb: process.env.STRIPE_PRICE_STORAGE_GB ?? '',
      resume: process.env.STRIPE_PRICE_RESUME ?? '',
      replay: process.env.STRIPE_PRICE_REPLAY ?? '',
    },
  },

  ttlManager: {
    intervalMs: 60_000, // run every 60 seconds
    archiveThresholdSeconds: 3600, // archive when TTL < 1 hour remaining
  },

  // Phase 3 — Auth
  jwtSecret: process.env.JWT_SECRET ?? 'dev_jwt_secret_change_in_production_minimum_32_chars',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  maxApiKeysPerAccount: parseInt(process.env.MAX_API_KEYS_PER_ACCOUNT ?? '10', 10),
  maxAgentsPerAccount: parseInt(process.env.MAX_AGENTS_PER_ACCOUNT ?? '50', 10),

  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM ?? 'noreply@snapstate.dev',
  },
};
