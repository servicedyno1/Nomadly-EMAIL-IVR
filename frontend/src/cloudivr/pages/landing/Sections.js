import React from 'react';
import { Workflow, PhoneForwarded, Voicemail, MessageSquare, Megaphone, Headphones, UserPlus, Hash, Wallet, Bot, Captions } from 'lucide-react';
import { usd } from '../../api';
import { SectionHead, coinList, planBadge, Reveal } from './kit';
import { IvrMock, OutboundMock, AiMock } from './Mockups';
import { ForwardingMock, VoicemailMock, SmsMock, BrowserPhoneMock, TextCallMock } from './MockupsLive';

export { coinList, andList, planBadge } from './kit';

export function Coverage({ catalog }) {
  const list = catalog?.countries || [];
  const tn = catalog?.typeNames || {};
  return (
    <section id="coverage" className="civr-l-cream scroll-mt-16" data-testid="coverage-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <div className="grid lg:grid-cols-12 gap-8 items-end">
          <div className="lg:col-span-8"><SectionHead label="Coverage" title={`Phone numbers in ${list.length || 17} countries.`} sub="Local, toll-free and mobile numbers. Pick a country and pay — most numbers are ready in about a minute; a few countries ask for ID details first." /></div>
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

function Badge({ plans, k }) {
  const b = planBadge(plans, k);
  if (!b) return null;
  const every = b === 'Every plan';
  return <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${every ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-indigo-200 bg-indigo-50 text-[#4338ca]'}`}>{b}</span>;
}

function FeatureCard({ icon: Icon, title, text, k, plans, mock, className = '', testid, delay = 0 }) {
  return (
    <Reveal delay={delay} className={`civr-l-card-cream p-6 md:p-8 flex flex-col overflow-hidden ${className}`} data-testid={testid}>
      <div className="flex items-start justify-between gap-4"><span className="w-10 h-10 rounded-xl bg-indigo-50 text-[#4f46e5] grid place-items-center"><Icon className="w-5 h-5" /></span><Badge plans={plans} k={k} /></div>
      <div className="text-xl font-semibold text-slate-900 mt-6">{title}</div>
      <p className="text-sm text-slate-600 mt-2 max-w-md">{text}</p>
      {mock && <div className="mt-auto pt-8 -mb-2">{mock}</div>}
    </Reveal>
  );
}

export function Features({ catalog }) {
  const plans = catalog?.plans;
  const small = 'md:col-span-6 lg:col-span-3';
  return (
    <section id="features" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="features-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="What you get" title="One number. A full phone system behind it." sub="Every card shows which plans include it, so you know exactly what you're paying for." />
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-12">
          <FeatureCard icon={Workflow} title="Keypad menu (IVR)" text="Callers press 1 for sales, 2 for support. Greetings from text-to-speech or your own audio, one sub-menu deep. Uses your plan minutes." k="ivr" plans={plans} mock={<IvrMock />} className="md:col-span-7" testid="feature-card-0" />
          <FeatureCard icon={Megaphone} title="Quick IVR & Bulk IVR calls" text="Call one person or a whole list. They hear your script or recording, then press 1 to reach you, enter a code or pick from a menu. Quick IVR for a few numbers, Bulk IVR campaigns for thousands — with live answers and key presses. Your first Quick IVR call is free once you sign up." k="ivrOutbound" plans={plans} mock={<OutboundMock />} className="md:col-span-5" testid="feature-card-1" delay={80} />
          <FeatureCard icon={PhoneForwarded} title="Call forwarding" text="Always, when busy or on no answer — to any phone worldwide, with up to 4 backup numbers. Billed per minute from your wallet." k="callForwarding" plans={plans} mock={<ForwardingMock />} className={small} testid="feature-card-2" />
          <FeatureCard icon={Voicemail} title="Voicemail" text={`Greetings in ${catalog?.voicemailLanguages?.length || 5} languages or your own audio. Recordings and transcripts land in your inbox and email.`} k="voicemail" plans={plans} mock={<VoicemailMock />} className={small} testid="feature-card-3" delay={80} />
          <FeatureCard icon={Headphones} title="Browser phone" text="Call and answer in your browser tab — by voice or by typing — or log in from any SIP softphone." k="sipCredentials" plans={plans} mock={<BrowserPhoneMock />} className={small} testid="feature-card-4" delay={160} />
          <FeatureCard icon={MessageSquare} title="SMS inbox" text="Read and reply to texts right in your inbox. Email and webhook delivery on Pro and up." plans={plans} mock={<SmsMock />} className={small} testid="feature-card-5" delay={240} />
          <FeatureCard icon={Captions} title="Text calls" text="For deaf and hard-of-hearing callers: you type and they hear a voice; they talk and you read their words live." k="textRelay" plans={plans} mock={<TextCallMock />} className="md:col-span-7" testid="feature-card-7" />
          <FeatureCard icon={Bot} title="AI voice agents" text="Unlike the keypad menu, it holds a real conversation in English, French or Spanish — answers questions, books appointments, takes messages or transfers to you. Billed per minute from your wallet." k="aiAgent" plans={plans} mock={<AiMock />} className="md:col-span-5" testid="feature-card-6" delay={80} />
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
    <section id="how" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="how-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="How it works" title="Sign up to ringing in three steps." />
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
