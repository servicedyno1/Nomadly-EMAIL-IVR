import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cp } from '../paths';
import { Wordmark } from '../Brand';

const BASE = `${window.location.origin}/cloudivr-web`;

const START = `curl -X POST ${BASE}/v1/calls \\
  -H "Authorization: Bearer civr_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+14155550123",
    "connectTo": "+18005550100",
    "from": "+14155550100",
    "machine": "hangup",
    "metadata": { "leadId": "L-1042" }
  }'`;

const REPLY = `{
  "id": "call_3f9a…",
  "status": "queued",
  "to": "+14155550123",
  "connectTo": "+18005550100",
  "from": "+14155550100",
  "machine": "hangup",
  "metadata": { "leadId": "L-1042" }
}`;

const EVENT = `POST https://your-crm.example.com/cloudivr
X-CloudIVR-Event: api_call.completed
X-CloudIVR-Signature: <hex HMAC-SHA256 of the raw body with your signing secret>

{
  "id": "evt_…",
  "type": "api_call.completed",
  "created": "2026-11-20T14:12:09.000Z",
  "data": {
    "id": "call_3f9a…", "status": "completed", "outcome": "connected",
    "to": "+14155550123", "connectTo": "+18005550100",
    "answeredBy": "human", "duration": 184, "connectedDuration": 181,
    "metadata": { "leadId": "L-1042" }
  }
}`;

const FIELDS = [
  ['to', 'required', 'The lead’s number with country code.'],
  ['connectTo', 'required', 'Where the call goes the moment the lead answers — e.g. your agents’ toll-free number.'],
  ['from', 'optional', 'One of your CloudIVR numbers to call from. Default: the one set in Settings → API.'],
  ['showAs', 'optional', 'A caller ID you verified in CloudIVR, shown instead of the from number.'],
  ['machine', 'optional', '"hangup" (default): when voicemail answers, end the call and report it. "connect": connect every answered call.'],
  ['metadata', 'optional', 'Any JSON object (under 2,000 characters), sent back in every update — e.g. your lead id.'],
];

const STEPS = [
  ['api_call.ringing', 'The lead’s phone is ringing.'],
  ['api_call.answered', 'The lead answered (answeredBy: human or machine).'],
  ['api_call.connected', 'Your agent line picked up and the two are talking.'],
  ['api_call.completed', 'The call ended. outcome: connected, voicemail, no_answer, busy, agent_no_answer or hung_up.'],
];

const ERRORS = [
  ['401 invalid_api_key', 'Missing or wrong key.'],
  ['403 api_not_enabled', 'The account has no API access (Enterprise, or Business + API add-on).'],
  ['400 invalid_to / invalid_connect_to / invalid_from', 'A number is missing, not in +country format, or not yours.'],
  ['402 insufficient_balance', 'The wallet can’t cover a minute of the call.'],
  ['409 do_not_call', 'The lead is on your do-not-call list.'],
  ['424 call_failed', 'The call could not be placed (message says why).'],
];

const Code = ({ children, testid }) => <pre className="bg-slate-900 text-slate-100 text-xs sm:text-sm rounded-xl p-4 overflow-x-auto" data-testid={testid}><code>{children}</code></pre>;
const H2 = ({ children }) => <h2 className="text-base md:text-lg font-semibold text-slate-900 mt-10 mb-3">{children}</h2>;

export default function ApiDocs() {
  return (
    <div className="min-h-screen bg-white text-slate-700" data-testid="api-docs-page">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-slate-200/80">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Link to={cp()} className="font-display text-2xl font-extrabold mr-auto flex items-center gap-2" data-testid="api-docs-logo-link"><Wordmark accent="#059669" iconClass="w-7 h-7" /></Link>
          <Link to={cp('/app/settings#settings-api')} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 py-3" data-testid="api-docs-settings-link"><ArrowLeft className="w-4 h-4" />Settings → API</Link>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">CRM calling API</h1>
        <p className="mt-4 text-base">Your CRM starts a call to a lead with one request. The moment the lead answers — no key to press — the call is connected to your agent line, showing your CloudIVR number or a verified caller ID. Each step is sent to your webhook.</p>
        <p className="mt-3 text-sm text-slate-500">Included with the Enterprise plan; on Business it’s a $99/month add-on. Both call legs (lead + agent line) are billed from your wallet at the normal per-minute rates. Only call people who agreed to hear from you.</p>

        <H2>1. Get a key</H2>
        <p className="text-sm">In CloudIVR: Settings → API → New key. It’s shown once — store it in your CRM. Send it on every request as <code className="bg-slate-100 px-1 rounded">Authorization: Bearer civr_live_…</code>.</p>

        <H2>2. Start a call</H2>
        <Code testid="api-docs-start">{START}</Code>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm" data-testid="api-docs-fields"><tbody>
          {FIELDS.map(([k, req, d]) => <tr key={k} className="border-t border-slate-200"><td className="py-2 pr-3 font-mono text-slate-900">{k}</td><td className="py-2 pr-3 text-xs text-slate-500">{req}</td><td className="py-2">{d}</td></tr>)}
        </tbody></table></div>
        <p className="mt-4 text-sm">Reply <code className="bg-slate-100 px-1 rounded">201</code>:</p>
        <Code testid="api-docs-reply">{REPLY}</Code>
        <p className="mt-3 text-sm">Check a call any time: <code className="bg-slate-100 px-1 rounded">GET {BASE}/v1/calls/&#123;id&#125;</code>. Your numbers: <code className="bg-slate-100 px-1 rounded">GET {BASE}/v1/numbers</code>.</p>

        <H2>3. Receive updates</H2>
        <p className="text-sm">Add your https URL in Settings → Notifications &amp; integrations → Webhooks and switch it on. Updates for API calls are always sent there:</p>
        <ul className="mt-3 space-y-1.5 text-sm" data-testid="api-docs-events">{STEPS.map(([k, d]) => <li key={k}><span className="font-mono text-slate-900">{k}</span> — {d}</li>)}</ul>
        <div className="mt-4"><Code testid="api-docs-event">{EVENT}</Code></div>
        <p className="mt-3 text-sm">Check the signature: HMAC-SHA256 of the raw body with your signing secret, hex — compare it with <code className="bg-slate-100 px-1 rounded">X-CloudIVR-Signature</code>.</p>

        <H2>Errors</H2>
        <ul className="space-y-1.5 text-sm" data-testid="api-docs-errors">{ERRORS.map(([k, d]) => <li key={k}><span className="font-mono text-slate-900">{k}</span> — {d}</li>)}</ul>
        <p className="mt-10 text-xs text-slate-500">There is no limit on how many calls run at once; each needs enough in the wallet for its first minute.</p>
      </main>
    </div>
  );
}
