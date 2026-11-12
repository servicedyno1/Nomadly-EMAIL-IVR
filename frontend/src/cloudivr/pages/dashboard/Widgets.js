import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, AlertTriangle, ChevronRight } from 'lucide-react';
import { money, day, enc, startPrice, useApi } from '../../api';
import { useShell } from '../../Shell';
import { statusPill } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';

// First-run checklist shown until the account owns a number.
export function GetStarted({ balance }) {
  const { catalog } = useShell();
  const from = startPrice(catalog);
  const steps = [
    { id: 'funds', done: balance > 0, title: 'Add funds to your wallet', sub: balance > 0 ? `Wallet ready · ${money(balance)}` : 'Crypto today, cards coming soon. Numbers, renewals and calls are paid from your wallet.', to: cp('/app/wallet'), cta: 'Add funds' },
    { id: 'buy', done: false, title: 'Pick your first number', sub: `${catalog?.countries?.length || 2} countries${from ? ` · from ${from}/month` : ''}.`, to: cp('/app/buy'), cta: 'Buy a number' },
    { id: 'setup', done: false, title: 'Choose what callers hear', sub: 'Forwarding, voicemail or a keypad menu — set it on your number once it’s live.' },
  ];
  const current = steps.findIndex(x => !x.done);
  return (
    <div className="civr-card p-6 md:p-8 civr-rise" data-testid="dashboard-get-started">
      <div className="civr-label">Get started</div>
      <ol className="mt-6 flex flex-col gap-4">
        {steps.map((x, i) => {
          const active = i === current;
          return (
            <li key={x.id} className={`flex flex-wrap sm:flex-nowrap items-center gap-4 rounded-xl border p-4 md:p-6 ${active ? 'border-[#818cf8]/40 bg-[#818cf8]/5' : 'border-[#222]'}`} data-testid={`get-started-step-${x.id}`}>
              <span className={`w-10 h-10 rounded-full flex items-center justify-center font-mono shrink-0 ${x.done ? 'bg-[#6366f1] text-white' : active ? 'border border-[#818cf8] text-[#818cf8]' : 'border border-[#333] text-[#a1a1aa]'}`}>{x.done ? <Check className="w-5 h-5" /> : i + 1}</span>
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

const TABS = [['calling', 'Calling'], ['mobile', 'Mobile'], ['texting', 'Texting']];
const numberLink = (n) => cp(n.texting ? `/app/texting?id=${enc(n.id)}` : n.mobile ? '/app/numbers' : `/app/numbers/${enc(n.phoneNumber)}`);

function NumberRow({ n, i, pv }) {
  return (
    <Link to={numberLink(n)} className="flex items-center gap-4 py-4 -mx-2 px-2 rounded-lg hover:bg-[#111] transition-colors" data-testid={`dashboard-number-${i}`}>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-lg truncate" data-testid={`dashboard-number-${i}-phone`}>{pv.phone(n.phoneNumber)}</div>
        <div className="text-xs text-[#a1a1aa] mt-1">{n.texting ? n.planName : `${n.countryName || n.country} · ${n.planName}`}{n.planNumber && <> · included with {pv.phone(n.planNumber)}</>}{n.expiresAt && <> · {n.texting ? 'next bill' : n.autoRenew ? 'renews' : 'expires'} {day(n.expiresAt)}</>}</div>
      </div>
      <span className={statusPill(n.status)}>{n.status}</span><ChevronRight className="w-4 h-4 text-[#a1a1aa]" />
    </Link>
  );
}

function NumberTabs({ groups, tab, setTab }) {
  return (
    <div role="tablist" className="flex gap-2 mt-3 mb-1" data-testid="dashboard-numbers-tabs">
      {TABS.filter(([k]) => groups[k].length).map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`dashboard-numbers-tab-${k}`}
          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${tab === k ? 'bg-[#818cf8] text-white' : 'bg-[#111] text-[#a1a1aa] hover:text-white'}`}>
          {label} <span className="opacity-70">{groups[k].length}</span>
        </button>
      ))}
    </div>
  );
}

// Existing accounts: their numbers (Calling / Mobile / Texting tabs) with renewal dates + a warning when the wallet can't cover the next renewal.
export function YourNumbers({ nums: voip, balance }) {
  const pv = usePrivacy();
  const [picked, setTab] = useState(null);
  const { data: mob } = useApi('/mobile-numbers');
  // USA mobile numbers (two-way SMS) are numbers too; they open in the mobile section of My numbers.
  const mobile = (mob?.items || []).filter(m => ['provisioning', 'awaiting_imei', 'active', 'suspended'].includes(m.status)).map(m => ({ phoneNumber: m.phoneNumber || 'Assigning number…', mobile: true, status: m.status, expiresAt: m.expiresAt, autoRenew: m.autoRenew, planPrice: m.price, countryName: 'United States', planName: 'Texting Number' }));
  const { data: hs } = useApi('/hosted-sms');
  const texting = (hs?.items || []).filter(t => ['verify', 'loa', 'documents', 'admin_docs', 'review', 'active', 'paused'].includes(t.status)).map(t => ({ id: t.id, phoneNumber: t.phoneNumber, texting: true, status: t.status, expiresAt: t.planNumber ? null : t.nextBillAt, autoRenew: true, planPrice: t.planNumber ? 0 : t.monthly, planNumber: t.planNumber, planName: 'Landline to Texting' }));
  if (!voip) return null;
  const groups = { calling: voip, mobile, texting };
  const nums = [...voip, ...mobile, ...texting];
  const tab = groups[picked]?.length ? picked : TABS.map(([k]) => k).find(k => groups[k].length) || 'calling';
  const shown = groups[tab];
  const next = nums.filter(n => n.autoRenew && n.status === 'active' && n.expiresAt && new Date(n.expiresAt) > Date.now()).sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))[0];
  const shortBy = next ? Math.round(((next.planPrice || 0) - balance) * 100) / 100 : 0;
  return (
    <div className="civr-card p-6" data-testid="dashboard-your-numbers">
      <div className="flex items-center justify-between mb-2"><div className="font-display text-2xl font-bold">Your numbers</div><Link to={cp('/app/numbers')} className="text-sm text-[#a1a1aa] hover:text-[#818cf8] py-2" data-testid="dashboard-all-numbers-link">All numbers</Link></div>
      {TABS.filter(([k]) => groups[k].length).length > 1 && <NumberTabs groups={groups} tab={tab} setTab={setTab} />}
      {shortBy > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/5 p-4 my-4" data-testid="dashboard-low-balance-warning">
          <AlertTriangle className="w-5 h-5 text-[#fbbf24] shrink-0" />
          <div className="flex-1 text-sm">Your wallet ({money(balance)}) won’t cover the next renewal: <span className="font-mono">{pv.phone(next.phoneNumber)}</span> renews {day(next.expiresAt)} for {money(next.planPrice)}.</div>
          <Link to={cp(`/app/wallet?need=${shortBy}`)} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="dashboard-low-balance-add-funds">Add funds</Link>
        </div>
      )}
      <div className="divide-y divide-[#1a1a1a]" role="tabpanel" data-testid={`dashboard-numbers-panel-${tab}`}>
        {shown.slice(0, 5).map((n, i) => <NumberRow key={n.id || n.phoneNumber} n={n} i={i} pv={pv} />)}
      </div>
      {shown.length > 5 && <Link to={cp(tab === 'texting' ? '/app/texting' : '/app/numbers')} className="block text-sm text-[#818cf8] mt-3" data-testid="dashboard-numbers-more">+{shown.length - 5} more</Link>}
      {next && shortBy <= 0 && <div className="text-xs text-[#a1a1aa] mt-4" data-testid="dashboard-next-renewal">Next renewal: <span className="font-mono">{pv.phone(next.phoneNumber)}</span> on {day(next.expiresAt)} · {money(next.planPrice)} from your wallet</div>}
    </div>
  );
}
