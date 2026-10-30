import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import QRCode from 'react-qr-code';
import { Wallet as WalletIcon, Copy, Loader2, RefreshCw, AlertTriangle, Info, Coins, Receipt, Plus, Check, Gift } from 'lucide-react';
import { CardComingSoon } from './buy/Checkout';
import { api, useApi, money, when } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, SkeletonCard, SkeletonRows, Empty, ErrorNote, statusPill, useIsPhone } from '../ui';
import { cp } from '../paths';
import { useOffer } from '../offers';
import { Coin, CoinIcon, CoinSelect, PayWindow } from '../Pickers';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));
const PRESETS = [25, 50, 100, 250];
const POLL_MS = 20000;

function DepositCard({ dep }) {
  const preview = dep.dryRun;
  return (
    <div className={`civr-card p-6 civr-rise ${preview ? '' : 'civr-trace'}`} data-testid="wallet-deposit-card">
      {preview && <div className="flex items-center gap-2 text-sm text-[#fbbf24] mb-4" data-testid="wallet-deposit-preview-warning"><AlertTriangle className="w-4 h-4" />Preview mode — this is not a real address. Do not send funds.</div>}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {!preview && <div className="bg-white p-4 rounded-xl shrink-0" data-testid="wallet-deposit-qr"><QRCode value={dep.address} size={148} /></div>}
        <div className="min-w-0 space-y-4">
          <div><div className="text-xs text-[#a1a1aa]">Send exactly</div><div className="font-mono text-2xl" data-testid="wallet-deposit-amount"><span className="inline-flex items-center gap-2"><CoinIcon coin={dep.coin} size={26} />{dep.amountCrypto ? `${dep.amountCrypto} ${dep.coin}` : `${money(dep.amountUsd)} in ${dep.coin}`}</span></div></div>
          <div><div className="text-xs text-[#a1a1aa]">To address</div>
            <div className="flex items-center gap-2"><code className="text-sm break-all" data-testid="wallet-deposit-address">{dep.address}</code>{!preview && <button onClick={() => copy(dep.address)} className="w-11 h-11 shrink-0 flex items-center justify-center text-[#a1a1aa] hover:text-[#818cf8]" aria-label="Copy address" data-testid="wallet-deposit-copy-button"><Copy className="w-4 h-4" /></button>}</div>
          </div>
          <p className="text-xs text-[#a1a1aa]">{dep.note}</p>
          {!preview && <p className="text-xs text-[#a1a1aa]" data-testid="wallet-deposit-polling-note">We check for your payment every 20 seconds while this page is open.</p>}
          {!preview && dep.expiresAt && <PayWindow expiresAt={dep.expiresAt} testid="wallet-deposit-expiry" />}
        </div>
      </div>
    </div>
  );
}

function NeedBanner({ need, forNum }) {
  return (
    <div className="civr-card civr-trace p-4 md:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="wallet-resume-banner">
      <Info className="w-5 h-5 text-[#818cf8] shrink-0" />
      <div className="flex-1 text-sm">Add at least <span className="font-mono">{money(need)}</span> {forNum ? <>to buy <span className="font-mono">{forNum}</span></> : 'to cover your next renewal'}. Your balance updates here once the network confirms the deposit.</div>
      {forNum && <Link to={cp(`/app/buy?resume=1${new URLSearchParams(window.location.search).get('extra') ? `&extra=${encodeURIComponent(new URLSearchParams(window.location.search).get('extra'))}` : ''}`)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="wallet-resume-link">Back to your number</Link>}
    </div>
  );
}

// Bonus the live top-up offer would add for this amount (tiers, or first top-up %).
const bonusFor = (o, n) => {
  if (!o || o.used) return 0;
  if (o.kind === 'topup') return o.tiers.reduce((b, t) => (n >= t.min ? t.bonus : b), 0);
  if (o.kind === 'firstTopup') return n >= o.first.min ? Math.round(Math.min(o.first.max, n * o.first.pct / 100) * 100) / 100 : 0;
  return 0;
};

function OfferNote({ offer, amount, setAmount }) {
  if (!offer || offer.used || !['topup', 'firstTopup'].includes(offer.kind)) return null;
  const bonus = bonusFor(offer, Number(amount) || 0);
  return (
    <div className="civr-offer rounded-xl p-4 text-sm space-y-2" data-testid="wallet-offer">
      <div className="flex items-center gap-2 font-semibold"><Gift className="w-4 h-4 text-[var(--c-accent)]" />{offer.title}</div>
      {offer.kind === 'topup' && <div className="flex flex-wrap gap-2">{offer.tiers.map(t => <button type="button" key={t.min} onClick={() => setAmount(t.min)} className={`civr-pill cursor-pointer ${Number(amount) === t.min ? 'civr-pill-on' : ''}`} data-testid={`wallet-offer-tier-${t.min}`}>{`${money(t.min)} → ${money(t.min + t.bonus)}`}</button>)}</div>}
      {offer.kind === 'firstTopup' && <div className="text-[var(--c-muted)]">{offer.text}</div>}
      <div data-testid="wallet-offer-bonus">{bonus > 0 ? <>You’ll get <span className="font-mono">{money(bonus)}</span> extra — <span className="font-mono">{money((Number(amount) || 0) + bonus)}</span> in total, once the payment confirms.</> : <span className="text-[var(--c-muted)]">Pick an amount above to get the bonus today.</span>}</div>
    </div>
  );
}

function TopUp({ coins, min, initial, onCreated }) {
  const { offer } = useOffer();
  const [amount, setAmount] = useState(initial);
  const [coin, setCoin] = useState(coins[0] || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async (e) => {
    e.preventDefault(); setError(null);
    const n = Number(amount);
    if (!(n >= min) || n > 10000) { setError(new Error(`Enter an amount between $${min} and $10,000.`)); return; }
    setBusy(true);
    try { onCreated(await api('/wallet/topup', { method: 'POST', body: { amountUsd: n, coin } })); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} noValidate className="civr-card p-6 space-y-6" data-testid="wallet-topup-form">
      <div className="font-display text-2xl font-bold">Add funds</div>
      <div className="grid sm:grid-cols-2 gap-3" data-testid="wallet-pay-methods">
        <div className="civr-card civr-trace p-4 flex gap-4 items-start" data-testid="wallet-method-crypto"><Coins className="w-5 h-5 mt-0.5 shrink-0 text-[#818cf8]" /><div className="flex-1"><div className="font-semibold">Crypto</div><div className="text-xs text-[#a1a1aa] mt-1">{`${coins.map(c => c.replace(/\s*\(.*\)/, '')).filter((c, i, a) => a.indexOf(c) === i).slice(0, 4).join(', ')} and more`}</div></div><Check className="w-4 h-4 text-[#818cf8] shrink-0" /></div>
        <CardComingSoon testid="wallet-method-card" />
      </div>
      <OfferNote offer={offer} amount={amount} setAmount={setAmount} />
      <div className="flex flex-wrap gap-2">{PRESETS.map(p => <button type="button" key={p} onClick={() => setAmount(p)} className={`civr-pill civr-preset cursor-pointer ${Number(amount) === p ? 'civr-pill-on' : ''}`} data-testid={`wallet-preset-${p}`}>${p}</button>)}</div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={`Amount (USD, min $${min})`}><input type="number" min={min} max={10000} step="1" className="civr-input font-mono" value={amount} onChange={e => setAmount(e.target.value)} data-testid="wallet-amount-input" /></Field>
        <Field label="Coin"><CoinSelect coins={coins} value={coin} onChange={setCoin} amountUsd={amount} testid="wallet-coin-select" /></Field>
      </div>
      <ErrorNote error={error} testid="wallet-topup-error" />
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="wallet-topup-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Get payment address</button>
    </form>
  );
}

const DEP_LABEL = { waiting: 'Waiting for payment', paid: 'Paid', credited: 'Paid', paid_late: 'Paid (late)', expired: 'Expired', test: 'Test only' };
const depStatus = (d) => DEP_LABEL[d.status] || d.status;
const DepStatus = ({ d }) => <span className={`${statusPill(d.status)} shrink-0 whitespace-nowrap`} title={d.status === 'expired' ? 'Not paid within 6 hours. If you already sent it, it is still credited when it arrives.' : d.status === 'test' ? 'Preview mode: no real payment was created.' : d.status === 'waiting' && d.expiresAt ? `Expires ${when(d.expiresAt)}` : undefined}>{depStatus(d)}</span>;
const signed = (h) => `${h.amount > 0 ? '+' : '−'}${money(Math.abs(h.amount))}`;
const CARD_ROW = 'py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3';

function Deposits({ list }) {
  const phone = useIsPhone();
  if (phone) return (
    <ul className="divide-y divide-[#1f1f1f]" data-testid="wallet-deposits-table">{list.map((d, i) => (
      <li key={d.ref} className={CARD_ROW} data-testid={`wallet-deposit-${i}`}>
        <div className="min-w-0"><div className="font-mono">{money(d.amountUsd)} <span className="text-xs text-[#a1a1aa] inline-flex items-center gap-1 align-middle"><CoinIcon coin={d.coin} size={14} />{d.coin}</span></div><div className="text-xs text-[#a1a1aa] mt-0.5">{when(d.createdAt)}</div></div>
        <DepStatus d={d} />
      </li>
    ))}</ul>
  );
  return (
    <div className="overflow-x-auto -mx-1 px-1" tabIndex={0} role="region" aria-label="Deposits"><table className="civr-table" data-testid="wallet-deposits-table"><thead><tr><th>Amount</th><th>Coin</th><th>Status</th><th>When</th></tr></thead>
      <tbody>{list.map((d, i) => <tr key={d.ref} data-testid={`wallet-deposit-${i}`}><td className="font-mono">{money(d.amountUsd)}</td><td><Coin coin={d.coin} size={16} /></td><td><DepStatus d={d} /></td><td className="text-xs text-[#a1a1aa] whitespace-nowrap">{when(d.createdAt)}</td></tr>)}</tbody></table></div>
  );
}

function History({ list }) {
  const phone = useIsPhone();
  if (phone) return (
    <ul className="divide-y divide-[#1f1f1f]" data-testid="wallet-history-table">{list.map((h, i) => (
      <li key={h.id} className={CARD_ROW} data-testid={`wallet-history-${i}`}>
        <div className="min-w-0"><div className="text-sm text-[#e4e4e7] break-words">{h.description}</div><div className="text-xs text-[#a1a1aa] mt-0.5">{when(h.at)}</div></div>
        <span className={`font-mono shrink-0 ${h.amount > 0 ? 'text-[#34d399]' : ''}`}>{signed(h)}</span>
      </li>
    ))}</ul>
  );
  return (
    <div className="overflow-x-auto -mx-1 px-1" tabIndex={0} role="region" aria-label="Wallet history"><table className="civr-table" data-testid="wallet-history-table"><thead><tr><th>What</th><th>Amount</th><th>When</th></tr></thead>
      <tbody>{list.map((h, i) => <tr key={h.id} data-testid={`wallet-history-${i}`}><td className="text-xs">{h.description}</td><td className={`font-mono whitespace-nowrap ${h.amount > 0 ? 'text-[#34d399]' : ''}`}>{signed(h)}</td><td className="text-xs text-[#a1a1aa] whitespace-nowrap">{when(h.at)}</td></tr>)}</tbody></table></div>
  );
}

function Tables({ data }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4 mt-6">
      <div className="civr-card p-5 sm:p-6 overflow-x-auto">
        <div className="font-display text-2xl font-bold mb-4">Deposits</div>
        {!data.deposits.length ? (
          <Empty bare icon={Coins} title="No deposits yet" sub="Your crypto top-ups and their status show up here." testid="wallet-deposits-empty">
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => { const el = document.querySelector('[data-testid="wallet-amount-input"]'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }} data-testid="wallet-deposits-empty-add-button"><Plus className="w-4 h-4" />Add funds</button>
          </Empty>
        ) : <Deposits list={data.deposits} />}
      </div>
      <div className="civr-card p-5 sm:p-6 overflow-x-auto">
        <div className="font-display text-2xl font-bold mb-4">History</div>
        {!data.history.length ? (
          <Empty bare icon={Receipt} title="No transactions yet" sub="Number purchases, renewals and call charges show up here." testid="wallet-history-empty">
            <Link to={cp('/app/buy')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="wallet-history-empty-buy-link">Buy a number</Link>
          </Empty>
        ) : <History list={data.history} />}
      </div>
    </div>
  );
}

export default function Wallet() {
  const { refreshSummary } = useShell();
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useApi('/wallet');
  const [dep, setDep] = useState(null);
  const need = Math.max(0, Number(params.get('need')) || 0);
  const forNum = params.get('for');
  useEffect(() => {
    if (!dep) return undefined;
    const t = setInterval(() => { reload(); refreshSummary(); }, POLL_MS);
    return () => clearInterval(t);
  }, [dep, reload, refreshSummary]);
  const refresh = () => { reload(); refreshSummary(); };
  const header = (
    <PageHeader label="Wallet" title="Wallet" sub="Numbers, renewals, extra minutes and SMS, forwarded calls, IVR calls, AI agent calls and text calls are paid from here." testid="wallet-header">
      <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={refresh} data-testid="wallet-refresh-button"><RefreshCw className="w-4 h-4" />Check now</button>
    </PageHeader>
  );
  if (loading && !data) return (
    <div>{header}
      <div className="grid lg:grid-cols-3 gap-4"><SkeletonCard lines={2} /><SkeletonCard lines={3} className="lg:col-span-2" testid="wallet-topup-loading" /></div>
      <div className="grid lg:grid-cols-2 gap-4 mt-6"><SkeletonRows rows={3} testid="wallet-deposits-loading" /><SkeletonRows rows={3} testid="wallet-history-loading" /></div>
    </div>
  );
  if (error && !data) return <div data-testid="wallet-page">{header}<ErrorNote error={error} onRetry={reload} /></div>;
  return (
    <div data-testid="wallet-page">
      {header}
      {need > 0 && <NeedBanner need={need} forNum={forNum} />}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="civr-card p-6 flex flex-col justify-between" data-testid="wallet-balance-card">
          <div className="flex items-center justify-between"><span className="civr-label">Balance</span><WalletIcon className="w-5 h-5 text-[#818cf8]" /></div>
          <div className="font-mono text-4xl xl:text-5xl whitespace-nowrap mt-6" data-testid="wallet-balance">{money(data.balance)}</div>
          <div className="text-xs text-[#a1a1aa] mt-2">USD · credited once the network confirms your deposit</div>
        </div>
        <div className="lg:col-span-2"><TopUp coins={data.coins} min={data.minTopup} initial={need ? Math.max(data.minTopup, Math.ceil(need)) : Number(params.get('amount')) || 50} onCreated={(d) => { setDep(d); reload(); }} /></div>
      </div>
      {dep && <div className="mt-4"><DepositCard dep={dep} /></div>}
      <Tables data={data} />
    </div>
  );
}
