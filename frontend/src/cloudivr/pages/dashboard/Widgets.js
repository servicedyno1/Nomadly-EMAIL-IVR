import React from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, AlertTriangle, ChevronRight } from 'lucide-react';
import { money, day, enc, startPrice } from '../../api';
import { useShell } from '../../Shell';
import { statusPill } from '../../ui';
import { cp } from '../../paths';

// First-run checklist shown until the account owns a number.
export function GetStarted({ balance }) {
  const { catalog } = useShell();
  const from = startPrice(catalog);
  const steps = [
    { id: 'funds', done: balance > 0, title: 'Add funds with crypto', sub: balance > 0 ? `Wallet ready · ${money(balance)}` : 'Numbers, renewals and calls are paid from your wallet.', to: cp('/app/wallet'), cta: 'Add funds' },
    { id: 'buy', done: false, title: 'Pick your first number', sub: `${catalog?.countries?.length || 17} countries${from ? ` · from ${from}/month` : ''}.`, to: cp('/app/buy'), cta: 'Buy a number' },
    { id: 'setup', done: false, title: 'Choose what callers hear', sub: 'Forwarding, voicemail or an IVR menu — set it on your number once it’s live.' },
  ];
  const current = steps.findIndex(x => !x.done);
  return (
    <div className="civr-card p-6 md:p-8 civr-rise" data-testid="dashboard-get-started">
      <div className="civr-label">Get started</div>
      <ol className="mt-6 space-y-4">
        {steps.map((x, i) => {
          const active = i === current;
          return (
            <li key={x.id} className={`flex flex-wrap sm:flex-nowrap items-center gap-4 rounded-xl border p-4 md:p-6 ${active ? 'border-[#34d399]/40 bg-[#34d399]/5' : 'border-[#222]'}`} data-testid={`get-started-step-${x.id}`}>
              <span className={`w-10 h-10 rounded-full flex items-center justify-center font-mono shrink-0 ${x.done ? 'bg-[#34d399] text-[#04130d]' : active ? 'border border-[#34d399] text-[#34d399]' : 'border border-[#333] text-[#9a9a9a]'}`}>{x.done ? <Check className="w-5 h-5" /> : i + 1}</span>
              <div className="flex-1 min-w-0"><div className={`font-semibold ${x.done ? 'text-[#a1a1aa]' : ''}`}>{x.title}</div><div className="text-sm text-[#a1a1aa] mt-1">{x.sub}</div></div>
              {x.done && <span className="civr-pill civr-pill-on" data-testid={`get-started-${x.id}-done`}>Done</span>}
              {x.to && !x.done && <Link to={x.to} className={`civr-btn w-full sm:w-auto ${active ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`get-started-${x.id}-button`}>{x.cta}<ArrowRight className="w-4 h-4" /></Link>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Existing accounts: their numbers with renewal dates + a warning when the wallet can't cover the next renewal.
export function YourNumbers({ nums, balance }) {
  if (!nums) return null;
  const next = nums.filter(n => n.autoRenew && n.status === 'active' && n.expiresAt).sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))[0];
  const shortBy = next ? Math.round(((next.planPrice || 0) - balance) * 100) / 100 : 0;
  return (
    <div className="civr-card p-6 mt-6" data-testid="dashboard-your-numbers">
      <div className="flex items-center justify-between mb-2"><div className="font-display text-2xl font-bold">Your numbers</div><Link to={cp('/app/numbers')} className="text-sm text-[#a1a1aa] hover:text-[#34d399] py-2" data-testid="dashboard-all-numbers-link">All numbers</Link></div>
      {shortBy > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/5 p-4 my-4" data-testid="dashboard-low-balance-warning">
          <AlertTriangle className="w-5 h-5 text-[#fbbf24] shrink-0" />
          <div className="flex-1 text-sm">Your wallet ({money(balance)}) won’t cover the next renewal: <span className="font-mono">{next.phoneNumber}</span> renews {day(next.expiresAt)} for {money(next.planPrice)}.</div>
          <Link to={cp(`/app/wallet?need=${shortBy}`)} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="dashboard-low-balance-add-funds">Add funds</Link>
        </div>
      )}
      <div className="divide-y divide-[#1a1a1a]">
        {nums.slice(0, 5).map((n, i) => (
          <Link key={n.phoneNumber} to={cp(`/app/numbers/${enc(n.phoneNumber)}`)} className="flex items-center gap-4 py-4 -mx-2 px-2 rounded-lg hover:bg-[#111] transition-colors" data-testid={`dashboard-number-${i}`}>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-lg truncate">{n.phoneNumber}</div>
              <div className="text-xs text-[#9a9a9a] mt-1">{n.countryName || n.country} · {n.planName} · {n.autoRenew ? 'renews' : 'expires'} {day(n.expiresAt)}</div>
            </div>
            <span className={statusPill(n.status)}>{n.status}</span><ChevronRight className="w-4 h-4 text-[#8a8a8a]" />
          </Link>
        ))}
      </div>
      {next && shortBy <= 0 && <div className="text-xs text-[#9a9a9a] mt-4" data-testid="dashboard-next-renewal">Next renewal: <span className="font-mono">{next.phoneNumber}</span> on {day(next.expiresAt)} · {money(next.planPrice)} from your wallet</div>}
    </div>
  );
}
