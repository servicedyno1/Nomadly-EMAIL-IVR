import React, { useEffect, useRef, useState } from 'react';
import { Wallet as WalletIcon, Loader2, CheckCircle2 } from 'lucide-react';
import { api, money, setFundsAsker } from './api';
import { Modal } from './pages/contacts/Modal';
import { TopUp, DepositCard } from './pages/Wallet';

// Waits for the wallet to reach the target, then tells the asker to run the action again.
function useWalletReaches(target, active, onReached) {
  const fired = useRef(false);
  useEffect(() => {
    if (!active) return undefined;
    fired.current = false;
    const tick = async () => { try { const w = await api('/wallet'); if (!fired.current && w.balance >= target) { fired.current = true; onReached(); } } catch (_) { /* keep polling */ } };
    const t = setInterval(tick, 5000);
    tick();
    return () => clearInterval(t);
  }, [target, active, onReached]);
}

// "Not enough in your wallet": pay just the difference with crypto or Mollie; the action finishes on its own once it lands.
export function FundsAskHost() {
  const [pending, setPending] = useState(null);
  const [info, setInfo] = useState(null);
  const [dep, setDep] = useState(null);
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    setFundsAsker((d) => new Promise((resolve) => {
      setDep(null); setPaid(false);
      api('/wallet').then(setInfo).catch(() => setInfo(null));
      setPending((prev) => { prev?.resolve(false); return { resolve, need: Number(d.need), balance: Number(d.balance) || 0, message: d.message }; });
    }));
    return () => setFundsAsker(null);
  }, []);
  const done = (v) => { pending?.resolve(v); setPending(null); };
  const target = pending ? Math.round((pending.balance + pending.need) * 100) / 100 : 0;
  const onReached = React.useCallback(() => { setPaid(true); setTimeout(() => done(true), 900); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useWalletReaches(target, !!pending && !paid, onReached);
  if (!pending) return null;
  const min = info?.minTopup || 1;
  return (
    <Modal title={`Pay ${money(pending.need)} to continue`} sub={pending.balance > 0 ? `Your ${money(pending.balance)} wallet balance is used first — you only pay the difference.` : 'Pay the amount below and we finish this for you.'} onClose={() => done(false)} testid="funds-ask-dialog">
      <p className="text-sm text-[var(--c-muted)] mb-4" data-testid="funds-ask-reason">{String(pending.message || '').split(/(?<=\.)\s+/).filter(x => !/top up|add funds|add \$/i.test(x)).join(' ')}</p>
      {paid ? (
        <div className="flex items-center gap-2 text-sm text-[#34d399]" data-testid="funds-ask-paid"><CheckCircle2 className="w-5 h-5" />Payment received — finishing now…</div>
      ) : dep ? (
        <div className="space-y-3">
          <DepositCard dep={dep} />
          <div className="flex items-center gap-2 text-xs text-[var(--c-muted)]" data-testid="funds-ask-waiting"><Loader2 className="w-4 h-4 animate-spin" />Waiting for your payment. This window finishes the purchase by itself once it lands.</div>
        </div>
      ) : info ? (
        <>
          {pending.need < min && <p className="text-xs text-[var(--c-muted)] mb-3" data-testid="funds-ask-min-note">{`The smallest top-up is ${money(min)}; the rest stays in your wallet.`}</p>}
          <TopUp coins={info.coins} min={min} initial={Math.max(min, Math.ceil(pending.need))} onCreated={setDep} sameTab={false} testid="funds-ask" />
          <p className="text-xs text-[var(--c-muted)] mt-3 flex items-center gap-1.5" data-testid="funds-ask-card-note"><WalletIcon className="w-3.5 h-3.5" />Paying by card opens a new tab — keep this window open and it finishes once the payment lands.</p>
        </>
      ) : <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading payment options…</div>}
    </Modal>
  );
}
