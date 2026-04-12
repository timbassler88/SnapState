import { useState } from 'react';

function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-4 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600">{children}</a>
    </h2>
  );
}
function P({ children }) { return <p className="text-gray-600 leading-relaxed mb-3">{children}</p>; }

const FREE_TIERS = {
  writes: 10_000,
  storageGb: 1,
  resumes: 5_000,
  replays: 1_000,
};

const PRICES = {
  writes: 0.001,       // per write
  storageGb: 0.10,     // per GB-month
  resumes: 0.0005,     // per call
  replays: 0.002,      // per call
};

function SliderRow({ label, value, onChange, min, max, step, format }) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-sm font-semibold text-indigo-700">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
      />
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

function fmt(n, suffix = '') {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${suffix}`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k${suffix}`;
  return `${n}${suffix}`;
}

function Calculator() {
  const [writes, setWrites] = useState(50_000);
  const [storage, setStorage] = useState(5);
  const [resumes, setResumes] = useState(20_000);
  const [replays, setReplays] = useState(3_000);

  const billableWrites = Math.max(0, writes - FREE_TIERS.writes);
  const billableStorage = Math.max(0, storage - FREE_TIERS.storageGb);
  const billableResumes = Math.max(0, resumes - FREE_TIERS.resumes);
  const billableReplays = Math.max(0, replays - FREE_TIERS.replays);

  const writesCost = billableWrites * PRICES.writes;
  const storageCost = billableStorage * PRICES.storageGb;
  const resumesCost = billableResumes * PRICES.resumes;
  const replaysCost = billableReplays * PRICES.replays;
  const total = writesCost + storageCost + resumesCost + replaysCost;

  const lineItems = [
    { label: 'Checkpoint writes', qty: writes, free: FREE_TIERS.writes, billable: billableWrites, cost: writesCost, unit: 'writes' },
    { label: 'Storage', qty: storage, free: FREE_TIERS.storageGb, billable: billableStorage, cost: storageCost, unit: 'GB' },
    { label: 'Resume calls', qty: resumes, free: FREE_TIERS.resumes, billable: billableResumes, cost: resumesCost, unit: 'calls' },
    { label: 'Replay calls', qty: replays, free: FREE_TIERS.replays, billable: billableReplays, cost: replaysCost, unit: 'calls' },
  ];

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
        <h3 className="font-semibold text-gray-800">Monthly Cost Calculator</h3>
        <p className="text-xs text-gray-500 mt-0.5">Free tier deducted automatically</p>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Sliders */}
        <div>
          <SliderRow label="Checkpoint writes / month" value={writes} onChange={setWrites}
            min={0} max={500_000} step={5_000} format={(v) => fmt(v)} />
          <SliderRow label="Storage (GB)" value={storage} onChange={setStorage}
            min={0} max={100} step={1} format={(v) => `${v} GB`} />
          <SliderRow label="Resume calls / month" value={resumes} onChange={setResumes}
            min={0} max={200_000} step={5_000} format={(v) => fmt(v)} />
          <SliderRow label="Replay calls / month" value={replays} onChange={setReplays}
            min={0} max={50_000} step={1_000} format={(v) => fmt(v)} />
        </div>

        {/* Breakdown */}
        <div>
          <table className="w-full text-sm mb-4">
            <thead className="text-xs text-gray-500 uppercase border-b border-gray-100">
              <tr>
                <th className="text-left pb-2">Item</th>
                <th className="text-right pb-2">Billable</th>
                <th className="text-right pb-2">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lineItems.map((li) => (
                <tr key={li.label}>
                  <td className="py-2 text-gray-700 text-xs">{li.label}</td>
                  <td className="py-2 text-right text-gray-500 text-xs">
                    {li.billable > 0 ? fmt(li.billable, ` ${li.unit}`) : <span className="text-emerald-600">Free</span>}
                  </td>
                  <td className="py-2 text-right font-medium text-xs">
                    {li.cost > 0 ? `$${li.cost.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
            <p className="text-xs text-indigo-600 mb-1">Estimated monthly total</p>
            <p className="text-3xl font-bold text-indigo-700">
              {total === 0 ? 'Free' : `$${total.toFixed(2)}`}
            </p>
            {total === 0 && (
              <p className="text-xs text-indigo-500 mt-1">All usage within free tier</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const FAQS = [
  {
    q: 'What counts as a checkpoint write?',
    a: 'Each successful POST /checkpoints request counts as one write, regardless of payload size (up to the 1 MB limit). Failed requests due to ETag conflicts or validation errors do not count.',
  },
  {
    q: 'How is storage measured?',
    a: 'Storage is the compressed size of all checkpoint state stored in R2 cold storage (workflows that have been archived). Active workflows in Redis are not counted toward storage billing.',
  },
  {
    q: 'What happens when I hit the free tier limit?',
    a: 'The API continues to function but requests above the free tier are metered and billed at the usage rates shown above. There is no hard cutoff or service interruption.',
  },
  {
    q: 'Can I upgrade or downgrade at any time?',
    a: 'Billing is fully usage-based — there are no plans or tiers to upgrade. You pay only for what you use above the free allowance, billed monthly.',
  },
  {
    q: 'Is there a free tier for agent registrations?',
    a: 'Agent registration (POST /agents) is always free. You are limited to 50 registered agents per account by default; contact us to increase this limit.',
  },
];

export function Pricing() {
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Pricing</h1>
      <P>Simple, usage-based pricing. A generous free tier covers most development and small production workloads.</P>

      {/* Free tier card */}
      <div className="border-2 border-indigo-200 bg-indigo-50/40 rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded">Free</span>
          <span className="text-gray-600 text-sm">No credit card required</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Checkpoint writes', value: '10,000 / mo' },
            { label: 'Storage', value: '1 GB' },
            { label: 'Resume calls', value: '5,000 / mo' },
            { label: 'Replay calls', value: '1,000 / mo' },
          ].map((item) => (
            <div key={item.label} className="text-center">
              <p className="text-lg font-bold text-indigo-700">{item.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing table */}
      <H2 id="rates">Usage rates (beyond free tier)</H2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 mb-8">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-5 py-3 text-left">Service</th>
              <th className="px-5 py-3 text-right">Price</th>
              <th className="px-5 py-3 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[
              { svc: 'Checkpoint writes', price: '$0.001 / write', note: 'Each POST /checkpoints call above the free tier' },
              { svc: 'Storage', price: '$0.10 / GB·month', note: 'Compressed size in cold storage (R2)' },
              { svc: 'Resume calls', price: '$0.0005 / call', note: 'Each GET /workflows/:id/resume above free tier' },
              { svc: 'Replay calls', price: '$0.002 / call', note: 'Each GET /workflows/:id/replay above free tier' },
            ].map((r) => (
              <tr key={r.svc} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-medium text-gray-800">{r.svc}</td>
                <td className="px-5 py-3 text-right font-mono text-indigo-700 font-semibold">{r.price}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="calculator">Cost calculator</H2>
      <Calculator />

      <H2 id="faq">Frequently asked questions</H2>
      <div className="space-y-2 mt-4">
        {FAQS.map((faq, i) => (
          <div key={i} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="font-medium text-gray-800 text-sm">{faq.q}</span>
              <span className="text-gray-400 ml-4 flex-shrink-0">{openFaq === i ? '▲' : '▼'}</span>
            </button>
            {openFaq === i && (
              <div className="px-5 pb-4 text-gray-600 text-sm leading-relaxed border-t border-gray-100">
                {faq.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
