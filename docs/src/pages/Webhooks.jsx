import { CodeBlock } from '../components/CodeBlock.jsx';

function H2({ id, children }) {
  return (
    <h2 id={id} className="text-xl font-bold text-gray-900 mt-10 mb-3 scroll-mt-8 pb-2 border-b border-gray-100">
      <a href={`#${id}`} className="hover:text-indigo-600">{children}</a>
    </h2>
  );
}
function P({ children }) { return <p className="text-gray-600 leading-relaxed mb-3">{children}</p>; }

const EVENTS = [
  { event: 'checkpoint.saved', when: 'A new checkpoint is saved', payload: 'workflow_id, checkpoint_id, step' },
  { event: 'workflow.resumed', when: 'GET /workflows/:id/resume is called', payload: 'workflow_id, step' },
  { event: 'workflow.archived', when: 'A workflow is moved to cold storage (R2)', payload: 'workflow_id, archived_at' },
  { event: 'workflow.expired', when: 'A workflow TTL expires and is purged from Redis', payload: 'workflow_id' },
];

const REGISTER_TABS = [
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `const webhook = await client.registerWebhook({
  url: 'https://example.com/checkpoint-hook',
  events: ['checkpoint.saved', 'workflow.resumed'],
  secret: process.env.WEBHOOK_SECRET, // optional HMAC signing
});
console.log('Registered:', webhook.webhookId);

// Remove later
await client.deleteWebhook(webhook.webhookId);`,
  },
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST https://snapstate.dev/webhooks \\
  -H "Authorization: Bearer snp_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/hook",
    "events": ["checkpoint.saved"],
    "secret": "your_signing_secret"
  }'`,
  },
];

const VERIFY_TABS = [
  {
    label: 'Node.js / Express',
    language: 'javascript',
    code: `import crypto from 'crypto';
import express from 'express';

const app = express();
app.use(express.raw({ type: 'application/json' }));

app.post('/checkpoint-hook', (req, res) => {
  const signature = req.headers['x-checkpoint-signature'];
  const expected = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (signature !== expected) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body);
  console.log('Event:', event.event, event.data);
  res.sendStatus(200);
});`,
  },
  {
    label: 'Python / FastAPI',
    language: 'python',
    code: `import hmac, hashlib, os
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()
SECRET = os.environ["WEBHOOK_SECRET"]

@app.post("/checkpoint-hook")
async def handle_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("x-checkpoint-signature", "")
    expected = hmac.new(
        SECRET.encode(), body, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = await request.json()
    print(f"Event: {event['event']}", event["data"])
    return {"ok": True}`,
  },
];

export function Webhooks() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Webhooks</h1>
      <P>
        Receive real-time event notifications when checkpoints are saved, workflows are
        resumed, or workflows expire. Webhooks use HTTPS POST with optional HMAC-SHA256 signing.
      </P>

      <H2 id="events">Available events</H2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 my-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Event</th>
              <th className="px-4 py-2 text-left">When it fires</th>
              <th className="px-4 py-2 text-left">Payload fields</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {EVENTS.map((e) => (
              <tr key={e.event} className="hover:bg-gray-50">
                <td className="px-4 py-2"><code className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{e.event}</code></td>
                <td className="px-4 py-2 text-gray-600 text-xs">{e.when}</td>
                <td className="px-4 py-2 text-gray-400 font-mono text-xs">{e.payload}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="register">Registering a webhook</H2>
      <CodeBlock tabs={REGISTER_TABS} />

      <H2 id="payload">Webhook payload format</H2>
      <P>Checkpoint POSTs a JSON body to your URL on each event:</P>
      <CodeBlock language="json" code={JSON.stringify({
        event: 'checkpoint.saved',
        timestamp: '2026-04-11T00:01:30Z',
        data: {
          workflow_id: 'wf_001',
          checkpoint_id: 'cp_wf_001_0003',
          step: 3,
        },
      }, null, 2)} />
      <P>
        The request also includes a{' '}
        <code className="bg-gray-100 px-1 rounded text-sm">Content-Type: application/json</code> header
        and, when a secret is configured, an{' '}
        <code className="bg-gray-100 px-1 rounded text-sm">X-Checkpoint-Signature</code> header containing
        the HMAC-SHA256 hex digest of the raw request body.
      </P>

      <H2 id="verify">Signature verification</H2>
      <P>
        Always verify the signature before processing webhook events. Use a constant-time
        comparison (<code className="bg-gray-100 px-1 rounded text-sm">crypto.timingSafeEqual</code> or{' '}
        <code className="bg-gray-100 px-1 rounded text-sm">hmac.compare_digest</code>) to prevent timing attacks.
      </P>
      <CodeBlock tabs={VERIFY_TABS} />

      <H2 id="retry">Retry policy</H2>
      <P>
        Webhooks are fire-and-forget with a 5-second timeout. If your endpoint returns a
        non-2xx status or times out, the delivery is not automatically retried — design your
        consumer to be idempotent and poll the API for missed events if needed.
      </P>

      <H2 id="best-practices">Best practices</H2>
      <ul className="space-y-2 text-sm text-gray-600 leading-relaxed">
        {[
          ['Respond quickly', 'Return 200 as fast as possible; process the event asynchronously. Slow responses may time out.'],
          ['Be idempotent', 'The same event may be delivered more than once in edge cases. Use the checkpoint_id or workflow_id as an idempotency key.'],
          ['Verify signatures', 'Always validate X-Checkpoint-Signature when a secret is configured. Reject invalid requests before processing.'],
          ['Use HTTPS', 'Webhook URLs must be accessible over HTTPS to protect payload data in transit.'],
        ].map(([title, desc]) => (
          <li key={title} className="flex gap-2">
            <span className="text-indigo-500">▸</span>
            <span><strong className="text-gray-800">{title}:</strong> {desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
