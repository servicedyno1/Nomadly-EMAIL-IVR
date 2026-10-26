import React from 'react';
import { Workflow, PhoneForwarded, Voicemail, MessageSquare, Megaphone, Headphones, UserPlus, Hash, Wallet, Bot, Captions } from 'lucide-react';
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

function Badge({ plans, k }) {
  const b = planBadge(plans, k);
  if (!b) return null;
  const every = b === 'Every plan';
  return <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${every ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-indigo-200 bg-indigo-50 text-[#4338ca]'}`}>{b}</span>;
}

function FeatureCard({ icon: Icon, kicker, title, text, k, plans, mock, className = '', testid, delay = 0 }) {
  return (
    <Reveal delay={delay} className={`civr-l-card-cream p-6 md:p-8 flex flex-col overflow-hidden ${className}`} data-testid={testid}>
      <div className="flex items-start justify-between gap-4"><span className="w-10 h-10 rounded-xl bg-indigo-50 text-[#4f46e5] grid place-items-center"><Icon className="w-5 h-5" /></span><Badge plans={plans} k={k} /></div>
      {kicker && <div className="text-xs font-semibold uppercase tracking-wider text-[#4f46e5] mt-6" data-testid={`${testid}-kicker`}>{kicker}</div>}
      <div className={`text-xl font-semibold text-slate-900 ${kicker ? 'mt-2' : 'mt-6'}`}>{title}</div>
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
        <SectionHead label="The platform" title="Inbound, outbound and AI. One number runs it all." sub="Answer every caller, call every lead and keep every text and voicemail in one inbox. Each card shows the plan that unlocks it." />
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mt-12">
          <FeatureCard icon={Workflow} kicker="Inbound" title="Keypad menu (IVR)" text="Sound like a big company from day one. Callers hear your greeting and press 1 for sales, 2 for support or 3 for voicemail — routed in under a second. Start from a template, use a natural AI voice or your own recording, and see which keys people press. Uses your plan minutes." k="ivr" plans={plans} mock={<IvrMock />} className="md:col-span-7" testid="feature-card-0" />
          <FeatureCard icon={Megaphone} kicker="Outbound" title="Quick IVR & Bulk IVR campaigns" text="Put your outreach on autopilot. We call your list, play your script, then connect everyone who presses 1, collect a code you accept or decline, or route each key. Quick IVR reaches up to 10 people right now; Bulk IVR works through whole lists with live results. Your first Quick IVR call is on us." k="ivrOutbound" plans={plans} mock={<OutboundMock />} className="md:col-span-5" testid="feature-card-1" delay={80} />
          <FeatureCard icon={PhoneForwarded} kicker="Inbound" title="Call forwarding" text="Never miss a deal. Ring any phone worldwide — always, when you’re busy or when you don’t pick up — with up to 4 backup numbers. Billed per minute from your wallet." k="callForwarding" plans={plans} mock={<ForwardingMock />} className={small} testid="feature-card-2" />
          <FeatureCard icon={Voicemail} kicker="Inbound" title="Voicemail" text={`Greetings in ${catalog?.voicemailLanguages?.length || 5} languages or your own audio. Every message lands in your inbox and email, transcribed so you can read it in seconds.`} k="voicemail" plans={plans} mock={<VoicemailMock />} className={small} testid="feature-card-3" delay={80} />
          <FeatureCard icon={Headphones} kicker="Anywhere" title="Browser phone" text="Make and take calls from any browser tab on every plan — nothing to install. On Pro and up, also sign in from a SIP softphone or desk phone. Your office goes wherever you go." k="browserPhone" plans={plans} mock={<BrowserPhoneMock />} className={small} testid="feature-card-4" delay={160} />
          <FeatureCard icon={MessageSquare} kicker="Messaging" title="SMS inbox" text="Read and reply to every text in one inbox. Push them to email or your own system with webhooks on Pro and up." plans={plans} mock={<SmsMock />} className={small} testid="feature-card-5" delay={240} />
          <FeatureCard icon={Captions} kicker="Accessibility" title="Text calls" text="Built for deaf and hard-of-hearing callers: you type, and a natural voice speaks each sentence the moment you finish it; they talk, and you read their words live. Soft typing sounds keep the line from going quiet." k="textRelay" plans={plans} mock={<TextCallMock />} className="md:col-span-7" testid="feature-card-7" />
          <FeatureCard icon={Bot} kicker="Inbound & outbound" title="AI voice agents" text="Your best rep on every line, 24/7. It talks naturally in English, French or Spanish — answers questions, books appointments, takes messages and passes hot calls to you. Point it at your leads and it calls them too. Billed per minute from your wallet." k="aiAgent" plans={plans} mock={<AiMock />} className="md:col-span-5" testid="feature-card-6" delay={80} />
        </div>
      </div>
    </section>
  );
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
