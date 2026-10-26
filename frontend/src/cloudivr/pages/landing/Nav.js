import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Menu, X, PhoneCall, ArrowRight } from 'lucide-react';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { Wordmark } from '../../Brand';
import { LangSwitcher } from '../../i18n';
import { startPrice } from '../../api';
import { Slide } from './kit';
import { PRODUCTS, USE_CASES, goTo, hrefOf } from './menu';

export const LANDING_LINKS = [['#coverage', 'Coverage', 'coverage'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']];
const MENUS = [['products', 'Products', PRODUCTS], ['usecases', 'Use cases', USE_CASES]];

function Item({ it, onPick, testid }) {
  const [id, Icon, title, desc, target] = it;
  return (
    <a href={hrefOf('', target)} onClick={(e) => { goTo(target, e); onPick(); }} className="civr-l-menu-item group" data-testid={`${testid}-${id}`}>
      <span className="w-10 h-10 rounded-xl bg-[#f5f3ff] text-[#5b21b6] grid place-items-center shrink-0 transition-colors group-hover:bg-[#5b21b6] group-hover:text-white"><Icon className="w-5 h-5" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="block text-xs text-slate-500 mt-0.5 leading-snug">{desc}</span></span>
    </a>
  );
}

function Featured({ which, catalog, onPick }) {
  const from = startPrice(catalog);
  const [title, text, href, cta, id] = which === 'products'
    ? ['Free 60-second test call', 'We ring your phone with a live demo menu — or call from this browser. No card needed.', '#try', 'Try a free call', 'try']
    : ['One price per number', `Free to sign up${from ? ` · numbers from ${from}/month` : ''} · no contracts.`, '#pricing', 'See plans', 'pricing'];
  return (
    <a href={href} onClick={(e) => { goTo(href, e); onPick(); }} className="civr-l-purple relative overflow-hidden rounded-2xl p-6 flex flex-col justify-between min-h-[200px] group" data-testid={`nav-menu-featured-${id}`}>
      <span className="civr-l-glow w-40 h-40 -right-10 -top-10 bg-[#7c3aed]/60" />
      <span className="relative"><span className="civr-l-kicker text-[11px]">{which === 'products' ? 'Try it' : 'Pricing'}</span><span className="block text-lg font-semibold text-white mt-2">{title}</span><span className="block text-sm text-[#cbd5e1] mt-2">{text}</span></span>
      <span className="relative inline-flex items-center gap-2 text-sm font-semibold text-[#7dd3fc] mt-6">{cta}<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></span>
    </a>
  );
}

function MegaPanel({ which, catalog, onPick }) {
  const [, label, items] = MENUS.find(m => m[0] === which);
  return (
    <div id={`nav-menu-${which}`} role="region" aria-label={label} className="civr-l-menu absolute left-4 right-4 sm:left-6 sm:right-6 md:left-8 md:right-8 top-[calc(100%+8px)] p-3 grid grid-cols-12 gap-3" data-testid={`nav-menu-${which}`}>
      <div className="col-span-8 grid grid-cols-2 gap-1 content-start p-2">{items.map(it => <Item key={it[0]} it={it} onPick={onPick} testid={`nav-menu-${which}-item`} />)}</div>
      <div className="col-span-4"><Featured which={which} catalog={catalog} onPick={onPick} /></div>
    </div>
  );
}

function MobileMenu({ catalog, onClose, account }) {
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, []);
  return (
    <div className="lg:hidden fixed inset-x-0 top-16 bottom-0 z-40 bg-white text-slate-900 overflow-y-auto civr-l-swap" data-testid="landing-mobile-menu">
      <div className="px-4 sm:px-6 py-6 flex flex-col gap-8">
        {MENUS.map(([id, label, items]) => (
          <div key={id}>
            <div className="civr-l-eyebrow text-[#5b21b6] px-3">{label}</div>
            <div className="mt-2 flex flex-col gap-1">{items.map(it => <Item key={it[0]} it={it} onPick={onClose} testid={`mobile-menu-${id}-item`} />)}</div>
          </div>
        ))}
        <div className="flex flex-col border-t border-slate-200 pt-4">
          {[...LANDING_LINKS, ['#try', 'Free test call', 'try']].map(([href, label, id]) => <a key={id} href={href} onClick={(e) => { goTo(href, e); onClose(); }} className="px-3 py-3 text-base font-medium text-slate-700" data-testid={`mobile-menu-link-${id}`}>{label}</a>)}
        </div>
        <div className="grid gap-3 pb-6">
          <Link to={account ? cp('/app') : cp('/signup')} className="civr-l-btn w-full" data-testid="mobile-menu-cta">{account ? 'Open dashboard' : 'Get your number'}</Link>
          {!account && <Link to={cp('/login')} className="civr-l-btn civr-l-btn-ghost w-full" data-testid="mobile-menu-signin">Sign in</Link>}
        </div>
      </div>
    </div>
  );
}

export function LandingNav({ catalog }) {
  const { account } = useCivrAuth();
  const [scrolled, setScrolled] = useState(0);
  const [open, setOpen] = useState(null);
  const [mobile, setMobile] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY);
    on();
    window.addEventListener('scroll', on, { passive: true });
    const esc = (e) => { if (e.key === 'Escape') { setOpen(null); setMobile(false); } };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('keydown', esc); };
  }, []);
  const hover = (id) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(id), id ? 60 : 160); };
  return (
    <>
    <header className={`civr-l-navbar fixed top-0 inset-x-0 z-50 text-white ${scrolled > 8 ? 'scrolled' : ''}`} onMouseLeave={() => hover(null)} data-testid="civr-nav">
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 md:px-8 h-16 flex items-center gap-2 sm:gap-4">
        <Link to={cp()} className="font-display text-2xl font-extrabold tracking-tight min-h-[44px] flex items-center gap-2 mr-auto lg:mr-6" data-testid="civr-nav-logo"><Wordmark accent="#7dd3fc" iconClass="w-7 h-7 sm:w-8 sm:h-8" /></Link>
        <nav className="hidden lg:flex items-center gap-1 mr-auto" aria-label="Main">
          {MENUS.map(([id, label]) => (
            <button key={id} type="button" className={`civr-l-navlink ${open === id ? 'on' : ''}`} aria-expanded={open === id} aria-controls={`nav-menu-${id}`} onMouseEnter={() => hover(id)} onClick={() => setOpen(o => (o === id ? null : id))} data-testid={`nav-${id}-dropdown`}>
              {label}<ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open === id ? 'rotate-180' : ''}`} />
            </button>
          ))}
          {LANDING_LINKS.map(([href, label, id]) => <a key={id} href={href} onMouseEnter={() => hover(null)} onClick={(e) => goTo(href, e)} className="civr-l-navlink" data-testid={`landing-nav-${id}`}>{label}</a>)}
        </nav>
        {scrolled > 300 && <a href="#try" onClick={(e) => goTo('#try', e)} className="hidden xl:inline-flex items-center gap-2 text-sm font-semibold text-[#7dd3fc] civr-rise" data-testid="civr-nav-sticky-cta"><PhoneCall className="w-4 h-4" />Free call</a>}
        <LangSwitcher testid="landing-lang-switcher" />
        {account
          ? <Link to={cp('/app')} className="civr-l-pill civr-l-pill-light civr-l-pill-sm" data-testid="landing-open-dashboard"><Slide><span className="sm:hidden">Dashboard</span><span className="hidden sm:inline">Open dashboard</span></Slide></Link>
          : <>
              <Link to={cp('/login')} aria-label="Sign in" className="text-sm font-medium text-white/85 hover:text-white px-1 py-3 min-h-[44px] hidden sm:flex items-center whitespace-nowrap transition-colors" data-testid="civr-nav-login-btn">Sign in</Link>
              <Link to={cp('/signup')} className="civr-l-pill civr-l-pill-light civr-l-pill-sm whitespace-nowrap" data-testid="civr-nav-signup-btn"><Slide><span className="sm:hidden">Start</span><span className="hidden sm:inline">Get your number</span></Slide></Link>
            </>}
        <button type="button" className="lg:hidden w-11 h-11 -mr-2 grid place-items-center rounded-full hover:bg-white/10 transition-colors" aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile} onClick={() => setMobile(m => !m)} data-testid="landing-mobile-menu-button">{mobile ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
        {open && <MegaPanel which={open} catalog={catalog} onPick={() => setOpen(null)} />}
      </div>
    </header>
    {mobile && <MobileMenu catalog={catalog} account={account} onClose={() => setMobile(false)} />}
    </>
  );
}
