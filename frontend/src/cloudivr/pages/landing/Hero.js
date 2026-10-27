import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall, Check } from 'lucide-react';
import { startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Slide } from './kit';
import { HeroTabs } from './HeroTabs';
import { HearIt } from './HearIt';
import { useLang } from '../../i18n';

// Whole-sentence titles so the highlighted word lands in the right place in every language.
const TITLE = { en: ['Every call ', 'answered', '. Every lead called.'], fr: ['Chaque appel ', 'décroché', '. Chaque prospect rappelé.'], es: ['Cada llamada ', 'atendida', '. Cada cliente, llamado.'] };

export function Hero({ catalog }) {
  const { account } = useCivrAuth();
  const from = startPrice(catalog);
  const n = catalog?.countries?.length || 17;
  const t = TITLE[useLang().lang] || TITLE.en;
  const trust = ['Live in minutes', 'Browser phone on every plan', 'No contracts', 'Crypto & wallet payments'];
  return (
    <section className="civr-l-cream relative pt-32 md:pt-40" data-testid="civr-hero">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <div className="civr-l-kicker civr-rise" data-testid="hero-eyebrow"><span className="civr-l-dot" /><span className="sm:hidden">IVR · AI voice agents · Campaigns</span><span className="hidden sm:inline">Virtual numbers · IVR · AI voice agents · Campaigns</span></div>
        <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-7xl mt-7 civr-rise civr-d1 text-slate-950" data-testid="hero-title" data-no-translate>{t[0]}<span className="civr-l-hl">{t[1]}</span>{t[2]}</h1>
        <p className="text-base md:text-lg text-slate-600 mt-6 max-w-2xl mx-auto leading-relaxed civr-rise civr-d2" data-testid="hero-subtitle">
          {`Get a number in ${n} countries and run your whole phone line from the browser. A keypad menu or an AI voice agent answers every call, texts and voicemails land in one inbox — and campaigns call your list and connect the hot leads to you.`}
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-10 civr-rise civr-d3">
          <Link to={account ? cp('/app/buy') : cp('/signup')} className="civr-l-pill civr-l-pill-ink" data-testid="civr-hero-cta-buy-btn"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
          <a href="#try" className="civr-l-pill civr-l-pill-outline" data-testid="civr-hero-cta-test-btn"><PhoneCall className="w-4 h-4" /><Slide>Try a free call</Slide></a>
        </div>
        <HearIt className="max-w-2xl mx-auto mt-8 civr-rise civr-d3" />
        <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 mt-8 civr-rise civr-d4" data-testid="hero-microcopy">
          {trust.map(x => <span key={x} className="inline-flex items-center gap-2 text-sm text-slate-600"><Check className="w-4 h-4 text-slate-900" />{x}</span>)}
        </div>
        <p className="text-sm text-slate-500 mt-4 civr-rise civr-d4" data-testid="hero-price-note">Free to sign up{from ? ` · Numbers from ${from}/month` : ''} · Pay with crypto or your wallet (cards coming soon)</p>
      </div>
      <HeroTabs />
    </section>
  );
}
