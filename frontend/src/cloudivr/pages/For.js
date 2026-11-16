import React, { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, X } from 'lucide-react';
import { useApi, startPrice } from '../api';
import { cp } from '../paths';
import { useSiteLook, Reveal } from './landing/kit';
import { LandingNav } from './landing/Nav';
import { Footer, useStart } from './landing/PricingFaq';
import { WhoFor } from './landing/WhoFor';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import { audienceBy } from './for/audiences';

function Hero({ a, from, to }) {
  return (
    <section className="relative bg-white pt-28 md:pt-36 pb-16 md:pb-20" data-testid="for-hero">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#edf4ff] text-[#1d6fd8] text-sm font-semibold px-4 h-9 civr-rise" data-testid="for-eyebrow"><a.icon className="w-4 h-4" aria-hidden="true" />{`For ${a.name.toLowerCase()}`}</div>
        <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl text-slate-950 font-extrabold tracking-tight mt-6 max-w-4xl civr-rise civr-d1" data-testid="for-title">{a.title[0]}<span className="text-[#1d6fd8]">{a.title[1]}</span></h1>
        <p className="max-w-2xl text-base md:text-lg text-slate-600 mt-6 leading-relaxed civr-rise civr-d2" data-testid="for-subtitle">{a.sub}</p>
        <div className="mt-10 flex flex-wrap items-center gap-4 civr-rise civr-d3">
          <Link to={to} className="civr-l-btn civr-l-btn-hero inline-flex items-center justify-center gap-2 min-h-[56px] px-8 w-full sm:w-auto" data-testid="for-hero-cta">Get your number<ArrowRight className="w-5 h-5" aria-hidden="true" /></Link>
          <a href={`${cp()}#pricing`} className="text-sm font-semibold text-slate-900 underline underline-offset-4 min-h-[44px] inline-flex items-center" data-testid="for-hero-pricing">See pricing</a>
        </div>
        <p className="text-sm text-slate-600 mt-4" data-testid="for-hero-note">{from ? `Free to sign up · from ${from}/month · no contract` : 'Free to sign up · no contract'}</p>
      </div>
    </section>
  );
}

// The three problems this audience arrives with, each next to what CloudIVR does about it.
function Pains({ a }) {
  return (
    <section className="civr-l-cream border-t civr-l-rule" data-testid="for-pains">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">Sound familiar?</h2></Reveal>
        <ul className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
          {a.pains.map(([pain, fix], i) => (
            <Reveal as="li" key={pain} delay={i * 80} className="grid md:grid-cols-2 gap-4 md:gap-12 py-8" data-testid={`for-pain-${i}`}>
              <p className="flex gap-3 text-lg font-semibold text-slate-950"><X className="w-5 h-5 mt-1 shrink-0 text-rose-500" aria-hidden="true" />{pain}</p>
              <p className="flex gap-3 text-base text-slate-700"><Check className="w-5 h-5 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />{fix}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Features({ a }) {
  return (
    <section className="bg-white border-t border-slate-100" data-testid="for-features">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20">
        <Reveal><h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">What you will use most</h2></Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
          {a.features.map(([Icon, t, d], i) => (
            <Reveal key={t} delay={i * 60} className="rounded-2xl border border-slate-200 p-6" data-testid={`for-feature-${i}`}>
              <span className="w-10 h-10 rounded-xl bg-slate-100 grid place-items-center"><Icon className="w-5 h-5 text-slate-900" aria-hidden="true" /></span>
              <h3 className="font-semibold text-slate-950 mt-5">{t}</h3>
              <p className="text-sm text-slate-600 mt-2">{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Questions({ a, to }) {
  return (
    <section className="civr-l-cream border-t civr-l-rule" data-testid="for-faq">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)] gap-12 items-start">
        <div>
          <h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">Questions people ask first</h2>
          <dl className="mt-8 space-y-6">
            {a.faq.map(([q, an], i) => <div key={q} data-testid={`for-faq-${i}`}><dt className="font-semibold text-slate-950">{q}</dt><dd className="text-slate-700 mt-2">{an}</dd></div>)}
          </dl>
        </div>
        <Reveal className="civr-l-ondark rounded-3xl bg-[#07060f] ring-1 ring-white/10 p-8 md:p-10" data-testid="for-final-cta">
          <h2 className="civr-l-h text-2xl sm:text-3xl text-white">Try it on a real number.</h2>
          <p className="text-slate-300 mt-3">Free to sign up. You pay only when you pick a number.</p>
          <Link to={to} className="civr-l-pill civr-l-pill-ink mt-8" data-testid="for-final-cta-button">Get your number<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
        </Reveal>
      </div>
    </section>
  );
}

// cloudivr.net/for/<audience>: the same product, told for one kind of customer.
export default function ForPage() {
  const { who } = useParams();
  const a = audienceBy(who);
  const { data } = useApi('/public/catalog');
  const catalog = data || CATALOG_SNAPSHOT;
  const start = useStart();
  useSiteLook();
  useEffect(() => { window.scrollTo(0, 0); }, [who]);
  if (!a) return <Navigate to={cp()} replace />;
  const to = start(a.plan);
  return (
    <div className="civr-l civr-np" data-testid={`for-page-${a.slug}`}>
      <LandingNav />
      <main>
        <Hero a={a} from={startPrice(catalog)} to={to} />
        <Pains a={a} />
        <Features a={a} />
        <Questions a={a} to={to} />
        <WhoFor skip={a.slug} title="Not quite you?" sub="CloudIVR is set up differently for each kind of work." />
      </main>
      <Footer catalog={catalog} />
    </div>
  );
}
