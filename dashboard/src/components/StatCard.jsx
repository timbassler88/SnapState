export function StatCard({ label, value, sub, color = 'indigo' }) {
  const colors = {
    indigo: 'border-indigo-500 text-indigo-400',
    green: 'border-green-500 text-green-400',
    amber: 'border-amber-500 text-amber-400',
    rose: 'border-rose-500 text-rose-400',
  };

  return (
    <div className={`bg-gray-900 rounded-xl border-l-4 ${colors[color]} p-5 flex flex-col gap-1`}>
      <p className="text-xs text-gray-400 uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-bold ${colors[color]}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
