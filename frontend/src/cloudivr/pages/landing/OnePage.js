import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, PhoneCall, Smartphone, MessageSquareText, Printer, ShieldCheck, Zap, LifeBuoy } from 'lucide-react';
import { Reveal, reducedMotion } from './kit';
import { goTo } from './menu';
import { usd } from '../../api';
import { PlanCard, useStart } from './PricingFaq';
import { Card, Waitlist, ESIM_POINTS, MOBILE_POINTS } from './ProductHero';
import { openEsimCheckout } from './EsimCheckout';
import { openMobileCheckout } from './MobileCheckout';
import { PaymentMethods } from './Payments';
import { FaxLanding } from './FaxLanding';
import { LandingPlanHelper } from './PlanHelper';

// Pricing tabs follow the three kinds of number (plus the eSIM, which is a line on your own phone).
export const PICKS = [
  ['ivr', PhoneCall, 'Calls', 'A number for calls, menus, voicemail and AI'],
  ['mobile', MessageSquareText, 'Calls + texting', 'Two-way texts and calls on one number'],
  ['fax', Printer, 'Fax only', 'Send and receive faxes online'],
  ['esim', Smartphone, 'USA eSIM', 'A real line on your phone'],
];

const goPlans = (id, setTab) => { setTab(id); document.getElementById('pricing')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); };
const TRUST = [[ShieldCheck, 'No contract'], [Zap, 'Live in minutes'], [LifeBuoy, 'Real people on support']];

// A price that hasn't loaded yet shows a shimmer, never a dash.
const Price = ({ value, testid }) => (value === false ? <span className="text-sm font-semibold text-slate-700" data-testid={testid}>See plans</span> : value ? <b className="text-xl text-slate-950 tabular-nums" data-testid={testid}>{value}</b> : <span className="civr-skel inline-block h-6 w-14 rounded-md align-middle" aria-label="Loading price" data-testid={`${testid}-loading`} />);

// The three kinds of number with their price, right next to the sign-up button.
function PriceList({ rows, onDetails }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white text-left civr-rise civr-d3" data-testid="hero-prices">
      <div className="px-6 pt-6 pb-3 text-sm font-semibold text-slate-700">Pick what your number is for</div>
      <ul>
        {rows.map(([id, I, title, text, price, extra]) => (
          <li key={id} className="border-t border-slate-100">
            <button type="button" onClick={() => onDetails(id)} className="group w-full text-left px-6 py-5 min-h-[72px] flex items-center gap-4 hover:bg-slate-50 focus-visible:bg-slate-50 transition-colors" aria-label={`${title}: see prices`} data-testid={`hero-price-${id}`}>
              <span className="w-10 h-10 rounded-xl bg-[#edf4ff] grid place-items-center shrink-0"><I className="w-5 h-5 text-[#1d6fd8]" aria-hidden="true" /></span>
              <span className="flex-1 min-w-0"><span className="block font-semibold text-slate-950">{title}</span><span className="block text-sm text-slate-600">{text}{extra ? ` · ${extra}` : ''}</span></span>
              <span className="text-right shrink-0"><span className="block text-xs text-slate-600">from</span><Price value={price} testid={`hero-price-${id}-amount`} /><span className="text-xs text-slate-600">/mo</span></span>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Hero: one headline, one sign-up button, and the prices beside it.
export function OneHero({ setTab, from, offer, fax, offerFailed, faxFailed }) {
  const start = useStart();
  const rows = [
    ['ivr', PhoneCall, 'Calls', 'Answer, forward, menus, voicemail', from, 'texting optional'],
    ['mobile', MessageSquareText, 'Calls + texting', 'Two-way texts and calls', offer?.price ? usd(offer.price) : offerFailed ? false : null, 'USA texts unlimited'],
    ['fax', Printer, 'Fax only', 'Send and receive faxes online', fax?.price ? usd(fax.price) : faxFailed ? false : null, `${fax?.freePages ?? 25} free pages a month`],
  ];
  return (
    <section id="product-hero" className="relative bg-white pt-28 md:pt-36 pb-16 md:pb-24" data-testid="product-hero">
      <div className="relative max-w-7xl mx-auto px-6 md:px-8">
        <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] gap-12 lg:gap-16 items-center">
          <div>
            <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl text-slate-950 font-extrabold tracking-tight civr-rise civr-d1" data-testid="hero-title">A business number for calls, texts or fax.</h1>
            <p className="max-w-xl text-base md:text-lg text-slate-600 mt-6 leading-relaxed civr-rise civr-d2" data-testid="hero-subtitle">Live in minutes. No ID needed in the USA, Canada or UK. Month to month{from ? `, from ${from}` : ''}.</p>
            <div className="mt-10 civr-rise civr-d3">
              <Link to={start()} className="civr-l-btn civr-l-btn-hero inline-flex items-center justify-center gap-2 min-h-[56px] px-8 w-full sm:w-auto" data-testid="hero-signup-cta">Get your number<ArrowRight className="w-5 h-5" aria-hidden="true" /></Link>
              <p className="text-sm text-slate-600 mt-3" data-testid="hero-signup-note">Free to sign up. Pay only when you pick a number.</p>
            </div>
            <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="hero-trust">
              {TRUST.map(([I, t], i) => <li key={t} className="flex items-center gap-2 text-sm font-medium text-slate-700" data-testid={`hero-trust-${i}`}><I className="w-4 h-4 text-emerald-600" aria-hidden="true" />{t}</li>)}
            </ul>
            <p className="text-sm text-slate-600 mt-6">Not sure yet? <a href="#try" onClick={(e) => goTo('#try', e)} className="font-semibold text-[#1d6fd8] underline underline-offset-2 inline-flex items-center min-h-[44px]" data-testid="hero-try-link">Take a free test call</a></p>
          </div>
          <PriceList rows={rows} onDetails={(id) => goPlans(id, setTab)} />
        </div>
      </div>
    </section>
  );
}

// Every plan in one place: tabs for Cloud IVR, USA eSIM and USA mobile number.
export function AllPlans({ catalog, tab, setTab, esimPrice, offer, fax }) {
  const start = useStart();
  const plans = (catalog?.plans || []).filter(p => p.available !== false);
  const hasRec = plans.some(p => p.recommended);
  const r = catalog?.rates;
  const [hotId, setHotId] = useState(null);
  const isHot = (p, i) => (hotId ? p.id === hotId : hasRec ? p.recommended : i === 1);
  return (
    <section id="pricing" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="pricing-section">
      <span id="coverage" className="block -mt-16 pt-16" aria-hidden="true" />
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">Pricing</h2><p className="text-slate-600 mt-3 max-w-2xl">One monthly price per number. No contract, cancel any time.</p></Reveal>
        <div role="tablist" aria-label="Kind of number" className="inline-flex flex-wrap gap-2 mt-10 rounded-2xl bg-white border civr-l-rule p-1.5" data-testid="plans-tabs">
          {PICKS.map(([id, I, t]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`civr-plan-tab inline-flex items-center gap-2 rounded-xl px-4 h-11 text-sm font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-100'}`} data-testid={`plans-tab-${id}`}><I className="w-4 h-4" />{t}</button>)}
        </div>
        <div key={tab} className="civr-tab-panel mt-8" data-testid={`plans-panel-${tab}`}>
          {tab === 'ivr' && (
            <>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">{plans.map((p, i) => <PlanCard key={p.id} p={p} plans={plans} hot={isHot(p, i)} start={start} delay={i * 80} />)}</div>
              {r && <p className="text-sm text-slate-600 mt-6 max-w-3xl" data-testid="pricing-extra-usage">Outgoing calls and forwarding are paid from your wallet. Business shows your verified caller ID on every call.</p>}
              <details className="mt-6 group max-w-3xl" data-testid="pricing-more">
                <summary className="cursor-pointer inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-slate-900" data-testid="pricing-more-toggle"><ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />Not sure which plan? Need more?</summary>
                <div className="mt-4 space-y-6">
                  <LandingPlanHelper plans={plans} onPlan={(id) => { setHotId(id); setTimeout(() => document.querySelector(`[data-testid="civr-plan-card-${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); }} setTab={setTab} />
                  <p className="text-sm text-slate-700" data-testid="pricing-enterprise"><b>Enterprise · {'$'}{catalog?.enterprise?.price ?? 399}/month</b> — custom minutes, API access, a dedicated SIP trunk and white-label for resellers. <a href="mailto:sales@cloudivr.net?subject=CloudIVR%20Enterprise" className="font-semibold text-[#1d6fd8] underline underline-offset-2 inline-block py-2" data-testid="pricing-enterprise-contact">Talk to sales</a></p>
                </div>
              </details>
            </>
          )}
          {tab === 'fax' && <FaxLanding fax={fax} />}
          {tab !== 'ivr' && tab !== 'fax' && (
            <div className="grid md:grid-cols-2 gap-5 max-w-5xl">
              {tab === 'esim'
                ? <Card id="esim-card" icon={Smartphone} badge="On your phone" title="USA eSIM" kind="Downloadable eSIM on a real USA carrier" price={esimPrice || 75} points={ESIM_POINTS} note="QR code usually ready within minutes of payment."><button type="button" onClick={() => openEsimCheckout()} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-esim">Order eSIM<ArrowRight className="w-4 h-4" /></button></Card>
                : <Card id="mobile" icon={MessageSquareText} badge="In your browser" title="Calls + texting number" kind="USA number on a real carrier · more countries in the app" price={offer?.price || 75} points={MOBILE_POINTS} note="Pick a ZIP code; the exact number is shown after payment.">{offer?.available ? <button type="button" onClick={openMobileCheckout} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-mobile">Order number<ArrowRight className="w-4 h-4" /></button> : offer ? <Waitlist /> : <div className="mt-4 h-[52px]" />}</Card>}
              <div className="rounded-2xl border civr-l-rule bg-white p-6 text-sm text-slate-700 space-y-3" data-testid="which-one">
                <p className="font-semibold text-slate-950">Which one do I need?</p>
                <p>Want the line on your phone? <b>USA eSIM</b>.</p>
                <p>Want to text and call from your browser? <b>Calls + texting number</b>. Outside the USA you pay per text sent.</p>
                <p>Need to send and receive faxes? <button type="button" className="font-semibold underline" onClick={() => setTab('fax')} data-testid="which-one-fax">Fax number</button>.</p>
                <p>Need IVR, campaigns, SIP or your verified caller IDs? <button type="button" className="font-semibold underline" onClick={() => setTab('ivr')} data-testid="which-one-ivr">Calling plans</button>.</p>
              </div>
            </div>
          )}
        </div>
        <PaymentMethods catalog={catalog} className="mt-10 pt-8 border-t civr-l-rule" testid="pricing-payment-methods" />
      </div>
    </section>
  );
}
