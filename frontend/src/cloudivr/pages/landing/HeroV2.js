import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall, Check } from 'lucide-react';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Slide } from './kit';
import { useLang } from '../../i18n';
import { IvrMock } from './Mockups';
import { LandlineTextMock } from './MockupsLive';
import { goTo } from './menu';

// Whole sentences per language; only the rotating word changes (never machine-split).
const TITLE = {
  en: ['Never miss another', ['call', 'lead', 'booking', 'text'], ''],
  es: ['No vuelvas a perder', ['una llamada', 'un cliente', 'una reserva', 'un mensaje'], ''],
  fr: ['Ne manquez plus jamais', ['un appel', 'un prospect', 'une réservation', 'un SMS'], ''],
};

function Rotating({ words }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setI(x => (x + 1) % words.length), 2400);
    return () => clearInterval(t);
  }, [words.length]);
  return (
    <span className="v2-rot" data-testid="hero-rotating-word" aria-live="off">
      {words.map((w, k) => <span key={w} data-on={k === i ? 1 : k === (i - 1 + words.length) % words.length ? 2 : 0} aria-hidden={k !== i}>{w}</span>)}
    </span>
  );
}

// Layered live previews (app cards), like a product collage.
function Collage() {
  return (
    <div className="relative min-h-[420px] hidden md:block" aria-hidden="true" data-testid="hero-collage">
      <div className="absolute left-0 top-0 w-[80%] shadow-2xl rounded-2xl"><IvrMock /></div>
      <div className="absolute right-0 bottom-[-24px] w-[58%] shadow-2xl rounded-2xl"><LandlineTextMock /></div>
    </div>
  );
}

export function HeroV2({ catalog }) {
  const { account } = useCivrAuth();
  const t = TITLE[useLang().lang] || TITLE.en;
  const n = catalog?.countries?.length || 17;
  return (
    <section className="v2-hero relative pt-28 md:pt-36 pb-16 md:pb-24 overflow-hidden" data-testid="civr-hero">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 grid md:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="text-center md:text-left civr-rise">
          <div className="civr-l-kicker" data-testid="hero-eyebrow"><span className="civr-l-dot" />Virtual numbers · IVR · AI voice agents</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-[60px] lg:leading-[1.05] mt-6" data-testid="hero-title" data-no-translate>{t[0]}<br /><Rotating words={t[1]} />{t[2]}</h1>
          <p className="text-base md:text-lg v2-muted mt-6 max-w-xl mx-auto md:mx-0 leading-relaxed" data-testid="hero-subtitle">{`A number in ${n} countries, a keypad menu or AI agent that answers every call, campaigns that call your list, and texts on your landline. All from the browser.`}</p>
          <div className="flex flex-col sm:flex-row gap-3 mt-9 sm:justify-center md:justify-start">
            <Link to={account ? cp('/app/buy') : cp('/signup')} className="civr-l-pill civr-l-pill-ink w-full sm:w-auto" data-testid="civr-hero-cta-buy-btn"><Slide>{account ? 'Get your number' : 'Sign up free'}</Slide><ArrowRight className="w-4 h-4" /></Link>
            <a href="#try" onClick={(e) => goTo('#try', e)} className="civr-l-pill civr-l-pill-outline w-full sm:w-auto" data-testid="civr-hero-cta-test-btn"><PhoneCall className="w-4 h-4" /><Slide>Try a free call</Slide></a>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 justify-center md:justify-start text-sm v2-muted" data-testid="hero-microcopy">
            {['Free to sign up', 'No contracts', 'Live in minutes'].map(x => <span key={x} className="inline-flex items-center gap-1.5"><Check className="w-4 h-4 v2-link" />{x}</span>)}
          </div>
        </div>
        <Collage />
      </div>
    </section>
  );
}
