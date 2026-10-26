import React from 'react';
import { CreditCard } from 'lucide-react';

// Accepted payment methods as small brand-coloured chips (text marks, no third-party images).
const CARDS = [
  ['visa', 'Visa', <span key="v" className="font-extrabold italic tracking-tight text-[#1a1f71] text-[13px]">VISA</span>],
  ['mastercard', 'Mastercard', <svg key="m" viewBox="0 0 32 20" className="w-7 h-5" aria-hidden="true"><circle cx="12" cy="10" r="8" fill="#eb001b" /><circle cx="20" cy="10" r="8" fill="#f79e1b" /><path d="M16 3.1a8 8 0 0 1 0 13.8 8 8 0 0 1 0-13.8z" fill="#ff5f00" /></svg>],
  ['amex', 'American Express', <span key="a" className="px-1.5 py-0.5 rounded-sm bg-[#2e77bb] text-white text-[9px] font-bold tracking-wider">AMEX</span>],
  ['discover', 'Discover', <span key="d" className="text-[10px] font-bold tracking-wide text-slate-800">DISC<span className="inline-block w-2 h-2 rounded-full bg-[#f58220] mx-px align-[-1px]" />VER</span>],
  ['debit', 'Debit cards', <span key="db" className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700"><CreditCard className="w-4 h-4 text-slate-500" />Debit</span>],
];
const COIN = { BTC: ['#f7931a', '₿', 'Bitcoin'], ETH: ['#627eea', 'Ξ', 'Ethereum'], USDT: ['#26a17b', '₮', 'Tether'], LTC: ['#345d9d', 'Ł', 'Litecoin'], DOGE: ['#c2a633', 'Ð', 'Dogecoin'], BCH: ['#0ac18e', 'B', 'Bitcoin Cash'], TRON: ['#eb0029', 'T', 'TRON'] };
const DEFAULT_COINS = ['BTC', 'ETH', 'USDT', 'LTC'];

const Chip = ({ title, children, testid }) => <span title={title} className="h-9 px-3 rounded-lg border border-slate-200 bg-white inline-flex items-center gap-1.5 shadow-[0_1px_1px_rgba(15,23,42,.04)]" data-testid={testid}>{children}</span>;

export function PaymentMethods({ catalog, label = 'Accepted payment methods', className = '', testid = 'payment-methods' }) {
  const coins = [...new Set((catalog?.coins?.length ? catalog.coins : DEFAULT_COINS).map(c => c.replace(/\s*\(.*\)/, '')))].filter(c => COIN[c]);
  return (
    <div className={className} data-testid={testid}>
      {label && <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{label}</div>}
      <div className="flex flex-wrap items-center gap-2" data-no-translate>
        {CARDS.map(([id, title, mark]) => <Chip key={id} title={title} testid={`${testid}-${id}`}>{mark}</Chip>)}
        {coins.map(c => { const [bg, g, name] = COIN[c]; return <Chip key={c} title={name} testid={`${testid}-${c.toLowerCase()}`}><span className="w-5 h-5 rounded-full text-white text-[11px] font-bold grid place-items-center" style={{ background: bg }}>{g}</span><span className="text-[11px] font-semibold text-slate-700">{c}</span></Chip>; })}
      </div>
    </div>
  );
}
