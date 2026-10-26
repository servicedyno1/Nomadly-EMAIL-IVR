import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall, PhoneIncoming, CornerDownRight, Check } from 'lucide-react';
import { startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Slide, CountUp } from './kit';
import { AppMock } from './Mockups';
import { useLang } from '../../i18n';

// Whole-sentence titles so the highlighted word lands in the right place in every language.
const TITLE = { en: ['Numbers that ', 'answer', ', route & call for you.'], fr: ['Des numéros qui ', 'répondent', ', routent et appellent pour vous.'], es: ['Números que ', 'contestan', ', enrutan y llaman por ti.'] };

const EVENTS = [[PhoneIncoming, 'Incoming call', '+1 415 555 0182'], [CornerDownRight, 'Pressed 1 → Sales', 'forwarded in 0.4 s'], [PhoneIncoming, 'Incoming call', '+44 20 7946 0958'], [CornerDownRight, 'Pressed 3 → Voicemail', 'sent to your inbox']];

// Small event chip on the product shot.
function LiveCallCard() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % EVENTS.length), 2600); return () => clearInterval(t); }, []);
  const [Icon, title, sub] = EVENTS[i];
  return (
    <div className="hidden sm:block absolute right-6 -bottom-10 w-60 rounded-xl border border-slate-200 bg-white shadow-[0_16px_40px_-16px_rgba(15,23,42,.3)] p-4" data-testid="hero-live-ivr-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><span className="civr-l-dot" />Live IVR</div>
      <div key={i} className="flex items-start gap-3 mt-3 civr-rise">
        <span className="w-8 h-8 rounded-lg bg-indigo-50 text-[#4f46e5] grid place-items-center shrink-0"><Icon className="w-4 h-4" /></span>
        <div className="min-w-0"><div className="text-sm font-semibold text-slate-900">{title}</div><div className="text-xs font-mono text-slate-500 mt-0.5 truncate">{sub}</div></div>
      </div>
    </div>
  );
}

function StatStrip({ catalog }) {
  const stats = [[catalog?.countries?.length || 17, 'Countries'], ['60 s', 'Free test call'], [startPrice(catalog) || '$50', 'From / month'], [(catalog?.coins || []).length || 8, 'Coins accepted']];
  return (
    <div className="relative border-t civr-l-rule bg-white" data-testid="hero-stats">
      <div className="max-w-7xl mx-auto px-6 md:px-8 grid grid-cols-2 md:grid-cols-4">
        {stats.map(([v, l], i) => (
          <div key={l} className={`py-6 md:py-8 ${i % 2 ? 'pl-6' : ''} ${i > 0 ? 'md:pl-8 md:border-l civr-l-rule' : ''} ${i > 1 ? 'border-t md:border-t-0 civr-l-rule' : ''}`} data-testid={`hero-stat-${i}`}>
            <div className="civr-l-h text-3xl md:text-4xl text-slate-900"><CountUp value={v} /></div>
            <div className="text-sm text-slate-500 mt-1">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hero({ catalog }) {
  const { account } = useCivrAuth();
  const from = startPrice(catalog);
  const n = catalog?.countries?.length || 17;
  const t = TITLE[useLang().lang] || TITLE.en;
  const trust = ['No contracts', 'Pay with crypto', 'Live in minutes'];
  return (
    <section className="civr-l-cream relative overflow-hidden pt-32 md:pt-40" data-testid="civr-hero">
      <div className="absolute inset-0 civr-l-gridbg civr-l-mask" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(50% 45% at 85% 20%, rgba(99,102,241,.10), transparent 70%)' }} />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 grid lg:grid-cols-12 gap-16 lg:gap-12 items-center pb-24">
        <div className="lg:col-span-5 relative z-10">
          <div className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-slate-200 bg-white text-sm text-slate-600 civr-rise" data-testid="hero-eyebrow"><span className="civr-l-dot" />Cloud numbers · IVR · AI agents</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl mt-6 civr-rise civr-d1 text-slate-900" data-testid="hero-title" data-no-translate>{t[0]}<span className="text-[#4f46e5]">{t[1]}</span>{t[2]}</h1>
          <p className="text-base md:text-lg text-slate-600 mt-6 max-w-xl civr-rise civr-d2" data-testid="hero-subtitle">
            {`Virtual numbers in ${n} countries with call forwarding, voicemail, an SMS inbox, a keypad menu (IVR), bulk campaigns and AI voice agents. Call from your browser and pay with crypto.`}
          </p>
          <div className="flex flex-wrap gap-3 mt-8 civr-rise civr-d3">
            <Link to={account ? cp('/app/buy') : cp('/signup')} className="civr-l-btn" data-testid="civr-hero-cta-buy-btn"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
            <a href="#try" className="civr-l-btn civr-l-btn-ghost" data-testid="civr-hero-cta-test-btn"><PhoneCall className="w-4 h-4" /><Slide>Try a free call</Slide></a>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-8 civr-rise civr-d4" data-testid="hero-microcopy">
            {trust.map(x => <span key={x} className="inline-flex items-center gap-2 text-sm text-slate-600"><Check className="w-4 h-4 text-[#4f46e5]" />{x}</span>)}
          </div>
          <p className="text-sm text-slate-500 mt-4 civr-rise civr-d4" data-testid="hero-price-note">Free to sign up{from ? ` · Numbers from ${from}/month` : ''}</p>
        </div>
        <div className="lg:col-span-7 relative civr-rise civr-d2">
          <AppMock />
          <LiveCallCard />
        </div>
      </div>
      <StatStrip catalog={catalog} />
    </section>
  );
}
