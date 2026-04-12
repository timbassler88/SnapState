/**
 * Admin API client for the dashboard.
 * All requests use the ADMIN_SECRET configured via the VITE_ADMIN_SECRET env var
 * (or hardcoded for dev — replace with proper auth in production).
 */

const BASE = '';
const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET ?? 'admin_dev_secret_change_me';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${ADMIN_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json;
}

export const api = {
  // ---- Stats ----
  getStats: () => req('GET', '/admin/stats'),

  // ---- Activity ----
  getActivity: (limit = 20) => req('GET', `/admin/activity?limit=${limit}`),

  // ---- Workflows ----
  getWorkflows: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)));
    return req('GET', `/admin/workflows?${qs}`);
  },

  // ---- Accounts ----
  getAccounts: (page = 1) => req('GET', `/admin/accounts?page=${page}`),
  getAccount: (id) => req('GET', `/admin/accounts/${id}`),
  createAccount: (data) => req('POST', '/admin/accounts', data),
  getAccountKeys: (id) => req('GET', `/admin/accounts/${id}/keys`),
  createApiKey: (accountId, data) => req('POST', `/admin/accounts/${accountId}/keys`, data),
  revokeApiKey: (accountId, keyId) => req('DELETE', `/admin/accounts/${accountId}/keys/${keyId}`),

  // ---- Billing ----
  getUsage: (accountId) => req('GET', `/admin/accounts/${accountId}/usage`),
  getInvoices: (accountId) => req('GET', `/admin/accounts/${accountId}/invoices`),

  // ---- Analytics (admin) ----
  getAnalyticsOverview: (days = 30) => req('GET', `/admin/analytics/overview?days=${days}`),
  getAnalyticsFailures: (days = 7) => req('GET', `/admin/analytics/failures?days=${days}`),

  // ---- Health ----
  getHealth: () => fetch('/health').then((r) => r.json()),
};
