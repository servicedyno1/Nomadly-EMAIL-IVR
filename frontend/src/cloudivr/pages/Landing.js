import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Workflow, PhoneForwarded, Voicemail, MessageSquare, Megaphone, Headphones, Globe2, Bitcoin, Check } from 'lucide-react';
import { useApi, money } from '../api';
import { useCivrAuth } from '../AuthContext';

const HERO_IMG = 'https://images.pexels.com/photos/7682203/pexels-photo-7682203.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';

const FEATURES = [
  [Workflow, 'Visual IVR builder', 'Press 1 for sales, 2 for support. Greetings from text-to-speech or your own audio, one sub-menu deep.', 'md:col-span-8 md:row-span-2', true],
  [PhoneForwarded, 'Call forwarding', 'Always, when busy or on no answer — to any phone worldwide.', 'md:col-span-4'],
  [Voicemail, 'Voicemail', 'Custom greetings, recordings in your inbox and email.', 'md:col-span-4'],
  [Megaphone, 'Bulk IVR campaigns', 'Paste leads, pick a message, watch answers and key presses live. Pause or cancel any time.', 'md:col-span-4'],
  [Headphones, 'Browser phone', 'Call and answer from this tab with your number’s SIP line.', 'md:col-span-4'],
  [MessageSquare, 'SMS inbox', 'Inbound texts in your inbox, email or webhook.', 'md:col-span-4'],
];

function Nav() {
  const { account } = useCivrAuth();
  return (
    <header className="civr-glass sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center gap-6">
        <Link to="/cloudivr" className="font-display text-2xl font-extrabold tracking-tight mr-auto" data-testid="landing-logo">CLOUD<span className="text-[#34d399]">IVR</span></Link>
        <a href="#features" className="hidden md:inline text-sm text-[#888] hover:text-white" data-testid="landing-nav-features">Features</a>
        <a href="#pricing" className="hidden md:inline text-sm text-[#888] hover:text-white" data-testid="landing-nav-pricing">Pricing</a>
        {account
          ? <Link to="/cloudivr/app" className="civr-btn civr-btn-primary civr-btn-sm" data-testid="landing-open-dashboard">Open dashboard</Link>
          : <>
              <Link to="/cloudivr/login" className="text-sm text-[#ddd] hover:text-[#34d399]" data-testid="landing-signin-link">Sign in</Link>
              <Link to="/cloudivr/signup" className="civr-btn civr-btn-primary civr-btn-sm" data-testid="landing-signup-button">Get a number</Link>
            </>}
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="civr-grain" />
      <div className="max-w-7xl mx-auto px-5 md:px-8 pt-16 md:pt-24 pb-20 grid lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7">
          <div className="civr-label civr-rise">Nomadly · Cloud IVR + SIP</div>
          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[0.92] mt-5 civr-rise civr-d1">
            Phone numbers that <span className="text-[#34d399]">answer</span>, route and call for you.
          </h1>
          <p className="text-base md:text-lg text-[#9a9a9a] mt-6 max-w-xl civr-rise civr-d2">
            Virtual numbers in 17 countries with an auto-attendant, forwarding, voicemail, SMS and outbound IVR campaigns. Pay with crypto. Run it all from your browser.
          </p>
          <div className="flex flex-wrap gap-3 mt-9 civr-rise civr-d3">
            <Link to="/cloudivr/signup" className="civr-btn civr-btn-primary" data-testid="hero-get-started-button">Create free account <ArrowRight className="w-4 h-4" /></Link>
            <a href="#pricing" className="civr-btn civr-btn-ghost" data-testid="hero-see-pricing-button">See pricing</a>
          </div>
          <div className="flex flex-wrap gap-5 mt-10 text-xs font-mono uppercase tracking-widest text-[#666] civr-rise civr-d4">
            <span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-[#38bdf8]" />17 countries</span>
            <span className="flex items-center gap-2"><Bitcoin className="w-4 h-4 text-[#fbbf24]" />Crypto wallet</span>
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#34d399] civr-pulse" />Network online</span>
          </div>
        </div>
        <div className="lg:col-span-5 relative civr-rise civr-d2">
          <div className="civr-card overflow-hidden civr-trace">
            <img src={HERO_IMG} alt="Support agent on a call" className="w-full h-[380px] object-cover opacity-80" />
          </div>
          <div className="civr-card absolute -bottom-6 -left-4 md:-left-10 p-4 w-64 civr-glass">
            <div className="civr-label">Live IVR</div>
            <div className="font-mono text-sm mt-2 text-[#ddd]">“Press 1 for sales…”</div>
            <div className="text-xs text-[#888] mt-1">Caller pressed <span className="text-[#34d399]">1</span> → forwarded</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="max-w-7xl mx-auto px-5 md:px-8 py-20">
      <div className="civr-label">What you get</div>
      <h2 className="font-display text-3xl sm:text-4xl font-bold mt-3 mb-10 max-w-2xl">One number. A full phone system behind it.</h2>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {FEATURES.map(([Icon, title, text, span, big], i) => (
          <div key={title} className={`civr-card p-7 ${span} ${big ? 'flex flex-col justify-between min-h-[260px]' : ''}`} data-testid={`feature-card-${i}`}>
            <Icon className={`${big ? 'w-10 h-10' : 'w-6 h-6'} text-[#34d399]`} />
            {big && <IvrSketch />}
            <div className="mt-6">
              <div className={`font-display font-bold ${big ? 'text-4xl' : 'text-2xl'}`}>{title}</div>
              <p className="text-sm text-[#888] mt-2 max-w-lg">{text}</p>
            </div>
          </div>
        ))}
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
      <div className="hidden sm:block h-px flex-1 max-w-[60px] bg-[#34d399]/40" />
      <div className="grid gap-2 flex-1">
        {keys.map(([k, l, a], i) => (
          <div key={k} className={`flex items-center gap-3 rounded-xl border border-[#222] bg-[#0f0f0f] px-3 py-2 civr-rise civr-d${i + 1}`}>
            <span className="w-7 h-7 rounded-lg border border-[#34d399]/50 text-[#34d399] font-mono text-sm flex items-center justify-center">{k}</span>
            <span className="text-sm font-medium">{l}</span><span className="ml-auto text-xs font-mono text-[#777]">{a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pricing() {
  const { data } = useApi('/public/catalog');
  const plans = data?.plans || [];
  return (
    <section id="pricing" className="max-w-7xl mx-auto px-5 md:px-8 py-20">
      <div className="civr-label">Pricing</div>
      <h2 className="font-display text-3xl sm:text-4xl font-bold mt-3 mb-10">Monthly per number. Cancel any time.</h2>
      <div className="grid md:grid-cols-3 gap-5">
        {plans.map((p, i) => (
          <div key={p.id} className={`civr-card p-7 flex flex-col ${i === 1 ? 'civr-trace' : ''}`} data-testid={`pricing-plan-${p.id}`}>
            <div className="flex items-center justify-between"><div className="font-display text-3xl font-bold">{p.name}</div>{i === 1 && <span className="civr-pill civr-pill-on">Popular</span>}</div>
            <div className="font-mono text-4xl mt-4">{money(p.price)}<span className="text-sm text-[#666]">/mo</span></div>
            <ul className="mt-6 space-y-2.5 text-sm text-[#bbb] flex-1">
              {p.features.map(f => <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-[#34d399] mt-0.5 shrink-0" />{f}</li>)}
            </ul>
            <Link to="/cloudivr/signup" className={`civr-btn mt-8 ${i === 1 ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`pricing-choose-${p.id}`}>Choose {p.name}</Link>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div data-testid="landing-page">
      <Nav />
      <Hero />
      <Features />
      <Pricing />
      <footer className="border-t border-[#1a1a1a] py-10 text-center text-xs font-mono uppercase tracking-widest text-[#555]">Nomadly CloudIVR · Speechcue network</footer>
    </div>
  );
}
