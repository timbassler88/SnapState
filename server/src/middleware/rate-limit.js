import { getRedis } from '../store/redis.js';
import { config } from '../config.js';
import { sendError, ErrorCodes } from '../utils/errors.js';

/**
 * Redis-backed sliding window rate limiter.
 *
 * Uses a sorted set per API key where each member is a unique request ID
 * and the score is the timestamp (ms). Expired entries are pruned on every
 * request so the window always reflects the last `windowMs` milliseconds.
 */
export async function rateLimitMiddleware(request, reply) {
  const apiKey = request.apiKey;
  if (!apiKey) return; // auth middleware should have rejected before we get here

  const redis = getRedis();
  const now = Date.now();
  const windowStart = now - config.rateLimit.windowMs;
  const key = `rate_limit:${apiKey}`;
  const ttlSeconds = Math.ceil(config.rateLimit.windowMs / 1000);

  // Sliding window using a sorted set
  const pipeline = redis.pipeline();
  // Remove entries outside the window
  pipeline.zremrangebyscore(key, '-inf', windowStart);
  // Count remaining entries
  pipeline.zcard(key);
  // Add current request
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  // Refresh TTL
  pipeline.expire(key, ttlSeconds);

  const results = await pipeline.exec();
  const count = results[1][1]; // zcard result (before adding current)

  if (count >= config.rateLimit.max) {
    const retryAfter = Math.ceil(config.rateLimit.windowMs / 1000);
    reply.header('Retry-After', String(retryAfter));
    return sendError(reply, 429, ErrorCodes.RATE_LIMITED, 'Rate limit exceeded');
  }
}
