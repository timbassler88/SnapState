/**
 * Seed script: generates a test API key and adds it to Redis.
 *
 * Usage:
 *   node scripts/seed.js
 *
 * Outputs the generated key to stdout. Store it in your .env or pass via env.
 */

import 'dotenv/config';
import Redis from 'ioredis';
import { config } from '../src/config.js';

const redis = new Redis(config.redisUrl);

function generateApiKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${config.apiKeyPrefix}${hex}`;
}

const apiKey = generateApiKey();
await redis.sadd('api_keys', apiKey);
await redis.quit();

console.log(`\nAPI key generated and stored in Redis:\n\n  ${apiKey}\n`);
console.log('Add this to your environment:');
console.log(`  export SNAPSTATE_API_KEY="${apiKey}"\n`);
