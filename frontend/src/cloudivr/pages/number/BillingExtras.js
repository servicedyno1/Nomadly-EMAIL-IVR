import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowDownCircle, Layers, Plus, Loader2 } from 'lucide-react';
import { api, enc, money, useApi } from '../../api';
import { Field } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';
import { ask } from '../../i18n';

// Switch to a cheaper plan now — no refund; features the new plan lacks turn off.
export function Downgrade({ num, plans, reload, refreshSummary }) {
  const order = plans.map(p => p.id);
  const lower = plans.filter(p => p.available && order.indexOf(p.id) < order.indexOf(num.plan));
  const [plan, setPlan] = useState(lower[lower.length - 1]?.id || '');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!lower.length || num.isSubNumber) return null;
  const call = async (confirm) => {
    if (confirm && !ask('Switch plans now? There is no refund for this month, and the features listed turn off right away.')) return;
    setBusy(true);
    try {
      const d = await api(`/numbers/${enc(num.phoneNumber)}/downgrade`, { method: 'POST', body: { plan, confirm } });
      if (!confirm) setPreview(d.preview); else { toast.success(`Now on ${d.plan} · ${money(d.planPrice)}/month`); setPreview(null); reload(); refreshSummary(); }
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-5" data-testid="billing-downgrade-card">
      <div className="font-display text-2xl font-bold">Downgrade plan</div>
      <Field label="Switch to"><select className="civr-input" value={plan} onChange={e => { setPlan(e.target.value); setPreview(null); }} data-testid="billing-downgrade-plan-select">{lower.map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.price)}/month</option>)}</select></Field>
      {preview && (
        <div className="text-sm space-y-2" data-testid="billing-downgrade-preview">
          <div>New price <span className="font-mono">{money(preview.newPrice)}</span>/month from your next renewal · {preview.minutes[1]} min · {preview.sms[1]} SMS.</div>
          {preview.lost.length > 0 && <div className="text-[#fbbf24]" data-testid="billing-downgrade-lost">Turns off now: {preview.lost.join(', ')}.</div>}
          {preview.extras > preview.extraLimit && <div className="text-[#fbbf24]">You have {preview.extras} extra numbers; the new plan allows {preview.extraLimit}. They keep working but you can’t add more.</div>}
          <div className="text-xs text-[#8a8a8a]">No refund for the current month.</div>
        </div>
      )}
      {preview ? <button className="civr-btn civr-btn-danger" disabled={busy} onClick={() => call(true)} data-testid="billing-downgrade-confirm-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Switch to {preview.planName} now</button>
        : <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy || !plan} onClick={() => call(false)} data-testid="billing-downgrade-preview-button"><ArrowDownCircle className="w-4 h-4" />See what changes</button>}
    </div>
  );
}

// Extra numbers on this plan (the bot's sub-numbers): flat monthly price, same plan features.
export function ExtraNumbers({ num }) {
  const pv = usePrivacy();
  const { data } = useApi(num.isSubNumber ? null : `/numbers/${enc(num.phoneNumber)}/extra`);
  if (num.isSubNumber) return (
    <div className="civr-card p-6 space-y-2" data-testid="billing-extra-of">
      <div className="font-display text-2xl font-bold">Extra number</div>
      <p className="text-sm text-[#888]">This number is an extra on <Link className="text-[#34d399] font-mono" to={cp(`/app/numbers/${enc(num.parentNumber)}?tab=billing`)} data-testid="billing-extra-parent-link">{pv.phone(num.parentNumber)}</Link> and follows that number’s plan.</p>
    </div>
  );
  if (!data) return null;
  const full = data.used >= data.limit;
  return (
    <div className="civr-card p-6 space-y-4" data-testid="billing-extra-card">
      <div className="flex items-center gap-2 font-display text-2xl font-bold"><Layers className="w-5 h-5 text-[#38bdf8]" />Extra numbers</div>
      <p className="text-sm text-[#888]">Add more numbers to this plan for {money(data.price)}/month each. They get the same {num.planName} features.</p>
      <div className="text-sm" data-testid="billing-extra-usage"><span className="font-mono">{data.used}</span> of <span className="font-mono">{data.limit}</span> used</div>
      {data.numbers.map((x, i) => <Link key={x.phoneNumber} to={cp(`/app/numbers/${enc(x.phoneNumber)}`)} className="block font-mono text-sm text-[#ddd] hover:text-[#34d399]" data-testid={`billing-extra-row-${i}`}>{pv.phone(x.phoneNumber)} · {x.status}</Link>)}
      {full ? <div className="text-xs text-[#fbbf24]">Limit reached — upgrade this number to add more.</div>
        : <Link to={cp(`/app/buy?extra=${enc(num.phoneNumber)}`)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="billing-extra-add-link"><Plus className="w-4 h-4" />Add an extra number</Link>}
    </div>
  );
}
