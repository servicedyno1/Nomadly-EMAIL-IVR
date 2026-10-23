import React, { useState } from 'react';
import { toast } from 'sonner';
import QRCode from 'react-qr-code';
import { Wallet as WalletIcon, Copy, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { api, useApi, money, when } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, Spinner, ErrorNote, statusPill } from '../ui';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));
const PRESETS = [25, 50, 100, 250];

function DepositCard({ dep }) {
  const preview = dep.dryRun;
  return (
    <div className={`civr-card p-6 civr-rise ${preview ? '' : 'civr-trace'}`} data-testid="wallet-deposit-card">
      {preview && <div className="flex items-center gap-2 text-sm text-[#fbbf24] mb-4" data-testid="wallet-deposit-preview-warning"><AlertTriangle className="w-4 h-4" />Preview mode — this is not a real address. Do not send funds.</div>}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {!preview && <div className="bg-white p-3 rounded-xl shrink-0" data-testid="wallet-deposit-qr"><QRCode value={dep.address} size={148} /></div>}
        <div className="min-w-0 space-y-3">
          <div><div className="text-xs text-[#888]">Send exactly</div><div className="font-mono text-2xl" data-testid="wallet-deposit-amount">{dep.amountCrypto ? `${dep.amountCrypto} ${dep.coin}` : `${money(dep.amountUsd)} in ${dep.coin}`}</div></div>
          <div><div className="text-xs text-[#888]">To address</div>
            <div className="flex items-center gap-2"><code className="text-sm break-all" data-testid="wallet-deposit-address">{dep.address}</code>{!preview && <button onClick={() => copy(dep.address)} className="p-1 text-[#666] hover:text-[#34d399]" data-testid="wallet-deposit-copy-button"><Copy className="w-4 h-4" /></button>}</div>
          </div>
          <p className="text-xs text-[#888]">{dep.note}</p>
        </div>
      </div>
    </div>
  );
}

function TopUp({ coins, min, onCreated }) {
  const [amount, setAmount] = useState(50);
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
    <form onSubmit={go} noValidate className="civr-card p-6 space-y-5" data-testid="wallet-topup-form">
      <div className="font-display text-2xl font-bold">Add funds with crypto</div>
      <div className="flex flex-wrap gap-2">{PRESETS.map(p => <button type="button" key={p} onClick={() => setAmount(p)} className={`civr-pill cursor-pointer !text-sm ${Number(amount) === p ? 'civr-pill-on' : ''}`} data-testid={`wallet-preset-${p}`}>${p}</button>)}</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={`Amount (USD, min $${min})`}><input type="number" min={min} max={10000} step="1" className="civr-input font-mono" value={amount} onChange={e => setAmount(e.target.value)} data-testid="wallet-amount-input" /></Field>
        <Field label="Coin"><select className="civr-input" value={coin} onChange={e => setCoin(e.target.value)} data-testid="wallet-coin-select">{coins.map(c => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <ErrorNote error={error} testid="wallet-topup-error" />
      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="wallet-topup-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Get payment address</button>
    </form>
  );
}

export default function Wallet() {
  const { refreshSummary } = useShell();
  const { data, error, loading, reload } = useApi('/wallet');
  const [dep, setDep] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const refresh = () => { reload(); refreshSummary(); };
  return (
    <div data-testid="wallet-page">
      <PageHeader label="Wallet" title="Wallet" sub="Numbers, renewals, forwarded minutes and IVR calls are paid from here." testid="wallet-header">
        <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={refresh} data-testid="wallet-refresh-button"><RefreshCw className="w-4 h-4" />Refresh</button>
      </PageHeader>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="civr-card p-6 flex flex-col justify-between" data-testid="wallet-balance-card">
          <div className="flex items-center justify-between"><span className="civr-label">Balance</span><WalletIcon className="w-5 h-5 text-[#34d399]" /></div>
          <div className="font-mono text-5xl mt-6" data-testid="wallet-balance">{money(data.balance)}</div>
          <div className="text-xs text-[#666] mt-2">USD · updates automatically after the network confirms a deposit</div>
        </div>
        <div className="lg:col-span-2"><TopUp coins={data.coins} min={data.minTopup} onCreated={(d) => { setDep(d); reload(); }} /></div>
      </div>
      {dep && <div className="mt-4"><DepositCard dep={dep} /></div>}
      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <div className="civr-card p-5 overflow-x-auto">
          <div className="font-display text-2xl font-bold mb-3">Deposits</div>
          {!data.deposits.length ? <div className="text-sm text-[#666] py-6" data-testid="wallet-deposits-empty">No deposits yet.</div> : (
            <table className="civr-table" data-testid="wallet-deposits-table"><thead><tr><th>Amount</th><th>Coin</th><th>Status</th><th>When</th></tr></thead>
              <tbody>{data.deposits.map((d, i) => <tr key={d.ref} data-testid={`wallet-deposit-${i}`}><td className="font-mono">{money(d.amountUsd)}</td><td>{d.coin}</td><td><span className={statusPill(d.status)}>{d.address === 'PREVIEW-MODE-DO-NOT-SEND-FUNDS' ? 'preview' : d.status}</span></td><td className="text-xs text-[#888]">{when(d.createdAt)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="civr-card p-5 overflow-x-auto">
          <div className="font-display text-2xl font-bold mb-3">History</div>
          {!data.history.length ? <div className="text-sm text-[#666] py-6" data-testid="wallet-history-empty">No transactions yet.</div> : (
            <table className="civr-table" data-testid="wallet-history-table"><thead><tr><th>What</th><th>Amount</th><th>When</th></tr></thead>
              <tbody>{data.history.map((h, i) => <tr key={h.id} data-testid={`wallet-history-${i}`}><td className="text-xs">{h.description}</td><td className={`font-mono ${h.amount > 0 ? 'text-[#34d399]' : ''}`}>{h.amount > 0 ? '+' : '−'}{money(Math.abs(h.amount))}</td><td className="text-xs text-[#888]">{when(h.at)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
