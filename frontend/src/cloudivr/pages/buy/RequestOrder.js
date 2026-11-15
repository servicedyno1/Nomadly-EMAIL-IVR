import React, { useState } from 'react';
import { toast } from 'sonner';
import { Clock, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { useShell } from '../../Shell';
import { ErrorNote } from '../../ui';
import { WalletPay } from '../../WalletPay';

const DETAILS = {
  none: 'No paperwork needed.',
  name: 'Your saved business or full name is sent with the order.',
  name_address: 'Your saved name and address are sent with the order.',
};
const STATUS = { submitted: 'Sent to the carrier', in_review: 'Carrier is reviewing', approved: 'Approved — activating', active: 'Ready', refunded: 'Declined — refunded' };

// Countries where the carrier assigns the number after an order: pay now, number arrives later, full refund if declined.
export function RequestOrder({ request, plan, addon = 0, onDone }) {
  const total = (plan?.price || 0) + addon;
  const { refreshSummary } = useShell();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api('/numbers/request', { method: 'POST', body: { country: request.country, plan: plan.id } }); toast.success(`Ordered. We’ll tell you when your ${request.name} number is ready.`); refreshSummary(); onDone?.(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-4 civr-rise" data-testid="request-order">
      <div className="flex items-start gap-3">
        <Clock className="w-5 h-5 text-[#818cf8] mt-1 shrink-0" />
        <div>
          <div className="font-semibold">{request.flag} {request.name} numbers are assigned by the carrier</div>
          <p className="text-sm text-[var(--c-muted)] mt-1">You can’t pick the exact number. Pay now and the carrier assigns one, usually within a few business days. If they decline, you get a full refund to your wallet.</p>
        </div>
      </div>
      <p className="text-sm flex gap-2" data-testid="request-order-details"><ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-[#818cf8]" />{DETAILS[request.details]}</p>
      {request.localOnly && <p className="text-xs text-[#fbbf24] flex gap-2" data-testid="request-order-local-note"><AlertTriangle className="w-4 h-4 shrink-0" />The carrier offers these numbers to businesses based in {request.name}; a request from elsewhere may be declined (and refunded).</p>}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-[var(--c-muted)] basis-full">{plan?.name} plan · {addon > 0 ? `${money(plan?.price || 0)} + country charge ${money(addon)} = ${money(total)}` : money(plan?.price || 0)} per month</span>
        <WalletPay price={total} onWallet={go} busy={busy} disabled={!plan} label={`Order for ${money(total)} from wallet`} testid="request-order-paybox" walletTestid="request-order-pay-button" />
      </div>
      <ErrorNote error={err} testid="request-order-error" />
    </div>
  );
}

export function PendingRequests({ refresh = 0 }) {
  const { data, reload } = useApi('/numbers/requests');
  React.useEffect(() => { if (refresh) reload(); }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (data?.requests || []).filter(r => r.status !== 'active');
  if (!list.length) return null;
  return (
    <div className="civr-card p-4 mb-6 space-y-2" data-testid="pending-requests">
      <div className="civr-label">Numbers on order</div>
      {list.map(r => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`pending-request-${r.id}`}>
          <span>{r.countryName} · {money(r.price)}</span>
          <span className={r.status === 'refunded' ? 'text-[#f87171]' : 'text-[#818cf8]'}>{STATUS[r.status] || r.status}</span>
        </div>
      ))}
    </div>
  );
}
