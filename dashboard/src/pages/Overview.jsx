import { useEffect, useState } from 'react';
import { StatCard } from '../components/StatCard.jsx';
import { UsageChart } from '../components/UsageChart.jsx';
import { api } from '../lib/api.js';

function HealthDot({ ok }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${ok ? 'bg-green-400' : 'bg-rose-500'}`} />
  );
}

export function Overview() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getStats(), api.getActivity(20)])
      .then(([s, a]) => {
        setStats(s);
        setActivity(a?.events ?? []);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-lg bg-rose-950 border border-rose-700 p-4 text-rose-300 text-sm">
        Failed to load stats: {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-100">Overview</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Active Workflows" value={stats?.active_workflows ?? '…'} color="indigo" />
        <StatCard label="Checkpoints Today" value={stats?.checkpoints_today ?? '…'} color="green" />
        <StatCard label="Total Accounts" value={stats?.total_accounts ?? '…'} color="amber" />
        <StatCard
          label="Storage Used"
          value={stats ? `${stats.storage_used_mb} MB` : '…'}
          color="rose"
        />
      </div>

      {/* Health */}
      <section className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-widest">Service Health</h2>
        <div className="flex gap-6 text-sm">
          <span>
            <HealthDot ok={stats?.redis_connected} />
            Redis
          </span>
          <span>
            <HealthDot ok={stats?.postgres_connected} />
            Postgres
          </span>
          <span>
            <HealthDot ok={stats?.r2_reachable} />
            R2 Storage
          </span>
        </div>
      </section>

      {/* Usage chart — last 30 days placeholder */}
      <section className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-widest">
          Daily Usage (last 30 days)
        </h2>
        <UsageChart data={[]} />
        <p className="text-xs text-gray-600 mt-2">
          Per-account charts available on the Billing page.
        </p>
      </section>

      {/* Recent activity */}
      <section className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 mb-4 uppercase tracking-widest">
          Recent Activity
        </h2>
        {activity.length === 0 ? (
          <p className="text-gray-500 text-sm">No recent activity.</p>
        ) : (
          <table className="w-full text-xs text-gray-400">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="text-left py-2">Event</th>
                <th className="text-left py-2">Account</th>
                <th className="text-left py-2">Workflow</th>
                <th className="text-left py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((ev) => (
                <tr key={ev.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 text-indigo-400">{ev.event_type}</td>
                  <td className="py-2">{ev.email ?? '—'}</td>
                  <td className="py-2 font-mono text-gray-500 truncate max-w-[160px]">
                    {ev.workflow_id ?? '—'}
                  </td>
                  <td className="py-2 text-gray-600">
                    {new Date(ev.created_at).toLocaleTimeString()}
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
