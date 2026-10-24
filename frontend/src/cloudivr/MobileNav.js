import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Lightbulb, MoreHorizontal, Send } from 'lucide-react';
import { NAV_ITEMS, appPath } from './nav';
import { useShell } from './Shell';

const SHORT = { 'nav-dashboard': 'Overview', 'nav-numbers': 'Numbers', 'nav-inbox': 'Inbox', 'nav-wallet': 'Wallet' };
const MAIN = ['nav-dashboard', 'nav-numbers', 'nav-inbox', 'nav-wallet'].map(id => NAV_ITEMS.find(x => x[3] === id));
const MORE = NAV_ITEMS.filter(([, , , id]) => !SHORT[id]);
const tab = (active) => `relative min-w-0 flex flex-col items-center justify-center gap-1 h-16 text-xs font-medium transition-colors ${active ? 'text-[#34d399]' : 'text-[#a1a1aa]'}`;

const Badge = ({ n }) => (n > 0 ? <span className="absolute top-2 left-1/2 ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ef4444] text-white text-[11px] font-bold flex items-center justify-center" data-testid="mobile-inbox-unread">{n > 99 ? '99+' : n}</span> : null);

// Phone-sized screens: bottom tab bar with Overview, Numbers, Inbox, Wallet + a "More" menu for the rest.
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const shell = useShell();
  const channelLink = shell?.catalog?.channelLink;
  const unread = shell?.summary?.unread || 0;
  useEffect(() => { setOpen(false); }, [pathname]);
  const moreActive = MORE.some(([to]) => pathname.startsWith(appPath(to)));
  return (
    <>
      {open && <button type="button" aria-label="Close menu" className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)} data-testid="mobile-more-backdrop" />}
      {open && (
        <div className="lg:hidden fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 civr-card p-2 civr-rise max-h-[70vh] overflow-y-auto" data-testid="mobile-more-menu">
          {MORE.map(([to, label, Icon, id]) => (
            <NavLink key={id} to={appPath(to)} className={({ isActive }) => `civr-nav-link ${isActive ? 'active' : ''}`} data-testid={`mobile-${id}`}><Icon className="w-4 h-4" />{label}</NavLink>
          ))}
          {channelLink && <a href={channelLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="mobile-channel-link"><Send className="w-4 h-4" />Telegram channel</a>}
          <Link to={appPath('settings#suggest')} className="civr-nav-link" data-testid="mobile-suggest-link"><Lightbulb className="w-4 h-4" />Suggest a feature</Link>
        </div>
      )}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]" data-testid="mobile-bottom-nav">
        {MAIN.map(([to, , Icon, id]) => (
          <NavLink key={id} end={to === ''} to={appPath(to)} className={({ isActive }) => tab(isActive && !open)} data-testid={`mobile-${id}`}>
            <Icon className="w-5 h-5" />{id === 'nav-inbox' && <Badge n={unread} />}<span className="max-w-full truncate px-1">{SHORT[id]}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={tab(open || moreActive)} data-testid="mobile-nav-more"><MoreHorizontal className="w-5 h-5" />More</button>
      </nav>
    </>
  );
}
