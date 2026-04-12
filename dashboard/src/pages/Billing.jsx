import { useEffect, useState } from 'react';
import { UsageChart } from '../components/UsageChart.jsx';
import { api } from '../lib/api.js';

function UsageRow({ label, count, freeRemaining, billable, unit = '' }) {
  const pct = count > 0 ? Math.min(100, Math.round(((count - freeRemaining) / count) * 100)) : 0;
  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-400">
          {count.toLocaleString()}{unit} used
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-600 mt-1">
        <span>{freeRemaining.toLocaleString()}{unit} free remaining</span>
        <span className={billable > 0 ? 'text-amber-400' : 'text-gray-600'}>
          {billable > 0 ? `${billable.toLocaleString()}${unit} billable` : 'within free tier'}
        </span>
      </div>
    </div>
  );
}

export function Billing() {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [usage, setUsage] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getAccounts().then((r) => {
      const list = r?.accounts ?? [];
      setAccounts(list);
      if (list.length > 0) setSelectedId(String(list[0].id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    Promise.all([api.getUsage(selectedId), api.getInvoices(selectedId)])
      .then(([u, inv]) => {
        setUsage(u);
        setInvoices(inv?.invoices ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-100">Billing</h1>
        <select
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-300"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name ?? a.email}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-rose-400 text-sm">{error}</p>}
      {loading && <p className="text-gray-500 text-sm">Loading…</p>}

      {usage && (
        <>
          {/* Period + charge */}
          <div className="flex items-center justify-between bg-gray-900 rounded-xl border border-gray-800 px-6 py-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Billing Period</p>
              <p className="text-sm text-gray-300 mt-0.5">
                {usage.period.start} — {usage.period.end}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Estimated Charge</p>
              <p className="text-2xl font-bold text-indigo-400 mt-0.5">{usage.estimated_charge}</p>
            </div>
          </div>

          {/* Usage breakdown */}
          <section className="bg-gray-900 rounded-xl border border-gray-800 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-widest">
              Usage This Period
            </h2>
            <UsageRow
              label="Checkpoint Writes"
              count={usage.usage.checkpoint_writes.count}
              freeRemaining={usage.usage.checkpoint_writes.free_remaining}
              billable={usage.usage.checkpoint_writes.billable}
            />
            <UsageRow
              label="Storage"
              count={parseFloat(usage.usage.storage_gb.current.toFixed(3))}
              freeRemaining={parseFloat(usage.usage.storage_gb.free_remaining.toFixed(3))}
              billable={parseFloat(usage.usage.storage_gb.billable.toFixed(3))}
              unit=" GB"
            />
            <UsageRow
              label="Resume Calls"
              count={usage.usage.resume_calls.count}
              freeRemaining={usage.usage.resume_calls.free_remaining}
              billable={usage.usage.resume_calls.billable}
            />
            <UsageRow
              label="Replay Calls"
              count={usage.usage.replay_calls.count}
              freeRemaining={usage.usage.replay_calls.free_remaining}
              billable={usage.usage.replay_calls.billable}
            />
          </section>

          {/* Usage chart placeholder */}
          <section className="bg-gray-900 rounded-xl border border-gray-800 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-widest">
              Daily Breakdown
            </h2>
            <UsageChart data={[]} />
          </section>
        </>
      )}

      {/* Invoices */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <p className="px-6 py-3 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
          Past Invoices
        </p>
        {invoices.length === 0 ? (
          <p className="px-6 py-4 text-gray-600 text-sm">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="text-left px-6 py-2">Period</th>
                <th className="text-left px-6 py-2">Amount</th>
                <th className="text-left px-6 py-2">Status</th>
                <th className="px-6 py-2" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-800/50">
                  <td className="px-6 py-3 text-gray-400 text-xs">
                    {inv.period_start.slice(0, 10)} — {inv.period_end.slice(0, 10)}
                  </td>
                  <td className="px-6 py-3 text-gray-200">
                    ${(inv.amount_due / 100).toFixed(2)}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      inv.status === 'paid' ? 'bg-green-950 text-green-400'
                        : inv.status === 'open' ? 'bg-amber-950 text-amber-400'
                          : 'bg-rose-950 text-rose-400'
                    }`}>{inv.status}</span>
                  </td>
                  <td className="px-6 py-3">
                    {inv.invoice_pdf && (
                      <a href={inv.invoice_pdf} target="_blank" rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-200 text-xs">
                        PDF
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
