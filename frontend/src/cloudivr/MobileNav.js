import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { NAV_ITEMS, appPath } from './nav';

const SHORT = { 'nav-dashboard': 'Overview', 'nav-numbers': 'Numbers', 'nav-buy': 'Buy', 'nav-wallet': 'Wallet' };
const MAIN = NAV_ITEMS.filter(([, , , id]) => SHORT[id]);
const MORE = NAV_ITEMS.filter(([, , , id]) => !SHORT[id]);
const tab = (active) => `flex flex-col items-center justify-center gap-1 h-16 text-[11px] font-medium transition-colors ${active ? 'text-[#34d399]' : 'text-[#a1a1aa]'}`;

// Phone-sized screens: bottom tab bar with the four main pages + a "More" menu for the rest.
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);
  const moreActive = MORE.some(([to]) => pathname.startsWith(appPath(to)));
  return (
    <>
      {open && <button type="button" aria-label="Close menu" className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)} data-testid="mobile-more-backdrop" />}
      {open && (
        <div className="lg:hidden fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 civr-card p-2 civr-rise" data-testid="mobile-more-menu">
          {MORE.map(([to, label, Icon, id]) => (
            <NavLink key={id} to={appPath(to)} className={({ isActive }) => `civr-nav-link ${isActive ? 'active' : ''}`} data-testid={`mobile-${id}`}><Icon className="w-4 h-4" />{label}</NavLink>
          ))}
        </div>
      )}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]" data-testid="mobile-bottom-nav">
        {MAIN.map(([to, , Icon, id]) => (
          <NavLink key={id} end={to === ''} to={appPath(to)} className={({ isActive }) => tab(isActive && !open)} data-testid={`mobile-${id}`}><Icon className="w-5 h-5" />{SHORT[id]}</NavLink>
        ))}
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={tab(open || moreActive)} data-testid="mobile-nav-more"><MoreHorizontal className="w-5 h-5" />More</button>
      </nav>
    </>
  );
}
