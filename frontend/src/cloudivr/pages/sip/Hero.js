import React from 'react';
import { ArrowRight, Check, Phone, PhoneIncoming, PhoneOff, Server } from 'lucide-react';
import { usd } from '../../api';
import { useLang } from '../../i18n';
import { Slide, CountUp, useInView, useStep } from '../landing/kit';
import { sipDomain, sipPick } from './shared';

// Whole-sentence titles so the highlighted words land in the right place in every language.
const TITLE = {
  en: ['Your business number on ', 'any SIP phone', '.'],
  fr: ['Votre numéro pro sur ', 'n’importe quel téléphone SIP', '.'],
  es: ['Tu número de empresa en ', 'cualquier teléfono SIP', '.'],
};

// 0 registered · 1 incoming call · 2 on the call · 3 call ended (reduced motion stays on 0).
const PHASES = 4;

function Field({ k, v, secret, testid }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0" data-testid={testid}>
      <span className="text-xs font-medium text-slate-500">{k}</span>
      <span className={`font-mono text-sm text-slate-900 truncate ${secret ? 'tracking-widest' : ''}`} data-no-translate>{v}</span>
    </div>
  );
}

function CallArea({ phase }) {
  if (phase === 1) {
    return (
      <div className="rounded-2xl bg-slate-900 text-white p-4 civr-pop" data-testid="sip-mock-incoming">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-300 grid place-items-center civr-ringing"><PhoneIncoming className="w-5 h-5" /></span>
          <div className="min-w-0"><div className="text-sm font-semibold">Incoming call</div><div className="text-xs font-mono text-white/60 mt-0.5" data-no-translate>+1 415 555 0182</div></div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <span className="h-10 rounded-xl bg-rose-700 text-white text-sm font-semibold grid place-items-center"><span className="inline-flex items-center gap-1.5"><PhoneOff className="w-4 h-4" />Decline</span></span>
          <span className="h-10 rounded-xl bg-emerald-700 text-white text-sm font-semibold grid place-items-center"><span className="inline-flex items-center gap-1.5"><Phone className="w-4 h-4" />Accept</span></span>
        </div>
      </div>
    );
  }
  if (phase === 2) {
    return (
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 civr-pop" data-testid="sip-mock-oncall">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0"><div className="text-sm font-semibold text-emerald-900">On call</div><div className="text-xs font-mono text-emerald-800/70 mt-0.5" data-no-translate>+1 415 555 0182 · 00:14</div></div>
          <span className="civr-eq text-emerald-600" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3" data-testid="sip-mock-ready">
      <div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{phase === 3 ? 'Call ended' : 'Ready to call'}</div><div className="text-xs text-slate-500 mt-0.5">{phase === 3 ? 'Saved to your call history' : 'Dial out or wait for a call'}</div></div>
      <span className="w-10 h-10 rounded-full bg-[#4f46e5] text-white grid place-items-center"><Phone className="w-4 h-4" /></span>
    </div>
  );
}

// A softphone account screen that registers and takes a call — the whole pitch in one picture.
function SoftphoneMock({ domain }) {
  const [ref, inView] = useInView({ once: false });
  const phase = useStep(inView, PHASES, 2400);
  const ringing = phase === 1;
  return (
    <div ref={ref} className="relative mx-auto w-full max-w-md" data-testid="sip-softphone-mock">
      <div className="absolute -inset-6 rounded-[40px] pointer-events-none" style={{ background: 'radial-gradient(60% 60% at 50% 40%, rgba(99,102,241,.16), transparent 70%)' }} />
      <div className="relative rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_70px_-30px_rgba(15,23,42,.35)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-rose-400" /><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /></div>
          <div className="text-xs font-semibold text-slate-500">SIP account</div>
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${ringing ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`} data-testid="sip-mock-status">
            <span className={`w-1.5 h-1.5 rounded-full ${ringing ? 'bg-amber-500' : 'bg-emerald-500'}`} />{ringing ? 'Ringing' : 'Registered'}
          </span>
        </div>
        <div className="px-5 pt-3 pb-1">
          <Field k="Server" v={domain} testid="sip-mock-server" />
          <Field k="Username" v="cv7k2m9q4x" />
          <Field k="Password" v="••••••••••••" secret />
          <Field k="Port" v="5060 · UDP" />
        </div>
        <div className="p-5 pt-3"><CallArea phase={phase} /></div>
      </div>
      <div className="hidden sm:flex absolute -left-6 -bottom-6 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-[0_16px_40px_-16px_rgba(15,23,42,.3)]" data-testid="sip-mock-apps-chip">
        <Server className="w-4 h-4 text-[#4f46e5]" />
        <span className="text-xs font-semibold text-slate-700" data-no-translate>Zoiper · MicroSIP · Linphone</span>
      </div>
    </div>
  );
}

function StatStrip({ catalog }) {
  const pick = sipPick(catalog);
  const stats = [
    [catalog?.countries?.length || 17, 'Countries', true],
    ['5060', 'SIP port · 5061 for TLS', false],
    [pick ? usd(pick.price) : '$75', 'SIP from / month', true],
    ['24/7', 'Calls ring your apps', false],
  ];
  return (
    <div className="relative border-t civr-l-rule bg-white" data-testid="sip-hero-stats">
      <div className="max-w-7xl mx-auto px-6 md:px-8 grid grid-cols-2 md:grid-cols-4">
        {stats.map(([v, l, count], i) => (
          <div key={l} className={`py-6 md:py-8 ${i % 2 ? 'pl-6' : ''} ${i > 0 ? 'md:pl-8 md:border-l civr-l-rule' : ''} ${i > 1 ? 'border-t md:border-t-0 civr-l-rule' : ''}`} data-testid={`sip-hero-stat-${i}`}>
            <div className="civr-l-h text-3xl md:text-4xl text-slate-900">{count ? <CountUp value={v} /> : <span data-no-translate>{v}</span>}</div>
            <div className="text-sm text-slate-500 mt-1">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SipHero({ catalog }) {
  const t = TITLE[useLang().lang] || TITLE.en;
  const n = catalog?.countries?.length || 17;
  const pick = sipPick(catalog);
  const trust = ['Works with free apps', 'UDP, TCP & TLS', 'No contracts', 'Crypto & wallet payments'];
  return (
    <section className="civr-l-cream relative overflow-hidden pt-32 md:pt-40" data-testid="sip-hero">
      <div className="absolute inset-0 civr-l-gridbg civr-l-mask" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(50% 45% at 85% 20%, rgba(99,102,241,.10), transparent 70%)' }} />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 grid lg:grid-cols-12 gap-16 lg:gap-12 items-center pb-24">
        <div className="lg:col-span-6 relative z-10">
          <div className="inline-flex items-center gap-2 min-h-8 py-1 px-3 rounded-2xl sm:rounded-full border border-slate-200 bg-white text-sm text-slate-600 civr-rise" data-testid="sip-hero-eyebrow"><span className="civr-l-dot" />SIP numbers · Softphones · Desk phones</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl mt-6 civr-rise civr-d1 text-slate-900" data-testid="sip-hero-title" data-no-translate>{t[0]}<span className="text-[#4f46e5]">{t[1]}</span>{t[2]}</h1>
          <p className="text-base md:text-lg text-slate-600 mt-6 max-w-xl civr-rise civr-d2" data-testid="sip-hero-subtitle">
            {`Get a real number in ${n} countries and sign in from Zoiper, MicroSIP, Linphone or the desk phone you already own. Calls ring wherever you are, with voicemail, a keypad menu, call recording and an SMS inbox built in.`}
          </p>
          <div className="flex flex-wrap gap-3 mt-8 civr-rise civr-d3">
            <a href="#plans" className="civr-l-btn" data-testid="sip-hero-cta-plans"><Slide>Choose your plan</Slide><ArrowRight className="w-4 h-4" /></a>
            <a href="#apps" className="civr-l-btn civr-l-btn-ghost" data-testid="sip-hero-cta-setup"><Slide>See how setup works</Slide></a>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-8 civr-rise civr-d4" data-testid="sip-hero-trust">
            {trust.map(x => <span key={x} className="inline-flex items-center gap-2 text-sm text-slate-600"><Check className="w-4 h-4 text-[#4f46e5]" />{x}</span>)}
          </div>
          {pick && <p className="text-sm text-slate-500 mt-4 civr-rise civr-d4" data-testid="sip-hero-price-note">{`SIP logins from ${usd(pick.price)}/month on ${pick.name} · Free to sign up`}</p>}
        </div>
        <div className="lg:col-span-6 relative civr-rise civr-d2">
          <SoftphoneMock domain={sipDomain(catalog)} />
        </div>
      </div>
      <StatStrip catalog={catalog} />
    </section>
  );
}
