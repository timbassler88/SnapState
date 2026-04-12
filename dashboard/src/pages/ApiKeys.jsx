import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-200">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ApiKeys() {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [keys, setKeys] = useState([]);
  const [newAccount, setNewAccount] = useState({ email: '', name: '' });
  const [newKey, setNewKey] = useState({ label: '' });
  const [createdKey, setCreatedKey] = useState(null);
  const [modal, setModal] = useState(null); // 'account' | 'key' | 'confirm-revoke'
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadAccounts = () =>
    api.getAccounts().then((r) => setAccounts(r?.accounts ?? [])).catch((e) => setError(e.message));

  const loadKeys = (accountId) =>
    api.getAccountKeys(accountId).then((r) => setKeys(r?.keys ?? [])).catch(() => {});

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    if (selected) loadKeys(selected);
  }, [selected]);

  const handleCreateAccount = async () => {
    try {
      await api.createAccount(newAccount);
      setModal(null);
      setNewAccount({ email: '', name: '' });
      await loadAccounts();
    } catch (e) { setError(e.message); }
  };

  const handleCreateKey = async () => {
    try {
      const result = await api.createApiKey(selected, newKey);
      setCreatedKey(result.api_key);
      setModal('show-key');
      setNewKey({ label: '' });
      await loadKeys(selected);
    } catch (e) { setError(e.message); }
  };

  const handleRevoke = async () => {
    try {
      await api.revokeApiKey(selected, revokeTarget);
      setModal(null);
      setRevokeTarget(null);
      await loadKeys(selected);
    } catch (e) { setError(e.message); }
  };

  const copy = () => {
    navigator.clipboard.writeText(createdKey ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">API Keys</h1>
        <button
          onClick={() => setModal('account')}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold transition"
        >
          + New Account
        </button>
      </div>

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      <div className="grid grid-cols-3 gap-6">
        {/* Account list */}
        <div className="col-span-1 bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <p className="px-4 py-3 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
            Accounts
          </p>
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-800/50 text-sm transition ${
                selected === a.id ? 'bg-indigo-900/40 text-indigo-300' : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <p className="font-medium">{a.name ?? a.email}</p>
              <p className="text-xs text-gray-500">{a.email}</p>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${
                a.plan === 'paid' ? 'bg-indigo-900 text-indigo-300' : 'bg-gray-800 text-gray-500'
              }`}>{a.plan}</span>
            </button>
          ))}
        </div>

        {/* Key list */}
        <div className="col-span-2 bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider">API Keys</p>
            {selected && (
              <button
                onClick={() => setModal('key')}
                className="text-xs text-indigo-400 hover:text-indigo-200 transition"
              >
                + Generate Key
              </button>
            )}
          </div>
          {!selected ? (
            <p className="px-4 py-6 text-gray-600 text-sm">Select an account.</p>
          ) : keys.length === 0 ? (
            <p className="px-4 py-6 text-gray-600 text-sm">No keys yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left px-4 py-2">Prefix</th>
                  <th className="text-left px-4 py-2">Label</th>
                  <th className="text-left px-4 py-2">Last Used</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-gray-800/50">
                    <td className="px-4 py-2 font-mono text-indigo-300">{k.key_prefix}…</td>
                    <td className="px-4 py-2 text-gray-400">{k.label ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'never'}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        k.revoked_at ? 'bg-rose-950 text-rose-400' : 'bg-green-950 text-green-400'
                      }`}>
                        {k.revoked_at ? 'revoked' : 'active'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {!k.revoked_at && (
                        <button
                          onClick={() => { setRevokeTarget(k.id); setModal('confirm-revoke'); }}
                          className="text-rose-500 hover:text-rose-300 transition"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Account modal */}
      {modal === 'account' && (
        <Modal title="New Account" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              placeholder="Email *"
              value={newAccount.email}
              onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
            />
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              placeholder="Name"
              value={newAccount.name}
              onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
            />
            <button
              onClick={handleCreateAccount}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold transition"
            >
              Create Account
            </button>
          </div>
        </Modal>
      )}

      {/* Create Key modal */}
      {modal === 'key' && (
        <Modal title="Generate API Key" onClose={() => setModal(null)}>
          <div className="space-y-3">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              placeholder="Label (e.g. production-bot)"
              value={newKey.label}
              onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
            />
            <button
              onClick={handleCreateKey}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold transition"
            >
              Generate
            </button>
          </div>
        </Modal>
      )}

      {/* Show generated key (once) */}
      {modal === 'show-key' && (
        <Modal title="API Key Created" onClose={() => { setModal(null); setCreatedKey(null); }}>
          <p className="text-xs text-amber-400 mb-3">
            Store this key securely — it will not be shown again.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-gray-950 border border-gray-700 rounded px-3 py-2 text-xs text-green-300 break-all">
              {createdKey}
            </code>
            <button
              onClick={copy}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-xs transition"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm revoke */}
      {modal === 'confirm-revoke' && (
        <Modal title="Revoke API Key?" onClose={() => setModal(null)}>
          <p className="text-sm text-gray-400 mb-4">
            This key will immediately stop working. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setModal(null)}
              className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
            >
              Cancel
            </button>
            <button
              onClick={handleRevoke}
              className="flex-1 py-2 bg-rose-700 hover:bg-rose-600 rounded text-sm font-semibold transition"
            >
              Revoke
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
