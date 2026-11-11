import React, { useState } from 'react';
import { ArrowRight, PhoneCall, ShieldCheck, Zap, LifeBuoy } from 'lucide-react';
import { usd } from '../../api';
import { PICKS } from './OnePage';
import { openEsimCheckout } from './EsimCheckout';
import { openMobileCheckout } from './MobileCheckout';

const PITCH = {
  ivr: 'Calls, keypad menus, SIP logins and campaigns. Business shows any caller ID.',
  esim: 'A real USA carrier line that lives on your phone. QR code in minutes.',
  mobile: 'A real USA carrier number you use in your browser, for calls and texts.',
};

const SHORT = { ivr: 'Business line', esim: 'USA eSIM', mobile: 'Texting Number' };
const TRUST = [[ShieldCheck, 'Month to month, no contract'], [Zap, 'Live in minutes'], [LifeBuoy, 'Real human support']];

// JujuCloud-style hero card: three tabs, one pitch, price and action each.
export function HeroCard({ from, esimPrice, offer, goPlans }) {
  const [tab, setTab] = useState('ivr');
  const price = tab === 'ivr' ? from : usd(tab === 'esim' ? esimPrice || 75 : offer?.price || 75);
  const go = () => {
    if (tab === 'esim') return openEsimCheckout();
    if (tab === 'mobile' && offer?.available) return openMobileCheckout();
    return goPlans(tab);
  };
  const label = tab === 'ivr' ? 'See phone plans' : tab === 'esim' ? 'Order eSIM' : offer?.available ? 'Order number' : 'See details';
  return (
    <div className="mx-auto mt-8 max-w-2xl civr-rise civr-d3">
      <div className="rounded-2xl border border-slate-200 bg-white p-2 sm:p-3 shadow-xl shadow-slate-200/70" data-testid="hero-card">
        <div role="tablist" aria-label="What do you need?" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100/80 p-1" data-testid="hero-card-tabs">
          {PICKS.map(([id, I]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`hero-card-tab-${id}`}
              className={`flex min-h-11 flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 rounded-lg px-2 py-2 text-xs sm:text-sm font-semibold transition-colors ${tab === id ? 'bg-white text-[#0f4396] shadow-sm ring-1 ring-[#1d6fd8]/15' : 'text-slate-600 hover:bg-white/70 hover:text-slate-950'}`}>
              <I className="w-4 h-4" />{SHORT[id]}
            </button>
          ))}
        </div>
        <div key={tab} role="tabpanel" className="civr-tab-panel flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 text-left" data-testid={`hero-card-panel-${tab}`}>
          <div className="flex-1 min-w-0">
            <p className="text-sm sm:text-base text-slate-700" data-testid="hero-card-pitch">{PITCH[tab]}</p>
            {price && <p className="mt-1 text-sm text-slate-500">from <b className="text-lg text-slate-950" data-testid="hero-card-price">{price}</b>/month</p>}
          </div>
          <button type="button" onClick={go} className="civr-l-btn civr-l-btn-hero inline-flex items-center justify-center gap-2 h-14 px-7 shrink-0" data-testid={`hero-card-cta-${tab}`}>{label}<ArrowRight className="w-4 h-4" /></button>
        </div>
      </div>
      <a href="#try" className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-900 backdrop-blur hover:border-[#1d6fd8]/40 hover:bg-[#edf4ff] transition-colors" data-testid="hero-try-link"><PhoneCall className="w-4 h-4 text-[#1d6fd8]" />Try a free call first, with any caller ID</a>
      <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2" data-testid="hero-trust">
        {TRUST.map(([I, t], i) => <li key={t} className="flex items-center gap-2 text-sm font-medium text-slate-600" data-testid={`hero-trust-${i}`}><I className="w-4 h-4 text-emerald-600" />{t}</li>)}
      </ul>
    </div>
  );
}
