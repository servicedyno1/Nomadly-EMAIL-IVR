import React from 'react';
import { UserPlus, Hash, Wallet, Globe2, Timer, Tag, Languages, Clock3, Coins, ArrowRight } from 'lucide-react';
import { SectionHead, coinList, planBadge, Reveal, CountUp } from './kit';
import { startPrice } from '../../api';

export { coinList, andList, planBadge } from './kit';

// Real facts from the live catalogue (no made-up customers), cm.com stats-row style.
export function Facts({ catalog }) {
  const coins = new Set((catalog?.coins || []).map(c => c.replace(/\s*\(.*\)/, ''))).size;
  const items = [
    [Globe2, String(catalog?.countries?.length || 17), 'Countries with local, mobile or toll-free numbers'],
    [Timer, '60 s', 'Free test call — no account, no card'],
    [Tag, startPrice(catalog) || '$50', 'Numbers from, per month — no contracts'],
    [Languages, '3', 'AI agent languages: English, French and Spanish'],
    [Clock3, '24/7', 'Your menu or AI agent always answers'],
    ...(coins ? [[Coins, String(coins), 'Cryptocurrencies accepted, plus your wallet']] : []),
  ];
  return (
    <section className="civr-l-cream" data-testid="facts-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 pb-20 md:pb-24 pt-4">
        <Reveal className="civr-l-eyebrow" data-testid="facts-label">CloudIVR at a glance</Reveal>
        <div className={`grid grid-cols-2 md:grid-cols-3 ${items.length > 5 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} border-t civr-l-rule mt-6`} data-testid="hero-stats">
          {items.map(([Icon, v, l], i) => (
            <Reveal key={l} delay={i * 70} className={`py-8 pr-4 ${i ? 'lg:pl-6 lg:border-l civr-l-rule' : ''}`} data-testid={`hero-stat-${i}`}>
              <Icon className="w-5 h-5 text-[#5b21b6]" />
              <div className="civr-l-h text-3xl md:text-4xl text-slate-900 mt-4"><CountUp value={v} /></div>
              <div className="text-sm text-slate-500 mt-2 max-w-[14rem]">{l}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// The big statement, cm.com "every conversation" style.
export function Statement() {
  return (
    <section className="civr-l-cream border-t civr-l-rule" data-testid="statement-section">
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-20 md:py-28">
        <Reveal><p className="civr-l-h text-2xl sm:text-3xl lg:text-[2.75rem] text-slate-900 !leading-[1.2]" data-testid="statement-text">Your callers don’t see a menu, a voicemail box, a campaign and an AI agent. <span className="text-[#7c3aed]">They see one phone line — yours.</span></p></Reveal>
        <Reveal delay={120}><p className="text-base md:text-lg text-slate-600 mt-8 max-w-3xl">So CloudIVR runs all of it on one number. Every call, key press, text, voicemail and recording lands in the same account, and you watch your campaigns live — from the first ring to the hot lead you’re connected to.</p></Reveal>
        <Reveal delay={200} className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <p className="font-semibold text-slate-900">Answer every call. Call every lead. Miss nothing.</p>
          <a href="#features" className="inline-flex items-center gap-2 text-sm font-semibold text-[#5b21b6] hover:text-[#4c1d95] group" data-testid="statement-explore-link">Explore the platform<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></a>
        </Reveal>
      </div>
    </section>
  );
}

export function Coverage({ catalog }) {
  const list = catalog?.countries || [];
  const tn = catalog?.typeNames || {};
  return (
    <section id="coverage" className="civr-l-cream scroll-mt-16" data-testid="coverage-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <div className="grid lg:grid-cols-12 gap-8 items-end">
          <div className="lg:col-span-8"><SectionHead label="Coverage" title={`Local presence in ${list.length || 17} countries.`} sub="Local, mobile and toll-free numbers your customers recognise — and pick up. Most go live in about a minute; a few countries ask for a quick ID check first." /></div>
          <p className="lg:col-span-4 text-sm civr-l-muted lg:text-right">Voice and SIP on every number · SMS on most</p>
        </div>
        <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="coverage-grid">
          {list.map((c, i) => (
            <Reveal key={c.code} delay={Math.min(i, 11) * 50} className="civr-l-card-cream px-4 py-4 min-w-0" data-testid={`coverage-${c.code}`}>
              <div className="flex items-center gap-3 min-w-0"><span className="text-2xl leading-none">{c.flag}</span><span className="font-semibold text-slate-900 truncate">{c.name}</span></div>
              <div className="text-xs civr-l-muted mt-2 truncate">{c.types.map(t => tn[t] || t).join(' · ')}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Badge({ plans, k }) {
  const b = planBadge(plans, k);
  if (!b) return null;
  const every = b === 'Every plan';
  return <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${every ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-indigo-200 bg-indigo-50 text-[#4338ca]'}`}>{b}</span>;
}

export function HowItWorks({ catalog }) {
  const steps = [
    [UserPlus, 'Create your free account', 'Email or Google. No card, no contract, no setup fee.'],
    [Hash, 'Pick a number and a plan', 'Choose a country and a local, mobile or toll-free number. Then decide what callers get: forwarding, voicemail, a keypad menu or an AI voice agent.'],
    [Wallet, 'Pay and go live', `Crypto (${coinList(catalog) || 'BTC, ETH, USDT and more'}) or your CloudIVR wallet — cards are coming soon. Most numbers ring in about a minute.`],
  ];
  return (
    <section id="how" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="how-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="How it works" title="From sign-up to ringing in minutes." />
        <ol className="grid md:grid-cols-3 gap-4 mt-12">
          {steps.map(([Icon, t, s], i) => (
            <Reveal as="li" key={t} delay={i * 120} className="civr-l-card-cream p-6 md:p-8" data-testid={`how-step-${i + 1}`}>
              <div className="flex items-center justify-between"><span className="w-8 h-8 rounded-full bg-[#4f46e5] text-white text-sm font-semibold grid place-items-center">{i + 1}</span><Icon className="w-5 h-5 text-slate-400" /></div>
              <div className="text-xl font-semibold text-slate-900 mt-6">{t}</div>
              <p className="text-sm text-slate-600 mt-2">{s}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
