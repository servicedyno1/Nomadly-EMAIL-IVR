import React from 'react';
import { Wallet } from 'lucide-react';

// Payment methods shown on the landing/pricing pages. The real source of truth is the live Mollie method list
// (catalog.paymentMethods — exactly what the Mollie account has switched on: iDEAL, cards, PayPal, Apple Pay …).
// Before Mollie answers we show a small chosen fallback set once cards are live; if cards aren't live yet we show
// the honest "Cards — coming soon" badge. The CloudIVR wallet (crypto top-up) always works and always shows.
const FALLBACK = [
  ['creditcard', 'Cards'],
  ['ideal', 'iDEAL'],
  ['applepay', 'Apple Pay'],
  ['googlepay', 'Google Pay'],
];

const Mark = ({ id, name }) => {
  switch (id) {
    case 'creditcard':
    case 'cards':
      return <span className="inline-flex items-center gap-1"><span className="font-extrabold italic tracking-tight text-[#1a1f71] text-[13px]">VISA</span><svg viewBox="0 0 32 20" className="w-6 h-4" aria-hidden="true"><circle cx="12" cy="10" r="8" fill="#eb001b" /><circle cx="20" cy="10" r="8" fill="#f79e1b" /><path d="M16 3.1a8 8 0 0 1 0 13.8 8 8 0 0 1 0-13.8z" fill="#ff5f00" /></svg></span>;
    case 'ideal':
      return <span className="text-[13px] font-bold tracking-tight"><span className="text-[#cc0066]">i</span><span className="text-[#cc0066]">DEAL</span></span>;
    case 'bancontact':
      return <span className="text-xs font-bold tracking-wide text-[#004e8c]">Bancontact</span>;
    case 'paypal':
      return <span className="text-[13px] font-bold tracking-tight"><span className="text-[#003087] italic">Pay</span><span className="text-[#0070e0] italic">Pal</span></span>;
    case 'applepay':
      return <span className="text-xs font-semibold text-slate-900"> Pay</span>;
    case 'googlepay':
      return <span className="text-xs font-semibold text-slate-700">G Pay</span>;
    default:
      return <span className="text-xs font-semibold text-slate-700">{name}</span>;
  }
};

const Chip = ({ title, children, testid }) => (
  <span title={title} className="civr-pay-chip h-9 px-3 rounded-lg border border-slate-200 bg-white inline-flex items-center gap-1.5 shadow-[0_1px_1px_rgba(15,23,42,.04)]" data-testid={testid}>{children}</span>
);

export function PaymentMethods({ catalog, label = 'Pay with', className = '', testid = 'payment-methods' }) {
  const cardsLive = catalog?.cardPayments === true;
  const live = Array.isArray(catalog?.paymentMethods) ? catalog.paymentMethods : [];
  const methods = live.length
    ? live.map((m) => [m.id, m.name, m.image])
    : (cardsLive ? FALLBACK.map(([id, name]) => [id, name, null]) : []);
  return (
    <div className={`flex flex-col sm:flex-row sm:flex-wrap gap-x-10 gap-y-5 ${className}`} data-testid={testid}>
      <div data-testid={`${testid}-now`}>
        {label && <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{label}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <Chip title="CloudIVR wallet — top up once, pay renewals and calls from it" testid={`${testid}-wallet`}><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Wallet className="w-4 h-4 text-slate-900" />CloudIVR wallet</span></Chip>
          {methods.map(([id, name, image]) => (
            <Chip key={id} title={name} testid={`${testid}-${id}`}>
              {image ? <img src={image} alt={name} className="h-5 w-auto" loading="lazy" /> : <Mark id={id} name={name} />}
            </Chip>
          ))}
          <Chip title="Crypto top-up" testid={`${testid}-crypto`}><span className="text-xs font-semibold text-slate-700">Crypto</span></Chip>
        </div>
      </div>
      {!cardsLive && !live.length && (
        <div data-testid={`${testid}-soon`}>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 inline-flex items-center gap-2">Cards<span className="px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold tracking-wide normal-case" data-testid={`${testid}-soon-badge`}>Coming soon</span></div>
          <div className="flex flex-wrap items-center gap-2">
            {FALLBACK.map(([id, name]) => <Chip key={id} title={`${name} — coming soon`} testid={`${testid}-${id}`}><Mark id={id} name={name} /></Chip>)}
          </div>
        </div>
      )}
    </div>
  );
}
