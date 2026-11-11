import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { api, enc, money } from '../../api';
import { cp } from '../../paths';
import { useShell } from '../../Shell';

// One-tap "Your campaign needs Pro" upgrade for a number that can't run this kind of campaign yet.
export function CampaignUpgradeNudge({ numbers, need, feature, onDone }) {
  const { catalog, refreshSummary } = useShell() || {};
  const order = (catalog?.plans || []).map(p => p.id);
  const cands = numbers.filter(n => n.status === 'active' && !n.isSubNumber && order.indexOf(n.plan) < order.indexOf(need));
  const [phone, setPhone] = useState(cands[0]?.phoneNumber || '');
  const [quote, setQuote] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const plan = catalog?.plans?.find(p => p.id === need);
  useEffect(() => {
    if (!phone || !need) return;
    setQuote(null); setErr(null);
    api(`/numbers/${enc(phone)}/upgrade`, { method: 'POST', body: { plan: need } }).then(d => setQuote(d.quote)).catch(e => setErr(e.message));
  }, [phone, need]);
  if (!cands.length || !plan) return null;
  const go = async () => {
    setBusy(true);
    try {
      const d = await api(`/numbers/${enc(phone)}/upgrade`, { method: 'POST', body: { plan: need, confirm: true } });
      toast.success(`${phone} is now on ${plan.name} · charged ${money(d.charged)}`); refreshSummary?.(); onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 max-w-xl mx-auto text-left" data-testid="campaign-upgrade-nudge">
      <div className="flex items-center gap-2 font-display text-xl font-bold"><Zap className="w-5 h-5 text-[#818cf8]" />{`Your campaign needs ${plan.name}`}</div>
      <p className="text-sm text-[var(--c-muted)] mt-1">{`${feature} run on ${plan.name} numbers. Upgrade one of yours and start right away — same number, same settings.`}</p>
      {cands.length > 1 && <select className="civr-input font-mono mt-4" value={phone} onChange={e => setPhone(e.target.value)} data-testid="campaign-upgrade-number">{cands.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{n.phoneNumber}</option>)}</select>}
      {err && <p className="text-sm text-[#fbbf24] mt-3" data-testid="campaign-upgrade-error">{err} {/wallet|balance|top up/i.test(err) && <Link to={cp(`/app/wallet${quote ? `?need=${quote.charge}` : ''}`)} className="underline">Add funds</Link>}</p>}
      <button type="button" className="civr-btn civr-btn-primary mt-4 w-full" disabled={busy || !quote} onClick={go} data-testid="campaign-upgrade-button">
        {quote ? `Upgrade ${phone} to ${plan.name} · ${money(quote.charge)} now` : 'Checking the price…'}
      </button>
      {quote && <p className="text-xs text-[var(--c-muted)] mt-2" data-testid="campaign-upgrade-note">{`Paid from your wallet${quote.credit ? `, with ${money(quote.credit)} credit for the rest of this month` : ''}. Then ${money(quote.newPrice)}/month.`}</p>}
    </div>
  );
}
