import React, { useState } from 'react';
import { toast } from 'sonner';
import { Webhook, Loader2, Copy, RefreshCw, Send, Eye, EyeOff } from 'lucide-react';
import { api, useApi, when } from '../../api';
import { Field, Toggle, Spinner } from '../../ui';
import { useUnsaved, SaveRow } from '../../guard';
import { ask } from '../../confirm';

const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied'), () => toast.error('Copy failed — select the text and copy it yourself.'));

function Secret({ secret, onRotate }) {
  const [show, setShow] = useState(false);
  if (!secret) return null;
  return (
    <Field label="Signing secret" hint="Each request has an X-CloudIVR-Signature header: the HMAC-SHA256 of the raw body with this secret.">
      <div className="flex flex-wrap items-center gap-2">
        <code className="civr-input font-mono text-xs !w-auto flex-1 min-w-0 truncate" data-testid="webhooks-secret">{show ? secret : `${secret.slice(0, 8)}••••••••••••`}</code>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !px-2" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide secret' : 'Show secret'} data-testid="webhooks-secret-toggle">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !px-2" onClick={() => copy(secret)} aria-label="Copy secret" data-testid="webhooks-secret-copy"><Copy className="w-4 h-4" /></button>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onRotate} data-testid="webhooks-secret-rotate"><RefreshCw className="w-4 h-4" />New secret</button>
      </div>
    </Field>
  );
}

function Deliveries({ list }) {
  if (!list?.length) return <div className="text-xs text-[#a1a1aa]" data-testid="webhooks-deliveries-empty">No events sent yet.</div>;
  return (
    <ul className="space-y-1.5 text-xs" data-testid="webhooks-deliveries">
      {list.slice(0, 6).map((d, i) => (
        <li key={d.eventId || i} className="flex flex-wrap items-center gap-2" data-testid={`webhooks-delivery-${i}`}>
          <span className={d.ok ? 'civr-pill civr-pill-on' : 'civr-pill civr-pill-bad'}>{d.ok ? `${d.status} OK` : d.error || 'Failed'}</span>
          <span className="font-mono">{d.type}</span>{d.test && <span className="civr-pill">test</span>}
          <span className="ml-auto text-[#a1a1aa]">{when(d.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function Form({ data, reload }) {
  const w = data.webhook;
  const [f, setF] = useState({ enabled: w.enabled, url: w.url || '', events: w.events || [] });
  const [busy, setBusy] = useState('');
  const u = useUnsaved(f);
  const toggleEvent = (k) => setF(x => ({ ...x, events: x.events.includes(k) ? x.events.filter(e => e !== k) : [...x.events, k] }));
  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { toast.error(e.message); } finally { setBusy(''); } };
  const save = () => run('save', async () => { await api('/webhooks', { method: 'PUT', body: f }); toast.success(f.enabled ? 'Event feed on' : 'Event feed saved (off)'); u.reset(); reload(); });
  const test = () => run('test', async () => { const d = await api('/webhooks/test', { method: 'POST', body: { type: f.events[0] || 'call.ended' } }); d.ok ? toast.success(`Test event delivered (${d.status})`) : toast.error(`Your URL answered: ${d.error}`); reload(); });
  const rotate = async () => { if (await ask('Make a new signing secret? Requests signed with the old one stop matching right away.', { ok: 'Make new secret' })) run('rotate', async () => { await api('/webhooks/secret', { method: 'POST' }); toast.success('New secret ready'); reload(); }); };
  return (
    <div className="civr-card p-6 space-y-6 lg:col-span-2" data-testid="settings-webhooks-card" {...u.bind}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-display text-2xl font-bold"><Webhook className="w-5 h-5 text-[#34d399]" />Call events (webhooks & Zapier)</div>
          <p className="text-sm text-[#a1a1aa] mt-1 max-w-2xl">Send calls, voicemails and texts to your CRM as they happen. For Zapier, create a Zap with “Webhooks by Zapier” → Catch Hook and paste its URL here.</p>
        </div>
        <Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} testid="webhooks-enabled-toggle" />
      </div>
      <Field label="Send events to" hint="A public address that starts with https://. We POST JSON and wait up to 6 seconds.">
        <input className="civr-input font-mono" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://hooks.zapier.com/hooks/catch/…" data-testid="webhooks-url-input" />
      </Field>
      <div>
        <span className="block text-[13px] font-medium text-[#d4d4d8] mb-2">Events</span>
        <div className="flex flex-wrap gap-2" data-testid="webhooks-events">{data.events.map(e => <button key={e.key} type="button" aria-pressed={f.events.includes(e.key)} onClick={() => toggleEvent(e.key)} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-10 ${f.events.includes(e.key) ? 'civr-pill-on' : ''}`} data-testid={`webhooks-event-${e.key.replace(/[._]/g, '-')}`}>{e.label}</button>)}</div>
      </div>
      <Secret secret={w.secret} onRotate={rotate} />
      <SaveRow dirty={u.dirty} testid="webhooks-unsaved-pill">
        <button className="civr-btn civr-btn-primary" disabled={!!busy} onClick={save} data-testid="webhooks-save-button">{busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />}Save event feed</button>
        <button className="civr-btn civr-btn-ghost" disabled={!!busy || !w.url || u.dirty} onClick={test} title={u.dirty ? 'Save first' : undefined} data-testid="webhooks-test-button">{busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send a test event</button>
      </SaveRow>
      <div className="border-t border-[#1a1a1a] pt-4 space-y-2"><div className="text-sm font-medium">Recent deliveries</div><Deliveries list={data.deliveries} /></div>
    </div>
  );
}

export function Webhooks() {
  const { data, reload } = useApi('/webhooks');
  if (!data) return <div className="civr-card p-6 lg:col-span-2"><Spinner /></div>;
  return <Form key={String(data.webhook.updatedAt)} data={data} reload={reload} />;
}
