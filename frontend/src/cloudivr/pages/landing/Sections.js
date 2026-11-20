import React from 'react';
import { UserPlus, Hash, Wallet, Globe2, Timer, Tag, Languages, Clock3, ArrowRight } from 'lucide-react';
import { SectionHead, planBadge, Reveal, CountUp } from './kit';
import { startPrice } from '../../api';
import { Proof } from './Proof';
import { Flag } from '../../Pickers';

export { coinList, andList, planBadge } from './kit';

// Real facts from the live catalogue (no made-up customers), cm.com stats-row style.
export function Facts({ catalog }) {
  const items = [
    [Globe2, 'Local', 'Local, mobile or toll-free numbers'],
    [Timer, '60 s', 'Free test call — no account, no card'],
    [Tag, startPrice(catalog) || '$50', 'Numbers from, per month — no contracts'],
    [Languages, '20', 'AI conversation languages — it switches when your caller does'],
    [Clock3, '24/7', 'Your menu or AI receptionist always answers'],
  ];
  return (
    <section className="civr-l-cream" data-testid="facts-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 pb-20 md:pb-24 pt-4">
        <Reveal className="civr-l-eyebrow" data-testid="facts-label">CloudIVR at a glance</Reveal>
        <div className={`grid grid-cols-2 md:grid-cols-3 ${items.length > 5 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} border-t civr-l-rule mt-6`} data-testid="hero-stats">
          {items.map(([Icon, v, l], i) => (
            <Reveal key={l} delay={i * 70} className={`py-8 pr-4 ${i ? 'lg:pl-6 lg:border-l civr-l-rule' : ''}`} data-testid={`hero-stat-${i}`}>
              <Icon className="w-5 h-5 text-slate-900" />
              <div className="civr-l-h text-3xl md:text-4xl text-slate-900 mt-4"><CountUp value={v} /></div>
              <div className="text-sm text-slate-500 mt-2 max-w-[14rem]">{l}</div>
            </Reveal>
          ))}
        </div>
        <Proof />
      </div>
    </section>
  );
}

// The big statement, cm.com "every conversation" style.
export function Statement() {
  return (
    <section className="civr-l-cream border-t civr-l-rule" data-testid="statement-section">
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-20 md:py-28">
        <Reveal><p className="civr-l-h text-2xl sm:text-3xl lg:text-[2.75rem] text-slate-900 !leading-[1.2]" data-testid="statement-text">Your callers don’t see a menu, a voicemail box, a campaign and an AI conversation. <span className="text-slate-400">They see one phone line — yours.</span></p></Reveal>
        <Reveal delay={120}><p className="text-base md:text-lg text-slate-600 mt-8 max-w-3xl">So CloudIVR runs all of it on one number. Every call, key press, text, voicemail and recording lands in the same account, and you watch your campaigns live — from the first ring to the hot lead you’re connected to.</p></Reveal>
        <Reveal delay={200} className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <p className="font-semibold text-slate-900">Answer every call. Call every lead. Miss nothing.</p>
          <a href="#features" className="inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-slate-900 hover:text-slate-600 transition-colors group" data-testid="statement-explore-link">Explore the platform<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></a>
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
          <div className="lg:col-span-8"><SectionHead label="Coverage" title="Local presence where your customers are." sub="Local, mobile and toll-free numbers your customers recognise — and pick up." /></div>
          <p className="lg:col-span-4 text-sm civr-l-muted lg:text-right">Voice & SIP on a Business Line · SMS on a Texting Number · Fax on a fax-only number</p>
        </div>
        <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="coverage-grid">
          {list.map((c, i) => (
            <Reveal key={c.code} delay={Math.min(i, 11) * 50} className="civr-l-card-cream px-4 py-4 min-w-0" data-testid={`coverage-${c.code}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0"><Flag code={c.code} className="!w-8 !h-6 !rounded" /><span className="font-semibold text-slate-900 leading-snug min-w-0">{c.name}</span></div>
              <div className="text-xs civr-l-muted mt-2 leading-snug">{c.types.map(t => tn[t] || t).join(' · ')}</div>
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
  return <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${every ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-slate-900 bg-slate-900 text-white'}`}>{b}</span>;
}

export function HowItWorks({ catalog }) {
  const steps = [
    [UserPlus, 'Say what it’s for', 'Calls, calls + texting, or fax only. Create a free account by email or Google, no card needed.'],
    [Hash, 'Pick your number', 'Choose a country and a local, mobile or toll-free number. Add forwarding, voicemail, a keypad menu or an AI receptionist later.'],
    [Wallet, 'Pay and go live', 'Pay from your wallet. Most numbers work within a minute.'],
  ];
  return (
    <section id="how" className="bg-[#fbfcfe] scroll-mt-16" data-testid="how-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-28">
        <SectionHead label="How it works" title="Three steps. About five minutes." />
        <ol className="relative grid md:grid-cols-3 gap-10 md:gap-8 mt-14">
          <span className="lx-step-line hidden md:block" aria-hidden="true" />
          {steps.map(([Icon, t, s], i) => (
            <Reveal as="li" key={t} delay={i * 120} className="relative md:pr-8" data-testid={`how-step-${i + 1}`}>
              <span className="relative w-9 h-9 rounded-full bg-[#1d6fd8] text-white text-sm font-semibold grid place-items-center ring-8 ring-[#fbfcfe]" aria-hidden="true">{i + 1}</span>
              <div className="civr-l-card-cream mt-6 h-24 px-5 flex items-center gap-2 flex-wrap" aria-hidden="true" data-testid={`how-step-${i + 1}-visual`}>
                {i === 0 && ['Calls', 'Calls + texting', 'Fax'].map((x, k) => <span key={x} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${k ? 'bg-slate-100 text-slate-600' : 'bg-[#1d6fd8] text-white'}`}>{x}</span>)}
                {i === 1 && <><Icon className="w-5 h-5 text-[#1d6fd8]" /><span className="font-mono text-base font-semibold text-slate-950" data-no-translate>+1 (415) 555-0134</span></>}
                {i === 2 && <><span className="lx-live" /><span className="text-sm font-semibold text-slate-950">Your number is live</span></>}
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mt-6">{t}</h3>
              <p className="text-base text-slate-600 mt-2 leading-relaxed">{s}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
