import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Minus, PhoneCall, Smartphone, MessageSquareText, Printer } from 'lucide-react';
import { Reveal, Slide, reducedMotion } from './kit';
import { usd } from '../../api';
import { PlanCard, TextingCard, useStart } from './PricingFaq';
import { Card, Waitlist, ESIM_POINTS, MOBILE_POINTS } from './ProductHero';
import { openEsimCheckout } from './EsimCheckout';
import { openMobileCheckout } from './MobileCheckout';
import { PaymentMethods } from './Payments';
import { HeroDecor, Squiggle } from './Doodles';
import { PurposeCards } from './PurposeCards';
import { FaxLanding } from './FaxLanding';
import { NumbersPreview } from './NumbersPreview';
import { LandingPlanHelper } from './PlanHelper';

const WORDS = ['business calls', 'IVR campaigns', 'two-way texts', 'online fax', 'a USA eSIM'];
export const PICKS = [
  ['ivr', PhoneCall, 'A business phone line', 'Calls, IVR, SIP and campaigns'],
  ['esim', Smartphone, 'A USA eSIM', 'A real line on your phone'],
  ['mobile', MessageSquareText, 'A Texting Number', 'Send and receive texts in your browser'],
  ['fax', Printer, 'A fax number', 'Send and receive faxes online'],
];

function CyclingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const t = setInterval(() => setI(n => (n + 1) % WORDS.length), 2600);
    return () => clearInterval(t);
  }, []);
  return <span className="civr-cycle" aria-live="polite"><span key={i} className="civr-cycle-word civr-l-hl" data-testid="hero-cycling-word">{WORDS[i]}</span></span>;
}

const goPlans = (id, setTab) => { setTab(id); document.getElementById('pricing')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); };

// Hero: centred headline with a hand-drawn underline, floating telecom drawings, a tabbed card and a sample dashboard.
export function OneHero({ setTab, from, esimPrice, offer, fax, catalog }) {
  return (
    <section className="relative overflow-hidden bg-white pt-28 md:pt-32 pb-14 md:pb-16" data-testid="product-hero">
      <HeroDecor />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 text-center">
        <div className="mx-auto max-w-3xl">
          <div className="civr-l-kicker civr-rise"><span className="civr-l-dot" />Cloud phone, IVR, texting and fax</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl mt-5 text-slate-950 font-extrabold tracking-tight civr-rise civr-d1" data-testid="hero-title">One place for <span className="relative inline-block"><CyclingWord /><Squiggle /></span></h1>
          <p className="mx-auto max-w-2xl text-base md:text-lg text-slate-600 mt-5 leading-relaxed civr-rise civr-d2" data-testid="hero-subtitle">Pick what you need, pay with crypto or your wallet, and you are live in minutes. Month to month, no contract{from ? ` · from ${from}/month` : ''}.</p>
        </div>
        <PurposeCards catalog={catalog} from={from} offer={offer} fax={fax} esimPrice={esimPrice} goPlans={(id) => goPlans(id, setTab)} />
        <NumbersPreview />
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
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">All plans, side by side</h2><p className="text-slate-600 mt-3 max-w-2xl">Each number does one job: a Business Line for voice and SIP, a Texting Number for SMS, a fax-only number for fax. One monthly price each, no contract.</p></Reveal>
        <LandingPlanHelper plans={plans} onPlan={(id) => { setHotId(id); setTimeout(() => document.querySelector(`[data-testid="civr-plan-card-${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); }} setTab={setTab} />
        <div role="tablist" className="inline-flex flex-wrap gap-2 mt-8 rounded-2xl bg-white border civr-l-rule p-1.5" data-testid="plans-tabs">
          {PICKS.map(([id, I, t]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`civr-plan-tab inline-flex items-center gap-2 rounded-xl px-4 h-11 text-sm font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-100'}`} data-testid={`plans-tab-${id}`}><I className="w-4 h-4" />{t}</button>)}
        </div>
        <div key={tab} className="civr-tab-panel mt-8" data-testid={`plans-panel-${tab}`}>
          {tab === 'ivr' && (
            <>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">{plans.map((p, i) => <PlanCard key={p.id} p={p} plans={plans} hot={isHot(p, i)} start={start} delay={i * 80} />)}{catalog?.texting && <TextingCard t={catalog.texting} start={start} delay={plans.length * 80} />}</div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 p-5 flex flex-wrap items-center gap-4" data-testid="pricing-enterprise"><div className="flex-1 min-w-[240px]"><div className="font-semibold text-slate-900">Enterprise · from $299/month</div><p className="text-sm text-slate-500 mt-1">Custom minutes and limits, API access, a dedicated SIP trunk and white-label for resellers.</p></div><a href="mailto:sales@cloudivr.net?subject=CloudIVR%20Enterprise" className="rounded-full bg-slate-900 text-white px-5 py-2 text-sm font-semibold" data-testid="pricing-enterprise-contact">Talk to sales</a></div>
              {r && <p className="text-sm text-slate-500 mt-6 max-w-3xl" data-testid="pricing-extra-usage">{'Outgoing calls and forwarding are paid from your wallet. Business can show your verified caller ID on every call.'}</p>}
            </>
          )}
          {tab === 'fax' && <FaxLanding fax={fax} />}
          {tab !== 'ivr' && tab !== 'fax' && (
            <div className="grid md:grid-cols-2 gap-5 max-w-5xl">
              {tab === 'esim'
                ? <Card id="esim-card" icon={Smartphone} badge="On your phone" title="USA eSIM" kind="Downloadable eSIM on a real USA carrier" price={esimPrice || 75} points={ESIM_POINTS} note="QR code usually ready within minutes of payment."><button type="button" onClick={() => openEsimCheckout()} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-esim">Order eSIM<ArrowRight className="w-4 h-4" /></button></Card>
                : <Card id="mobile" icon={MessageSquareText} badge="In your browser" title="Texting Number" kind="Virtual number on a real USA carrier" price={offer?.price || 75} points={MOBILE_POINTS} note="Pick a ZIP code; the exact number is shown after payment.">{offer?.available ? <button type="button" onClick={openMobileCheckout} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-mobile">Order number<ArrowRight className="w-4 h-4" /></button> : offer ? <Waitlist /> : <div className="mt-4 h-[52px]" />}</Card>}
              <div className="rounded-2xl border civr-l-rule bg-white p-6 text-sm text-slate-700 space-y-3" data-testid="which-one">
                <p className="font-semibold text-slate-950">Which one do I need?</p>
                <p>Want the line on your phone? <b>USA eSIM</b>.</p>
                <p>Want to text from your browser? <b>Texting Number</b>.</p>
                <p>Need to send and receive faxes? <button type="button" className="font-semibold underline" onClick={() => setTab('fax')} data-testid="which-one-fax">Fax number</button>.</p>
                <p>Need IVR, campaigns, SIP or your verified caller IDs? <button type="button" className="font-semibold underline" onClick={() => setTab('ivr')} data-testid="which-one-ivr">Cloud IVR plans</button>.</p>
              </div>
            </div>
          )}
        </div>
        <PaymentMethods catalog={catalog} className="mt-10 pt-8 border-t civr-l-rule" testid="pricing-payment-methods" />
      </div>
    </section>
  );
}

const ROWS = [
  ['Month to month, no contract', true, false, true],
  ['Real USA carrier mobile number', true, true, false],
  ['Show your verified caller ID (Business)', true, false, false],
  ['Keypad menu, Quick IVR and Bulk IVR campaigns', true, false, false],
  ['Browser phone and SIP softphone logins', true, false, 'Some'],
  ['AI voice agent and call recording', true, false, 'Some'],
  ['Fax-only numbers, USA and Canada', true, false, false],
  ['Pay with crypto', true, false, false],
];
const Cell = ({ v }) => (v === true ? <Check className="w-5 h-5 text-emerald-600 mx-auto" aria-label="Yes" /> : v === false ? <Minus className="w-5 h-5 text-slate-300 mx-auto" aria-label="No" /> : <span className="text-xs text-slate-500">{v}</span>);

export function CompareTable({ catalog }) {
  const start = useStart();
  return (
    <section className="civr-l-cream civr-l-soft border-t civr-l-rule" data-testid="compare-section">
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-20">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">Why CloudIVR</h2><p className="text-slate-600 mt-3">Compared with a typical carrier plan and a basic calling app.</p></Reveal>
        <Reveal delay={80} className="mt-8 overflow-x-auto rounded-2xl border civr-l-rule bg-white">
          <table className="w-full text-sm" data-testid="compare-table">
            <thead><tr className="border-b civr-l-rule text-slate-500"><th className="text-left font-medium p-4" /><th className="p-4 font-semibold text-slate-950">CloudIVR</th><th className="p-4 font-medium">Carrier plan</th><th className="p-4 font-medium">Calling app</th></tr></thead>
            <tbody>{ROWS.map(([label, a, b, c], i) => <tr key={label} className="border-b last:border-0 civr-l-rule" data-testid={`compare-row-${i}`}><td className="p-4 text-slate-800">{label}</td><td className="p-4 text-center bg-emerald-50/40"><Cell v={a} /></td><td className="p-4 text-center"><Cell v={b} /></td><td className="p-4 text-center"><Cell v={c} /></td></tr>)}</tbody>
          </table>
        </Reveal>
        <div className="mt-8"><Link to={start()} className="civr-l-pill civr-l-pill-ink" data-testid="compare-cta"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>{catalog?.extraNumber && <span className="ml-4 text-sm text-slate-500">Extra numbers from {usd(catalog.extraNumber.price)}/month</span>}</div>
      </div>
    </section>
  );
}
