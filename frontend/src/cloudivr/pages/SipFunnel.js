import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LogIn } from 'lucide-react';
import { useApi, usd } from '../api';
import { useCivrAuth } from '../AuthContext';
import { cp } from '../paths';
import { Wordmark } from '../Brand';
import { LangSwitcher } from '../i18n';
import { Slide } from './landing/kit';
import { Footer, useStart } from './landing/PricingFaq';
import { SipHero } from './sip/Hero';
import { Apps, Benefits, Steps } from './sip/Sections';
import { SipFaq, SipFinalCta, SipPlans } from './sip/Plans';
import { sipPick } from './sip/shared';

const LINKS = [['#apps', 'Phone apps', 'apps'], ['#how', 'How it works', 'how'], ['#plans', 'Plans', 'plans'], ['#faq', 'FAQ', 'faq']];

function useScrolled(y) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const f = () => setOn(window.scrollY > y);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, [y]);
  return on;
}

function Nav() {
  const { account } = useCivrAuth();
  return (
    <header className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200/80 text-slate-900" data-testid="sip-nav">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 h-16 flex items-center gap-3 sm:gap-6">
        <Link to={cp()} className="font-display text-2xl font-extrabold tracking-tight mr-auto min-h-[44px] flex items-center gap-2" data-testid="sip-nav-logo"><Wordmark accent="#059669" iconClass="w-7 h-7 sm:w-8 sm:h-8" /></Link>
        <nav className="hidden lg:flex items-center gap-8">
          {LINKS.map(([href, label, id]) => <a key={id} href={href} className="text-sm font-medium text-slate-600 hover:text-slate-900 py-3 transition-colors" data-testid={`sip-nav-${id}`}>{label}</a>)}
        </nav>
        <LangSwitcher tone="landing" testid="sip-lang-switcher" />
        {account
          ? <Link to={cp('/app')} className="civr-l-btn civr-l-btn-sm" data-testid="sip-nav-dashboard"><Slide><span className="sm:hidden">Dashboard</span><span className="hidden sm:inline">Open dashboard</span></Slide></Link>
          : <>
              <Link to={cp('/login')} aria-label="Sign in" className="text-sm font-medium text-slate-700 hover:text-slate-900 px-1 py-3 min-h-[44px] flex items-center whitespace-nowrap transition-colors" data-testid="sip-nav-login"><LogIn className="w-5 h-5 sm:hidden" aria-hidden="true" /><span className="hidden sm:inline">Sign in</span></Link>
              <a href="#plans" className="civr-l-btn civr-l-btn-sm whitespace-nowrap" data-testid="sip-nav-cta"><Slide><span className="sm:hidden">Plans</span><span className="hidden sm:inline">See plans</span></Slide></a>
            </>}
      </div>
    </header>
  );
}

// Phones: once the hero has scrolled away, the best SIP plan stays one tap away.
function StickyCta({ catalog }) {
  const start = useStart();
  const show = useScrolled(720);
  const pick = sipPick(catalog);
  if (!show || !pick) return null;
  return (
    <div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-xl px-4 pt-3 civr-rise" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }} data-testid="sip-sticky-cta">
      <div className="flex items-center gap-3">
        <div className="min-w-0 mr-auto">
          <div className="text-sm font-semibold text-slate-900" data-testid="sip-sticky-plan">{pick.name} · {usd(pick.price)}/mo</div>
          <div className="text-xs text-slate-500">SIP logins included</div>
        </div>
        <Link to={start(pick.id)} className="civr-l-btn civr-l-btn-sm" data-testid="sip-sticky-cta-button">Get started<ArrowRight className="w-4 h-4" /></Link>
      </div>
    </div>
  );
}

// Sales page for SIP buyers (cloudivr.net/sip). The SIP server itself (sip.cloudivr.net) stays a phone-only address.
export default function SipFunnel() {
  const { data: catalog } = useApi('/public/catalog');
  return (
    <div className="civr-l pb-20 md:pb-0" data-testid="sip-funnel-page">
      <Nav />
      <main>
        <SipHero catalog={catalog} />
        <Benefits catalog={catalog} />
        <Apps catalog={catalog} />
        <Steps />
        <SipPlans catalog={catalog} />
        <SipFaq catalog={catalog} />
        <SipFinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
      <StickyCta catalog={catalog} />
    </div>
  );
}
