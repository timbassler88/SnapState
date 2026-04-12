import { useEffect, useState } from 'react';
import { WorkflowTimeline } from '../components/WorkflowTimeline.jsx';
import { api } from '../lib/api.js';

export function Workflows() {
  const [workflows, setWorkflows] = useState([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = (q = '') => {
    setLoading(true);
    api.getWorkflows(q ? { q } : {})
      .then((r) => setWorkflows(r?.workflows ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggle = async (workflowId) => {
    if (expanded === workflowId) { setExpanded(null); return; }
    setExpanded(workflowId);
    if (history[workflowId]) return;
    try {
      const r = await fetch(`/workflows/${encodeURIComponent(workflowId)}/replay`, {
        headers: { Authorization: `Bearer ${import.meta.env.VITE_API_KEY ?? ''}` },
      });
      const data = await r.json();
      setHistory((h) => ({ ...h, [workflowId]: data.checkpoints ?? [] }));
    } catch {
      setHistory((h) => ({ ...h, [workflowId]: [] }));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-100">Workflows</h1>

      {/* Search */}
      <div className="flex gap-3">
        <input
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          placeholder="Search by workflow ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(search)}
        />
        <button
          onClick={() => load(search)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold transition"
        >
          Search
        </button>
      </div>

      {error && <p className="text-rose-400 text-sm">{error}</p>}
      {loading && <p className="text-gray-500 text-sm">Loading…</p>}

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3">Workflow ID</th>
              <th className="text-left px-4 py-3">Checkpoints</th>
              <th className="text-left px-4 py-3">Last Activity</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {workflows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-600 text-sm">
                  No workflows found.
                </td>
              </tr>
            )}
            {workflows.map((wf) => (
              <>
                <tr
                  key={wf.workflow_id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                  onClick={() => toggle(wf.workflow_id)}
                >
                  <td className="px-4 py-3 font-mono text-indigo-300 text-xs">{wf.workflow_id}</td>
                  <td className="px-4 py-3 text-gray-300">{wf.total_checkpoints}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {wf.last_activity ? new Date(wf.last_activity).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      wf.status === 'archived'
                        ? 'bg-gray-700 text-gray-400'
                        : 'bg-green-900 text-green-300'
                    }`}>
                      {wf.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {expanded === wf.workflow_id ? '▲' : '▼'}
                  </td>
                </tr>
                {expanded === wf.workflow_id && (
                  <tr key={`${wf.workflow_id}-detail`}>
                    <td colSpan={5} className="px-6 py-4 bg-gray-950">
                      <WorkflowTimeline checkpoints={history[wf.workflow_id] ?? []} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
