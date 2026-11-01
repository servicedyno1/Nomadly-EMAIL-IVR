import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Wallet } from 'lucide-react';
import { money } from './api';
import { cp } from './paths';
import { useShell } from './Shell';
import { CryptoPay } from './CryptoPay';

// Live wallet balance; while something on screen needs more money it re-checks every 15 s so a top-up shows up by itself.
export function useBalance(need = 0, poll = true) {
  const shell = useShell();
  const bal = shell?.summary?.balance;
  const loading = bal == null;
  const short = bal == null ? 0 : Math.max(0, Math.round((need - bal) * 100) / 100);
  const refresh = shell?.refreshSummary;
  useEffect(() => { if (!poll || !(short > 0) || !refresh) return undefined; const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [poll, short, refresh]);
  return { balance: bal, short, enough: need <= 0 || (!loading && !(short > 0)), loading, refresh };
}

// Auto-renew on, but the wallet won't cover the next charge.
export function RenewWarning({ price, date, on = true, testid }) {
  const { balance, short, enough } = useBalance(on && price ? price : 0, false);
  if (!on || !price || enough || balance == null) return null;
  const when = date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#b45309]" role="status" data-testid={testid}>
      <Wallet className="w-3.5 h-3.5" />{when ? `Your wallet (${money(balance)}) won’t cover the ${money(price)} renewal on ${when}.` : `Your wallet (${money(balance)}) won’t cover the ${money(price)} renewal.`}
      <Link to={cp('/app/wallet')} className="underline font-semibold" data-testid={`${testid}-topup`}>{`Top up ${money(short)}`}</Link>
    </p>
  );
}

export function ShortNote({ balance, short, testid }) {
  if (balance == null) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--c-muted)]" data-testid={testid}>
      <Wallet className="w-4 h-4" />{`Wallet ${money(balance)} · ${money(short)} short`}
      <Link to={cp('/app/wallet')} className="underline font-semibold text-[var(--c-accent)]" data-testid={`${testid}-topup`}>Top up</Link>
    </p>
  );
}

// "Pay from wallet" only when the wallet covers it; otherwise what's missing + crypto as the main way to pay.
export function WalletPay({ price, onWallet, onCrypto, label, busy, disabled, crypto = true, small, testid, walletTestid, cryptoTestid, children }) {
  const { balance, short, enough } = useBalance(price);
  const sm = small ? 'civr-btn-sm' : '';
  return (
    <div className="space-y-2 w-full" data-testid={testid}>
      <div className="flex flex-wrap items-start gap-2">
        {enough && <button type="button" onClick={onWallet} disabled={busy || disabled} className={`civr-btn civr-btn-primary ${sm}`} data-testid={walletTestid || `${testid}-wallet`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{label || `Pay ${money(price)} from wallet`}</button>}
        {children}
      </div>
      {!enough && <ShortNote balance={balance} short={short} testid={`${testid}-short`} />}
      {crypto && !disabled && <CryptoPay price={price} onReady={onCrypto || onWallet} primary={!enough} testid={cryptoTestid || `${testid}-crypto`} />}
    </div>
  );
}
