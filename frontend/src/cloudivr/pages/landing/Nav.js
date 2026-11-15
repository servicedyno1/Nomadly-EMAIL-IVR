import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Wordmark } from '../../Brand';
import { LangSwitcher } from '../../i18n';
import { Slide, SiteThemeButton } from './kit';
import { goTo } from './menu';

export const LANDING_LINKS = [['#how', 'How it works', 'how'], ['#pricing', 'Pricing', 'pricing'], ['#try', 'Free test call', 'try'], ['#faq', 'FAQ', 'faq']];

function MobileMenu({ onClose, account }) {
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, []);
  return (
    <div className="lg:hidden fixed inset-x-0 top-16 bottom-0 z-[45] bg-white text-slate-900 overflow-y-auto civr-l-swap" data-testid="landing-mobile-menu">
      <div className="px-4 sm:px-6 py-6 flex flex-col gap-8">
        <div className="flex flex-col border-b border-slate-200 pb-4">
          {LANDING_LINKS.map(([href, label, id]) => <a key={id} href={href} onClick={(e) => { goTo(href, e); onClose(); }} className="px-3 py-3 min-h-[48px] text-base font-medium text-slate-700" data-testid={`mobile-menu-link-${id}`}>{label}</a>)}
        </div>
        <div className="grid gap-3 pb-6">
          <Link to={account ? cp('/app') : cp('/signup')} className="civr-l-btn w-full" data-testid="mobile-menu-cta">{account ? 'Open dashboard' : 'Sign up free'}</Link>
          {!account && <Link to={cp('/login')} className="civr-l-btn civr-l-btn-ghost w-full" data-testid="mobile-menu-signin">Sign in</Link>}
        </div>
      </div>
    </div>
  );
}

export function LandingNav() {
  const { account } = useCivrAuth();
  const [scrolled, setScrolled] = useState(0);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY);
    on();
    window.addEventListener('scroll', on, { passive: true });
    const esc = (e) => { if (e.key === 'Escape') setMobile(false); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('keydown', esc); };
  }, []);
  return (
    <>
    <header className={`civr-l-navbar fixed top-0 inset-x-0 z-50 text-slate-900 ${scrolled > 8 ? 'scrolled' : ''}`} data-testid="civr-nav">
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 md:px-8 h-16 flex items-center gap-1 min-[420px]:gap-2 sm:gap-4">
        <Link to={cp()} className="font-display text-2xl font-extrabold tracking-tight min-h-[44px] flex items-center gap-2 mr-auto lg:mr-6" data-testid="civr-nav-logo"><Wordmark accent="#059669" iconClass="w-7 h-7 sm:w-8 sm:h-8" textClass="max-[419px]:sr-only" /></Link>
        <nav className="hidden lg:flex items-center gap-1 mr-auto" aria-label="Main">
          {LANDING_LINKS.map(([href, label, id]) => <a key={id} href={href} onClick={(e) => goTo(href, e)} className="civr-l-navlink" data-testid={`landing-nav-${id}`}>{label}</a>)}
        </nav>
        <SiteThemeButton testid="landing-theme-button" />
        <LangSwitcher testid="landing-lang-switcher" tone="landing" />
        {account
          ? <Link to={cp('/app')} className="civr-l-pill civr-l-pill-ink civr-l-pill-sm" data-testid="landing-open-dashboard"><Slide><span className="sm:hidden">Dashboard</span><span className="hidden sm:inline">Open dashboard</span></Slide></Link>
          : <>
              <Link to={cp('/login')} aria-label="Sign in" className="text-sm font-medium text-slate-700 hover:text-slate-950 px-1 py-3 min-h-[44px] hidden sm:flex items-center whitespace-nowrap transition-colors" data-testid="civr-nav-login-btn">Sign in</Link>
              <Link to={cp('/signup')} className="civr-l-pill civr-l-pill-ink civr-l-pill-sm whitespace-nowrap min-h-[44px]" data-testid="civr-nav-signup-btn"><Slide><span className="sm:hidden">Sign up</span><span className="hidden sm:inline">Sign up free</span></Slide></Link>
            </>}
        <button type="button" className="lg:hidden w-11 h-11 -mr-2 grid place-items-center rounded-full hover:bg-slate-100 transition-colors" aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile} onClick={() => setMobile(m => !m)} data-testid="landing-mobile-menu-button">{mobile ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
      </div>
    </header>
    {mobile && <MobileMenu account={account} onClose={() => setMobile(false)} />}
    </>
  );
}
