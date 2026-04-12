const NAV = [
  { id: 'overview', label: 'Overview', icon: '◈' },
  { id: 'workflows', label: 'Workflows', icon: '⛓' },
  { id: 'apikeys', label: 'API Keys', icon: '⚿' },
  { id: 'billing', label: 'Billing', icon: '◎' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
];

export function Layout({ page, onNav, children }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-5 py-6 border-b border-gray-800">
          <p className="text-xs text-gray-500 uppercase tracking-widest">SnapState</p>
          <p className="text-lg font-bold text-indigo-400 mt-0.5">Admin</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => onNav(item.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                page === item.id
                  ? 'bg-indigo-900/60 text-indigo-300 font-semibold'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-gray-800">
          <p className="text-xs text-gray-600">v3.0.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
