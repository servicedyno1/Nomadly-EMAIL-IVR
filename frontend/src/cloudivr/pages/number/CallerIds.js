import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, Trash2, ShieldCheck } from 'lucide-react';
import { api, useApi, enc, money } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { usePrivacy } from '../../privacy';

const split = (s) => String(s || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);

function AddForm({ onSent }) {
  const [text, setText] = useState('');
  const [method, setMethod] = useState('sms');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fails, setFails] = useState([]);
  const n = split(text).length;
  const send = async () => {
    setBusy(true); setError(null); setFails([]);
    try {
      const d = await api('/caller-ids', { method: 'POST', body: { numbers: split(text), method } });
      const bad = (d.results || []).filter(r => !r.ok);
      setFails(bad); setText(bad.map(r => r.number).join('\n'));
      toast.success(d.message); onSent();
    } catch (e) { setError(e); setFails(e.body?.results?.filter(r => !r.ok) || []); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3" data-testid="caller-ids-add-form">
      <Field label="Numbers you own" hint="One per line, with country code. Up to 10 at a time — each gets its own code."><textarea className="civr-input font-mono !h-24 py-2" value={text} onChange={e => setText(e.target.value)} placeholder={'+14155550100\n+14155550101'} data-testid="caller-ids-number-input" /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <select className="civr-input !w-auto !h-9 text-sm" value={method} onChange={e => setMethod(e.target.value)} data-testid="caller-ids-method-select"><option value="sms">Text the code</option><option value="call">Call with the code</option></select>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !n} onClick={send} data-testid="caller-ids-send-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{n > 1 ? `Send ${n} codes` : 'Send code'}</button>
      </div>
      {fails.length > 0 && <ul className="text-xs text-[#fb7185] space-y-1" data-testid="caller-ids-send-failures">{fails.map(f => <li key={f.number}><span className="font-mono">{f.number}</span>: {f.message}</li>)}</ul>}
      <ErrorNote error={fails.length ? null : error} testid="caller-ids-error" />
    </div>
  );
}

function Pending({ item, price, i, onDone }) {
  const pv = usePrivacy();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try { await api('/caller-ids/verify', { method: 'POST', body: { number: item.number, code } }); toast.success(`${item.number} verified · ${money(price)} charged`); onDone(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border border-dashed border-[#3f3f46] rounded-xl px-4 py-2" data-testid={`caller-ids-pending-${i}`}>
      <span className="font-mono flex-1 min-w-[140px]">{pv.phone(item.number)}</span>
      <input className="civr-input font-mono !w-28 !h-9" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} placeholder="Code" data-testid={`caller-ids-code-input-${i}`} />
      <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !code.trim()} onClick={verify} data-testid={`caller-ids-verify-button-${i}`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Verify · {money(price)}</button>
    </div>
  );
}

export function CallerIds() {
  const { data, reload } = useApi('/caller-ids');
  const { hash } = useLocation();
  useEffect(() => { if (data && hash === '#caller-ids') document.getElementById('caller-ids')?.scrollIntoView({ behavior: 'smooth' }); }, [data, hash]);
  const pv = usePrivacy();
  const all = data?.items || [];
  const items = all.filter(i => i.status === 'verified');
  const pending = all.filter(i => i.status === 'pending');
  const price = data?.price ?? 25;
  const remove = async (n) => {
    if (!window.confirm(`Stop showing ${n}? Calls using it go back to their CloudIVR number. Verifying it again costs ${money(price)}.`)) return;
    try { await api(`/caller-ids/${enc(n)}`, { method: 'DELETE' }); toast.success('Caller ID removed'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <section id="caller-ids" className="civr-card p-6 mt-8 grid lg:grid-cols-2 gap-8 scroll-mt-24" data-testid="caller-ids-card">
      <div>
        <div className="flex items-center gap-2 font-display text-xl font-bold"><ShieldCheck className="w-5 h-5 text-[#818cf8]" />Your own caller IDs</div>
        <p className="text-sm text-[#a1a1aa] mt-2">Show a number you own, such as your mobile or office line, on Quick IVR calls, Call me first, campaigns, AI agent calls, text triggers and the browser phone. We send a code to that number to prove it’s yours. {money(price)} per number, charged only when the code is accepted. Calls are still billed from your CloudIVR number.</p>
        <div className="mt-4 space-y-2" data-testid="caller-ids-list">
          {pending.map((p, k) => <Pending key={p.number} item={p} price={price} i={k} onDone={reload} />)}
          {!items.length && !pending.length && <p className="text-sm text-[#a1a1aa]" data-testid="caller-ids-empty">No verified numbers yet.</p>}
          {items.map((i, k) => (
            <div key={i.number} className="flex items-center justify-between border border-[#262626] rounded-xl px-4 py-2" data-testid={`caller-ids-item-${k}`}>
              <span className="font-mono flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-[#818cf8]" />{pv.phone(i.number)}</span>
              <button type="button" onClick={() => remove(i.number)} className="w-9 h-9 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-[#fb7185] hover:bg-[#1f1f1f]" aria-label="Remove" data-testid={`caller-ids-remove-${k}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        {data?.dryRun && <p className="text-xs text-[#a1a1aa] mt-3">Preview mode: no code is sent — use 123456.</p>}
      </div>
      <AddForm onSent={reload} />
    </section>
  );
}
