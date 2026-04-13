import { CodeBlock } from '../components/CodeBlock.jsx';

function H1({ c }) { return <h1 className="text-3xl font-bold text-gray-900 mb-3">{c}</h1>; }
function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-3 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600">{children}</a>
    </h2>
  );
}
function H3({ children }) { return <h3 className="text-base font-semibold text-gray-800 mt-6 mb-2">{children}</h3>; }
function P({ children }) { return <p className="text-gray-600 leading-relaxed mb-3">{children}</p>; }

const TOOLS_TABLE = [
  { name: 'save_checkpoint', required: 'workflow_id, step, state', optional: 'label, agent_id, metadata', desc: 'Save workflow state after a step' },
  { name: 'resume_workflow', required: 'workflow_id', optional: '—', desc: 'Get the latest checkpoint to resume from' },
  { name: 'get_workflow_history', required: 'workflow_id', optional: 'from_step, to_step, limit', desc: 'Retrieve the full checkpoint history' },
  { name: 'register_agent', required: 'agent_id, name', optional: 'capabilities', desc: 'Register this agent with the service' },
];

export function McpSetup() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">MCP Server Setup</h1>
      <P>
        The SnapState MCP server exposes checkpoint operations as tools that any MCP-compatible
        agent (Claude Desktop, Cline, Cursor) can call. This lets agents save and resume work
        across sessions without writing any integration code.
      </P>

      <H2 id="what-is-mcp">What is MCP?</H2>
      <P>
        The Model Context Protocol (MCP) is an open standard for connecting AI agents to tools
        and services via a consistent interface. Claude Desktop, Cline, and other hosts support
        MCP servers as subprocess or HTTP+SSE transports.
      </P>

      <H2 id="install">Install the MCP server</H2>
      <CodeBlock language="bash" code={`# From the project root
cd mcp-server
npm install`} />

      <H2 id="claude-desktop">Claude Desktop configuration</H2>
      <P>
        Add the SnapState server to your{' '}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">claude_desktop_config.json</code>:
      </P>
      <CodeBlock language="json" code={`{
  "mcpServers": {
    "snapstate": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/src/index.js"],
      "env": {
        "SNAPSTATE_API_URL": "https://snapstate.dev",
        "SNAPSTATE_API_KEY": "snp_your_key_here"
      }
    }
  }
}`} />
      <P>
        Config file location: macOS: <code className="bg-gray-100 px-1 rounded text-sm">~/Library/Application Support/Claude/claude_desktop_config.json</code>
        &nbsp;· Windows: <code className="bg-gray-100 px-1 rounded text-sm">%APPDATA%\Claude\claude_desktop_config.json</code>
      </P>

      <H2 id="cline">Cline / VS Code configuration</H2>
      <P>In Cline's MCP settings, add a new server entry:</P>
      <CodeBlock language="json" code={`{
  "name": "snapstate",
  "command": "node",
  "args": ["/absolute/path/to/mcp-server/src/index.js"],
  "env": {
    "SNAPSTATE_API_URL": "https://snapstate.dev",
    "SNAPSTATE_API_KEY": "snp_your_key_here"
  }
}`} />

      <H2 id="tools">Available tools</H2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 my-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Tool</th>
              <th className="px-4 py-2 text-left">Required params</th>
              <th className="px-4 py-2 text-left">Optional params</th>
              <th className="px-4 py-2 text-left">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {TOOLS_TABLE.map((t) => (
              <tr key={t.name} className="hover:bg-gray-50">
                <td className="px-4 py-2"><code className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{t.name}</code></td>
                <td className="px-4 py-2 text-gray-600 text-xs font-mono">{t.required}</td>
                <td className="px-4 py-2 text-gray-400 text-xs font-mono">{t.optional}</td>
                <td className="px-4 py-2 text-gray-600 text-xs">{t.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="example">Example conversation flow</H2>
      <P>Here's how an agent uses Checkpoint across two sessions:</P>
      <div className="space-y-3 my-4">
        {[
          { speaker: 'Human', msg: 'Research quantum computing breakthroughs in 2025 and write a summary.' },
          { speaker: 'Claude', msg: '[Calls resume_workflow("wf_quantum_research")] → No prior state found. Starting fresh.' },
          { speaker: 'Claude', msg: '[Searches sources, gathers findings] [Calls save_checkpoint with step 1, state containing sources and raw data]' },
          { speaker: 'Human', msg: '(session ends)' },
          { speaker: 'Human', msg: 'Continue the quantum computing research.' },
          { speaker: 'Claude', msg: '[Calls resume_workflow("wf_quantum_research")] → Resuming from step 1. Found 12 sources. Continuing to draft...' },
        ].map((item, i) => (
          <div key={i} className={`flex gap-3 text-sm ${item.speaker === 'Human' ? '' : ''}`}>
            <span className={`font-semibold flex-shrink-0 w-16 text-right ${item.speaker === 'Human' ? 'text-gray-500' : 'text-indigo-600'}`}>
              {item.speaker}
            </span>
            <span className="text-gray-700">{item.msg}</span>
          </div>
        ))}
      </div>

      <H2 id="troubleshooting">Troubleshooting</H2>
      <H3>Server not appearing in Claude Desktop</H3>
      <P>Restart Claude Desktop after editing the config file. Check the path to <code className="bg-gray-100 px-1 rounded text-sm">index.js</code> — it must be absolute, not relative.</P>
      <H3>ENOENT or path errors on Windows</H3>
      <P>Use forward slashes or escaped backslashes in the config path. The <code className="bg-gray-100 px-1 rounded text-sm">command</code> should be <code className="bg-gray-100 px-1 rounded text-sm">"node"</code> (not <code className="bg-gray-100 px-1 rounded text-sm">"node.exe"</code>).</P>
      <H3>API key rejected</H3>
      <P>Make sure the server is running (<code className="bg-gray-100 px-1 rounded text-sm">npm start</code> in the <code className="bg-gray-100 px-1 rounded text-sm">server/</code> directory) and the key in <code className="bg-gray-100 px-1 rounded text-sm">SNAPSTATE_API_KEY</code> matches one issued by that server.</P>
      <H3>Tools not listed by the agent</H3>
      <P>Check the MCP server logs — they are emitted to stderr. If the server panics on startup, verify <code className="bg-gray-100 px-1 rounded text-sm">SNAPSTATE_API_URL</code> points to the correct host and port.</P>
    </div>
  );
}
