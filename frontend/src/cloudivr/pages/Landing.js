import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { useCivrAuth } from '../AuthContext';
import { cp } from '../paths';
import { Wordmark } from '../Brand';
import { Hero } from './landing/Hero';
import { Coverage, Features, HowItWorks } from './landing/Sections';
import { TryCall } from './landing/TryCall';
import { Pricing, Faq, FinalCta, Footer } from './landing/PricingFaq';
import { Slide } from './landing/kit';
import { LangSwitcher } from '../i18n';
import SupportChat from '../SupportChat';

export const LANDING_LINKS = [['#coverage', 'Coverage', 'coverage'], ['#try', 'Free test call', 'try'], ['#features', 'Features', 'features'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']];

function Nav() {
  const { account } = useCivrAuth();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 300);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-[#0A0D0E]/80 border-b border-white/10 text-[#FEFDF5]" data-testid="civr-nav">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 h-16 flex items-center gap-3 sm:gap-6">
        <Link to={cp()} className="font-display text-2xl font-extrabold tracking-tight mr-auto min-h-[44px] flex items-center gap-2" data-testid="civr-nav-logo"><Wordmark accent="#00E3AA" iconClass="w-8 h-8" /></Link>
        <nav className="hidden lg:flex items-center gap-7">
          {LANDING_LINKS.map(([href, label, id]) => <a key={id} href={href} className="text-sm text-[#FEFDF5]/70 hover:text-[#00E3AA] py-3 transition-colors" data-testid={`landing-nav-${id}`}>{label}</a>)}
        </nav>
        {scrolled && <a href="#try" className="hidden md:inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#00E3AA] civr-rise" data-testid="civr-nav-sticky-cta"><span className="civr-l-dot" />Free call</a>}
        <LangSwitcher tone="landing" testid="landing-lang-switcher" />
        {account
          ? <Link to={cp('/app')} className="civr-l-btn civr-l-btn-sm" data-testid="landing-open-dashboard"><Slide>Open dashboard</Slide></Link>
          : <>
              <Link to={cp('/login')} className="text-sm text-[#FEFDF5]/80 hover:text-[#00E3AA] px-1 py-3 transition-colors" data-testid="civr-nav-login-btn">Sign in</Link>
              <Link to={cp('/signup')} className="civr-l-btn civr-l-btn-sm" data-testid="civr-nav-signup-btn"><Slide><span className="sm:hidden">Start</span><span className="hidden sm:inline">Get your number</span></Slide></Link>
            </>}
      </div>
    </header>
  );
}

export default function Landing() {
  const { data: catalog } = useApi('/public/catalog');
  return (
    <div className="civr-l" data-testid="landing-page">
      <Nav />
      <main>
        <Hero catalog={catalog} />
        <Coverage catalog={catalog} />
        <TryCall />
        <Features catalog={catalog} />
        <HowItWorks catalog={catalog} />
        <Pricing catalog={catalog} />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
      <SupportChat visitor supportLink={catalog?.supportLink} />
    </div>
  );
}
