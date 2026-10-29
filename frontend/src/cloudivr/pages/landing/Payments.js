import React from 'react';
import { CreditCard, Wallet } from 'lucide-react';

// Payment methods as small brand-coloured chips (text marks, no third-party images). One truthful story everywhere:
// crypto and the CloudIVR wallet work today; cards are listed under "coming soon" until they are switched on.
const CARDS = [
  ['visa', 'Visa', <span key="v" className="font-extrabold italic tracking-tight text-[#1a1f71] text-[13px]">VISA</span>],
  ['mastercard', 'Mastercard', <svg key="m" viewBox="0 0 32 20" className="w-7 h-5" aria-hidden="true"><circle cx="12" cy="10" r="8" fill="#eb001b" /><circle cx="20" cy="10" r="8" fill="#f79e1b" /><path d="M16 3.1a8 8 0 0 1 0 13.8 8 8 0 0 1 0-13.8z" fill="#ff5f00" /></svg>],
  ['amex', 'American Express', <span key="a" className="px-1.5 py-0.5 rounded-sm bg-[#1f5a94] text-white text-[10px] font-bold tracking-wider">AMEX</span>],
  ['discover', 'Discover', <span key="d" className="text-[10px] font-bold tracking-wide text-slate-800">DISC<span className="inline-block w-2 h-2 rounded-full bg-[#f58220] mx-px align-[-1px]" />VER</span>],
  ['debit', 'Debit cards', <span key="db" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><CreditCard className="w-4 h-4 text-slate-500" />Debit</span>],
];
const COIN = { BTC: ['#f7931a', '₿', 'Bitcoin'], ETH: ['#627eea', 'Ξ', 'Ethereum'], USDT: ['#26a17b', '₮', 'Tether'], LTC: ['#345d9d', 'Ł', 'Litecoin'], DOGE: ['#c2a633', 'Ð', 'Dogecoin'], BCH: ['#0ac18e', 'B', 'Bitcoin Cash'], TRON: ['#eb0029', 'T', 'TRON'] };
const DEFAULT_COINS = ['BTC', 'ETH', 'USDT', 'LTC'];

const Chip = ({ title, children, testid, translate, soon }) => <span title={title} className={`civr-pay-chip h-9 px-3 rounded-lg border border-slate-200 bg-white inline-flex items-center gap-1.5 shadow-[0_1px_1px_rgba(15,23,42,.04)] ${soon ? 'bg-slate-50' : ''}`} data-testid={testid} data-no-translate={translate ? undefined : ''}>{children}</span>;

export function PaymentMethods({ catalog, label = 'Pay with', className = '', testid = 'payment-methods' }) {
  const coins = [...new Set((catalog?.coins?.length ? catalog.coins : DEFAULT_COINS).map(c => c.replace(/\s*\(.*\)/, '')))].filter(c => COIN[c]);
  const cardsLive = catalog?.cardPayments === true;
  return (
    <div className={`flex flex-col sm:flex-row sm:flex-wrap gap-x-10 gap-y-5 ${className}`} data-testid={testid}>
      <div data-testid={`${testid}-now`}>
        {label && <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{label}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <Chip title="CloudIVR wallet — top up once, pay renewals and calls from it" testid={`${testid}-wallet`} translate><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Wallet className="w-4 h-4 text-slate-900" />CloudIVR wallet</span></Chip>
          {coins.map(c => { const [bg, g, name] = COIN[c]; return <Chip key={c} title={name} testid={`${testid}-${c.toLowerCase()}`}><span aria-hidden="true" className="w-5 h-5 rounded-full text-white text-xs font-bold grid place-items-center" style={{ background: bg }}>{g}</span><span className="text-xs font-semibold text-slate-700">{c}</span></Chip>; })}
          {cardsLive && CARDS.map(([id, title, mark]) => <Chip key={id} title={title} testid={`${testid}-${id}`} translate={id === 'debit'}>{mark}</Chip>)}
        </div>
      </div>
      {!cardsLive && (
        <div data-testid={`${testid}-soon`}>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 inline-flex items-center gap-2">Cards<span className="px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold tracking-wide normal-case" data-testid={`${testid}-soon-badge`}>Coming soon</span></div>
          <div className="flex flex-wrap items-center gap-2">{CARDS.map(([id, title, mark]) => <Chip key={id} title={`${title} — coming soon`} testid={`${testid}-${id}`} translate={id === 'debit'} soon>{mark}</Chip>)}</div>
        </div>
      )}
    </div>
  );
}
