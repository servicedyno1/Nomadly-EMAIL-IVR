import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { Bell, Gauge, Hash, ShoppingCart, PhoneOutgoing, Megaphone, Music, Wallet as WalletIcon, Settings as Cog, LogOut, Phone, Inbox as InboxIcon } from 'lucide-react';
import { api, money } from './api';
import { useCivrAuth } from './AuthContext';
import { PreviewBanner } from './ui';
import Softphone from './Softphone';
import Dashboard from './pages/Dashboard';
import Numbers from './pages/Numbers';
import NumberDetail from './pages/NumberDetail';
import BuyNumber from './pages/BuyNumber';
import Verification from './pages/Verification';
import AudioLibrary from './pages/AudioLibrary';
import QuickCall from './pages/QuickCall';
import { Campaigns, CampaignNew } from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import Wallet from './pages/Wallet';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import { cp } from './paths';

const ShellCtx = createContext(null);
export const useShell = () => useContext(ShellCtx);

const NAV = [
  ['', 'Overview', Gauge, 'nav-dashboard'],
  ['numbers', 'My numbers', Hash, 'nav-numbers'],
  ['buy', 'Buy a number', ShoppingCart, 'nav-buy'],
  ['quick-call', 'Quick IVR call', PhoneOutgoing, 'nav-quick-call'],
  ['campaigns', 'Campaigns', Megaphone, 'nav-campaigns'],
  ['audio', 'Audio library', Music, 'nav-audio'],
  ['inbox', 'Inbox', InboxIcon, 'nav-inbox'],
  ['wallet', 'Wallet', WalletIcon, 'nav-wallet'],
  ['settings', 'Settings', Cog, 'nav-settings'],
];

function SideNav() {
  return (
    <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible" data-testid="nav-header">
      {NAV.map(([to, label, Icon, id]) => (
        <NavLink key={id} end={to === ''} to={cp(`/app/${to}`)} className={({ isActive }) => `civr-nav-link shrink-0 ${isActive ? 'active' : ''}`} data-testid={id}>
          <Icon className="w-4 h-4" />{label}
        </NavLink>
      ))}
    </nav>
  );
}

function TopBar({ summary, onPhone }) {
  const { account, logout } = useCivrAuth();
  const nav = useNavigate();
  return (
    <header className="civr-glass sticky top-0 z-30 flex items-center gap-3 px-4 md:px-8 h-16">
      <Link to={cp('/app')} className="font-display text-2xl font-extrabold tracking-tight mr-auto lg:hidden" data-testid="topbar-logo">CLOUD<span className="text-[#34d399]">IVR</span></Link>
      <div className="hidden lg:block mr-auto text-sm text-[#888]" data-testid="topbar-greeting">Signed in as <span className="text-[#ddd]">{account?.email}</span></div>
      <Link to={cp('/app/wallet')} className="civr-pill civr-pill-on !text-sm !normal-case !tracking-normal" data-testid="topbar-balance">{money(summary?.balance)}</Link>
      <Link to={cp('/app/inbox')} className="relative p-2 rounded-full hover:bg-[#151515]" data-testid="topbar-inbox-button" aria-label="Inbox">
        <Bell className="w-5 h-5" />
        {summary?.unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#34d399] text-[#04130d] text-[10px] font-bold flex items-center justify-center" data-testid="topbar-unread-count">{summary.unread}</span>}
      </Link>
      <button onClick={onPhone} className="p-2 rounded-full hover:bg-[#151515]" data-testid="topbar-softphone-button" aria-label="Browser phone"><Phone className="w-5 h-5" /></button>
      <button onClick={async () => { await logout(); nav(cp()); }} className="p-2 rounded-full hover:bg-[#151515]" data-testid="topbar-logout-button" aria-label="Sign out"><LogOut className="w-5 h-5" /></button>
    </header>
  );
}

export default function Shell() {
  const [summary, setSummary] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const refreshSummary = useCallback(() => api('/dashboard').then(setSummary).catch(() => {}), []);
  useEffect(() => {
    refreshSummary();
    api('/catalog').then(setCatalog).catch(() => {});
    const t = setInterval(refreshSummary, 30000);
    return () => clearInterval(t);
  }, [refreshSummary]);

  return (
    <ShellCtx.Provider value={{ summary, refreshSummary, catalog, openPhone: () => setPhoneOpen(true) }}>
      <PreviewBanner show={catalog?.dryRun} livePayments={catalog?.livePayments} />
      <div className="lg:flex">
        <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-[#1a1a1a] px-4 py-6">
          <Link to={cp('/app')} className="font-display text-3xl font-extrabold tracking-tight px-3 mb-8" data-testid="sidebar-logo">CLOUD<span className="text-[#34d399]">IVR</span></Link>
          <SideNav />
          <div className="mt-auto px-3 text-[11px] font-mono text-[#555] uppercase tracking-widest">Speechcue network</div>
        </aside>
        <div className="flex-1 min-w-0">
          <TopBar summary={summary} onPhone={() => setPhoneOpen(o => !o)} />
          <div className="lg:hidden px-4 py-3 border-b border-[#1a1a1a]"><SideNav /></div>
          <main className="px-4 md:px-8 py-8 md:py-10 max-w-7xl" data-testid="app-main">
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="numbers" element={<Numbers />} />
              <Route path="numbers/:phone" element={<NumberDetail />} />
              <Route path="buy" element={<BuyNumber />} />
              <Route path="verification" element={<Verification />} />
              <Route path="audio" element={<AudioLibrary />} />
              <Route path="quick-call" element={<QuickCall />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="campaigns/new" element={<CampaignNew />} />
              <Route path="campaigns/:id" element={<CampaignDetail />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>
      <Softphone open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </ShellCtx.Provider>
  );
}
