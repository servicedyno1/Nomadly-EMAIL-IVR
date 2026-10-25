import React, { Component, Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall, PhoneIncoming, CornerDownRight } from 'lucide-react';
import { startPrice } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { ART, Slide } from './kit';
import { useLang } from '../../i18n';

// Whole-sentence titles so the highlighted word lands in the right place in every language.
const TITLE = { en: ['Numbers that ', 'answer', ', route & call for you.'], fr: ['Des numéros qui ', 'répondent', ', routent et appellent pour vous.'], es: ['Números que ', 'contestan', ', enrutan y llaman por ti.'] };

const Hero3D = lazy(() => import('./Hero3D'));

class Boundary extends Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const canWebgl = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (_) { return false; } };

// Live R3F scene; the floating globe artwork stands in on reduced-motion, no WebGL, or while the scene loads.
function Art3D() {
  const [live, setLive] = useState(false);
  useEffect(() => { setLive(!window.matchMedia('(prefers-reduced-motion: reduce)').matches && canWebgl()); }, []);
  const still = <img src={ART.globe} alt="Global call network" className="w-full h-full object-contain civr-l-float mix-blend-screen" data-testid="civr-hero-3d-fallback" />;
  return (
    <div className="absolute inset-0" data-testid="civr-hero-3d">
      {live ? <Boundary fallback={still}><Suspense fallback={still}><Hero3D /></Suspense></Boundary> : still}
    </div>
  );
}

const EVENTS = [[PhoneIncoming, 'Incoming call', '+1 415 ••• 0182'], [CornerDownRight, 'Pressed 1 → Sales', 'forwarded in 0.4s'], [PhoneIncoming, 'Incoming call', '+44 20 ••• 7741'], [CornerDownRight, 'Pressed 3 → Voicemail', 'sent to your inbox']];
function LiveCallCard() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % EVENTS.length), 2600); return () => clearInterval(t); }, []);
  const [Icon, title, sub] = EVENTS[i];
  return (
    <div className="absolute left-0 bottom-4 sm:left-4 sm:bottom-10 w-64 rounded-2xl border border-white/10 bg-[#0A0D0E]/70 backdrop-blur-xl p-4" data-testid="hero-live-ivr-card">
      <div className="civr-l-eyebrow !text-xs"><span className="civr-l-dot" />Live IVR</div>
      <div key={i} className="flex items-start gap-3 mt-3 civr-rise">
        <Icon className="w-4 h-4 text-[#00E3AA] mt-0.5 shrink-0" />
        <div><div className="text-sm font-semibold">{title}</div><div className="text-xs font-mono civr-l-muted mt-0.5">{sub}</div></div>
      </div>
    </div>
  );
}

function StatStrip({ catalog }) {
  const stats = [[catalog?.countries?.length || 17, 'Countries'], ['60s', 'Free test call'], [startPrice(catalog) || '$50', 'From / month'], [(catalog?.coins || []).length || 8, 'Coins accepted']];
  return (
    <div className="relative border-t civr-l-rule" data-testid="hero-stats">
      <div className="max-w-7xl mx-auto px-6 md:px-8 grid grid-cols-2 md:grid-cols-4">
        {stats.map(([v, l], i) => (
          <div key={l} className={`py-6 md:py-8 ${i % 2 ? 'pl-6' : ''} ${i > 0 ? 'md:pl-8 md:border-l civr-l-rule' : ''} ${i > 1 ? 'border-t md:border-t-0 civr-l-rule' : ''}`} data-testid={`hero-stat-${i}`}>
            <div className="civr-l-h text-4xl md:text-5xl">{v}</div>
            <div className="civr-l-eyebrow !text-xs !text-[#FEFDF5]/60 mt-2">{l}</div>
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
  return (
    <section className="civr-l-dark relative overflow-hidden pt-24 md:pt-28" data-testid="civr-hero">
      <div className="absolute inset-0 civr-l-gridbg opacity-70" />
      <div className="civr-l-glow w-[560px] h-[560px] bg-[#00E3AA]/15 -right-40 top-0" />
      <div className="civr-l-glow w-[380px] h-[380px] bg-[#3434EF]/20 right-1/3 bottom-0" />
      <div className="relative max-w-7xl mx-auto px-6 md:px-8 grid lg:grid-cols-12 gap-6 lg:gap-8 items-center pb-12 md:pb-16">
        <div className="lg:col-span-6 relative z-10 pt-8">
          <div className="civr-l-eyebrow civr-rise"><span className="civr-l-dot" />Cloud numbers · IVR · AI agents</div>
          <h1 className="civr-l-h text-5xl sm:text-6xl lg:text-7xl mt-6 civr-rise civr-d1" data-testid="hero-title" data-no-translate>{t[0]}<span className="text-[#00E3AA]">{t[1]}</span>{t[2]}</h1>
          <p className="text-base md:text-lg civr-l-muted mt-6 max-w-xl civr-rise civr-d2" data-testid="hero-subtitle">
            {`Virtual numbers in ${n} countries with call forwarding, voicemail, an SMS inbox, a press-1 auto-attendant, bulk IVR campaigns and AI voice agents. Call from your browser and pay with crypto or your wallet.`}
          </p>
          <div className="flex flex-wrap gap-3 mt-8 civr-rise civr-d3">
            <a href="#try" className="civr-l-btn" data-testid="civr-hero-cta-test-btn"><PhoneCall className="w-4 h-4" /><Slide>Try a free call</Slide></a>
            <Link to={account ? cp('/app/buy') : cp('/signup')} className="civr-l-btn civr-l-btn-ghost" data-testid="civr-hero-cta-buy-btn"><Slide>Get your number</Slide><ArrowRight className="w-4 h-4" /></Link>
          </div>
          <p className="text-sm civr-l-muted mt-5 civr-rise civr-d4" data-testid="hero-microcopy">Free to sign up{from ? ` · Numbers from ${from}/month` : ''} · No contracts</p>
        </div>
        <div className="lg:col-span-6 relative h-[340px] sm:h-[440px] lg:h-[580px] civr-rise civr-d2">
          <Art3D />
          <LiveCallCard />
        </div>
      </div>
      <StatStrip catalog={catalog} />
    </section>
  );
}
