import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import QRCode from 'react-qr-code';
import { Wallet as WalletIcon, Copy, Loader2, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import { api, useApi, money, when } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, Spinner, ErrorNote, statusPill } from '../ui';
import { cp } from '../paths';

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
          <div><div className="text-xs text-[#a1a1aa]">Send exactly</div><div className="font-mono text-2xl" data-testid="wallet-deposit-amount">{dep.amountCrypto ? `${dep.amountCrypto} ${dep.coin}` : `${money(dep.amountUsd)} in ${dep.coin}`}</div></div>
          <div><div className="text-xs text-[#a1a1aa]">To address</div>
            <div className="flex items-center gap-2"><code className="text-sm break-all" data-testid="wallet-deposit-address">{dep.address}</code>{!preview && <button onClick={() => copy(dep.address)} className="w-11 h-11 shrink-0 flex items-center justify-center text-[#9a9a9a] hover:text-[#34d399]" aria-label="Copy address" data-testid="wallet-deposit-copy-button"><Copy className="w-4 h-4" /></button>}</div>
          </div>
          <p className="text-xs text-[#a1a1aa]">{dep.note}</p>
          {!preview && <p className="text-xs text-[#9a9a9a]" data-testid="wallet-deposit-polling-note">We check for your payment every 20 seconds while this page is open.</p>}
        </div>
      </div>
    </div>
  );
}

function NeedBanner({ need, forNum }) {
  return (
    <div className="civr-card civr-trace p-4 md:p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="wallet-resume-banner">
      <Info className="w-5 h-5 text-[#34d399] shrink-0" />
      <div className="flex-1 text-sm">Add at least <span className="font-mono">{money(need)}</span> {forNum ? <>to buy <span className="font-mono">{forNum}</span></> : 'to cover your next renewal'}. Your balance updates here once the network confirms the deposit.</div>
      {forNum && <Link to={cp('/app/buy?resume=1')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="wallet-resume-link">Back to your number</Link>}
    </div>
  );
}

function TopUp({ coins, min, initial, onCreated }) {
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
      <div className="font-display text-2xl font-bold">Add funds with crypto</div>
      <div className="flex flex-wrap gap-2">{PRESETS.map(p => <button type="button" key={p} onClick={() => setAmount(p)} className={`civr-pill civr-preset cursor-pointer ${Number(amount) === p ? 'civr-pill-on' : ''}`} data-testid={`wallet-preset-${p}`}>${p}</button>)}</div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={`Amount (USD, min $${min})`}><input type="number" min={min} max={10000} step="1" className="civr-input font-mono" value={amount} onChange={e => setAmount(e.target.value)} data-testid="wallet-amount-input" /></Field>
        <Field label="Coin"><select className="civr-input" value={coin} onChange={e => setCoin(e.target.value)} data-testid="wallet-coin-select">{coins.map(c => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <ErrorNote error={error} testid="wallet-topup-error" />
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="wallet-topup-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Get payment address</button>
    </form>
  );
}

function Tables({ data }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4 mt-6">
      <div className="civr-card p-6 overflow-x-auto">
        <div className="font-display text-2xl font-bold mb-4">Deposits</div>
        {!data.deposits.length ? <div className="text-sm text-[#9a9a9a] py-6" data-testid="wallet-deposits-empty">No deposits yet.</div> : (
          <table className="civr-table" data-testid="wallet-deposits-table"><thead><tr><th>Amount</th><th>Coin</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{data.deposits.map((d, i) => <tr key={d.ref} data-testid={`wallet-deposit-${i}`}><td className="font-mono">{money(d.amountUsd)}</td><td>{d.coin}</td><td><span className={statusPill(d.status)}>{d.address === 'PREVIEW-MODE-DO-NOT-SEND-FUNDS' ? 'preview' : d.status}</span></td><td className="text-xs text-[#a1a1aa]">{when(d.createdAt)}</td></tr>)}</tbody></table>
        )}
      </div>
      <div className="civr-card p-6 overflow-x-auto">
        <div className="font-display text-2xl font-bold mb-4">History</div>
        {!data.history.length ? <div className="text-sm text-[#9a9a9a] py-6" data-testid="wallet-history-empty">No transactions yet.</div> : (
          <table className="civr-table" data-testid="wallet-history-table"><thead><tr><th>What</th><th>Amount</th><th>When</th></tr></thead>
            <tbody>{data.history.map((h, i) => <tr key={h.id} data-testid={`wallet-history-${i}`}><td className="text-xs">{h.description}</td><td className={`font-mono ${h.amount > 0 ? 'text-[#34d399]' : ''}`}>{h.amount > 0 ? '+' : '−'}{money(Math.abs(h.amount))}</td><td className="text-xs text-[#a1a1aa]">{when(h.at)}</td></tr>)}</tbody></table>
        )}
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
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const refresh = () => { reload(); refreshSummary(); };
  return (
    <div data-testid="wallet-page">
      <PageHeader label="Wallet" title="Wallet" sub="Numbers, renewals, forwarded minutes and IVR calls are paid from here." testid="wallet-header">
        <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={refresh} data-testid="wallet-refresh-button"><RefreshCw className="w-4 h-4" />Check now</button>
      </PageHeader>
      {need > 0 && <NeedBanner need={need} forNum={forNum} />}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="civr-card p-6 flex flex-col justify-between" data-testid="wallet-balance-card">
          <div className="flex items-center justify-between"><span className="civr-label">Balance</span><WalletIcon className="w-5 h-5 text-[#34d399]" /></div>
          <div className="font-mono text-5xl mt-6" data-testid="wallet-balance">{money(data.balance)}</div>
          <div className="text-xs text-[#9a9a9a] mt-2">USD · credited once the network confirms your deposit</div>
        </div>
        <div className="lg:col-span-2"><TopUp coins={data.coins} min={data.minTopup} initial={need ? Math.max(data.minTopup, Math.ceil(need)) : 50} onCreated={(d) => { setDep(d); reload(); }} /></div>
      </div>
      {dep && <div className="mt-4"><DepositCard dep={dep} /></div>}
      <Tables data={data} />
    </div>
  );
}
