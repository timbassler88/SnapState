import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

/**
 * @param {{ data: Array<{ date: string, checkpoint_writes: number, checkpoint_reads: number, resume_calls: number, replay_calls: number }> }} props
 */
export function UsageChart({ data = [] }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        No usage data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          tickFormatter={(v) => v.slice(5)} // MM-DD
        />
        <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
          labelStyle={{ color: '#e5e7eb' }}
          itemStyle={{ color: '#9ca3af' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
        <Bar dataKey="checkpoint_writes" name="Writes" fill="#6366f1" radius={[2, 2, 0, 0]} />
        <Bar dataKey="checkpoint_reads" name="Reads" fill="#22d3ee" radius={[2, 2, 0, 0]} />
        <Bar dataKey="resume_calls" name="Resumes" fill="#34d399" radius={[2, 2, 0, 0]} />
        <Bar dataKey="replay_calls" name="Replays" fill="#f59e0b" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
