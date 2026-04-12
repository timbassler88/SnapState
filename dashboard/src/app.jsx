import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Layout } from './components/Layout.jsx';
import { Overview } from './pages/Overview.jsx';
import { Workflows } from './pages/Workflows.jsx';
import { ApiKeys } from './pages/ApiKeys.jsx';
import { Billing } from './pages/Billing.jsx';
import { Analytics } from './pages/Analytics.jsx';

function App() {
  const [page, setPage] = useState('overview');

  const pageMap = {
    overview: <Overview />,
    workflows: <Workflows />,
    apikeys: <ApiKeys />,
    billing: <Billing />,
    analytics: <Analytics />,
  };

  return (
    <Layout page={page} onNav={setPage}>
      {pageMap[page] ?? <Overview />}
    </Layout>
  );
}

createRoot(document.getElementById('root')).render(<App />);
