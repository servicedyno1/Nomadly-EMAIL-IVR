import React, { useEffect, useRef, useState } from 'react';
import { Wallet as WalletIcon, Bitcoin, Loader2, Check, Ticket, X } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { Field, Toggle } from '../../ui';

function Option({ on, onClick, icon: Icon, title, sub, testid }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`civr-card text-left p-4 flex gap-4 items-start ${on ? 'civr-trace' : ''}`} data-testid={testid}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${on ? 'text-[#34d399]' : 'text-[#a1a1aa]'}`} />
      <div className="flex-1"><div className="font-semibold">{title}</div><div className="text-xs text-[#a1a1aa] mt-1">{sub}</div></div>
      {on && <Check className="w-4 h-4 text-[#34d399] shrink-0" />}
    </button>
  );
}

// Same coupon codes as the bot; today's daily code is offered with one tap. coupon = { code, discount } | null.
export function CouponField({ total, coupon, setCoupon, initialCode }) {
  const { data } = useApi('/coupons/today');
  const [code, setCode] = useState(initialCode || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tried = useRef(false);
  const apply = async (c) => {
    setBusy(true); setErr('');
    try { const d = await api('/coupons/check', { method: 'POST', body: { code: c, amount: total } }); setCoupon({ code: d.code, discount: d.discount }); setCode(d.code); } catch (e) { setErr(e.message); setCoupon(null); } finally { setBusy(false); }
  };
  useEffect(() => { if (initialCode && !coupon && !tried.current) { tried.current = true; apply(initialCode); } });
  const today = data?.coupon && !data.coupon.used ? data.coupon : null;
  if (coupon) return (
    <div className="flex items-center gap-2 text-sm text-[#34d399] mt-4" data-testid="checkout-coupon-applied"><Ticket className="w-4 h-4" /><span className="font-mono">{coupon.code}</span> · {coupon.discount}% off
      <button type="button" onClick={() => setCoupon(null)} className="p-1 text-[#a1a1aa] hover:text-white" aria-label="Remove coupon" data-testid="checkout-coupon-remove"><X className="w-3.5 h-3.5" /></button></div>
  );
  return (
    <div className="mt-4 space-y-2" data-testid="checkout-coupon">
      <div className="flex gap-2 max-w-sm"><input className="civr-input font-mono uppercase !h-10" value={code} onChange={e => setCode(e.target.value)} placeholder="Coupon code" data-testid="checkout-coupon-input" />
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy || !code.trim()} onClick={() => apply(code)} data-testid="checkout-coupon-apply">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}</button></div>
      {err && <div className="text-xs text-[#fb7185]" data-testid="checkout-coupon-error">{err}</div>}
      {today && <button type="button" onClick={() => apply(today.code)} className="text-xs text-[#34d399] flex items-center gap-1.5" data-testid="checkout-coupon-today"><Ticket className="w-3.5 h-3.5" />Today’s coupon <span className="font-mono">{today.code}</span> · {today.discount}% off — tap to use</button>}
    </div>
  );
}

// Pay for the picked number from the wallet or with crypto; auto-renew starts switched on.
export default function Checkout({ pick, planObj, total, balance, coins, busy, onPay, onTopUp, coupon, setCoupon, initialCode, cryptoOk = true, cryptoMin = 0, label }) {
  const due = coupon ? Math.round(total * (1 - coupon.discount / 100) * 100) / 100 : total;
  const short = Math.max(0, Math.round((due - (balance || 0)) * 100) / 100);
  const [method, setMethod] = useState(short > 0 && cryptoOk ? 'crypto' : 'wallet');
  const [coin, setCoin] = useState(coins[0] || '');
  const [autoRenew, setAutoRenew] = useState(true);
  const walletShort = method === 'wallet' && short > 0;
  return (
    <div className="civr-card p-6 mt-6" data-testid="buy-summary">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1"><div className="font-mono text-xl" data-testid="buy-summary-number">{pick.phoneNumber}</div><div className="text-sm text-[#a1a1aa]">{label || `${planObj?.name} plan · monthly`}</div></div>
        <div className="text-right">{coupon && <div className="font-mono text-sm text-[#a1a1aa] line-through" data-testid="buy-total-before">{money(total)}</div>}<div className="font-mono text-3xl" data-testid="buy-total">{money(due)}</div>{coupon && <div className="text-xs text-[#a1a1aa]">first month · then {money(total)}/month</div>}</div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-6">
        <Option on={method === 'wallet'} onClick={() => setMethod('wallet')} icon={WalletIcon} title="Pay from wallet" sub={`Balance ${money(balance)}${short > 0 ? ` · ${money(short)} short` : ' · activates instantly'}`} testid="civr-checkout-wallet-option" />
        {cryptoOk ? <Option on={method === 'crypto'} onClick={() => setMethod('crypto')} icon={Bitcoin} title="Pay with crypto" sub="Send the exact price — the number activates once the network confirms." testid="civr-checkout-crypto-option" />
          : <div className="civr-card p-4 text-xs text-[#a1a1aa] flex gap-3"><Bitcoin className="w-5 h-5 shrink-0 text-[#a1a1aa]" />Extra numbers are paid from the wallet. Short? Add funds with crypto first.</div>}
      </div>
      {setCoupon && <CouponField total={total} coupon={coupon} setCoupon={setCoupon} initialCode={initialCode} />}
      {method === 'crypto' && (
        <div className="mt-4 max-w-xs"><Field label="Coin"><select className="civr-input" value={coin} onChange={e => setCoin(e.target.value)} data-testid="civr-checkout-coin-select">{coins.map(c => <option key={c}>{c}</option>)}</select></Field></div>
      )}
      {method === 'crypto' && cryptoMin > due && <div className="text-xs text-[#a1a1aa] mt-2" data-testid="civr-checkout-crypto-min">Crypto payments start at {money(cryptoMin)} — anything over {money(due)} stays in your wallet.</div>}
      <div className="flex items-center justify-between gap-4 mt-6 py-4 border-y border-[#1c1c1c]">
        <div><div className="text-sm font-medium">Auto-renew monthly</div><div className="text-xs text-[#a1a1aa] mt-0.5">Renews from your wallet so the number never lapses. Turn it off any time.</div></div>
        <Toggle checked={autoRenew} onChange={setAutoRenew} testid="civr-checkout-auto-renew-toggle" />
      </div>
      {walletShort && <div className="text-sm text-[#fbbf24] mt-4" data-testid="buy-shortfall-note">You need {money(short)} more in your wallet. Add funds — we keep this number and plan selected{cryptoOk ? ' — or pay with crypto instead' : ''}.</div>}
      <div className="mt-6 flex justify-end">
        {walletShort
          ? <button type="button" onClick={() => onTopUp(short)} className="civr-btn civr-btn-primary" data-testid="buy-topup-link"><WalletIcon className="w-4 h-4" />Add {money(short)} to wallet</button>
          : <button type="button" className="civr-btn civr-btn-primary" disabled={busy || (method === 'crypto' && !coin)} onClick={() => onPay({ method, coin, autoRenew })} data-testid="civr-checkout-pay-now-btn">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{method === 'crypto' ? `Pay ${money(due)} with ${coin || 'crypto'}` : `Pay ${money(due)} & activate`}</button>}
      </div>
    </div>
  );
}
