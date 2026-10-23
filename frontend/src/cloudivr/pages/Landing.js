import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Globe2, Bitcoin, CalendarCheck } from 'lucide-react';
import { useApi, startPrice } from '../api';
import { useCivrAuth } from '../AuthContext';
import { cp } from '../paths';
import { HowItWorks, Features, WhyUs } from './landing/Sections';
import { Pricing, Faq, FinalCta, Footer } from './landing/PricingFaq';

const HERO_IMG = 'https://images.pexels.com/photos/7682203/pexels-photo-7682203.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940';
export const LANDING_LINKS = [['#how', 'How it works', 'how'], ['#features', 'Features', 'features'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']];

function Nav() {
  const { account } = useCivrAuth();
  return (
    <header className="civr-glass sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 md:px-8 h-16 flex items-center gap-4 md:gap-8">
        <Link to={cp()} className="font-display text-2xl font-extrabold tracking-tight mr-auto" data-testid="landing-logo">CLOUD<span className="text-[#34d399]">IVR</span></Link>
        {LANDING_LINKS.map(([href, label, id]) => <a key={id} href={href} className="hidden md:inline text-sm text-[#a1a1aa] hover:text-white py-3" data-testid={`landing-nav-${id}`}>{label}</a>)}
        {account
          ? <Link to={cp('/app')} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="landing-open-dashboard">Open dashboard</Link>
          : <>
              <Link to={cp('/login')} className="text-sm text-[#ddd] hover:text-[#34d399] px-2 py-3" data-testid="landing-signin-link">Sign in</Link>
              <Link to={cp('/signup')} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="landing-signup-button">Get your number</Link>
            </>}
      </div>
    </header>
  );
}

function Hero({ catalog }) {
  const { account } = useCivrAuth();
  const from = startPrice(catalog);
  const n = catalog?.countries?.length || 17;
  return (
    <section className="relative overflow-hidden">
      <div className="civr-grain" />
      <div className="max-w-7xl mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-24 grid lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7">
          <div className="civr-label civr-rise">Virtual numbers · IVR · SIP</div>
          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[0.92] mt-6 civr-rise civr-d1">
            Phone numbers that <span className="text-[#34d399]">answer</span>, route and call for you.
          </h1>
          <p className="text-base md:text-lg text-[#a1a1aa] mt-6 max-w-xl civr-rise civr-d2" data-testid="hero-subtitle">
            Virtual numbers in {n} countries with call forwarding, voicemail, SMS and outbound IVR campaigns — plus a full press-1 auto-attendant on Business. Pay with crypto. Run it all from your browser.
          </p>
          <div className="flex flex-wrap gap-4 mt-8 civr-rise civr-d3">
            <Link to={account ? cp('/app/buy') : cp('/signup')} className="civr-btn civr-btn-primary" data-testid="hero-get-started-button">Get your number <ArrowRight className="w-4 h-4" /></Link>
            <a href="#pricing" className="civr-btn civr-btn-ghost" data-testid="hero-see-pricing-button">See pricing</a>
          </div>
          <p className="text-sm text-[#a1a1aa] mt-4 civr-rise civr-d3" data-testid="hero-microcopy">Free to sign up{from ? ` · Numbers from ${from}/month` : ''} · No contracts</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-8 text-xs font-mono uppercase tracking-widest text-[#9a9a9a] civr-rise civr-d4" data-testid="hero-trust-row">
            <span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-[#38bdf8]" />{n} countries</span>
            <span className="flex items-center gap-2"><Bitcoin className="w-4 h-4 text-[#fbbf24]" />Pay with crypto</span>
            <span className="flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-[#34d399]" />Cancel any time</span>
          </div>
        </div>
        <div className="lg:col-span-5 relative civr-rise civr-d2 pb-8 lg:pb-0">
          <div className="civr-card overflow-hidden civr-trace">
            <img src={HERO_IMG} alt="Support agent on a call" className="w-full h-[280px] sm:h-[380px] object-cover opacity-80" />
          </div>
          <div className="civr-card absolute bottom-0 left-4 lg:-bottom-6 lg:-left-10 p-4 w-64 civr-glass" data-testid="hero-live-ivr-card">
            <div className="civr-label">Example IVR</div>
            <div className="font-mono text-sm mt-2 text-[#ddd]">“Press 1 for sales…”</div>
            <div className="text-xs text-[#a1a1aa] mt-1">Caller pressed <span className="text-[#34d399]">1</span> → forwarded</div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const { data: catalog } = useApi('/public/catalog');
  return (
    <div data-testid="landing-page">
      <Nav />
      <main>
        <Hero catalog={catalog} />
        <HowItWorks catalog={catalog} />
        <Features catalog={catalog} />
        <WhyUs catalog={catalog} />
        <Pricing catalog={catalog} />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
    </div>
  );
}
