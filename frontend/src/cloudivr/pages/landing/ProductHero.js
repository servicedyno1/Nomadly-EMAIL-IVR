import React, { useState } from 'react';
import { ArrowRight, Smartphone, MessageSquareText, Check, ShieldCheck, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { Reveal } from './kit';
import { openEsimCheckout, EMAIL_OK } from './EsimCheckout';
import { openMobileCheckout } from './MobileCheckout';

const ESIM_POINTS = ['Install it on your phone with a QR code', 'US data, calls and texts on your phone', 'QR code shown in the app and emailed to you', 'For unlocked phones that support eSIM'];
const MOBILE_POINTS = ['A real carrier mobile number, not VoIP, accepted by most banks and apps', 'Send and receive texts in CloudIVR Messages, in any browser', 'No phone or SIM needed', 'Free caller ID for your CloudIVR calls'];

function Waitlist() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState(null);
  const go = async (e) => { e.preventDefault(); setState('busy'); try { await api('/public/waitlist', { method: 'POST', body: { email } }); setState('done'); } catch (x) { setState(x.message); } };
  if (state === 'done') return <p className="mt-6 text-sm font-semibold text-emerald-700" data-testid="mobile-waitlist-done">Thanks. We’ll email you when ordering opens.</p>;
  return (
    <form onSubmit={go} className="mt-4 space-y-2" data-testid="mobile-waitlist">
      <p className="text-sm font-semibold text-slate-900">Coming soon. Join the waitlist</p>
      <div className="flex gap-2">
        <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Your email" className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 h-12 text-slate-900" data-testid="mobile-waitlist-email" />
        <button type="submit" disabled={!EMAIL_OK.test(email.trim()) || state === 'busy'} className="civr-l-btn !h-12 shrink-0 disabled:opacity-50" data-testid="mobile-waitlist-submit">{state === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Notify me'}</button>
      </div>
      {state && state !== 'busy' && <p role="alert" className="text-sm text-rose-600">{state}</p>}
    </form>
  );
}

function Card({ id, icon: I, badge, title, price, points, note, children, delay }) {
  return (
    <Reveal delay={delay} id={id} className="v2-surface p-6 sm:p-7 flex flex-col text-left scroll-mt-28" data-testid={`product-card-${id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="w-11 h-11 rounded-xl grid place-items-center bg-[color:var(--np-blue)]/10 text-[color:var(--np-blue)]"><I className="w-5 h-5" /></span>
        <span className="text-xs font-semibold rounded-full px-3 py-1 bg-slate-100 text-slate-700">{badge}</span>
      </div>
      <h2 className="civr-l-h text-2xl sm:text-3xl mt-4 text-slate-950">{title}</h2>
      <div className="mt-2 font-mono text-slate-950" data-testid={`product-price-${id}`}><span className="text-3xl font-semibold">{`$${price}`}</span><span className="text-sm text-slate-500">/month</span></div>
      <ul className="mt-5 space-y-2.5 text-[15px] text-slate-700 flex-1">{points.map(x => <li key={x} className="flex gap-2.5"><Check className="w-4 h-4 mt-1 shrink-0 text-[color:var(--np-blue)]" />{x}</li>)}</ul>
      <p className="mt-5 text-xs text-slate-500 flex items-start gap-1.5 min-h-[32px]" data-testid={`product-note-${id}`}><ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0" />{note}</p>
      {children}
    </Reveal>
  );
}

// Top of the landing page: the two carrier products, each orderable without an account.
export function ProductHero({ esimPrice, offer }) {
  const mobilePrice = offer?.price || 75;
  return (
    <section className="civr-l-cream relative pt-24 md:pt-28 pb-14 md:pb-20" data-testid="product-hero">
      <div className="relative max-w-6xl mx-auto px-5 sm:px-6">
        <div className="max-w-4xl">
          <div className="civr-l-kicker civr-rise"><span className="civr-l-dot" />US mobile lines on a real carrier</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-[54px] lg:leading-[1.08] mt-5 text-slate-950 civr-rise civr-d1" data-testid="hero-title">A real US number on a real carrier. <span className="civr-l-hl">On your phone, or in your browser.</span></h1>
          <p className="text-base md:text-lg text-slate-600 mt-4 leading-relaxed civr-rise civr-d2" data-testid="hero-subtitle">Order in a couple of minutes, right here. Pay with crypto or your CloudIVR wallet. No contract, renews monthly.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5 mt-8">
          <Card id="esim-card" icon={Smartphone} badge="On your phone" title="CloudIVR eSIM" price={esimPrice || 75} points={ESIM_POINTS} note="QR code usually ready within minutes of payment." delay={60}>
            <button type="button" onClick={() => openEsimCheckout()} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-esim">Order eSIM<ArrowRight className="w-4 h-4" /></button>
          </Card>
          <Card id="mobile" icon={MessageSquareText} badge="In your browser" title="US mobile number" price={mobilePrice} points={MOBILE_POINTS} note="Pick a ZIP code; the exact number is shown after payment. Texts only for now, calls coming later." delay={140}>
            {offer?.available
              ? <button type="button" onClick={openMobileCheckout} className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-mobile">Order number<ArrowRight className="w-4 h-4" /></button>
              : offer ? <Waitlist /> : <div className="mt-4 h-[52px]" />}
          </Card>
        </div>
        <Reveal className="mt-6 rounded-2xl border civr-l-rule bg-white px-5 py-4 text-sm text-slate-700 flex flex-wrap gap-x-6 gap-y-1" data-testid="which-one">
          <span className="font-semibold text-slate-950">Which one do I need?</span>
          <span>Want the line on your phone? <b>eSIM</b>.</span>
          <span>Want the number in your browser? <b>US mobile number</b>.</span>
        </Reveal>
      </div>
    </section>
  );
}
