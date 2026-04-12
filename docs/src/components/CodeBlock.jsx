import { useState, useEffect, useRef } from 'react';

/**
 * CodeBlock — syntax-highlighted code with optional language tabs and copy button.
 *
 * Props:
 *   tabs: [{ label, language, code }]  — mutually exclusive with `code`
 *   code: string                        — single code block (no tabs)
 *   language: string                    — 'javascript' | 'python' | 'bash' | 'json'
 */
export function CodeBlock({ tabs, code, language = 'javascript' }) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef(null);

  const current = tabs ? tabs[activeTab] : { code, language };

  useEffect(() => {
    if (codeRef.current && typeof window !== 'undefined' && window.Prism) {
      window.Prism.highlightElement(codeRef.current);
    }
  }, [current.code, current.language]);

  const handleCopy = () => {
    navigator.clipboard.writeText(current.code ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 my-4 text-sm">
      {/* Tab bar */}
      {tabs && tabs.length > 1 && (
        <div className="flex items-center bg-gray-100 border-b border-gray-200 px-1">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === i
                  ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Code area */}
      <div className="relative bg-gray-900">
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 z-10 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-2 py-1 transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <div className="overflow-x-auto p-4 pr-16">
          <pre className={`language-${current.language}`} style={{ margin: 0, background: 'transparent' }}>
            <code ref={codeRef} className={`language-${current.language}`}>
              {current.code}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
