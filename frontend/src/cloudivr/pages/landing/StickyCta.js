import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PhoneCall } from 'lucide-react';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { goTo } from './menu';

// Mobile only (CSS hides it from md up): "Get your number" stays one tap away once the hero has scrolled past,
// and the bar steps aside when the test-call form, the final CTA or the footer is on screen.
export function StickyCta() {
  const { account } = useCivrAuth();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.querySelector('[data-testid="civr-hero"]');
    const hide = ['try-section', 'final-cta', 'landing-footer'].map(id => document.querySelector(`[data-testid="${id}"]`)).filter(Boolean);
    if (!hero || typeof IntersectionObserver === 'undefined') return undefined;
    let heroOut = false; const covering = new Set();
    const apply = () => setShow(heroOut && !covering.size);
    const ioHero = new IntersectionObserver(([e]) => { heroOut = !e.isIntersecting && e.boundingClientRect.bottom < 0; apply(); }, { threshold: 0 });
    ioHero.observe(hero);
    const ioHide = new IntersectionObserver((es) => { es.forEach(e => (e.isIntersecting ? covering.add(e.target) : covering.delete(e.target))); apply(); }, { threshold: 0.05 });
    hide.forEach(el => ioHide.observe(el));
    return () => { ioHero.disconnect(); ioHide.disconnect(); };
  }, []);
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 767px)');
    const set = () => { if (show && mq?.matches) document.body.setAttribute('data-civr-sticky', '1'); else document.body.removeAttribute('data-civr-sticky'); };
    set();
    mq?.addEventListener?.('change', set);
    return () => { mq?.removeEventListener?.('change', set); document.body.removeAttribute('data-civr-sticky'); };
  }, [show]);
  return (
    <div className={`civr-l-sticky ${show ? '' : 'hide'}`} aria-hidden={!show} data-testid="mobile-sticky-cta">
      <div className="flex items-center gap-2">
        <Link to={account ? cp('/app/buy') : cp('/signup')} tabIndex={show ? 0 : -1} className="civr-l-btn flex-1 !h-12" data-testid="sticky-cta-buy">{account ? 'Open dashboard' : 'Get your number'}<ArrowRight className="w-4 h-4" /></Link>
        <a href="#try" onClick={(e) => goTo('#try', e)} tabIndex={show ? 0 : -1} className="civr-l-btn civr-l-btn-ghost !h-12 !px-4" aria-label="Try a free call" data-testid="sticky-cta-try"><PhoneCall className="w-4 h-4" />Try a call</a>
      </div>
    </div>
  );
}
