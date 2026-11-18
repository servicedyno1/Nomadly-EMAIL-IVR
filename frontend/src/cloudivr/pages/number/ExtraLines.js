import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Layers, Plus, Trash2, Copy, Loader2, CalendarClock } from 'lucide-react';
import { api, enc, money } from '../../api';
import { Toggle } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';

const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// One bill: what the main number's renewal day charges (plan + every extra still on auto-renew).
function RenewalSummary({ r }) {
  if (!r) return null;
  return (
    <div className="rounded-xl border border-[var(--c-border,#27272a)] p-4 text-sm space-y-1" data-testid="extra-renewal-summary">
      <div className="flex items-center gap-2 font-semibold"><CalendarClock className="w-4 h-4 text-[#38bdf8]" />Next renewal · {day(r.date)}<Link to={cp('/app/renewals')} className="ml-auto text-xs font-normal underline text-[var(--c-muted)] hover:text-[#818cf8]" data-testid="extra-renewal-calendar-link">Renewal calendar</Link></div>
      {r.autoRenew ? <>
        <div className="font-mono text-2xl" data-testid="extra-renewal-total">{money(r.total)}</div>
        <div className="text-xs text-[var(--c-muted)]" data-testid="extra-renewal-breakdown">{`Plan ${money(r.main || 0)} + ${r.renewing} extra number${r.renewing === 1 ? '' : 's'} — one charge from your wallet`}</div>
        {r.later?.length > 0 && <div className="text-xs text-[var(--c-muted)]" data-testid="extra-renewal-later">{`Not in this charge: ${r.later.length} extra number${r.later.length === 1 ? '' : 's'} still on ${r.later.length === 1 ? 'its' : 'their'} own date — ${money(r.later.reduce((t, e) => t + e.firstPrice, 0))} in total when ${r.later.length === 1 ? 'it renews' : 'they renew'} (only the days up to ${day(r.date)}), then ${r.later.length === 1 ? 'it joins' : 'they join'} this bill.`}</div>}
      </> : <div className="text-xs text-[#fbbf24]" data-testid="extra-renewal-off">Auto-renew is off on the main number — it and all its extra numbers end on {day(r.date)}.</div>}
    </div>
  );
}

function LineRow({ x, i, onChanged, pv }) {
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const renew = async (on) => {
    setBusy('renew');
    try { await api(`/numbers/${enc(x.phoneNumber)}/auto-renew`, { method: 'POST', body: { enabled: on } }); toast.success(on ? `${x.phoneNumber} renews with the plan` : `${x.phoneNumber} ends on ${day(x.expiresAt)}`); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const del = async () => {
    setBusy('del');
    try { await api(`/numbers/${enc(x.phoneNumber)}/extra-line`, { method: 'DELETE', body: { confirm: x.phoneNumber } }); toast.success(`${x.phoneNumber} deleted — its slot is free again`); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(''); setConfirm(false); }
  };
  return (
    <div className="py-3 border-t border-[var(--c-border,#27272a)] first:border-t-0" data-testid={`extra-line-${i}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Link to={cp(`/app/numbers/${enc(x.phoneNumber)}`)} className="font-mono text-sm hover:text-[#818cf8] min-w-[9rem]" data-testid={`extra-line-${i}-link`}>{pv.phone(x.phoneNumber)}</Link>
        <span className="text-xs text-[var(--c-muted)] flex-1 min-w-[10rem]" data-testid={`extra-line-${i}-info`}>{x.autoRenew ? `${money(x.renewalPrice)}/mo${x.onPlanDate ? '' : ` · renews ${day(x.expiresAt)}, then joins the plan date`}` : `Ends ${day(x.expiresAt)}`}</span>
        <Toggle checked={!!x.autoRenew} disabled={!!busy} onChange={renew} testid={`extra-line-${i}-renew-toggle`} label="Renew" />
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={!!busy} onClick={() => setConfirm(true)} data-testid={`extra-line-${i}-delete`}><Trash2 className="w-4 h-4" /></button>
      </div>
      {confirm && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs rounded-lg border border-[#f87171]/40 bg-[#f87171]/5 p-3" data-testid={`extra-line-${i}-confirm`}>
        <span className="flex-1 min-w-[12rem]">Delete {x.phoneNumber} now? It stops working at once and can't be recovered. No refund for the days left.</span>
        <button type="button" className="civr-btn civr-btn-danger civr-btn-sm" disabled={busy === 'del'} onClick={del} data-testid={`extra-line-${i}-confirm-delete`}>{busy === 'del' && <Loader2 className="w-3 h-3 animate-spin" />}Delete</button>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setConfirm(false)} data-testid={`extra-line-${i}-cancel-delete`}>Keep</button>
      </div>}
    </div>
  );
}

const PARTS = [['forwarding', 'Call forwarding'], ['ivr', 'Keypad menu (IVR)'], ['voicemail', 'Voicemail']];
// Copy one number's forwarding / keypad menu / voicemail onto any of the others in one tap.
function CopySettings({ group }) {
  const [src, setSrc] = useState(group[0]);
  const [to, setTo] = useState(() => group.slice(1));
  const [parts, setParts] = useState(PARTS.map(p => p[0]));
  const [busy, setBusy] = useState(false);
  const flip = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const pickSrc = (v) => { setSrc(v); setTo(group.filter(x => x !== v)); };
  const run = async () => {
    setBusy(true);
    try { const d = await api(`/numbers/${enc(src)}/copy-settings`, { method: 'POST', body: { to, parts } }); toast.success(`Copied to ${d.to.length} number${d.to.length === 1 ? '' : 's'}`); if (d.skipped?.length) toast.warning(d.skipped.map(s => `${s.phoneNumber}: ${s.message}`).join('; ')); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <details className="rounded-xl border border-[var(--c-border,#27272a)] p-4 text-sm" data-testid="extra-copy-settings">
      <summary className="cursor-pointer font-semibold flex items-center gap-2" data-testid="extra-copy-settings-toggle"><Copy className="w-4 h-4 text-[#38bdf8]" />Copy settings to other numbers</summary>
      <div className="mt-3 space-y-3">
        <label className="block text-xs text-[var(--c-muted)]">Copy from
          <select className="civr-input mt-1" value={src} onChange={e => pickSrc(e.target.value)} data-testid="extra-copy-source">{group.map(p => <option key={p} value={p}>{p}</option>)}</select>
        </label>
        <div className="flex flex-wrap gap-3">{PARTS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={parts.includes(k)} onChange={() => flip(parts, setParts, k)} data-testid={`extra-copy-part-${k}`} />{l}</label>)}</div>
        <div className="flex items-center gap-3 text-xs text-[var(--c-muted)]" data-testid="extra-copy-select-bar">
          <span data-testid="extra-copy-selected-count">{`${to.length} of ${group.length - 1} selected`}</span>
          <button type="button" className="underline hover:text-[#818cf8] disabled:opacity-40 disabled:no-underline" disabled={to.length === group.length - 1} onClick={() => setTo(group.filter(x => x !== src))} data-testid="extra-copy-select-all">Select all</button>
          <button type="button" className="underline hover:text-[#818cf8] disabled:opacity-40 disabled:no-underline" disabled={!to.length} onClick={() => setTo([])} data-testid="extra-copy-select-none">Select none</button>
        </div>
        <div className="grid sm:grid-cols-2 gap-1">{group.filter(p => p !== src).map((p, i) => <label key={p} className="flex items-center gap-2 font-mono text-xs"><input type="checkbox" checked={to.includes(p)} onChange={() => flip(to, setTo, p)} data-testid={`extra-copy-target-${i}`} />{p}</label>)}</div>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !to.length || !parts.length} onClick={run} data-testid="extra-copy-apply">{busy && <Loader2 className="w-3 h-3 animate-spin" />}Copy to {to.length} number{to.length === 1 ? '' : 's'}</button>
      </div>
    </details>
  );
}

export function ExtraLines({ num, data, reload }) {
  const pv = usePrivacy();
  const full = !data.unlimited && data.used >= data.limit;
  return (
    <div className="civr-card p-6 space-y-4" data-testid="billing-extra-card">
      <div className="flex items-center gap-2 font-display text-2xl font-bold"><Layers className="w-5 h-5 text-[#38bdf8]" />Extra numbers</div>
      <p className="text-sm text-[#a1a1aa]">{`Add more numbers to this plan for ${money(data.price)}/month each. They get the same ${num.planName} features and renew with the plan on one bill — a new extra pays only for the days until then.`}</p>
      <div className="text-sm font-mono" data-testid="billing-extra-usage">{data.unlimited ? `${data.used} added · no limit` : `${data.used} of ${data.limit} used`}</div>
      {data.numbers.length > 0 && <RenewalSummary r={data.renewal} />}
      {data.numbers.length > 0 && <div data-testid="extra-lines-list">{data.numbers.map((x, i) => <LineRow key={x.phoneNumber} x={x} i={i} onChanged={reload} pv={pv} />)}</div>}
      {data.numbers.length > 0 && <CopySettings group={[num.phoneNumber, ...data.numbers.map(x => x.phoneNumber)]} />}
      {full ? <div className="text-xs text-[#fbbf24]">Limit reached — upgrade this number to add more.</div>
        : <Link to={cp(`/app/buy?extra=${enc(num.phoneNumber)}`)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="billing-extra-add-link"><Plus className="w-4 h-4" />Add extra numbers</Link>}
    </div>
  );
}

