import React, { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, ArrowUpCircle, Trash2, Loader2 } from 'lucide-react';
import { api, enc, money, day } from '../../api';
import { useShell } from '../../Shell';
import { Field, Toggle } from '../../ui';
import { PlanFeatures, unlocks } from '../../PlanFeatures';
import { Downgrade, ExtraNumbers } from './BillingExtras';
import { ask } from '../../i18n';

function Renewal({ num, reload, refreshSummary }) {
  const [busy, setBusy] = useState(false);
  const path = `/numbers/${enc(num.phoneNumber)}`;
  const renew = async () => {
    if (!ask(`Renew ${num.phoneNumber} for ${money(num.planPrice)}?`)) return;
    setBusy(true);
    try { const d = await api(`${path}/renew`, { method: 'POST' }); toast.success(`Renewed until ${day(d.expiresAt)}`); reload(); refreshSummary(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const auto = async (v) => { try { await api(`${path}/auto-renew`, { method: 'POST', body: { enabled: v } }); toast.success(v ? 'Auto-renew on' : 'Auto-renew off'); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="civr-card p-6 space-y-6" data-testid="billing-renewal-card">
      <div className="font-display text-2xl font-bold">Renewal</div>
      <div className="flex justify-between text-sm"><span className="text-[#a1a1aa]">Plan</span><span>{num.planName} · {money(num.planPrice)}/month</span></div>
      <div className="flex justify-between text-sm"><span className="text-[#a1a1aa]">Paid until</span><span data-testid="billing-expires">{day(num.expiresAt)}</span></div>
      <div className="flex items-center justify-between"><span className="text-sm">Auto-renew from wallet</span><Toggle checked={num.autoRenew} onChange={auto} testid="billing-auto-renew-toggle" /></div>
      <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={renew} disabled={busy} data-testid="billing-renew-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Renew now</button>
    </div>
  );
}

function Upgrade({ num, reload, refreshSummary, plans }) {
  const order = plans.map(p => p.id);
  const higher = plans.filter(p => p.available && order.indexOf(p.id) > order.indexOf(num.plan));
  const [plan, setPlan] = useState(higher[0]?.id || '');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!higher.length) return <div className="civr-card p-6 h-fit" data-testid="billing-top-plan"><div className="font-display text-2xl font-bold">Upgrade</div><p className="text-sm text-[#a1a1aa] mt-1">You’re on the top plan.</p></div>;
  const call = async (confirm) => {
    setBusy(true);
    try {
      const d = await api(`/numbers/${enc(num.phoneNumber)}/upgrade`, { method: 'POST', body: { plan, confirm } });
      if (!confirm) setQuote(d.quote); else { toast.success(`Upgraded · charged ${money(d.charged)}`); setQuote(null); reload(); refreshSummary(); }
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-6" data-testid="billing-upgrade-card">
      <div className="font-display text-2xl font-bold">Upgrade plan</div>
      <Field label="New plan"><select className="civr-input" value={plan} onChange={e => { setPlan(e.target.value); setQuote(null); }} data-testid="billing-upgrade-plan-select">{higher.map(p => <option key={p.id} value={p.id}>{`${p.name} · ${money(p.price)}/month`}</option>)}</select></Field>
      {unlocks(plans, num.plan, plan).length > 0 && (
        <div data-testid="billing-upgrade-unlocks">
          <div className="text-xs text-[#a1a1aa] mb-2">This upgrade unlocks</div>
          <PlanFeatures plan={{ webFeatures: unlocks(plans, num.plan, plan) }} compact testid="billing-upgrade-unlock" />
        </div>
      )}
      {quote && <div className="text-sm" data-testid="billing-upgrade-quote">Pay <span className="font-mono">{money(quote.charge)}</span> now{quote.credit > 0 ? ` (includes ${money(quote.credit)} credit for unused days)` : ''}. Then {money(quote.newPrice)}/month.</div>}
      {quote ? <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => call(true)} data-testid="billing-upgrade-confirm-button">Pay {money(quote.charge)} &amp; upgrade</button>
        : <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={() => call(false)} data-testid="billing-upgrade-quote-button"><ArrowUpCircle className="w-4 h-4" />See price</button>}
    </div>
  );
}

function Danger({ num, onDeleted, refreshSummary }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try { await api(`/numbers/${enc(num.phoneNumber)}`, { method: 'DELETE', body: { confirm: typed } }); toast.success('Number deleted'); refreshSummary(); onDeleted(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-4 border-[#fb7185]/30 lg:col-span-2" data-testid="billing-delete-card">
      <div className="font-display text-2xl font-bold text-[#fb7185]">Delete number</div>
      <p className="text-sm text-[#a1a1aa]">The number goes back to the carrier and can’t be recovered. No refund for the current month.</p>
      <div className="flex flex-col sm:flex-row gap-2"><input className="civr-input font-mono" value={typed} onChange={e => setTyped(e.target.value)} placeholder={`Type ${num.phoneNumber}`} data-testid="billing-delete-confirm-input" />
        <button className="civr-btn civr-btn-danger" disabled={busy || typed !== num.phoneNumber} onClick={del} data-testid="billing-delete-button"><Trash2 className="w-4 h-4" />Delete</button></div>
    </div>
  );
}

export default function BillingTab({ num, reload, onDeleted }) {
  const { catalog, refreshSummary } = useShell();
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Renewal num={num} reload={reload} refreshSummary={refreshSummary} />
      {catalog && !num.isSubNumber && <Upgrade num={num} reload={reload} refreshSummary={refreshSummary} plans={catalog.plans} />}
      {catalog && <Downgrade num={num} reload={reload} refreshSummary={refreshSummary} plans={catalog.plans} />}
      <ExtraNumbers num={num} />
      <Danger num={num} onDeleted={onDeleted} refreshSummary={refreshSummary} />
    </div>
  );
}
