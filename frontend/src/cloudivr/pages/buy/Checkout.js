import React, { useEffect, useRef, useState } from 'react';
import { useSavedAddress } from '../../profile/useSavedAddress';

import { Wallet as WalletIcon, Bitcoin, Loader2, Check, Ticket, X, CreditCard } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { useOffer } from '../../offers';
import { Field, Toggle } from '../../ui';
import { CoinSelect } from '../../Pickers';
import { TextingAddOn } from './TextingAddOn';
import { MolliePay, useMollie } from '../../MolliePay';

function Option({ on, onClick, icon: Icon, title, sub, testid }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`civr-card text-left p-4 flex gap-4 items-start ${on ? 'civr-trace' : ''}`} data-testid={testid}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${on ? 'text-[#818cf8]' : 'text-[#a1a1aa]'}`} />
      <div className="flex-1"><div className="font-semibold">{title}</div><div className="text-xs text-[#a1a1aa] mt-1">{sub}</div></div>
      {on && <Check className="w-4 h-4 text-[#818cf8] shrink-0" />}
    </button>
  );
}

// Card payments are not switched on yet: shown, but disabled, wherever you can pay.
export function CardComingSoon({ testid = 'card-coming-soon', className = '' }) {
  return (
    <div aria-disabled="true" className={`civr-card p-4 flex gap-4 items-start opacity-80 cursor-not-allowed ${className}`} data-testid={testid}>
      <CreditCard className="w-5 h-5 mt-0.5 shrink-0 text-[#a1a1aa]" />
      <div className="flex-1"><div className="font-semibold flex flex-wrap items-center gap-2">Credit / debit card<span className="civr-pill !text-xs" data-testid={`${testid}-badge`}>Coming soon</span></div><div className="text-xs text-[#a1a1aa] mt-1">Visa, Mastercard and more — available soon.</div></div>
    </div>
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
  const { offer } = useOffer();
  const mine = offer && offer.kind === 'number' && !offer.used && new Date(offer.expiresAt) > new Date() ? offer : null;
  const today = mine ? { code: mine.code, discount: mine.discount, mine: true } : data?.coupon && !data.coupon.used ? data.coupon : null;
  if (coupon) return (
    <div className="flex items-center gap-2 text-sm text-[#818cf8] mt-4" data-testid="checkout-coupon-applied"><Ticket className="w-4 h-4" /><span className="font-mono">{coupon.code}</span> · {coupon.discount}% off
      <button type="button" onClick={() => setCoupon(null)} className="p-1 text-[#a1a1aa] hover:text-white" aria-label="Remove coupon" data-testid="checkout-coupon-remove"><X className="w-3.5 h-3.5" /></button></div>
  );
  return (
    <div className="mt-4 space-y-2" data-testid="checkout-coupon">
      <div className="flex gap-2 max-w-sm"><input className="civr-input font-mono uppercase !h-10" value={code} onChange={e => setCode(e.target.value)} placeholder="Coupon code" data-testid="checkout-coupon-input" />
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy || !code.trim()} onClick={() => apply(code)} data-testid="checkout-coupon-apply">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}</button></div>
      {err && <div className="text-xs text-[#fb7185]" data-testid="checkout-coupon-error">{err}</div>}
      {today && <button type="button" onClick={() => apply(today.code)} className="text-xs text-[#818cf8] flex items-center gap-1.5" data-testid="checkout-coupon-today"><Ticket className="w-3.5 h-3.5" />{today.mine ? 'Your offer' : 'Today’s coupon'} <span className="font-mono">{today.code}</span> · {today.discount}% off — tap to use</button>}
    </div>
  );
}

// Pay for the picked number from the wallet or with crypto; auto-renew starts switched on.
export default function Checkout({ pick, planObj, total, balance, coins, busy, onPay, onTopUp, coupon, setCoupon, initialCode, cryptoOk = true, cryptoMin = 0, label, autoRenewDefault = true, textingOffer = null }) {
  const [tx, setTx] = useState({ on: false, zip: '' });
  const { usZip } = useSavedAddress(!!textingOffer?.available);
  useEffect(() => { if (usZip) setTx(v => (v.zip ? v : { ...v, zip: usZip })); }, [usZip]);
  const addOn = textingOffer?.available && tx.on ? textingOffer.bundlePrice : 0;
  const lineDue = coupon ? Math.round(total * (1 - coupon.discount / 100) * 100) / 100 : total;
  const due = Math.round((lineDue + addOn) * 100) / 100;
  const txBad = !!addOn && !/^\d{5}$/.test(tx.zip);
  const short = Math.max(0, Math.round((due - (balance || 0)) * 100) / 100);
  const [method, setMethod] = useState(short > 0 && cryptoOk ? 'crypto' : 'wallet');
  useEffect(() => { if (short > 0 && cryptoOk && method === 'wallet') setMethod('crypto'); }, [short, cryptoOk, method]);
  const [coin, setCoin] = useState(coins[0] || '');
  const [autoRenew, setAutoRenew] = useState(autoRenewDefault);
  const walletShort = method === 'wallet' && short > 0;
  const mol = useMollie(due > 0 ? Math.max(10, Math.ceil(short || due)) : 0), cardOk = !!mol?.enabled && mol.currencies.length > 0;
  const extra = { autoRenew, ...(addOn ? { texting: { zipcode: tx.zip } } : {}) };
  // Short wallet: its balance pays part, crypto only the rest (never below the crypto minimum).
  const part = short > 0 && (balance || 0) > 0 ? Math.round(balance * 100) / 100 : 0;
  const cryptoDue = part ? Math.max(short, cryptoMin) : Math.max(due, cryptoMin);
  return (
    <div className="civr-card p-6 mt-6" data-testid="buy-summary">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1"><div className="font-mono text-xl" data-testid="buy-summary-number">{pick.phoneNumber}</div><div className="text-sm text-[#a1a1aa]">{label || `${planObj?.name} plan · monthly`}{!label && <button type="button" onClick={() => document.querySelector('[data-testid="buy-plan-picker"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="ml-2 underline underline-offset-2 hover:text-[#818cf8]" data-testid="buy-change-plan">Change plan</button>}</div></div>
        <div className="text-right">{coupon && <div className="font-mono text-sm text-[#a1a1aa] line-through" data-testid="buy-total-before">{money(total + addOn)}</div>}<div className="font-mono text-3xl" data-testid="buy-total">{money(due)}</div>{addOn > 0 && <div className="text-xs text-[var(--c-muted)]" data-testid="buy-total-texting">{`Includes Texting Number ${money(addOn)}`}</div>}{coupon && <div className="text-xs text-[#a1a1aa]">first month · then {money(total)}/month</div>}</div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        {short > 0 && cryptoOk
          ? <div className="civr-card p-4 text-sm" data-testid="civr-checkout-wallet-short"><div className="flex items-center gap-2 font-semibold"><WalletIcon className="w-4 h-4" />Wallet {money(balance)}</div><div className="text-xs text-[#a1a1aa] mt-1">{money(short)} short · <button type="button" onClick={() => onTopUp(short)} className="underline font-semibold text-[var(--c-accent)]" data-testid="civr-checkout-wallet-topup">Top up</button></div></div>
          : <Option on={method === 'wallet'} onClick={() => setMethod('wallet')} icon={WalletIcon} title="Pay from wallet" sub={`Balance ${money(balance)}${short > 0 ? ` · ${money(short)} short` : ' · activates instantly'}`} testid="civr-checkout-wallet-option" />}
        {cardOk ? <Option on={method === 'card'} onClick={() => setMethod('card')} icon={CreditCard} title={part ? 'Wallet + card for the rest' : 'Pay by card'} sub={`${mol.currencies.map(c => c.currency).slice(0, 4).join(', ')} · secure checkout by Mollie${mol.mode === 'test' ? ' (test mode)' : ''}`} testid="civr-checkout-card-option" /> : <CardComingSoon testid="civr-checkout-card-option" />}
        {cryptoOk ? <Option on={method === 'crypto'} onClick={() => setMethod('crypto')} icon={Bitcoin} title={part ? 'Wallet + crypto for the rest' : 'Pay with crypto'} sub={part ? `Uses your ${money(part)} wallet balance — send just ${money(cryptoDue)} in crypto.` : 'Send the exact price — the number activates once the network confirms.'} testid="civr-checkout-crypto-option" />
          : <div className="civr-card p-4 text-xs text-[#a1a1aa] flex gap-3"><Bitcoin className="w-5 h-5 shrink-0 text-[#a1a1aa]" />Crypto isn’t available for this payment. Pay from your wallet — short? Add funds with crypto first.</div>}
      </div>
      <TextingAddOn offer={textingOffer} value={tx} onChange={setTx} />
      {setCoupon && <CouponField total={total} coupon={coupon} setCoupon={setCoupon} initialCode={initialCode} />}
      {method === 'crypto' && (
        <div className="mt-4 max-w-xs"><Field label="Coin"><CoinSelect coins={coins} value={coin} onChange={setCoin} amountUsd={cryptoDue} testid="civr-checkout-coin-select" /></Field></div>
      )}
      {method === 'crypto' && part > 0 && <div className="text-xs text-[#a1a1aa] mt-2" data-testid="civr-checkout-split-note">{`${money(part)} from your wallet + ${money(cryptoDue)} in crypto${cryptoDue > short ? ` (the crypto minimum — the extra ${money(Math.round((cryptoDue - short) * 100) / 100)} stays in your wallet)` : ''}. If the crypto arrives short, nothing is bought and everything stays in your wallet.`}</div>}
      {method === 'crypto' && !part && cryptoMin > due && <div className="text-xs text-[#a1a1aa] mt-2" data-testid="civr-checkout-crypto-min">Crypto payments start at {money(cryptoMin)} — anything over {money(due)} stays in your wallet.</div>}
      <div className="flex items-center justify-between gap-4 mt-6 py-4 border-y border-[#1c1c1c]">
        <div><div className="text-sm font-medium">Auto-renew monthly</div><div className="text-xs text-[#a1a1aa] mt-0.5">Renews from your wallet so the number never lapses. Turn it off any time.</div></div>
        <Toggle checked={autoRenew} onChange={setAutoRenew} testid="civr-checkout-auto-renew-toggle" label="Auto-renew monthly" />
      </div>
      {walletShort && <div className="text-sm text-[#fbbf24] mt-4" data-testid="buy-shortfall-note">You need {money(short)} more in your wallet. Add funds — we keep this number and plan selected{cryptoOk ? ' — or pay with crypto instead' : ''}.</div>}
      {method === 'card' && cardOk && <div className="mt-4" data-testid="civr-checkout-card-pay"><MolliePay price={due} startOpen onReady={() => onPay({ method: 'wallet', ...extra })} testid="civr-checkout-mollie" /></div>}
      <div className={`mt-6 flex justify-end ${method === 'card' ? 'hidden' : ''}`}>
        {walletShort
          ? <button type="button" onClick={() => onTopUp(short)} className="civr-btn civr-btn-primary" data-testid="buy-topup-link"><WalletIcon className="w-4 h-4" />Add {money(short)} to wallet</button>
          : <button type="button" className="civr-btn civr-btn-primary" disabled={busy || txBad || (method === 'crypto' && !coin)} onClick={() => onPay({ method, coin, autoRenew, useWallet: method === 'crypto' && part > 0, ...(addOn ? { texting: { zipcode: tx.zip } } : {}) })} data-testid="civr-checkout-pay-now-btn">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{method === 'crypto' ? `Pay ${money(part ? cryptoDue : due)} with ${coin || 'crypto'}` : `Pay ${money(due)} & activate`}</button>}
      </div>
    </div>
  );
}
