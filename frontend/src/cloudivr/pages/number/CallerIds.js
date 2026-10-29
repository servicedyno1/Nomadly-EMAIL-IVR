import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, Trash2, ShieldCheck } from 'lucide-react';
import { api, useApi, enc, money } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { usePrivacy } from '../../privacy';

function AddForm({ price, dryRun, onDone }) {
  const [number, setNumber] = useState('');
  const [method, setMethod] = useState('sms');
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const send = () => run(async () => { const d = await api('/caller-ids', { method: 'POST', body: { number, method } }); setSent(d); setCode(''); toast.success(d.message); });
  const verify = () => run(async () => { await api('/caller-ids/verify', { method: 'POST', body: { number: sent.number, code } }); toast.success(`Verified · ${money(price)} charged`); setSent(null); setNumber(''); onDone(); });
  return (
    <div className="space-y-3" data-testid="caller-ids-add-form">
      {!sent ? <>
        <Field label="Number you own" hint="Mobile, landline or office line, with country code."><input className="civr-input font-mono" inputMode="tel" value={number} onChange={e => setNumber(e.target.value)} placeholder="+14155550100" data-testid="caller-ids-number-input" /></Field>
        <div className="flex flex-wrap items-center gap-2">
          <select className="civr-input !w-auto !h-9 text-sm" value={method} onChange={e => setMethod(e.target.value)} data-testid="caller-ids-method-select"><option value="sms">Text me the code</option><option value="call">Call me with the code</option></select>
          <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !number.trim()} onClick={send} data-testid="caller-ids-send-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send code</button>
        </div>
      </> : <>
        <p className="text-sm text-[#a1a1aa]" data-testid="caller-ids-sent-message">{sent.message}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="civr-input font-mono !w-40" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} placeholder="Code" data-testid="caller-ids-code-input" />
          <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !code.trim()} onClick={verify} data-testid="caller-ids-verify-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Verify · {money(price)}</button>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setSent(null)} data-testid="caller-ids-cancel-button">Cancel</button>
        </div>
      </>}
      {dryRun && <p className="text-xs text-[#a1a1aa]">Preview mode: no code is sent.</p>}
      <ErrorNote error={error} testid="caller-ids-error" />
    </div>
  );
}

export function CallerIds() {
  const { data, reload } = useApi('/caller-ids');
  const { hash } = useLocation();
  useEffect(() => { if (data && hash === '#caller-ids') document.getElementById('caller-ids')?.scrollIntoView({ behavior: 'smooth' }); }, [data, hash]);
  const pv = usePrivacy();
  const items = (data?.items || []).filter(i => i.status === 'verified');
  const price = data?.price ?? 25;
  const remove = async (n) => {
    if (!window.confirm(`Stop showing ${n}? Campaigns using it go back to their CloudIVR number. Verifying it again costs ${money(price)}.`)) return;
    try { await api(`/caller-ids/${enc(n)}`, { method: 'DELETE' }); toast.success('Caller ID removed'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <section id="caller-ids" className="civr-card p-6 mt-8 grid lg:grid-cols-2 gap-8 scroll-mt-24" data-testid="caller-ids-card">
      <div>
        <div className="flex items-center gap-2 font-display text-xl font-bold"><ShieldCheck className="w-5 h-5 text-[#818cf8]" />Your own caller IDs</div>
        <p className="text-sm text-[#a1a1aa] mt-2">Show a number you own, such as your mobile or office line, on Quick IVR calls, campaigns, AI agent calls and the browser phone. We send a code to that number to prove it’s yours. {money(price)} per number, charged only when the code is accepted. Calls are still billed from your CloudIVR number.</p>
        <div className="mt-4 space-y-2" data-testid="caller-ids-list">
          {!items.length && <p className="text-sm text-[#a1a1aa]" data-testid="caller-ids-empty">No verified numbers yet.</p>}
          {items.map((i, k) => (
            <div key={i.number} className="flex items-center justify-between border border-[#262626] rounded-xl px-4 py-2" data-testid={`caller-ids-item-${k}`}>
              <span className="font-mono flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-[#818cf8]" />{pv.phone(i.number)}</span>
              <button type="button" onClick={() => remove(i.number)} className="w-9 h-9 flex items-center justify-center rounded-lg text-[#a1a1aa] hover:text-[#fb7185] hover:bg-[#1f1f1f]" aria-label="Remove" data-testid={`caller-ids-remove-${k}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </div>
      <AddForm price={price} dryRun={data?.dryRun} onDone={reload} />
    </section>
  );
}
