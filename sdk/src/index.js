/**
 * @snapstate/sdk
 *
 * Zero-dependency, isomorphic SDK for SnapState.
 * Works in Node.js (18+) and modern browsers via native fetch.
 */

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class SnapStateError extends Error {
  /**
   * @param {string} message
   * @param {string} code - Machine-readable error code
   * @param {number} statusCode - HTTP status code
   */
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'SnapStateError';
    /** @type {string} */
    this.code = code;
    /** @type {number} */
    this.statusCode = statusCode;
  }
}

export { SnapStateError as CheckpointError }; // deprecated alias

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function snakeToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        snakeToCamel(v),
      ])
    );
  }
  return obj;
}

function camelToSnake(obj) {
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/([A-Z])/g, '_$1').toLowerCase(),
        camelToSnake(v),
      ])
    );
  }
  return obj;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SnapStateClient {
  /**
   * @param {{ apiKey: string, baseUrl?: string }} opts
   */
  constructor({ apiKey, baseUrl = 'https://snapstate.dev' }) {
    if (!apiKey) throw new SnapStateError('apiKey is required', 'INVALID_CONFIG', 0);
    /** @private */
    this._apiKey = apiKey;
    /** @private */
    this._baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Make an authenticated HTTP request with auto-retry on 429.
   * @private
   */
  async _request(method, path, { body, query, headers: extraHeaders } = {}, retries = 3) {
    let url = `${this._baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(
        Object.fromEntries(
          Object.entries(query)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)])
        )
      );
      if (params.size > 0) url += `?${params}`;
    }

    const headers = {
      'Authorization': `Bearer ${this._apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(camelToSnake(body));

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(url, init);

      if (res.status === 429 && attempt < retries) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
        await sleep(retryAfter * 1000 * Math.pow(2, attempt));
        lastErr = new SnapStateError('Rate limit exceeded', 'RATE_LIMITED', 429);
        continue;
      }

      if (res.status === 204) return null;

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = json?.error ?? {};
        throw new SnapStateError(
          err.message ?? `HTTP ${res.status}`,
          err.code ?? 'UNKNOWN',
          res.status
        );
      }

      return snakeToCamel(json);
    }

    throw lastErr;
  }

  // ---------------------------------------------------------------------------
  // Checkpoints
  // ---------------------------------------------------------------------------

  /**
   * Save a checkpoint for a workflow step.
   *
   * @param {{ workflowId: string, step: number, label?: string, state: object, metadata?: object, ttlSeconds?: number, ifMatch?: string }} params
   * @returns {Promise<{ checkpointId: string, workflowId: string, step: number, etag: string, createdAt: string, diffFromPrevious: object, sizeBytes: number }>}
   */
  async save({ workflowId, step, label, state, agentId, metadata, ttlSeconds, ifMatch }) {
    const extraHeaders = {};
    if (ttlSeconds) extraHeaders['X-Checkpoint-TTL'] = String(ttlSeconds);
    if (ifMatch) extraHeaders['If-Match'] = ifMatch;

    return this._request('POST', '/checkpoints', {
      body: { workflowId, step, label, state, agentId, metadata },
      headers: extraHeaders,
    });
  }

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  /**
   * Register or update an agent identity.
   *
   * @param {{ agentId: string, name: string, description?: string, capabilities?: string[], metadata?: object }} params
   * @returns {Promise<object>} agent record
   */
  async registerAgent({ agentId, name, description, capabilities, metadata }) {
    return this._request('POST', '/agents', {
      body: { agentId, name, description, capabilities, metadata },
    });
  }

  /**
   * Retrieve a specific checkpoint by ID.
   *
   * @param {string} checkpointId
   * @returns {Promise<object>}
   */
  async get(checkpointId) {
    return this._request('GET', `/checkpoints/${encodeURIComponent(checkpointId)}`);
  }

  // ---------------------------------------------------------------------------
  // Workflows
  // ---------------------------------------------------------------------------

  /**
   * Get the latest checkpoint state for resuming a workflow.
   *
   * @param {string} workflowId
   * @returns {Promise<{ workflowId: string, latestCheckpoint: object, totalCheckpoints: number, workflowStartedAt: string, lastActivityAt: string }>}
   */
  async resume(workflowId) {
    return this._request('GET', `/workflows/${encodeURIComponent(workflowId)}/resume`);
  }

  /**
   * Get the full ordered checkpoint history for a workflow.
   *
   * @param {string} workflowId
   * @param {{ fromStep?: number, toStep?: number, limit?: number }} [opts]
   * @returns {Promise<{ workflowId: string, checkpoints: object[], total: number, hasMore: boolean }>}
   */
  async replay(workflowId, { fromStep, toStep, limit } = {}) {
    return this._request('GET', `/workflows/${encodeURIComponent(workflowId)}/replay`, {
      query: { from_step: fromStep, to_step: toStep, limit },
    });
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /**
   * Register a webhook URL to receive events.
   *
   * @param {{ url: string, events: string[], secret?: string }} params
   * @returns {Promise<{ webhookId: string, url: string, events: string[], createdAt: string }>}
   */
  async registerWebhook({ url, events, secret }) {
    return this._request('POST', '/webhooks', { body: { url, events, secret } });
  }

  /**
   * Remove a webhook registration.
   *
   * @param {string} webhookId
   * @returns {Promise<null>}
   */
  async deleteWebhook(webhookId) {
    return this._request('DELETE', `/webhooks/${encodeURIComponent(webhookId)}`);
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  /**
   * Check service health.
   *
   * @returns {Promise<{ status: string, redis: string, timestamp: string }>}
   */
  async health() {
    const res = await fetch(`${this._baseUrl}/health`);
    return res.json();
  }
}

export { SnapStateClient as CheckpointClient }; // deprecated alias

export default SnapStateClient;
