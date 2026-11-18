import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { api, enc } from '../../api';
import { ask } from '../../i18n';
import { ErrorNote } from '../../ui';
import { CallsFrom } from './SipCallerId';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

// Extra SIP logins: Pro 2 and Business 5 free, more at $5/month each on any plan with SIP. Password is shown once.
export function ExtraSipLogins({ num }) {
  const [d, setD] = useState(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const path = `/numbers/${enc(num.phoneNumber)}/sip/extra`;
  const load = () => api(path).then(setD).catch(setErr);
  useEffect(() => { load(); }, [num.phoneNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const add = async () => {
    const paid = d.freeLeft === 0;
    if (paid && !(await ask(`No free extra logins left on this plan. This one costs $${d.price}/month, charged from your wallet now and with each renewal of ${num.phoneNumber}.`, { ok: `Add for $${d.price}/mo`, title: 'Add a paid SIP login?' }))) return;
    setBusy(true); setErr(null); try { setFresh(await api(path, { method: 'POST', body: { label, confirmPaid: paid } })); setLabel(''); load(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const remove = async (x) => { if (!(await ask(`Remove the SIP login “${x.label}”? Devices using it stop working right away.${x.paid ? ` Its $${d.price}/month charge stops at the next renewal; this month isn’t refunded.` : ''}`, { danger: true, ok: 'Remove', title: 'Remove SIP login?' }))) return; try { await api(`${path}/${enc(x.id)}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e); } };
  return (
    <div className="civr-card p-6 space-y-4 lg:col-span-3" data-testid="extra-sip-card">
      <div className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-[#818cf8]" /><div className="font-display text-xl font-bold">Extra SIP logins</div><span className="civr-pill" data-testid="extra-sip-count">{d.logins.length}/{d.max}</span></div>
      {!d.allowed ? <p className="text-sm text-[var(--c-muted)]" data-testid="extra-sip-upgrade">Give each desk phone or teammate its own login. Pro includes 2 free, Business 5. More cost $5/month each.</p> : <>
        <p className="text-sm text-[var(--c-muted)]">Each login rings for {num.phoneNumber} and can call out from any of your numbers. Remove one to cut off that device without touching the others.</p>
        <p className="text-sm" data-testid="extra-sip-pricing">{d.freeLeft > 0 ? `${d.freeLeft} free login${d.freeLeft === 1 ? '' : 's'} left on this plan, then $${d.price}/month each.` : `Extra logins cost $${d.price}/month each.`}</p>
        {d.logins.map(x => (
          <div key={x.id} className="flex flex-wrap items-center gap-3 text-sm" data-testid={`extra-sip-${x.id}`}>
            <span className="font-semibold w-32 truncate">{x.label}</span>{x.paid && <span className="civr-pill" data-testid={`extra-sip-paid-${x.id}`}>${d.price}/mo</span>}{!x.active && <span className="civr-pill civr-pill-bad" data-testid={`extra-sip-inactive-${x.id}`}>Off on this plan</span>}<span className="font-mono flex-1 truncate" data-no-translate>{x.username}@{d.domain}</span>
            <button className="civr-btn civr-btn-ghost !px-2" onClick={() => remove(x)} aria-label={`Remove ${x.label}`} data-testid={`extra-sip-remove-${x.id}`}><Trash2 className="w-4 h-4" /></button>
            <div className="basis-full"><CallsFrom num={num} loginId={x.id} value={x.callerId} testid={`extra-sip-calls-from-${x.id}`} /></div>
          </div>
        ))}
        {fresh && <div className="rounded-xl border border-[#818cf8]/40 p-3 text-sm space-y-1" data-testid="extra-sip-new">
          <div className="font-semibold">New login “{fresh.label}” — copy the password now, it won’t be shown again.</div>
          {[['Username', fresh.username], ['Password', fresh.password], ['Server', fresh.domain]].map(([k, v]) => <div key={k} className="flex items-center gap-2"><span className="w-20 text-[var(--c-muted)]">{k}</span><span className="font-mono flex-1 truncate" data-no-translate>{v}</span><button className="civr-btn civr-btn-ghost !px-2" onClick={() => copy(v)} aria-label={`Copy ${k}`} data-testid={`extra-sip-copy-${k.toLowerCase()}`}><Copy className="w-4 h-4" /></button></div>)}
        </div>}
        {d.logins.length < d.max && <div className="flex flex-wrap gap-2">
          <input className="civr-input flex-1 min-w-[180px]" placeholder="Name, e.g. Front desk" maxLength={40} value={label} onChange={e => setLabel(e.target.value)} data-testid="extra-sip-label-input" />
          <button className="civr-btn civr-btn-primary" onClick={add} disabled={busy} data-testid="extra-sip-add-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{d.freeLeft > 0 ? 'Add free login' : `Add login · $${d.price}/mo`}</button>
        </div>}
      </>}
      <ErrorNote error={err} testid="extra-sip-error" />
    </div>
  );
}
