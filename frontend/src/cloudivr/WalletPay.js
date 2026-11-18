import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Wallet } from 'lucide-react';
import { money } from './api';
import { cp } from './paths';
import { useShell } from './Shell';
import { CryptoPay } from './CryptoPay';
import { MolliePay, useMollie } from './MolliePay';

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

// crypto: also offer "pay just the missing part in crypto" right here (off where the screen has its own crypto button).
export function ShortNote({ balance, short, testid, crypto = true }) {
  const shell = useShell();
  if (balance == null) return null;
  const total = Math.round((balance + short) * 100) / 100;
  return (
    <div className="space-y-2" data-testid={`${testid}-wrap`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--c-muted)]" data-testid={testid}>
        <Wallet className="w-4 h-4" />{`Wallet ${money(balance)} · ${money(short)} short`}
        <Link to={cp(`/app/wallet?need=${short}`)} className="underline font-semibold text-[var(--c-accent)]" data-testid={`${testid}-topup`}>Top up</Link>
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <MolliePay price={total} onReady={() => shell?.refreshSummary?.()} testid={`${testid}-card`} />
        {crypto && <CryptoPay price={total} onReady={() => shell?.refreshSummary?.()} testid={`${testid}-crypto`} />}
      </div>
    </div>
  );
}

// One payment block: what it costs, what the wallet covers, then one button per way to pay (wallet, card or bank, crypto).
export function WalletPay({ price, onWallet, onCrypto, label, busy, disabled, crypto = true, small, testid, walletTestid, cryptoTestid, children }) {
  const { balance, short, enough, loading } = useBalance(price);
  const cardOn = !!useMollie(price >= 1 ? Math.ceil(price) : 0)?.enabled;
  const sm = small ? 'civr-btn-sm' : '';
  const paid = onCrypto || onWallet;
  return (
    <div className={`w-full space-y-3 ${small ? '' : 'rounded-xl border border-[var(--c-border)] bg-[var(--c-surface-subtle,transparent)] p-4'}`} data-testid={testid}>
      {!small && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-[var(--c-muted)]">Total today</span>
          <span className="font-mono text-lg font-semibold" data-testid={`${testid}-total`}>{money(price)}</span>
        </div>
      )}
      {!loading && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--c-muted)]" data-testid={`${testid}-short`}>
          <Wallet className="w-4 h-4" />{enough ? `Wallet ${money(balance)} covers this` : `Wallet ${money(balance)} · ${money(short)} short`}
          {!enough && <Link to={cp(`/app/wallet?need=${short}`)} className="underline font-semibold text-[var(--c-accent)]" data-testid={`${testid}-short-topup`}>Top up</Link>}
        </p>
      )}
      {disabled && !enough && !loading && <p className="text-sm text-[var(--c-muted)]" data-testid={`${testid}-fill-first`}>Fill in the details above to see the ways to pay.</p>}
      <div className="flex flex-wrap items-start gap-2" data-testid={`${testid}-methods`}>
        {enough && <button type="button" onClick={onWallet} disabled={busy || disabled} className={`civr-btn civr-btn-primary ${sm}`} data-testid={walletTestid || `${testid}-wallet`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{label || `Pay ${money(price)} from wallet`}</button>}
        {!disabled && <MolliePay price={price} onReady={paid} primary={!enough} testid={`${testid}-card`} />}
        {crypto && !disabled && <CryptoPay price={price} onReady={paid} primary={!enough && !cardOn} testid={cryptoTestid || `${testid}-crypto`} />}
        {children}
      </div>
    </div>
  );
}
