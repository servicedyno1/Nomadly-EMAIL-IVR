import React from 'react';
import { Workflow, PhoneForwarded, Voicemail, MessageSquare, Megaphone, Headphones, UserPlus, Hash, Wallet } from 'lucide-react';
import { usd } from '../../api';
import { ART, SectionHead, coinList, planBadge } from './kit';

export { coinList, andList, planBadge } from './kit';

function Marquee({ list }) {
  const row = [...list, ...list];
  return (
    <div className="border-y civr-l-rule overflow-hidden py-5" data-testid="civr-country-marquee">
      <div className="civr-l-marquee">
        {row.map((c, i) => (
          <span key={`${c.code}-${i}`} className="civr-l-h text-3xl md:text-5xl px-6 md:px-10 flex items-center gap-4 whitespace-nowrap">
            <span className="text-2xl md:text-4xl">{c.flag}</span>{c.name}<span className="w-2.5 h-2.5 rotate-45 bg-[#3434EF] ml-6 md:ml-10" />
          </span>
        ))}
      </div>
    </div>
  );
}

export function Coverage({ catalog }) {
  const list = catalog?.countries || [];
  const tn = catalog?.typeNames || {};
  return (
    <section id="coverage" className="civr-l-cream scroll-mt-16" data-testid="coverage-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 pt-24 pb-12 grid lg:grid-cols-12 gap-8 items-end">
        <div className="lg:col-span-8"><SectionHead n="01" label="Coverage" title={`Local numbers in ${list.length || 17} countries.`} sub="Local, toll-free and mobile numbers. Pick a country, pay, and your number is ready to route calls." /></div>
        <p className="lg:col-span-4 text-sm civr-l-muted lg:text-right font-mono uppercase tracking-wider">Voice · SMS · SIP on one line</p>
      </div>
      {list.length > 0 && <Marquee list={list} />}
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-16 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="coverage-grid">
        {list.map(c => (
          <div key={c.code} className="civr-l-card-cream civr-l-tilt px-4 py-4 min-w-0" data-testid={`coverage-${c.code}`}>
            <div className="flex items-center gap-3 min-w-0"><span className="text-2xl">{c.flag}</span><span className="font-semibold truncate">{c.name}</span></div>
            <div className="text-xs civr-l-muted mt-2 font-mono uppercase tracking-wider truncate">{c.types.map(t => tn[t] || t).join(' · ')}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Badge({ plans, k, dark }) {
  const b = planBadge(plans, k);
  if (!b) return null;
  const every = b === 'Every plan';
  return <span className={`text-xs font-mono uppercase tracking-widest px-2.5 py-1 rounded-full border ${every ? (dark ? 'border-[#00E3AA]/50 text-[#00E3AA]' : 'border-[#3434EF]/40 text-[#3434EF]') : (dark ? 'border-white/20 text-white/70' : 'border-black/20 text-black/60')}`}>{b}</span>;
}

function FeatureCard({ icon: Icon, title, text, k, plans, dark, img, className, testid, children }) {
  return (
    <div className={`${dark ? 'civr-l-card civr-l-dark' : 'civr-l-card-cream'} civr-l-tilt p-6 md:p-8 flex flex-col overflow-hidden relative ${className}`} data-testid={testid}>
      <div className="flex items-start justify-between gap-4 relative z-10"><Icon className={`w-6 h-6 ${dark ? 'text-[#00E3AA]' : 'text-[#3434EF]'}`} /><Badge plans={plans} k={k} dark={dark} /></div>
      {img && <img src={img} alt="" className="civr-l-float w-full max-h-[300px] object-contain my-4 select-none pointer-events-none" draggable="false" />}
      {children}
      <div className="mt-auto pt-6 relative z-10">
        <div className="civr-l-h text-3xl md:text-4xl">{title}</div>
        <p className={`text-sm mt-2 max-w-md ${dark ? 'civr-l-muted' : 'text-black/60'}`}>{text}</p>
      </div>
    </div>
  );
}

export function Features({ catalog }) {
  const plans = catalog?.plans;
  return (
    <section id="features" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="features-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead n="03" label="What you get" title="One number. A full phone system behind it." sub="Every card shows which plans include it, so you know exactly what you're paying for." />
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-14">
          <FeatureCard icon={Workflow} title="Visual IVR builder" text="Press 1 for sales, 2 for support. Greetings from text-to-speech or your own audio, one sub-menu deep." k="ivr" plans={plans} dark img={ART.callflow} className="md:col-span-7 md:row-span-2 min-h-[520px]" testid="feature-card-0" />
          <FeatureCard icon={Megaphone} title="Bulk IVR campaigns" text="Paste leads, pick a message, watch answers and key presses live. Pause or cancel any time." k="bulkCall" plans={plans} img={ART.campaign} className="md:col-span-5" testid="feature-card-1" />
          <FeatureCard icon={PhoneForwarded} title="Call forwarding" text="Always, when busy or on no answer — to any phone worldwide." k="callForwarding" plans={plans} dark className="md:col-span-5" testid="feature-card-2" />
          <FeatureCard icon={Voicemail} title="Voicemail" text="Custom greetings, recordings in your inbox and email." k="voicemail" plans={plans} className="md:col-span-4" testid="feature-card-3" />
          <FeatureCard icon={Headphones} title="Browser phone" text="Call and answer from your browser tab on your number's SIP line." k="sipCredentials" plans={plans} className="md:col-span-4" testid="feature-card-4" />
          <FeatureCard icon={MessageSquare} title="SMS inbox" text="Inbound texts land in your inbox. Email and webhook delivery on Pro and up." plans={plans} className="md:col-span-4" testid="feature-card-5" />
        </div>
      </div>
    </section>
  );
}

export function HowItWorks({ catalog }) {
  const steps = [
    [UserPlus, 'Create a free account', 'Email and password or Google. No card, no contract.'],
    [Hash, 'Pick a number and plan', 'Choose a country, number type and plan. Auto-renew is on so it never lapses — switch it off any time.'],
    [Wallet, 'Pay with crypto or wallet', `${coinList(catalog) || 'Crypto'}, or your CloudIVR wallet (top-ups from ${usd(catalog?.minTopup || 10)}). Most numbers are live in about a minute.`],
  ];
  return (
    <section id="how" className="civr-l-dark scroll-mt-16" data-testid="how-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead n="04" label="How it works" title="Sign up to ringing in three steps." />
        <ol className="grid md:grid-cols-3 mt-14 border-t civr-l-rule">
          {steps.map(([Icon, t, s], i) => (
            <li key={t} className={`pt-8 pb-4 md:pr-8 ${i > 0 ? 'md:pl-8 md:border-l civr-l-rule' : ''}`} data-testid={`how-step-${i + 1}`}>
              <div className="flex items-center justify-between"><span className="civr-l-h text-7xl text-[#00E3AA]">0{i + 1}</span><Icon className="w-6 h-6 civr-l-muted" /></div>
              <div className="civr-l-h text-3xl mt-6">{t}</div>
              <p className="text-sm civr-l-muted mt-3">{s}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
