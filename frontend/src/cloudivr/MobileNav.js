import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Globe, Lightbulb, LogOut, MoreHorizontal, Send } from 'lucide-react';
import { NAV_ITEMS, appPath } from './nav';
import { useShell } from './Shell';
import { useCivrAuth } from './AuthContext';
import { usePrivacy } from './privacy';
import { LangSwitcher, useLang } from './i18n';
import { cp } from './paths';

const SHORT = { 'nav-dashboard': 'Overview', 'nav-numbers': 'Numbers', 'nav-inbox': 'Inbox', 'nav-wallet': 'Wallet' };
// Tab labels whose translation is too long for a 5-column phone bar.
const NARROW = { fr: { 'nav-inbox': 'Messages' }, es: { 'nav-inbox': 'Mensajes' } };
const MAIN = ['nav-dashboard', 'nav-numbers', 'nav-inbox', 'nav-wallet'].map(id => NAV_ITEMS.find(x => x[3] === id));
const MORE = NAV_ITEMS.filter(([, , , id]) => !SHORT[id]);
const tab = (active) => `relative min-w-0 flex flex-col items-center justify-center gap-1 h-16 text-xs font-medium transition-colors ${active ? 'text-[#34d399]' : 'text-[#a1a1aa]'}`;

const Badge = ({ n }) => (n > 0 ? <span className="absolute top-2 left-1/2 ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ef4444] text-white text-[11px] font-bold flex items-center justify-center" data-testid="mobile-inbox-unread">{n > 99 ? '99+' : n}</span> : null);

// Language, private mode and sign-out (kept out of the slim phone top bar).
function MoreSettings() {
  const { on, toggle } = usePrivacy();
  const { logout } = useCivrAuth();
  const nav = useNavigate();
  const EyeIcon = on ? EyeOff : Eye;
  return (
    <div className="mt-2 pt-2 border-t border-[#1f1f1f] space-y-1" data-testid="mobile-more-settings">
      <div className="flex items-center justify-between gap-3 pl-3 min-h-[44px] text-sm font-medium text-[#d4d4d8]"><span className="flex items-center gap-3"><Globe className="w-4 h-4" />Language</span><LangSwitcher testid="mobile-lang-switcher" /></div>
      <button type="button" role="switch" aria-checked={on} onClick={toggle} className="civr-nav-link w-full justify-between" data-testid="mobile-private-mode-button" data-private={on ? 'on' : 'off'}>
        <span className="flex items-center gap-3 text-left"><EyeIcon className={`w-4 h-4 shrink-0 ${on ? 'text-[#c4b5fd]' : ''}`} /><span>Private mode<span className="block text-xs font-normal text-[#a1a1aa]">Hide numbers and messages</span></span></span>
        <span className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${on ? 'bg-[#a78bfa]' : 'bg-[#2a2a2a]'}`}><span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} /></span>
      </button>
      <button type="button" onClick={async () => { nav(cp(), { replace: true }); await logout(); }} className="civr-nav-link w-full !text-[#fb7185]" data-testid="mobile-logout-button"><LogOut className="w-4 h-4" />Sign out</button>
    </div>
  );
}

// Phone-sized screens: bottom tab bar with Overview, Numbers, Inbox, Wallet + a "More" menu for the rest.
export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const shell = useShell();
  const channelLink = shell?.catalog?.channelLink;
  const unread = shell?.summary?.unread || 0;
  const { lang } = useLang();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const moreActive = MORE.some(([to]) => pathname.startsWith(appPath(to)));
  return (
    <>
      {open && <button type="button" aria-label="Close menu" className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)} data-testid="mobile-more-backdrop" />}
      {open && (
        <div className="lg:hidden fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 civr-card p-2 civr-rise max-h-[calc(100dvh-9rem)] overflow-y-auto overscroll-contain" data-testid="mobile-more-menu">
          {MORE.map(([to, label, Icon, id]) => (
            <NavLink key={id} to={appPath(to)} className={({ isActive }) => `civr-nav-link ${isActive ? 'active' : ''}`} data-testid={`mobile-${id}`}><Icon className="w-4 h-4" />{label}</NavLink>
          ))}
          {channelLink && <a href={channelLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="mobile-channel-link"><Send className="w-4 h-4" />Telegram channel</a>}
          <Link to={appPath('settings#suggest')} className="civr-nav-link" data-testid="mobile-suggest-link"><Lightbulb className="w-4 h-4" />Suggest a feature</Link>
          <MoreSettings />
        </div>
      )}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]" data-testid="mobile-bottom-nav">
        {MAIN.map(([to, , Icon, id]) => {
          const narrow = NARROW[lang]?.[id];
          return (
            <NavLink key={id} end={to === ''} to={appPath(to)} className={({ isActive }) => tab(isActive && !open)} data-testid={`mobile-${id}`}>
              <Icon className="w-5 h-5" />{id === 'nav-inbox' && <Badge n={unread} />}
              {narrow ? <span key={lang} className="max-w-full truncate px-1" data-no-translate>{narrow}</span> : <span className="max-w-full truncate px-1">{SHORT[id]}</span>}
            </NavLink>
          );
        })}
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={tab(open || moreActive)} data-testid="mobile-nav-more"><MoreHorizontal className="w-5 h-5" />More</button>
      </nav>
    </>
  );
}
