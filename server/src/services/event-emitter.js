import { createHmac } from 'node:crypto';
import { getRedis } from '../store/redis.js';

const DELIVERY_TIMEOUT_MS = 5000;

/**
 * Fire-and-forget webhook delivery for a given event.
 * Does not block the caller — errors are logged, not thrown.
 *
 * @param {string} event - e.g. 'checkpoint.saved'
 * @param {object} data  - event payload data
 * @param {string} apiKey - scopes webhook lookup
 * @param {import('ioredis').Redis} [redis]
 */
export function emitEvent(event, data, apiKey, redis) {
  // Intentionally not awaited
  _deliver(event, data, apiKey, redis).catch((err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'Webhook delivery failed', err: err.message }));
  });
}

async function _deliver(event, data, apiKey, redis) {
  const r = redis ?? getRedis();
  const webhookKey = `webhooks:${apiKey}`;

  const allWebhooks = await r.hgetall(webhookKey);
  if (!allWebhooks) return;

  const now = new Date().toISOString();

  await Promise.allSettled(
    Object.values(allWebhooks).map(async (raw) => {
      let hook;
      try {
        hook = JSON.parse(raw);
      } catch {
        return;
      }

      if (!hook.events.includes(event)) return;

      const payload = {
        event,
        webhook_id: hook.webhook_id,
        timestamp: now,
        data,
      };

      const body = JSON.stringify(payload);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'CheckpointService/1.0',
      };

      if (hook.secret) {
        const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
        headers['X-Checkpoint-Signature'] = `sha256=${sig}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      try {
        await fetch(hook.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    })
  );
}

/**
 * Register a webhook for an API key.
 *
 * @param {string} apiKey
 * @param {{ url: string, events: string[], secret?: string }} config
 * @param {import('ioredis').Redis} [redis]
 * @returns {Promise<object>} webhook record
 */
export async function registerWebhook(apiKey, { url, events, secret }, redis) {
  const r = redis ?? getRedis();
  const webhookId = `wh_${randomHex(12)}`;
  const createdAt = new Date().toISOString();

  const record = {
    webhook_id: webhookId,
    url,
    events,
    secret: secret ?? null,
    created_at: createdAt,
  };

  await r.hset(`webhooks:${apiKey}`, webhookId, JSON.stringify(record));

  // Return without secret in response
  const { secret: _omit, ...response } = record;
  return response;
}

/**
 * Delete a webhook by ID for an API key.
 *
 * @param {string} apiKey
 * @param {string} webhookId
 * @param {import('ioredis').Redis} [redis]
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
export async function deleteWebhook(apiKey, webhookId, redis) {
  const r = redis ?? getRedis();
  const deleted = await r.hdel(`webhooks:${apiKey}`, webhookId);
  return deleted > 0;
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
