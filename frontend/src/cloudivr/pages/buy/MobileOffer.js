import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageSquare, Lock } from 'lucide-react';
import { api, money, useApi } from '../../api';
import { useShell } from '../../Shell';
import { Field, ErrorNote } from '../../ui';
import { WalletPay } from '../../WalletPay';
import { cp } from '../../paths';

// US mobile number for texting: the carrier assigns it after payment, near the ZIP given.
export function MobileOffer({ onBought, open: startOpen = false }) {
  const { data } = useApi('/mobile-numbers');
  const { refreshSummary } = useShell();
  const [open, setOpen] = useState(startOpen);
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!data?.available) return null;
  const go = async () => { setBusy(true); setErr(null); try { await api('/mobile-numbers', { method: 'POST', body: { zipcode: zip } }); toast.success(`Paid ${money(data.price)}. Your number is being assigned`); refreshSummary(); onBought?.(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <div className="civr-card p-6 mt-6 space-y-4" data-testid="mobile-offer">
      <div className="flex flex-wrap items-start gap-3">
        <MessageSquare className="w-5 h-5 text-[#818cf8] mt-1" />
        <div className="flex-1 min-w-[200px]">
          <div className="font-semibold">Need a US mobile number for texting?</div>
          <p className="text-sm text-[var(--c-muted)] mt-1">A real US mobile number that sends and receives texts, right in Messages. Texts cost $0.05 each from your wallet. Calls aren’t included yet.</p>
        </div>
        <div className="font-mono text-xl" data-testid="mobile-offer-price">{`${money(data.price)}`}<span className="text-xs text-[var(--c-muted)]"> /month</span></div>
      </div>
      <p className="text-sm flex items-start gap-2 text-[#fbbf24]" data-testid="mobile-offer-reveal-note"><Lock className="w-4 h-4 mt-0.5 shrink-0" />You can’t pick the exact number. The carrier assigns it after your payment is confirmed, and we show it to you as soon as it’s ready, usually within minutes.</p>
      {!open ? <button type="button" onClick={() => setOpen(true)} className="civr-btn civr-btn-ghost" data-testid="mobile-offer-start">Get a mobile number</button> : <>
        <Field label="ZIP code" hint="We ask the carrier for a number near this US ZIP code. The area code can’t be guaranteed."><input className="civr-input font-mono max-w-[160px]" inputMode="numeric" value={zip} onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="e.g. 10011" data-testid="mobile-offer-zip" /></Field>
        <WalletPay price={data.price} onWallet={go} busy={busy} disabled={zip.length !== 5} testid="mobile-offer-pay" walletTestid="mobile-offer-pay-button" cryptoTestid="mobile-offer-crypto">
          <button type="button" onClick={() => setOpen(false)} className="civr-btn civr-btn-ghost" data-testid="mobile-offer-cancel">Cancel</button>
        </WalletPay>
        <ErrorNote error={err} testid="mobile-offer-error" />
        <p className="text-xs text-[var(--c-muted)]">Renews monthly from your wallet. Manage it under <Link to={cp('/app/numbers')} className="underline">My numbers</Link>.</p>
      </>}
    </div>
  );
}
