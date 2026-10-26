import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall, Check } from 'lucide-react';
import { startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Slide, useInView, reducedMotion } from './kit';
import { HeroTabs } from './HeroTabs';
import { useLang } from '../../i18n';

const Hero3D = lazy(() => import('./Hero3D'));

// Whole-sentence titles so the highlighted word lands in the right place in every language.
const TITLE = { en: ['Every call ', 'answered', '. Every lead called.'], fr: ['Chaque appel ', 'décroché', '. Chaque prospect rappelé.'], es: ['Cada llamada ', 'atendida', '. Cada cliente, llamado.'] };

const webgl = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (_) { return false; } };

// The 3D call hub behind the headline (tablet and up, motion allowed); it stops rendering once scrolled away.
function Scene() {
  const [ok, setOk] = useState(false);
  const [ref, inView] = useInView({ once: false, threshold: 0 });
  useEffect(() => { setOk(!reducedMotion() && window.matchMedia('(min-width: 768px)').matches && webgl()); }, []);
  return (
    <div ref={ref} className="civr-l-scene absolute inset-x-0 top-0 h-[640px] md:h-[760px] pointer-events-none" aria-hidden="true" data-testid="hero-3d">
      {ok && <Suspense fallback={null}><Hero3D paused={!inView} /></Suspense>}
    </div>
  );
}

export function Hero({ catalog }) {
  const { account } = useCivrAuth();
  const from = startPrice(catalog);
  const n = catalog?.countries?.length || 17;
  const t = TITLE[useLang().lang] || TITLE.en;
  const trust = ['Live in minutes', 'Browser phone on every plan', 'No contracts', 'Crypto & wallet payments'];
  return (
    <section className="civr-l-purple relative overflow-hidden pt-32 md:pt-40" data-testid="civr-hero">
      <div className="absolute inset-0 civr-l-gridbg civr-l-mask opacity-70" />
      <span className="civr-l-glow w-[520px] h-[520px] -left-40 top-10 bg-[#7c3aed]/35" />
      <span className="civr-l-glow w-[460px] h-[460px] -right-32 top-40 bg-[#0ea5e9]/20" />
      <Scene />
      <div className="relative max-w-4xl mx-auto px-6 text-center">
        <div className="civr-l-kicker civr-rise" data-testid="hero-eyebrow">Virtual numbers · IVR · AI voice agents · Campaigns</div>
        <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-7xl mt-6 civr-rise civr-d1 text-white civr-l-shadow" data-testid="hero-title" data-no-translate>{t[0]}<span className="civr-l-hl">{t[1]}</span>{t[2]}</h1>
        <p className="text-base md:text-lg text-[#cbd5e1] mt-6 max-w-2xl mx-auto civr-rise civr-d2" data-testid="hero-subtitle">
          {`Get a number in ${n} countries and run your whole phone line from the browser. A keypad menu or an AI voice agent answers every call, texts and voicemails land in one inbox — and campaigns call your list and connect the hot leads to you.`}
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-9 civr-rise civr-d3">
          <Link to={account ? cp('/app/buy') : cp('/signup')} className="civr-l-pill civr-l-pill-light" data-testid="civr-hero-cta-buy-btn"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
          <a href="#try" className="civr-l-pill civr-l-pill-line" data-testid="civr-hero-cta-test-btn"><PhoneCall className="w-4 h-4" /><Slide>Try a free call</Slide></a>
        </div>
        <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 mt-8 civr-rise civr-d4" data-testid="hero-microcopy">
          {trust.map(x => <span key={x} className="inline-flex items-center gap-2 text-sm text-[#e2e8f0]"><Check className="w-4 h-4 text-[#7dd3fc]" />{x}</span>)}
        </div>
        <p className="text-sm text-[#a5b4fc] mt-4 civr-rise civr-d4" data-testid="hero-price-note">Free to sign up{from ? ` · Numbers from ${from}/month` : ''}</p>
      </div>
      <HeroTabs />
    </section>
  );
}
