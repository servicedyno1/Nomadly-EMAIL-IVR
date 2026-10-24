import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Wallet as WalletIcon, Bitcoin, Loader2 } from 'lucide-react';
import { api, enc, money } from '../../api';
import { cp } from '../../paths';

// After the upgrade price is shown: pay it from the wallet, or send crypto for it (opens the order page).
export function UpgradePay({ num, plan, quote, coins = [], busy, onWallet }) {
  const nav = useNavigate();
  const [coin, setCoin] = useState(coins[0] || '');
  const [sending, setSending] = useState(false);
  const crypto = async () => {
    setSending(true);
    try { const d = await api(`/numbers/${enc(num.phoneNumber)}/upgrade-checkout`, { method: 'POST', body: { plan, coin } }); nav(cp(`/app/orders/${enc(d.order.id)}`)); } catch (e) { toast.error(e.message); } finally { setSending(false); }
  };
  return (
    <div className="grid sm:grid-cols-2 gap-3" data-testid="billing-upgrade-pay">
      <button className="civr-btn civr-btn-primary" disabled={busy} onClick={onWallet} data-testid="billing-upgrade-confirm-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <WalletIcon className="w-4 h-4" />}Pay {money(quote.charge)} from wallet</button>
      {coins.length > 0 && (
        <div className="flex gap-2">
          <select className="civr-input !w-28 !h-11" value={coin} onChange={e => setCoin(e.target.value)} aria-label="Coin" data-testid="billing-upgrade-coin-select">{coins.map(c => <option key={c}>{c}</option>)}</select>
          <button className="civr-btn civr-btn-ghost flex-1" disabled={sending || !coin} onClick={crypto} data-testid="billing-upgrade-crypto-button">{sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bitcoin className="w-4 h-4" />}Pay with crypto</button>
        </div>
      )}
      {quote.charge < 10 && coins.length > 0 && <div className="text-xs text-[#a1a1aa] sm:col-span-2" data-testid="billing-upgrade-crypto-min">Crypto payments start at $10 — anything over the upgrade price stays in your wallet.</div>}
    </div>
  );
}
