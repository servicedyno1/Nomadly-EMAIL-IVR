import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Phone, Plus, LifeBuoy, Eye, EyeOff, Send } from 'lucide-react';
import { api, money } from './api';
import { useCivrAuth } from './AuthContext';
import { PreviewBanner } from './ui';
import { PrivacyProvider, PrivateBanner, usePrivacy } from './privacy';
import Softphone from './Softphone';
import MobileNav from './MobileNav';
import { NAV, appPath } from './nav';
import Dashboard from './pages/Dashboard';
import Numbers from './pages/Numbers';
import NumberDetail from './pages/NumberDetail';
import BuyNumber from './pages/BuyNumber';
import OrderStatus from './pages/buy/OrderStatus';
import Verification from './pages/Verification';
import AudioLibrary from './pages/AudioLibrary';
import QuickCall from './pages/QuickCall';
import { Campaigns, CampaignNew } from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import Wallet from './pages/Wallet';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import SipPage from './pages/Sip';
import { AiAgents, AiAgentEdit } from './pages/AiAgents';
import { cp } from './paths';
import { LangSwitcher, useLang } from './i18n';
import SupportChat from './SupportChat';

const ShellCtx = createContext(null);
export const useShell = () => useContext(ShellCtx);

const ICON_BTN = 'relative w-11 h-11 flex items-center justify-center rounded-full hover:bg-[#151515] transition-colors';

function SideNav() {
  return (
    <nav className="flex flex-col gap-6" data-testid="nav-header">
      {NAV.map(([group, items]) => (
        <div key={group} data-testid={`nav-group-${group.toLowerCase()}`}>
          <div className="px-3 mb-2 text-xs font-mono uppercase tracking-widest text-[#a1a1aa]">{group}</div>
          <div className="flex flex-col gap-1">
            {items.map(([to, label, Icon, id]) => (
              <NavLink key={id} end={to === ''} to={appPath(to)} className={({ isActive }) => `civr-nav-link ${isActive ? 'active' : ''}`} data-testid={id}>
                <Icon className="w-4 h-4" />{label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Sidebar({ supportLink, channelLink }) {
  return (
    <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-[#1a1a1a] px-4 py-6 overflow-y-auto">
      <Link to={cp('/app')} className="font-display text-3xl font-extrabold tracking-tight px-3 mb-8" data-testid="sidebar-logo">CLOUD<span className="text-[#34d399]">IVR</span></Link>
      <SideNav />
      <div className="mt-auto pt-6 space-y-1">
        {channelLink && <a href={channelLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="sidebar-channel-link"><Send className="w-4 h-4" />Telegram channel</a>}
        {supportLink && <a href={supportLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="sidebar-support-link"><LifeBuoy className="w-4 h-4" />Message support</a>}
      </div>
    </aside>
  );
}

function PrivateButton() {
  const { on, toggle } = usePrivacy();
  const Icon = on ? EyeOff : Eye;
  const tip = on ? 'Private mode on — tap to show numbers and messages' : 'Private mode — hide numbers and messages';
  return (
    <button onClick={toggle} aria-pressed={on} aria-label={tip} title={tip} data-testid="topbar-private-mode-button" data-private={on ? 'on' : 'off'}
      className={`${ICON_BTN} ${on ? 'text-[#c4b5fd] bg-[#a78bfa]/15 hover:bg-[#a78bfa]/25' : ''}`}><Icon className="w-5 h-5" /></button>
  );
}

function TopBar({ summary, onPhone }) {
  const { account, logout } = useCivrAuth();
  const nav = useNavigate();
  return (
    <header className="civr-glass sticky top-0 z-30 flex items-center gap-1 sm:gap-2 px-4 md:px-8 h-16">
      <Link to={cp('/app')} className="font-display text-xl sm:text-2xl font-extrabold tracking-tight mr-auto lg:hidden" data-testid="topbar-logo">CLOUD<span className="text-[#34d399]">IVR</span></Link>
      <div className="hidden lg:block mr-auto text-sm text-[#a1a1aa]" data-testid="topbar-greeting">Signed in as <span className="text-[#f4f4f5]">{account?.email}</span></div>
      <Link to={cp('/app/wallet')} className="civr-pill civr-pill-on !text-sm !normal-case !tracking-normal h-9" data-testid="topbar-balance">{money(summary?.balance)}</Link>
      <Link to={cp('/app/wallet')} className="civr-btn civr-btn-ghost civr-btn-sm !hidden md:!inline-flex" data-testid="topbar-add-funds-button"><Plus className="w-4 h-4" />Add funds</Link>
      <LangSwitcher testid="topbar-lang-switcher" />
      <PrivateButton />
      <Link to={cp('/app/inbox')} className={ICON_BTN} data-testid="topbar-inbox-button" aria-label="Inbox">
        <Bell className="w-5 h-5" />
        {summary?.unread > 0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#34d399] text-[#04130d] text-[11px] font-bold flex items-center justify-center" data-testid="topbar-unread-count">{summary.unread}</span>}
      </Link>
      <button onClick={onPhone} className={ICON_BTN} data-testid="topbar-softphone-button" aria-label="Browser phone"><Phone className="w-5 h-5" /></button>
      <button onClick={async () => { nav(cp(), { replace: true }); await logout(); }} className={ICON_BTN} data-testid="topbar-logout-button" aria-label="Sign out"><LogOut className="w-5 h-5" /></button>
    </header>
  );
}

export default function Shell() {
  const [summary, setSummary] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const refreshSummary = useCallback(() => api('/dashboard').then(setSummary).catch(() => {}), []);
  const { lang } = useLang();
  // Spoken IVR menus follow the app language (server swaps default greetings too).
  useEffect(() => { api('/prefs/lang', { method: 'PUT', body: { lang } }).catch(() => {}); }, [lang]);
  useEffect(() => {
    refreshSummary();
    api('/public/catalog').then(setCatalog).catch(() => {});
    const t = setInterval(refreshSummary, 30000);
    return () => clearInterval(t);
  }, [refreshSummary]);

  return (
    <ShellCtx.Provider value={{ summary, refreshSummary, catalog, openPhone: () => setPhoneOpen(true) }}>
     <PrivacyProvider>
      <div className="lg:flex">
        <Sidebar supportLink={catalog?.supportLink} channelLink={catalog?.channelLink} />
        <div className="flex-1 min-w-0">
          <PreviewBanner show={catalog?.dryRun} livePayments={catalog?.livePayments} />
          <TopBar summary={summary} onPhone={() => setPhoneOpen(o => !o)} />
          <PrivateBanner />
          <main className="px-4 md:px-8 pt-8 md:pt-10 pb-28 lg:pb-12 max-w-7xl mx-auto" data-testid="app-main">
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="numbers" element={<Numbers />} />
              <Route path="numbers/:phone" element={<NumberDetail />} />
              <Route path="sip" element={<SipPage />} />
              <Route path="buy" element={<BuyNumber />} />
              <Route path="orders/:id" element={<OrderStatus />} />
              <Route path="verification" element={<Verification />} />
              <Route path="audio" element={<AudioLibrary />} />
              <Route path="quick-call" element={<QuickCall />} />
              <Route path="ai-agents" element={<AiAgents />} />
              <Route path="ai-agents/new" element={<AiAgentEdit />} />
              <Route path="ai-agents/:id" element={<AiAgentEdit />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="campaigns/new" element={<CampaignNew />} />
              <Route path="campaigns/:id" element={<CampaignDetail />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to={cp('/app')} replace />} />
            </Routes>
          </main>
        </div>
      </div>
      <MobileNav />
      <Softphone open={phoneOpen} onClose={() => setPhoneOpen(false)} />
      <SupportChat supportLink={catalog?.supportLink} />
     </PrivacyProvider>
    </ShellCtx.Provider>
  );
}
