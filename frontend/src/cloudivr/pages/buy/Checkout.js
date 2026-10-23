import React, { useState } from 'react';
import { Wallet as WalletIcon, Bitcoin, Loader2, Check } from 'lucide-react';
import { money } from '../../api';
import { Field, Toggle } from '../../ui';

function Option({ on, onClick, icon: Icon, title, sub, testid }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`civr-card text-left p-4 flex gap-4 items-start ${on ? 'civr-trace' : ''}`} data-testid={testid}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${on ? 'text-[#34d399]' : 'text-[#9a9a9a]'}`} />
      <div className="flex-1"><div className="font-semibold">{title}</div><div className="text-xs text-[#a1a1aa] mt-1">{sub}</div></div>
      {on && <Check className="w-4 h-4 text-[#34d399] shrink-0" />}
    </button>
  );
}

// Pay for the picked number from the wallet or with crypto; auto-renew starts switched on.
export default function Checkout({ pick, planObj, total, balance, coins, busy, onPay, onTopUp }) {
  const short = Math.max(0, Math.round((total - (balance || 0)) * 100) / 100);
  const [method, setMethod] = useState(short > 0 ? 'crypto' : 'wallet');
  const [coin, setCoin] = useState(coins[0] || '');
  const [autoRenew, setAutoRenew] = useState(true);
  const walletShort = method === 'wallet' && short > 0;
  return (
    <div className="civr-card p-6 mt-6" data-testid="buy-summary">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1"><div className="font-mono text-xl" data-testid="buy-summary-number">{pick.phoneNumber}</div><div className="text-sm text-[#a1a1aa]">{planObj?.name} plan · monthly</div></div>
        <div className="font-mono text-3xl" data-testid="buy-total">{money(total)}</div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-6">
        <Option on={method === 'wallet'} onClick={() => setMethod('wallet')} icon={WalletIcon} title="Pay from wallet" sub={`Balance ${money(balance)}${short > 0 ? ` · ${money(short)} short` : ' · activates instantly'}`} testid="civr-checkout-wallet-option" />
        <Option on={method === 'crypto'} onClick={() => setMethod('crypto')} icon={Bitcoin} title="Pay with crypto" sub="Send the exact price — the number activates once the network confirms." testid="civr-checkout-crypto-option" />
      </div>
      {method === 'crypto' && (
        <div className="mt-4 max-w-xs"><Field label="Coin"><select className="civr-input" value={coin} onChange={e => setCoin(e.target.value)} data-testid="civr-checkout-coin-select">{coins.map(c => <option key={c}>{c}</option>)}</select></Field></div>
      )}
      <div className="flex items-center justify-between gap-4 mt-6 py-4 border-y border-[#1c1c1c]">
        <div><div className="text-sm font-medium">Auto-renew monthly</div><div className="text-xs text-[#8a8a8a] mt-0.5">Renews from your wallet so the number never lapses. Turn it off any time.</div></div>
        <Toggle checked={autoRenew} onChange={setAutoRenew} testid="civr-checkout-auto-renew-toggle" />
      </div>
      {walletShort && <div className="text-sm text-[#fbbf24] mt-4" data-testid="buy-shortfall-note">You need {money(short)} more in your wallet. Add funds — we keep this number and plan selected — or pay with crypto instead.</div>}
      <div className="mt-6 flex justify-end">
        {walletShort
          ? <button type="button" onClick={() => onTopUp(short)} className="civr-btn civr-btn-primary" data-testid="buy-topup-link"><WalletIcon className="w-4 h-4" />Add {money(short)} to wallet</button>
          : <button type="button" className="civr-btn civr-btn-primary" disabled={busy || (method === 'crypto' && !coin)} onClick={() => onPay({ method, coin, autoRenew })} data-testid="civr-checkout-pay-now-btn">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{method === 'crypto' ? `Pay ${money(total)} with ${coin || 'crypto'}` : `Pay ${money(total)} & activate`}</button>}
      </div>
    </div>
  );
}
