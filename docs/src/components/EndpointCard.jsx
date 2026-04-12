import { useState } from 'react';

const METHOD_COLORS = {
  GET:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  POST:   'bg-blue-100 text-blue-700 border-blue-200',
  PATCH:  'bg-amber-100 text-amber-700 border-amber-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
};

function Table({ headers, rows }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 my-3">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-gray-700">
                  {j === 0 ? <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{cell}</code> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * EndpointCard — documents a single API endpoint with collapsible sections.
 *
 * Props:
 *   method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
 *   path: string
 *   description: string
 *   headers: [{ name, required, description }]
 *   body: [{ field, type, required, description }]
 *   response: object (JSON example)
 *   errors: [{ code, status, description }]
 *   curl: string
 */
export function EndpointCard({ method, path, description, headers, body, response, errors, curl }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-gray-200 rounded-xl mb-4 overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <span className={`text-xs font-bold px-2 py-0.5 rounded border font-mono ${METHOD_COLORS[method] ?? 'bg-gray-100 text-gray-600'}`}>
          {method}
        </span>
        <code className="text-sm text-gray-800 font-mono flex-1">{path}</code>
        <span className="text-gray-400 text-sm flex-1 text-right truncate pr-4 hidden md:block">{description}</span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-5 space-y-5">
          <p className="text-gray-600 text-sm">{description}</p>

          {headers && headers.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Headers</h4>
              <Table
                headers={['Name', 'Required', 'Description']}
                rows={headers.map((h) => [h.name, h.required ? 'Yes' : 'No', h.description])}
              />
            </section>
          )}

          {body && body.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Request Body</h4>
              <Table
                headers={['Field', 'Type', 'Required', 'Description']}
                rows={body.map((f) => [f.field, f.type, f.required ? 'Yes' : 'No', f.description])}
              />
            </section>
          )}

          {response && (
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Response</h4>
              <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                  {JSON.stringify(response, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {errors && errors.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Error Codes</h4>
              <Table
                headers={['HTTP', 'Code', 'Description']}
                rows={errors.map((e) => [String(e.status), e.code, e.description])}
              />
            </section>
          )}

          {curl && (
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">cURL Example</h4>
              <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto relative group">
                <button
                  onClick={() => navigator.clipboard.writeText(curl)}
                  className="absolute top-2 right-2 text-xs text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 px-2 py-1 rounded"
                >
                  Copy
                </button>
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">{curl}</pre>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
