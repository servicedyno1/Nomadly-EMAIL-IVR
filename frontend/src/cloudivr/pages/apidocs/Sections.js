import React from 'react';
import { KeyRound, PhoneCall, MessageSquare, Webhook } from 'lucide-react';
import { CodeTabs, CopyBtn } from './CodeTabs';
import { BASE } from './snippets';
import { PRICES, EVENTS, EVENT, VERIFY, ERRORS } from './content';

const C = ({ children }) => <code className="bg-slate-100 text-slate-900 px-1.5 py-0.5 rounded text-[0.85em]">{children}</code>;
const Block = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-24 py-10 border-t border-slate-200" data-testid={`api-docs-${id}`}>
    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
    <div className="mt-4 text-sm leading-relaxed text-slate-600 space-y-4">{children}</div>
  </section>
);

const CAPS = [
  [PhoneCall, 'Click-to-call', 'Ring a lead and connect them to your agents the moment they answer.'],
  [MessageSquare, 'Texts & campaigns', 'One-off texts or 500+ campaigns to USA & Canada mobiles.'],
  [Webhook, 'Live updates', 'Every call step is posted to your webhook, signed.'],
];

export const Overview = () => (
  <section id="overview" className="scroll-mt-24 pb-10" data-testid="api-docs-overview">
    <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">CloudIVR API · v1</div>
    <h1 className="mt-2 text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">Calls and texts from your CRM</h1>
    <p className="mt-4 text-base text-slate-600 max-w-2xl">A small JSON API: start a call that connects your lead to an agent, send a text, or launch a text campaign — paid from your CloudIVR wallet.</p>
    <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3" data-testid="api-docs-base-url">
      <span className="text-xs text-slate-500">Base URL</span><code className="font-mono text-sm text-slate-900 break-all mr-auto">{BASE}</code>
      <div className="bg-slate-900 rounded-md"><CopyBtn text={BASE} testid="api-docs-base-copy" /></div>
    </div>
    <div className="mt-6 grid sm:grid-cols-3 gap-3">{CAPS.map(([I, t, d]) => (
      <div key={t} className="rounded-xl ring-1 ring-slate-200 p-4 hover:ring-emerald-300 transition-shadow"><I className="w-5 h-5 text-emerald-600" /><div className="mt-2 font-semibold text-slate-900 text-sm">{t}</div><div className="mt-1 text-xs text-slate-500">{d}</div></div>
    ))}</div>
  </section>
);

export const Auth = () => (
  <Block id="auth" title="Authentication">
    <p>Create a key in CloudIVR under <b>Settings → API → New key</b>. It’s shown once — store it in your CRM’s secrets, never in browser code.</p>
    <p>Send it on every request. All bodies are JSON; all numbers use <C>+country</C> format.</p>
    <CodeTabs samples={{ Header: 'Authorization: Bearer civr_live_YOUR_KEY\nContent-Type: application/json' }} testid="api-docs-auth-header" />
    <p className="flex items-start gap-2 text-xs text-slate-500"><KeyRound className="w-4 h-4 shrink-0" />Lost or leaked a key? Delete it in Settings → API — it stops working at once — and create a new one.</p>
  </Block>
);

export const Pricing = () => (
  <Block id="pricing" title="Pricing">
    <p>Everything is paid from your CloudIVR wallet. You are never charged when a request is refused.</p>
    <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-200" data-testid="api-docs-sms-prices">{PRICES.map(([k, p, d]) => (
      <div key={k} className="grid sm:grid-cols-[140px_120px_1fr] gap-1 sm:gap-4 px-4 py-3"><span className="font-medium text-slate-900">{k}</span><span className="font-mono text-emerald-700">{p}</span><span className="text-slate-500">{d}</span></div>
    ))}</div>
    <p className="text-xs text-slate-500">Only call or text people who agreed to hear from you. Scam, prize and phishing texts are refused automatically.</p>
  </Block>
);

export const Webhooks = () => (
  <Block id="webhooks" title="Webhooks">
    <p>Add your https URL in <b>Settings → Notifications &amp; integrations → Webhooks</b> and switch it on. Every API call posts these events:</p>
    <ul className="space-y-2" data-testid="api-docs-events">{EVENTS.map(([k, d]) => <li key={k} className="flex flex-col sm:flex-row sm:gap-3"><span className="font-mono text-slate-900 sm:w-48 shrink-0">{k}</span><span>{d}</span></li>)}</ul>
    <CodeTabs title="Example delivery" samples={{ HTTP: EVENT }} testid="api-docs-event" />
    <p>Check <C>X-CloudIVR-Signature</C>: the hex HMAC-SHA256 of the raw body with your signing secret.</p>
    <CodeTabs title="Verify the signature" samples={VERIFY} testid="api-docs-verify" />
    <p className="text-xs text-slate-500">Text campaigns don’t post webhooks yet — poll <C>GET /v1/sms/campaigns/&#123;id&#125;</C> for progress.</p>
  </Block>
);

export const Errors = () => (
  <Block id="errors" title="Errors">
    <p>Errors return an HTTP status and a JSON body: <C>{'{ "error": "low_balance", "message": "…" }'}</C>. Show <C>message</C> to people; branch on <C>error</C> in code.</p>
    <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-200" data-testid="api-docs-errors">{ERRORS.map(([s, k, d]) => (
      <div key={s + k} className="grid sm:grid-cols-[56px_260px_1fr] gap-1 sm:gap-4 px-4 py-3"><span className={`font-mono font-semibold ${s >= '500' ? 'text-rose-600' : s >= '402' ? 'text-amber-600' : 'text-slate-900'}`}>{s}</span><span className="font-mono text-slate-900 text-xs sm:text-sm">{k}</span><span className="text-slate-500">{d}</span></div>
    ))}</div>
    <p className="text-xs text-slate-500">There is no limit on how many calls run at once; each needs enough in the wallet for its first minute.</p>
  </Block>
);
