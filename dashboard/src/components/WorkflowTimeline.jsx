import { useState } from 'react';

/**
 * Vertical timeline of checkpoints for a single workflow.
 *
 * @param {{ checkpoints: Array<{ step: number, label: string, created_at: string, state: object }> }} props
 */
export function WorkflowTimeline({ checkpoints = [] }) {
  const [expanded, setExpanded] = useState(null);

  if (!checkpoints.length) {
    return <p className="text-gray-500 text-sm">No checkpoints available.</p>;
  }

  return (
    <ol className="relative border-l border-gray-700 ml-3">
      {checkpoints.map((cp) => (
        <li key={cp.checkpoint_id ?? cp.step} className="mb-6 ml-6">
          {/* Dot */}
          <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-indigo-900 rounded-full ring-2 ring-indigo-500 text-xs text-indigo-300 font-bold">
            {cp.step}
          </span>

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-200">
                {cp.label ?? `Step ${cp.step}`}
              </p>
              <time className="text-xs text-gray-500">
                {new Date(cp.created_at).toLocaleString()}
              </time>
            </div>
            <button
              className="text-xs text-indigo-400 hover:text-indigo-200 transition"
              onClick={() => setExpanded(expanded === cp.step ? null : cp.step)}
            >
              {expanded === cp.step ? 'hide state' : 'view state'}
            </button>
          </div>

          {/* State JSON */}
          {expanded === cp.step && (
            <pre className="mt-2 bg-gray-950 text-green-300 text-xs rounded-lg p-3 overflow-auto max-h-64 border border-gray-800">
              {JSON.stringify(cp.state, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}
