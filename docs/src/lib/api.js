/**
 * Minimal API client used by the TryIt interactive playground.
 */

export async function callApi({ baseUrl, apiKey, method, path, body }) {
  const url = `${(baseUrl ?? 'http://localhost:3000').replace(/\/$/, '')}${path}`;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const init = { method: method ?? 'GET', headers };
  if (body && method !== 'GET') {
    try {
      init.body = JSON.stringify(JSON.parse(body));
    } catch {
      init.body = body;
    }
  }

  const start = Date.now();
  try {
    const res = await fetch(url, init);
    const elapsed = Date.now() - start;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }

    return {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: json ?? text,
      elapsed,
      ok: res.ok,
    };
  } catch (err) {
    return { error: err.message, ok: false, elapsed: Date.now() - start };
  }
}
