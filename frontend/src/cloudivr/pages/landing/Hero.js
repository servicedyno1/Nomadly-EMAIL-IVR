import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall, Check, Globe2, Clock3, Languages, Timer } from 'lucide-react';
import { goTo } from './menu';
import { cp } from '../../paths';
import { useStart } from './PricingFaq';
import { HeroDemo } from './HeroDemo';
import { CountUp, Reveal } from './kit';
import { PaymentMethods } from './Payments';
import { Proof } from './Proof';

const SAFE = ['No card needed', '60-second test call', 'Live in minutes'];

// Hero: one promise, one main action (the free test call), and the product answering a call.
export function OneHero() {
  const start = useStart();
  return (
    <section id="product-hero" className="lx-hero relative pt-24 md:pt-36 pb-20 md:pb-32" data-testid="product-hero">
      <div className="lx-aurora" aria-hidden="true" /><div className="lx-grain" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] gap-8 lg:gap-8 items-center">
        <div>
          <div className="lx-chip civr-rise" data-testid="hero-kicker"><span className="lx-live" aria-hidden="true" />AI receptionist on every plan</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl text-slate-950 mt-6 civr-rise civr-d1" data-testid="hero-title">One business number, <span className="lx-grad">wherever you work.</span></h1>
          <p className="max-w-xl text-base md:text-lg text-slate-600 mt-6 leading-relaxed civr-rise civr-d2" data-testid="hero-subtitle">Never miss a customer call. A menu or an AI receptionist answers, routes and takes messages around the clock, on a number for calls, texts or fax.</p>
          <div className="mt-8 md:mt-10 flex flex-col sm:flex-row gap-3 civr-rise civr-d3">
            <a href={`${cp()}#try`} onClick={(e) => goTo('#try', e)} className="civr-l-btn civr-l-btn-hero px-8" data-testid="hero-try-cta"><PhoneCall className="w-5 h-5" aria-hidden="true" />Make a free test call</a>
            <Link to={start()} className="civr-l-btn civr-l-btn-ghost civr-l-btn-hero px-8" data-testid="hero-signup-cta">Get your number<ArrowRight className="w-5 h-5" aria-hidden="true" /></Link>
          </div>
          <ul className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="hero-trust">
            {SAFE.map((t, i) => <li key={t} className="flex items-center gap-2 text-sm font-medium text-slate-700" data-testid={`hero-trust-${i}`}><Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />{t}</li>)}
          </ul>
        </div>
        <HeroDemo />
      </div>
    </section>
  );
}

// Real facts from the live catalogue, on a glass band that overlaps the hero. Platform counters show only when real.
export function TrustBand({ catalog }) {
  const items = [
    [Globe2, 'Local', 'and toll-free numbers'],
    [Clock3, '24/7', 'Your menu or AI always answers'],
    [Languages, '20', 'AI conversation languages'],
    [Timer, '60 s', 'Free test call, no card'],
  ];
  return (
    <section className="lx-soft relative" data-testid="facts-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 pb-16">
        <Reveal className="lx-glass relative -top-12 grid grid-cols-2 lg:grid-cols-4" data-testid="hero-stats">
          {items.map(([Icon, v, l], i) => (
            <div key={l} className={`p-6 md:p-8 ${i % 2 ? 'border-l border-slate-200/70' : ''} ${i > 1 ? 'max-lg:border-t border-slate-200/70' : ''} ${i === 2 ? 'lg:border-l' : ''}`} data-testid={`hero-stat-${i}`}>
              <Icon className="w-5 h-5 text-[#1d6fd8]" aria-hidden="true" />
              <div className="civr-l-h text-3xl md:text-4xl text-slate-950 mt-3"><CountUp value={v} /></div>
              <div className="text-sm text-slate-600 mt-1">{l}</div>
            </div>
          ))}
        </Reveal>
        <PaymentMethods catalog={catalog} label="Pay with" testid="trust-payment-methods" className="-mt-4" />
        <Proof />
      </div>
    </section>
  );
}
