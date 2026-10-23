import React from 'react';
import { Workflow, PhoneForwarded, Voicemail, MessageSquare, Megaphone, Headphones, UserPlus, Wallet, Hash, CalendarCheck, Bitcoin, Zap, SlidersHorizontal } from 'lucide-react';
import { usd } from '../../api';

// "BTC, LTC, ETH, USDT and more" from the catalog's coin list.
export const coinList = (c) => {
  const s = [...new Set((c?.coins || []).map(x => x.replace(/\s*\(.*\)/, '')))];
  return s.length > 4 ? `${s.slice(0, 4).join(', ')} and more` : s.join(', ');
};
export const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
export const instantCountries = (c) => andList((c?.countries || []).filter(x => !x.verification).map(x => x.name));

// Which plans include a feature, e.g. "Every plan", "Pro and up", "Business plan only".
export function planBadge(plans, key) {
  const ps = [...(plans || [])].sort((a, b) => a.price - b.price);
  if (!ps.length) return null;
  const ok = key ? ps.filter(p => p.access?.[key]) : ps;
  if (ok.length === ps.length) return 'Every plan';
  return ok.length === 1 ? `${ok[0].name} plan only` : `${ok[0].name} and up`;
}

export function SectionHead({ label, title, sub }) {
  return (
    <div className="mb-12 max-w-2xl">
      <div className="civr-label">{label}</div>
      <h2 className="font-display text-3xl sm:text-4xl font-bold mt-4">{title}</h2>
      {sub && <p className="text-base text-[#a1a1aa] mt-4">{sub}</p>}
    </div>
  );
}

export function HowItWorks({ catalog }) {
  const steps = [
    [UserPlus, 'Create your free account', 'Email and password. No card and no contract.'],
    [Wallet, 'Add funds with crypto', `${coinList(catalog) || 'Crypto'} · from ${usd(catalog?.minTopup || 10)}. Credited once the network confirms.`],
    [Hash, 'Pick a number and plan', 'Choose a country and a plan. Most numbers are live in about a minute.'],
  ];
  return (
    <section id="how" className="max-w-7xl mx-auto px-6 md:px-8 py-24 scroll-mt-16">
      <SectionHead label="How it works" title="From sign-up to a ringing number in three steps." />
      <ol className="grid md:grid-cols-3 gap-6">
        {steps.map(([Icon, t, s], i) => (
          <li key={t} className="civr-card p-8" data-testid={`how-step-${i + 1}`}>
            <div className="flex items-center justify-between"><span className="font-mono text-sm text-[#34d399]">0{i + 1}</span><Icon className="w-6 h-6 text-[#34d399]" /></div>
            <div className="font-display text-2xl font-bold mt-8">{t}</div>
            <p className="text-sm text-[#a1a1aa] mt-2">{s}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const FEATURES = [
  [Workflow, 'Visual IVR builder', 'Press 1 for sales, 2 for support. Greetings from text-to-speech or your own audio, one sub-menu deep.', 'ivr', 'md:col-span-8 md:row-span-2', true],
  [PhoneForwarded, 'Call forwarding', 'Always, when busy or on no answer — to any phone worldwide.', 'callForwarding', 'md:col-span-4'],
  [Voicemail, 'Voicemail', 'Custom greetings, with recordings in your inbox and email.', 'voicemail', 'md:col-span-4'],
  [Megaphone, 'Bulk IVR campaigns', 'Paste leads, pick a message, watch answers and key presses live. Pause or cancel any time.', 'bulkCall', 'md:col-span-4'],
  [Headphones, 'Browser phone', 'Call and answer from this tab with your number’s SIP line.', 'sipCredentials', 'md:col-span-4'],
  [MessageSquare, 'SMS inbox', 'Inbound texts land in your inbox. Email and webhook delivery on Pro and up.', null, 'md:col-span-4'],
];

export function Features({ catalog }) {
  return (
    <section id="features" className="max-w-7xl mx-auto px-6 md:px-8 py-24 scroll-mt-16">
      <SectionHead label="What you get" title="One number. A full phone system behind it." sub="Each card shows which plans include it, so you know what you’re paying for." />
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {FEATURES.map(([Icon, title, text, key, span, big], i) => {
          const badge = planBadge(catalog?.plans, key);
          return (
            <div key={title} className={`civr-card p-8 ${span} ${big ? 'flex flex-col justify-between min-h-[264px]' : ''}`} data-testid={`feature-card-${i}`}>
              <div className="flex items-start justify-between gap-4">
                <Icon className={`${big ? 'w-10 h-10' : 'w-6 h-6'} text-[#34d399]`} />
                {badge && <span className={`civr-pill ${badge === 'Every plan' ? 'civr-pill-on' : 'civr-pill-warn'}`} data-testid={`feature-plan-badge-${i}`}>{badge}</span>}
              </div>
              {big && <IvrSketch />}
              <div className="mt-6">
                <div className={`font-display font-bold ${big ? 'text-4xl' : 'text-2xl'}`}>{title}</div>
                <p className="text-sm text-[#a1a1aa] mt-2 max-w-lg">{text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Mini call-flow drawn inside the big IVR feature card.
function IvrSketch() {
  const keys = [['1', 'Sales', 'Forward → +1 415…'], ['2', 'Support', 'Sub-menu'], ['3', 'After hours', 'Voicemail']];
  return (
    <div className="my-6 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="feature-ivr-sketch">
      <div className="civr-pill civr-pill-on !text-xs shrink-0">“Thanks for calling…”</div>
      <div className="hidden sm:block h-px flex-1 max-w-[64px] bg-[#34d399]/40" />
      <div className="grid gap-2 flex-1">
        {keys.map(([k, l, a], i) => (
          <div key={k} className={`flex items-center gap-4 rounded-xl border border-[#222] bg-[#0f0f0f] px-4 py-2 civr-rise civr-d${i + 1}`}>
            <span className="w-8 h-8 rounded-lg border border-[#34d399]/50 text-[#34d399] font-mono text-sm flex items-center justify-center">{k}</span>
            <span className="text-sm font-medium">{l}</span><span className="ml-auto text-xs font-mono text-[#9a9a9a]">{a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WhyUs({ catalog }) {
  const points = [
    [CalendarCheck, 'Month to month', 'Every number renews monthly from your wallet. Turn off auto-renew and it simply won’t renew.'],
    [Bitcoin, 'Crypto top-ups', `Pay with ${coinList(catalog) || 'crypto'}. No bank card, no billing address.`],
    [Zap, 'Live in minutes', `${instantCountries(catalog) || 'US and Canada'} numbers go live right after payment. Other countries need a short ID check.`],
    [SlidersHorizontal, 'You stay in control', 'Pause, resume or cancel a campaign mid-run, and see every call, key press and SMS in your logs.'],
  ];
  return (
    <section id="why" className="border-y border-[#1a1a1a] bg-[#0d0d0d]" data-testid="why-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24 grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-5">
          <SectionHead label="Why CloudIVR" title="No contracts. No card. No surprises." />
          <ul className="grid gap-8">
            {points.map(([Icon, t, s], i) => (
              <li key={t} className="flex gap-4" data-testid={`why-point-${i}`}>
                <Icon className="w-5 h-5 text-[#34d399] shrink-0 mt-1" />
                <div><div className="font-semibold">{t}</div><p className="text-sm text-[#a1a1aa] mt-1">{s}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-7" data-testid="coverage-grid">
          <div className="civr-label mb-4">Where you can get a number</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(catalog?.countries || []).map(c => (
              <div key={c.code} className="flex items-center gap-2 rounded-xl border border-[#222] bg-[#111] px-4 py-3 text-sm min-w-0" data-testid={`coverage-${c.code}`}>
                <span className="text-lg">{c.flag}</span><span className="flex-1 truncate">{c.name}</span>
                <span className={`text-[10px] font-mono uppercase ${c.verification ? 'text-[#fbbf24]' : 'text-[#34d399]'}`}>{c.verification ? 'ID check' : 'Instant'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
