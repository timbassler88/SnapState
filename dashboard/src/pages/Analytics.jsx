import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { api } from '../lib/api.js';

const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-gray-200">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function LoadingBox({ height = 240 }) {
  return (
    <div
      className="bg-gray-800 rounded-xl border border-gray-700 flex items-center justify-center text-gray-600 text-sm"
      style={{ height }}
    >
      Loading…
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div className="bg-gray-800 rounded-xl border border-red-900 p-4 text-red-400 text-sm">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow Funnel Chart
// ---------------------------------------------------------------------------

function WorkflowFunnel({ overview }) {
  if (!overview) return <LoadingBox />;

  const data = [
    { name: 'Started', value: overview.total_workflows },
    { name: 'Active', value: overview.active_workflows },
    { name: 'Completed', value: overview.completed_workflows },
  ];

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Workflow Funnel" subtitle="Started → Active → Completed" />
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ left: 16, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fill: '#d1d5db', fontSize: 12 }} width={80} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#f9fafb' }}
            itemStyle={{ color: '#a5b4fc' }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Checkpoint Volume
// ---------------------------------------------------------------------------

function CheckpointVolumeChart({ activity }) {
  if (!activity) return <LoadingBox />;

  // Aggregate usage_events by date
  const byDate = {};
  (activity.events ?? []).forEach((e) => {
    const d = e.created_at?.slice(0, 10);
    if (d) byDate[d] = (byDate[d] ?? 0) + 1;
  });

  const data = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, count]) => ({ date: date.slice(5), count })); // MM-DD display

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Daily Checkpoint Volume" subtitle="Events in the last 30 days" />
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#f9fafb' }}
            itemStyle={{ color: '#a5b4fc' }}
          />
          <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Failure Hotspots Chart
// ---------------------------------------------------------------------------

function FailureHotspots({ failures }) {
  if (!failures) return <LoadingBox />;

  const data = (failures.failure_by_step ?? []).map((f) => ({
    step: `Step ${f.step ?? '?'}`,
    count: f.count,
  }));

  if (data.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
        <SectionHeader title="Failure Hotspots" subtitle="Steps with most errors" />
        <p className="text-gray-500 text-sm text-center py-12">No failures in this period</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Failure Hotspots" subtitle={`${failures.total_failures} total failures in ${failures.period_days} days`} />
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="step" tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#f9fafb' }}
            itemStyle={{ color: '#f87171' }}
          />
          <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Leaderboard
// ---------------------------------------------------------------------------

const SORT_KEYS = ['total_workflows', 'avg_steps', 'error_rate', 'last_seen_at'];

function AgentLeaderboard({ overview }) {
  const [sortKey, setSortKey] = useState('total_workflows');

  if (!overview) return <LoadingBox />;

  const agents = [...(overview.top_agents ?? [])]
    .sort((a, b) => {
      if (sortKey === 'last_seen_at') return (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '');
      return (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
    });

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Agent Leaderboard" />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="text-xs bg-gray-700 text-gray-300 border border-gray-600 rounded px-2 py-1"
        >
          <option value="total_workflows">By workflows</option>
          <option value="avg_steps">By avg steps</option>
          <option value="error_rate">By error rate</option>
        </select>
      </div>
      {agents.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No agent activity yet</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase border-b border-gray-700">
              <th className="text-left pb-2">Agent</th>
              <th className="text-right pb-2">Workflows</th>
              <th className="text-right pb-2">Avg Steps</th>
              <th className="text-right pb-2">Error Rate</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.agent_id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                <td className="py-2 font-mono text-indigo-300 text-xs">{a.agent_id}</td>
                <td className="py-2 text-right text-gray-300">{a.workflows ?? a.total_workflows ?? 0}</td>
                <td className="py-2 text-right text-gray-300">{a.avg_steps ?? '—'}</td>
                <td className="py-2 text-right">
                  <span className={`text-xs font-medium ${(a.error_rate ?? 0) > 0.1 ? 'text-red-400' : 'text-green-400'}`}>
                    {a.error_rate != null ? `${Math.round(a.error_rate * 100)}%` : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Failures
// ---------------------------------------------------------------------------

function RecentFailures({ failures }) {
  if (!failures) return <LoadingBox />;

  const recent = failures.recent_failures ?? [];

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
      <SectionHeader title="Recent Failures" subtitle="Latest error events" />
      {recent.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No failures recorded</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs uppercase border-b border-gray-700">
              <th className="text-left pb-2">Workflow</th>
              <th className="text-right pb-2">Step</th>
              <th className="text-left pb-2 pl-4">Agent</th>
              <th className="text-left pb-2 pl-4">Error</th>
              <th className="text-right pb-2">When</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((f, i) => (
              <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                <td className="py-2 font-mono text-xs text-indigo-300 max-w-[140px] truncate">{f.workflow_id}</td>
                <td className="py-2 text-right text-gray-400">{f.step ?? '—'}</td>
                <td className="py-2 pl-4 text-gray-400 text-xs">{f.agent_id ?? '—'}</td>
                <td className="py-2 pl-4 text-red-300 text-xs max-w-[180px] truncate">{f.error_message ?? f.error_type ?? '—'}</td>
                <td className="py-2 text-right text-gray-500 text-xs">
                  {f.created_at ? new Date(f.created_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Analytics page
// ---------------------------------------------------------------------------

export function Analytics() {
  const [overview, setOverview] = useState(null);
  const [failures, setFailures] = useState(null);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [ov, fl, ac] = await Promise.all([
          api.getAnalyticsOverview(30),
          api.getAnalyticsFailures(7),
          api.getActivity(100),
        ]);
        if (!cancelled) {
          setOverview(ov);
          setFailures(fl);
          setActivity(ac);
        }
      } catch (e) {
        if (!cancelled) setError(e.message ?? 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-white">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">
          Aggregate insights across all accounts — last 30 days
        </p>
      </div>

      {error && <ErrorBox message={error} />}

      {/* Summary stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <LoadingBox key={i} height={96} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Workflows" value={overview?.total_workflows?.toLocaleString()} />
          <StatCard
            label="Completed"
            value={overview?.completed_workflows?.toLocaleString()}
            sub={overview ? `${Math.round((overview.completed_workflows / Math.max(overview.total_workflows, 1)) * 100)}% completion rate` : null}
          />
          <StatCard
            label="Total Checkpoints"
            value={overview?.total_checkpoints?.toLocaleString()}
            sub={overview ? `avg ${overview.avg_steps_per_workflow} steps/workflow` : null}
          />
          <StatCard
            label="Failures (7d)"
            value={failures?.total_failures?.toLocaleString()}
            sub={failures?.period_days ? `last ${failures.period_days} days` : null}
          />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <WorkflowFunnel overview={loading ? null : overview} />
        <CheckpointVolumeChart activity={loading ? null : activity} />
      </div>

      {/* Failure row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FailureHotspots failures={loading ? null : failures} />
        <AgentLeaderboard overview={loading ? null : overview} />
      </div>

      {/* Recent failures */}
      <RecentFailures failures={loading ? null : failures} />
    </div>
  );
}
