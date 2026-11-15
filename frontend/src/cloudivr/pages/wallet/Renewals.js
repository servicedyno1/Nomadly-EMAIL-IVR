import React, { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { api, enc, money, useApi } from '../../api';
import { Flag } from '../../Pickers';
import { countryOfPhone } from '../../phoneCountry';

const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const ACTIVE = new Set(['active', 'suspended', 'past_due', 'pending', 'provisioning']);

// Every paid line in one list: plan numbers, Texting Numbers, eSIMs and fax numbers. Turning renewal off keeps the
// line until its end date; then it is released with the provider so nothing more is billed.
function useLines() {
  const nums = useApi('/numbers'), es = useApi('/esim'), fax = useApi('/fax-numbers');
  const rows = [
    ...(nums.data?.numbers || []).filter(n => ACTIVE.has(n.status) && !n.isSubNumber && !n.replacedBy).map(n => ({ key: `n-${n.phoneNumber}`, what: `${n.planName || n.plan || 'Plan'} number`, phone: n.phoneNumber, price: n.renewalPrice || n.planPrice, date: n.expiresAt, on: n.autoRenew !== false, flip: (on) => api(`/numbers/${enc(n.phoneNumber)}/auto-renew`, { method: 'POST', body: { enabled: on } }) })),
    ...(es.data?.items || []).filter(i => ACTIVE.has(i.status) && i.price > 0).map(i => ({ key: `e-${i.id}`, what: i.kind === 'mobile' ? 'USA Texting Number' : 'USA eSIM', phone: i.phoneNumber, price: i.price, date: i.nextBillAt || i.expiresAt, on: !!i.autoRenew, flip: (on) => api(`/esim/${i.id}/auto-renew`, { method: 'POST', body: { on } }) })),
    ...(fax.data?.numbers || []).filter(n => ACTIVE.has(n.status)).map(n => ({ key: `f-${n.phoneNumber}`, what: 'Fax number', phone: n.phoneNumber, price: n.price, date: n.expiresAt, on: n.autoRenew !== false, flip: (on) => api(`/fax-numbers/${enc(n.phoneNumber)}`, { method: 'PATCH', body: { autoRenew: on } }) })),
  ];
  const reload = () => { nums.reload(); es.reload(); fax.reload(); };
  return { rows, loading: !nums.data && !es.data && !fax.data, reload };
}

function Row({ r, i, reload }) {
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    setBusy(true);
    try { await r.flip(!r.on); toast.success(r.on ? `Renewal off — ${r.phone || r.what} ends ${day(r.date)} and is released then` : `Renews monthly from your wallet`); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-testid={`renewals-row-${i}`}>
      <span className="flex items-center gap-2 min-w-[12rem] flex-1"><Flag code={countryOfPhone(r.phone)} /><span><span className="font-mono block" data-no-translate>{r.phone || '—'}</span><span className="text-xs text-[var(--c-muted)]">{r.what}</span></span></span>
      <span className="text-sm w-40" data-testid={`renewals-row-${i}-date`}>{`${r.on ? 'Renews' : 'Ends'} ${day(r.date)}`}<span className="block text-xs text-[var(--c-muted)]">{r.price ? `${money(r.price)}/month` : ''}</span></span>
      <button type="button" role="switch" aria-checked={r.on} disabled={busy} onClick={flip} className="civr-btn civr-btn-ghost civr-btn-sm gap-2" data-testid={`renewals-row-${i}-toggle`}>
        <span className={`inline-block w-8 h-4 rounded-full relative transition-colors ${r.on ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border)]'}`}><span className={`absolute left-0 top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${r.on ? 'translate-x-4' : 'translate-x-0.5'}`} /></span>
        {r.on ? 'Auto-renew on' : 'Auto-renew off'}
      </button>
    </div>
  );
}

export function Renewals() {
  const { rows, loading, reload } = useLines();
  if (loading) return null;
  return (
    <section className="civr-card mt-8" data-testid="renewals">
      <div className="p-5 border-b border-[var(--c-border)]">
        <div className="font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4" />Renewals</div>
        <p className="text-sm text-[var(--c-muted)] mt-1">Every number and line you pay for monthly. Turn auto-renew off and it stays yours until its end date, then we release it with the carrier so you’re never billed again.</p>
      </div>
      {rows.length ? <div className="divide-y divide-[var(--c-border)]">{rows.map((r, i) => <Row key={r.key} r={r} i={i} reload={reload} />)}</div>
        : <p className="p-5 text-sm text-[var(--c-muted)]" data-testid="renewals-empty">Nothing renews monthly yet.</p>}
    </section>
  );
}
