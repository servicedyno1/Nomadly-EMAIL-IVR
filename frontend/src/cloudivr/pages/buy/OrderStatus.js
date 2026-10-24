import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import QRCode from 'react-qr-code';
import { Copy, RefreshCw, Check, AlertTriangle, ArrowRight, ShieldCheck, Loader2, Sparkles } from 'lucide-react';
import { api, useApi, money, enc } from '../../api';
import { useShell } from '../../Shell';
import { PageHeader, Spinner, ErrorNote } from '../../ui';
import { cp } from '../../paths';

const STEPS = ['Waiting for payment', 'Payment confirmed', 'Activating your line', 'Ready'];
const UPGRADE_STEPS = ['Waiting for payment', 'Payment confirmed', 'Upgrading your plan', 'Done'];
const STEP_OF = { awaiting_payment: 0, underpaid: 1, activating: 2, active: 3, verification: 3 };
const POLL_MS = 15000;
const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

function Steps({ status, upgrade }) {
  const at = STEP_OF[status] ?? -1;
  return (
    <ol className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6" data-testid="order-steps">
      {(upgrade ? UPGRADE_STEPS : STEPS).map((s, i) => (
        <li key={s} className={`civr-card px-4 py-3 text-xs font-mono uppercase tracking-wider flex items-center gap-2 ${i <= at ? 'text-[#34d399] border-[#34d399]/40' : 'text-[#a1a1aa]'}`} data-testid={`order-step-${i}`}>
          {i < at || at === 3 ? <Check className="w-4 h-4" /> : i === at ? <span className="w-2 h-2 rounded-full bg-[#34d399] civr-pulse" /> : <span className="w-2 h-2 rounded-full bg-[#333]" />}{s}
        </li>
      ))}
    </ol>
  );
}

function Deposit({ o, busy, onCheck, onCancel, onSimulate }) {
  return (
    <div className="civr-card civr-trace p-6" data-testid="order-deposit-card">
      {o.preview && <div className="flex items-center gap-2 text-sm text-[#fbbf24] mb-4"><AlertTriangle className="w-4 h-4" />Preview mode — not a real address. Do not send funds.</div>}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {!o.preview && <div className="bg-white p-4 rounded-xl shrink-0" data-testid="order-deposit-qr"><QRCode value={o.address} size={148} /></div>}
        <div className="min-w-0 space-y-4">
          <div><div className="text-xs text-[#a1a1aa]">Send exactly</div><div className="font-mono text-2xl" data-testid="order-deposit-amount">{o.amountCrypto ? `${o.amountCrypto} ${o.coin}` : `${money(o.price)} in ${o.coin}`}</div></div>
          <div><div className="text-xs text-[#a1a1aa]">To address</div>
            <div className="flex items-center gap-2"><code className="text-sm break-all" data-testid="order-deposit-address">{o.address}</code>{!o.preview && <button onClick={() => copy(o.address)} className="w-11 h-11 shrink-0 flex items-center justify-center text-[#a1a1aa] hover:text-[#34d399]" aria-label="Copy address" data-testid="order-copy-address-btn"><Copy className="w-4 h-4" /></button>}</div>
          </div>
          <p className="text-xs text-[#a1a1aa]">We check for your payment every 15 seconds. You can leave this page — the number activates on its own and you’ll see it in your inbox.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-6">
        <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onCheck} disabled={!!busy} data-testid="order-check-btn"><RefreshCw className="w-4 h-4" />Check now</button>
        {o.dryRun && <button className="civr-btn civr-btn-ghost civr-btn-sm !border-[#fbbf24]/50 !text-[#fbbf24]" onClick={onSimulate} disabled={!!busy} data-testid="order-simulate-payment-btn">{busy === 'simulate-payment' && <Loader2 className="w-4 h-4 animate-spin" />}Preview: simulate payment</button>}
        <button className="civr-btn civr-btn-danger civr-btn-sm ml-auto" onClick={onCancel} disabled={!!busy} data-testid="order-cancel-btn">Cancel order</button>
      </div>
    </div>
  );
}

function Outcome({ o, balance, busy, onFinish }) {
  const num = o.assignedNumber || o.phoneNumber;
  if (o.status === 'active' && o.kind === 'upgrade') return (
    <div className="civr-card civr-trace p-6" data-testid="order-upgrade-success">
      <div className="flex items-center gap-2 text-[#34d399] font-semibold"><Check className="w-5 h-5" />Plan upgraded</div>
      <div className="font-mono text-3xl mt-3">{num}</div>
      <p className="text-sm text-[#a1a1aa] mt-2" data-testid="order-message">{o.message}</p>
      <Link to={cp(`/app/numbers/${enc(num)}`)} className="civr-btn civr-btn-primary mt-6" data-testid="order-open-number-btn">Open {num} <ArrowRight className="w-4 h-4" /></Link>
    </div>
  );
  if (o.status === 'active') return (
    <div className="civr-card civr-trace p-6" data-testid="order-success">
      <div className="flex items-center gap-2 text-[#34d399] font-semibold"><Check className="w-5 h-5" />Your number is live</div>
      <div className="font-mono text-3xl mt-3" data-testid="order-assigned-number">{num}</div>
      {o.substitutedFrom && <div className="mt-4 flex gap-3 text-sm rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/5 p-4" data-testid="order-substituted-notice"><Sparkles className="w-5 h-5 text-[#fbbf24] shrink-0" /><span>{o.message} We also emailed you.</span></div>}
      <Link to={cp(`/app/numbers/${enc(num)}`)} className="civr-btn civr-btn-primary mt-6" data-testid="order-open-number-btn">Set up {num} <ArrowRight className="w-4 h-4" /></Link>
    </div>
  );
  if (o.status === 'verification') return (
    <div className="civr-card civr-trace p-6" data-testid="order-verification">
      <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="w-5 h-5 text-[#34d399]" />Payment received — one last step</div>
      <p className="text-sm text-[#a1a1aa] mt-2">The carrier needs a few details before {num} goes live. Your number is held for you until you finish — no rush.</p>
      {o.substitutedFrom && <p className="text-sm text-[#fbbf24] mt-3" data-testid="order-substituted-notice">{o.message}</p>}
      <Link to={cp('/app/verification')} className="civr-btn civr-btn-primary mt-6" data-testid="order-verification-link">Continue <ArrowRight className="w-4 h-4" /></Link>
    </div>
  );
  if (o.status === 'underpaid') return (
    <div className="civr-card p-6" data-testid="order-underpaid">
      <div className="flex items-center gap-2 text-[#fbbf24] font-semibold"><AlertTriangle className="w-5 h-5" />Payment came in short</div>
      <p className="text-sm text-[#a1a1aa] mt-2">{o.message} Wallet balance: <span className="font-mono text-[#f4f4f5]">{money(balance)}</span>.</p>
      <div className="flex flex-wrap gap-2 mt-6">
        <button className="civr-btn civr-btn-primary" onClick={onFinish} disabled={!!busy || balance < o.charge} data-testid="order-finish-btn">{busy === 'finish' && <Loader2 className="w-4 h-4 animate-spin" />}Finish with wallet</button>
        <Link to={cp(`/app/wallet?need=${Math.max(0, o.charge - balance).toFixed(2)}`)} className="civr-btn civr-btn-ghost" data-testid="order-add-funds-link">Add funds</Link>
      </div>
    </div>
  );
  return (
    <div className="civr-card p-6" data-testid="order-closed">
      <div className="font-semibold">{o.status === 'cancelled' ? 'Order cancelled' : o.status === 'activating' ? 'Activating your number…' : 'We could not finish this order'}</div>
      {o.message && <p className="text-sm text-[#a1a1aa] mt-2" data-testid="order-message">{o.message}</p>}
      {o.status !== 'activating' && <Link to={cp('/app/buy')} className="civr-btn civr-btn-ghost mt-6" data-testid="order-buy-again-link">Pick another number</Link>}
    </div>
  );
}

export default function OrderStatus() {
  const { id } = useParams();
  const { refreshSummary } = useShell();
  const { data, error, loading, reload, setData } = useApi(`/numbers/orders/${enc(id)}`);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const o = data?.order;
  const status = o?.status;
  useEffect(() => {
    if (!['awaiting_payment', 'activating'].includes(status)) return undefined;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [status, reload]);
  useEffect(() => { if (['active', 'verification', 'underpaid'].includes(status)) refreshSummary(); }, [status, refreshSummary]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const act = async (path) => {
    setBusy(path); setErr(null);
    try { setData(await api(`/numbers/orders/${enc(id)}/${path}`, { method: 'POST', body: {} })); refreshSummary(); } catch (e) { setErr(e); } finally { setBusy(''); }
  };
  return (
    <div data-testid="order-page">
      <PageHeader label="Checkout" title={o.kind === 'upgrade' ? 'Your plan upgrade' : 'Your number order'} sub={o.kind === 'upgrade' ? `${o.phoneNumber} → ${o.planName} plan · ${money(o.price)}` : `${o.phoneNumber} · ${o.planName} plan · ${money(o.price)} · auto-renew ${o.autoRenew ? 'on' : 'off'}`} testid="order-header" />
      <Steps status={status} upgrade={o.kind === 'upgrade'} />
      <div className="mb-4"><ErrorNote error={err} testid="order-error" /></div>
      {status === 'awaiting_payment'
        ? <Deposit o={o} busy={busy} onCheck={() => { setBusy('check'); reload().finally(() => setBusy('')); }} onCancel={() => act('cancel')} onSimulate={() => act('simulate-payment')} />
        : <Outcome o={o} balance={data.balance} busy={busy} onFinish={() => act('finish')} />}
    </div>
  );
}
