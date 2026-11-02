import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { X, Check, ArrowRight, MessageSquareText, Lock } from 'lucide-react';
import { api } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { IN, Label, Btn, Account, Pay } from './EsimCheckout';

// Landing-page USA mobile number checkout: ZIP → account → pay (wallet, or crypto top-up then auto-order) → done.
export const openMobileCheckout = () => window.dispatchEvent(new CustomEvent('civr-mobile-checkout'));
const LATER = 'Closed it after paying? The money stays in your wallet. Open Buy a number → USA mobile number in the app to finish the order.';

function Zip({ zip, setZip, onNext }) {
  return (
    <div className="space-y-5" data-testid="mobile-co-details">
      <Label text="ZIP code" hint="We ask the carrier for a number near this USA ZIP code. It’s a preference: the area code can’t be guaranteed.">
        <input className={`${IN} font-mono max-w-[200px]`} inputMode="numeric" autoComplete="postal-code" value={zip} onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="e.g. 10011" data-testid="mobile-co-zip" />
      </Label>
      <p className="flex items-start gap-2 text-sm text-slate-600 rounded-xl bg-slate-50 p-3" data-testid="mobile-co-reveal-note"><Lock className="w-4 h-4 mt-0.5 shrink-0 text-[color:var(--np-blue)]" />You can’t pick the exact number. The carrier assigns it after your payment is confirmed, usually within minutes.</p>
      <Btn onClick={onNext} disabled={zip.length !== 5} data-testid="mobile-co-next">Continue<ArrowRight className="w-4 h-4" /></Btn>
    </div>
  );
}

function Done({ onClose }) {
  return (
    <div className="text-center space-y-4 py-4" data-testid="mobile-co-done">
      <span className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mx-auto"><Check className="w-7 h-7" /></span>
      <h3 className="civr-l-h text-2xl">Paid. Your number is being assigned</h3>
      <p className="text-sm text-slate-600">It appears in My numbers as soon as the carrier assigns it, usually within minutes. Texts to it arrive in Messages, and it’s added as a caller ID for free.</p>
      <Link to={cp('/app/numbers')} onClick={onClose} className="civr-l-btn w-full inline-flex items-center justify-center gap-2 min-h-[48px]" data-testid="mobile-co-open">Open My numbers<ArrowRight className="w-4 h-4" /></Link>
    </div>
  );
}

const TITLES = { details: 'Where should the number be from?', account: 'Your account', pay: 'Pay', done: 'Done' };

function Checkout({ price, onClose }) {
  const { account } = useCivrAuth();
  const nav = useNavigate();
  const [step, setStep] = useState('details');
  const [zip, setZip] = useState('');
  const box = useRef(null);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); box.current?.querySelector('input,select')?.focus(); return () => window.removeEventListener('keydown', k); }, [onClose, step]);
  const place = useCallback(() => api('/mobile-numbers', { method: 'POST', body: { zipcode: zip } }), [zip]);
  const paid = useCallback(() => setStep('done'), []);
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 grid place-items-center p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid="mobile-checkout">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="mobile-co-title" className="bg-white text-slate-900 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 sm:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-slate-500"><MessageSquareText className="w-4 h-4" />{`USA mobile number · $${price}/month`}</div><h2 id="mobile-co-title" className="civr-l-h text-2xl mt-2" data-testid="mobile-co-step">{TITLES[step]}</h2></div>
          <button type="button" onClick={onClose} className="w-11 h-11 grid place-items-center rounded-full hover:bg-slate-100 shrink-0" aria-label="Close" data-testid="mobile-co-close"><X className="w-5 h-5" /></button>
        </div>
        {step === 'details' && <Zip zip={zip} setZip={setZip} onNext={() => setStep(account ? 'pay' : 'account')} />}
        {step === 'account' && <Account intro="Create your free CloudIVR account. Your number and its texts live here." onDone={() => setStep('pay')} onMfa={() => nav(cp('/login'))} />}
        {step === 'pay' && <Pay price={price} name={`USA mobile number · ZIP ${zip}`} place={place} onPaid={paid} what="number" later={LATER} />}
        {step === 'done' && <Done onClose={onClose} />}
      </div>
    </div>
  );
}

// Mounted once on the landing page; "Order number" buttons open it via openMobileCheckout().
export function MobileCheckoutHost({ offer }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const f = () => setOpen(true); window.addEventListener('civr-mobile-checkout', f); return () => window.removeEventListener('civr-mobile-checkout', f); }, []);
  if (!open || !offer?.available) return null;
  return <Checkout price={offer.price} onClose={() => setOpen(false)} />;
}
