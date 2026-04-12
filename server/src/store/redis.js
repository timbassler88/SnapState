import Redis from 'ioredis';
import { config } from '../config.js';

let client;

export function getRedis() {
  if (!client) {
    client = new Redis(config.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    client.on('error', (err) => {
      // Logged by Fastify pino — surface without crashing
      console.error(JSON.stringify({ level: 'error', msg: 'Redis error', err: err.message }));
    });
  }
  return client;
}

/**
 * Create a second Redis client pointing at a different database number.
 * Used by tests to isolate state (db 1).
 */
export function createRedisClient(url) {
  return new Redis(url ?? config.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
}

export async function checkRedisHealth() {
  try {
    const pong = await getRedis().ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
