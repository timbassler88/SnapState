import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { DocsLayout } from './components/DocsLayout.jsx';
import { GettingStarted } from './pages/GettingStarted.jsx';
import { ApiReference } from './pages/ApiReference.jsx';
import { JsSdk } from './pages/JsSdk.jsx';
import { PythonSdk } from './pages/PythonSdk.jsx';
import { McpSetup } from './pages/McpSetup.jsx';
import { AgentIdentity } from './pages/AgentIdentity.jsx';
import { AgentIntegration } from './pages/AgentIntegration.jsx';
import { Webhooks } from './pages/Webhooks.jsx';
import { Pricing } from './pages/Pricing.jsx';

function App() {
  return (
    <HashRouter>
      <DocsLayout>
        <Routes>
          <Route path="/" element={<GettingStarted />} />
          <Route path="/api" element={<ApiReference />} />
          <Route path="/sdk/javascript" element={<JsSdk />} />
          <Route path="/sdk/python" element={<PythonSdk />} />
          <Route path="/guides/mcp" element={<McpSetup />} />
          <Route path="/guides/agents" element={<AgentIdentity />} />
          <Route path="/guides/integration" element={<AgentIntegration />} />
          <Route path="/guides/webhooks" element={<Webhooks />} />
          <Route path="/pricing" element={<Pricing />} />
        </Routes>
      </DocsLayout>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')).render(<App />);
