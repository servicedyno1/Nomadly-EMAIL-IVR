import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Minus, PhoneCall, Smartphone, MessageSquareText } from 'lucide-react';
import { Reveal, Slide, reducedMotion } from './kit';
import { usd, money } from '../../api';
import { PlanCard, TextingCard, useStart } from './PricingFaq';
import { Card, Waitlist, ESIM_POINTS, MOBILE_POINTS } from './ProductHero';
import { openEsimCheckout } from './EsimCheckout';
import { openMobileCheckout } from './MobileCheckout';
import { PaymentMethods } from './Payments';

const WORDS = ['business calls', 'IVR campaigns', 'two-way texts', 'a USA eSIM'];
export const PICKS = [
  ['ivr', PhoneCall, 'A business phone line', 'Calls, IVR, SIP and campaigns'],
  ['esim', Smartphone, 'A USA eSIM', 'A real line on your phone'],
  ['mobile', MessageSquareText, 'A USA mobile number', 'Real carrier number in your browser'],
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

// Short hero: cycling headline + "What do you need?" picker that opens the matching plans tab.
export function OneHero({ setTab, from }) {
  return (
    <section className="civr-l-cream pt-28 md:pt-32 pb-14 md:pb-20" data-testid="product-hero">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <div className="max-w-3xl">
          <div className="civr-l-kicker civr-rise"><span className="civr-l-dot" />Cloud phone, IVR and USA mobile lines</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl mt-5 text-slate-950 civr-rise civr-d1" data-testid="hero-title">One place for <CyclingWord /></h1>
          <p className="text-base md:text-lg text-slate-600 mt-5 leading-relaxed civr-rise civr-d2" data-testid="hero-subtitle">Pick what you need, pay with crypto or your wallet, and you are live in minutes. Month to month, no contract{from ? ` · from ${from}/month` : ''}.</p>
        </div>
        <div className="mt-10 civr-rise civr-d3" data-testid="plan-picker">
          <p className="text-sm font-semibold text-slate-900 mb-3">What do you need?</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {PICKS.map(([id, I, t, s]) => (
              <button key={id} type="button" onClick={() => goPlans(id, setTab)} className="civr-pick group text-left rounded-2xl border civr-l-rule bg-white p-5 min-h-[96px]" data-testid={`plan-picker-${id}`}>
                <span className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl grid place-items-center bg-slate-950 text-white"><I className="w-5 h-5" /></span><span className="font-semibold text-slate-950">{t}</span><ArrowRight className="w-4 h-4 ml-auto text-slate-400 group-hover:translate-x-1 transition-transform" /></span>
                <span className="block text-sm text-slate-500 mt-2">{s}</span>
              </button>
            ))}
          </div>
          <a href="#try" className="inline-flex items-center gap-2 mt-6 text-sm font-semibold text-slate-900 underline underline-offset-4" data-testid="hero-try-link">Or try a free call first — show any caller ID</a>
        </div>
      </div>
    </section>
  );
}

// Every plan in one place: tabs for Cloud IVR, USA eSIM and USA mobile number.
export function AllPlans({ catalog, tab, setTab, esimPrice, offer }) {
  const start = useStart();
  const plans = (catalog?.plans || []).filter(p => p.available !== false);
  const hasRec = plans.some(p => p.recommended);
  const r = catalog?.rates;
  return (
    <section id="pricing" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="pricing-section">
      <span id="coverage" className="block -mt-16 pt-16" aria-hidden="true" />
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">All plans, side by side</h2><p className="text-slate-600 mt-3 max-w-2xl">One monthly price, no contract. Switch tabs to compare.</p></Reveal>
        <div role="tablist" className="inline-flex flex-wrap gap-2 mt-8 rounded-2xl bg-white border civr-l-rule p-1.5" data-testid="plans-tabs">
          {PICKS.map(([id, I, t]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`civr-plan-tab inline-flex items-center gap-2 rounded-xl px-4 h-11 text-sm font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-100'}`} data-testid={`plans-tab-${id}`}><I className="w-4 h-4" />{t}</button>)}
        </div>
        <div key={tab} className="civr-tab-panel mt-8" data-testid={`plans-panel-${tab}`}>
          {tab === 'ivr' && (
            <>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">{plans.map((p, i) => <PlanCard key={p.id} p={p} plans={plans} hot={hasRec ? p.recommended : i === 1} start={start} delay={i * 80} />)}{catalog?.texting && <TextingCard t={catalog.texting} start={start} delay={plans.length * 80} />}</div>
              {r && <p className="text-sm text-slate-500 mt-6 max-w-3xl" data-testid="pricing-extra-usage">{`Plan minutes cover incoming calls. Outgoing calls and forwarding are paid from your wallet (forwarding ${money(r.forwardingPerMin)}/min; extra incoming minutes ${money(r.overagePerMin)}, extra SMS ${money(r.overagePerSms)}). Business can show any caller ID on every call.`}</p>}
            </>
          )}
          {tab !== 'ivr' && (
            <div className="grid md:grid-cols-2 gap-5 max-w-5xl">
              {tab === 'esim'
                ? <Card id="esim-card" icon={Smartphone} badge="On your phone" title="USA eSIM" kind="Downloadable eSIM on a real USA carrier" price={esimPrice || 75} points={ESIM_POINTS} note="QR code usually ready within minutes of payment."><button type="button" onClick={() => openEsimCheckout()} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-esim">Order eSIM<ArrowRight className="w-4 h-4" /></button></Card>
                : <Card id="mobile" icon={MessageSquareText} badge="In your browser" title="USA mobile number" kind="Virtual number on a real USA carrier" price={offer?.price || 75} points={MOBILE_POINTS} note="Pick a ZIP code; the exact number is shown after payment.">{offer?.available ? <button type="button" onClick={openMobileCheckout} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-mobile">Order number<ArrowRight className="w-4 h-4" /></button> : offer ? <Waitlist /> : <div className="mt-4 h-[52px]" />}</Card>}
              <div className="rounded-2xl border civr-l-rule bg-white p-6 text-sm text-slate-700 space-y-3" data-testid="which-one">
                <p className="font-semibold text-slate-950">Which one do I need?</p>
                <p>Want the line on your phone? <b>USA eSIM</b>.</p>
                <p>Want a number you use in your browser? <b>USA mobile number</b>.</p>
                <p>Need IVR, campaigns, SIP or any caller ID? <button type="button" className="font-semibold underline" onClick={() => setTab('ivr')} data-testid="which-one-ivr">Cloud IVR plans</button>.</p>
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
  ['Show any caller ID (Business)', true, false, false],
  ['Keypad menu, Quick IVR and Bulk IVR campaigns', true, false, false],
  ['Browser phone and SIP softphone logins', true, false, 'Some'],
  ['AI voice agent and call recording', true, false, 'Some'],
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
