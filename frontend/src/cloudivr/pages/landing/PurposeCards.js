import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall, Server, MessageSquareText, Printer, Smartphone, ShieldCheck, Zap, LifeBuoy } from 'lucide-react';
import { usd } from '../../api';
import { cp } from '../../paths';
import { openEsimCheckout } from './EsimCheckout';
import { openMobileCheckout } from './MobileCheckout';

const TRUST = [[ShieldCheck, 'Month to month, no contract'], [Zap, 'Live in minutes'], [LifeBuoy, 'Real human support']];

// Hero: "What do you need the number for?" — Voice, SIP, SMS, Fax, each with what it is, its starting price and an action.
export function PurposeCards({ catalog, from, offer, fax, esimPrice, goPlans }) {
  const sipPlan = (catalog?.plans || []).find(p => p.available !== false && p.access?.sipCredentials);
  const cards = [
    ['voice', PhoneCall, 'Voice', 'A Business Line for calls, keypad menus, voicemail, campaigns and AI agents.', from, 'See phone plans', () => goPlans('ivr')],
    ['sip', Server, 'SIP', 'Logins for desk phones and softphone apps, on a Business Line.', sipPlan ? usd(sipPlan.price) : null, 'SIP & softphones', null, cp('/sip')],
    ['sms', MessageSquareText, 'SMS', 'A Texting Number on a real USA carrier. Send and receive texts in your browser.', usd(offer?.price || 75), offer?.available ? 'Order number' : 'See details', () => (offer?.available ? openMobileCheckout() : goPlans('mobile'))],
    ['fax', Printer, 'Fax', 'A fax-only number for the USA or Canada. Send and receive faxes online.', fax?.price ? usd(fax.price) : null, 'Find a fax number', () => goPlans('fax')],
  ];
  return (
    <div className="mx-auto mt-10 max-w-6xl civr-rise civr-d3 text-left" data-testid="hero-purposes">
      <h2 className="text-center text-lg md:text-xl font-semibold text-slate-950" data-testid="hero-purposes-title">What do you need the number for?</h2>
      <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(([id, I, title, pitch, price, label, go, to]) => (
          <div key={id} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/60 flex flex-col transition-[transform,border-color] duration-300 hover:-translate-y-1 hover:border-[#1d6fd8]/40" data-testid={`hero-purpose-${id}`}>
            <div className="w-11 h-11 rounded-xl bg-[#edf4ff] grid place-items-center"><I className="w-5 h-5 text-[#1d6fd8]" /></div>
            <div className="mt-4 text-lg font-bold text-slate-950">{title}</div>
            <p className="mt-1 text-sm text-slate-600 flex-1">{pitch}</p>
            <p className="mt-3 text-sm text-slate-500 min-h-[28px]">{price && <>from <b className="text-lg text-slate-950" data-testid={`hero-purpose-${id}-price`}>{price}</b>/month</>}</p>
            {to
              ? <Link to={to} className="civr-l-btn mt-3 inline-flex items-center justify-center gap-2 h-12" data-testid={`hero-purpose-${id}-cta`}>{label}<ArrowRight className="w-4 h-4" /></Link>
              : <button type="button" onClick={go} className="civr-l-btn mt-3 inline-flex items-center justify-center gap-2 h-12" data-testid={`hero-purpose-${id}-cta`}>{label}<ArrowRight className="w-4 h-4" /></button>}
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => openEsimCheckout()} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-900 hover:border-[#1d6fd8]/40 hover:bg-[#edf4ff] transition-colors" data-testid="hero-esim-link"><Smartphone className="w-4 h-4 text-[#1d6fd8]" />Want the line on your phone? USA eSIM{esimPrice ? `, ${usd(esimPrice)}/month` : ''}</button>
        <a href="#try" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-900 hover:border-[#1d6fd8]/40 hover:bg-[#edf4ff] transition-colors" data-testid="hero-try-link"><PhoneCall className="w-4 h-4 text-[#1d6fd8]" />Try a free call first, with your verified caller IDs</a>
      </div>
      <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2" data-testid="hero-trust">
        {TRUST.map(([I, t], i) => <li key={t} className="flex items-center gap-2 text-sm font-medium text-slate-600" data-testid={`hero-trust-${i}`}><I className="w-4 h-4 text-emerald-600" />{t}</li>)}
      </ul>
    </div>
  );
}
