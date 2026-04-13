import { useState } from 'react';
import { callApi } from '../lib/api.js';

const ENDPOINTS = [
  { label: 'POST /checkpoints', method: 'POST', path: '/checkpoints',
    defaultBody: '{\n  "workflow_id": "wf_test",\n  "step": 1,\n  "state": { "progress": 0 }\n}' },
  { label: 'GET /workflows/:id/resume', method: 'GET', path: '/workflows/wf_test/resume', defaultBody: '' },
  { label: 'GET /workflows/:id/replay', method: 'GET', path: '/workflows/wf_test/replay', defaultBody: '' },
  { label: 'POST /agents', method: 'POST', path: '/agents',
    defaultBody: '{\n  "agent_id": "my-bot",\n  "name": "My Bot",\n  "capabilities": ["search"]\n}' },
  { label: 'GET /agents', method: 'GET', path: '/agents', defaultBody: '' },
  { label: 'GET /analytics/overview', method: 'GET', path: '/analytics/overview', defaultBody: '' },
  { label: 'GET /health', method: 'GET', path: '/health', defaultBody: '' },
];

export function TryIt() {
  const [baseUrl, setBaseUrl] = useState('https://snapstate.dev');
  const [apiKey, setApiKey] = useState('');
  const [endpointIdx, setEndpointIdx] = useState(0);
  const [customPath, setCustomPath] = useState('');
  const [body, setBody] = useState(ENDPOINTS[0].defaultBody);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const endpoint = ENDPOINTS[endpointIdx];

  const handleEndpointChange = (idx) => {
    setEndpointIdx(idx);
    setBody(ENDPOINTS[idx].defaultBody);
    setCustomPath('');
    setResult(null);
  };

  const handleSend = async () => {
    setLoading(true);
    setResult(null);
    const res = await callApi({
      baseUrl,
      apiKey,
      method: endpoint.method,
      path: customPath || endpoint.path,
      body: endpoint.method !== 'GET' ? body : undefined,
    });
    setResult(res);
    setLoading(false);
  };

  const statusColor = (status) => {
    if (!status) return 'text-gray-400';
    if (status < 300) return 'text-emerald-600';
    if (status < 400) return 'text-amber-600';
    return 'text-red-600';
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-700">Try It</span>
        <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
          Sends real requests to your server
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Config row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Server URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="https://snapstate.dev"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="snp_..."
            />
          </div>
        </div>

        {/* Endpoint selection */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Endpoint</label>
          <select
            value={endpointIdx}
            onChange={(e) => handleEndpointChange(Number(e.target.value))}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {ENDPOINTS.map((ep, i) => (
              <option key={i} value={i}>{ep.label}</option>
            ))}
          </select>
        </div>

        {/* Custom path override */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Path <span className="text-gray-400">(override)</span>
          </label>
          <input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={endpoint.path}
          />
        </div>

        {/* Body (POST/PATCH only) */}
        {endpoint.method !== 'GET' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Request Body (JSON)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={loading}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium text-sm rounded-lg transition-colors"
        >
          {loading ? 'Sending…' : `Send ${endpoint.method} Request`}
        </button>

        {/* Response */}
        {result && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-sm font-bold ${statusColor(result.status)}`}>
                {result.status} {result.statusText}
              </span>
              <span className="text-xs text-gray-400">{result.elapsed}ms</span>
            </div>
            {result.error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                {result.error}
              </div>
            ) : (
              <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                  {JSON.stringify(result.body, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
