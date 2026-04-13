import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const NAV = [
  {
    section: null,
    items: [{ label: 'Getting Started', to: '/' }],
  },
  {
    section: 'API Reference',
    items: [{ label: 'All Endpoints', to: '/api' }],
  },
  {
    section: 'SDKs',
    items: [
      { label: 'JavaScript', to: '/sdk/javascript' },
      { label: 'Python', to: '/sdk/python' },
    ],
  },
  {
    section: 'Guides',
    items: [
      { label: 'MCP Setup', to: '/guides/mcp' },
      { label: 'Agent Identity', to: '/guides/agents' },
      { label: 'Agent Integration', to: '/guides/integration' },
      { label: 'Webhooks', to: '/guides/webhooks' },
    ],
  },
  {
    section: null,
    items: [{ label: 'Pricing', to: '/pricing' }],
  },
];

function SidebarLink({ to, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `block text-sm px-3 py-1.5 rounded-lg transition-colors ${
          isActive
            ? 'bg-indigo-50 text-indigo-700 font-medium'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function Sidebar({ onClose }) {
  return (
    <div className="flex flex-col h-full py-6 px-4">
      {/* Logo */}
      <div className="mb-8 px-1">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">SS</span>
          </div>
          <span className="font-bold text-gray-900">SnapState</span>
        </div>
        <p className="text-xs text-gray-500 mt-1 px-0.5">Developer Documentation</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto">
        {NAV.map((group, gi) => (
          <div key={gi}>
            {group.section && (
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">
                {group.section}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarLink key={item.to} to={item.to} label={item.label} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="mt-6 px-3 pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">v3.0.0</p>
        <a href="/dashboard/" className="text-xs text-indigo-600 hover:underline mt-1 block">
          → Admin Dashboard
        </a>
      </div>
    </div>
  );
}

export function DocsLayout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-gray-200 bg-white fixed h-full">
        <Sidebar />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-gray-900/50" />
          <aside className="relative w-64 bg-white h-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <Sidebar onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 md:ml-64">
        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-gray-500 hover:text-gray-700"
          >
            ☰
          </button>
          <span className="font-bold text-gray-900 text-sm">SnapState Docs</span>
        </div>

        {/* Page content */}
        <main className="max-w-3xl mx-auto px-6 md:px-10 py-10 md:py-14">
          {children}
        </main>
      </div>
    </div>
  );
}
