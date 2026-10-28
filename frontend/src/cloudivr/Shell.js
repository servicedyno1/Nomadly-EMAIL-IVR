import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ThemeRoot, ThemeButton } from './theme';
import { NavLink, Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Phone, Plus, LifeBuoy, Eye, EyeOff, Send, Lightbulb, HelpCircle, Search } from 'lucide-react';
import { api, money } from './api';
import { useCivrAuth } from './AuthContext';
import { PreviewBanner } from './ui';
import { PrivacyProvider, PrivateBanner, usePrivacy } from './privacy';
import Softphone from './Softphone';
import { RtcProvider } from './rtc';
import { IncomingCalls } from './Incoming';
import { UpgradeHost } from './Upgrade';
import MobileNav from './MobileNav';
import { Wordmark } from './Brand';
import { NAV, appPath } from './nav';
import Dashboard from './pages/Dashboard';
import Numbers from './pages/Numbers';
import NumberDetail from './pages/NumberDetail';
import BuyNumber from './pages/BuyNumber';
import OrderStatus from './pages/buy/OrderStatus';
import Verification from './pages/Verification';
import AudioLibrary from './pages/AudioLibrary';
import QuickCall from './pages/QuickCall';
import Contacts from './pages/Contacts';
import Texting from './pages/Texting';
import TextCall from './pages/TextCall';
import { Campaigns, CampaignNew } from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import Live from './pages/Live';
import DoNotCall from './pages/DoNotCall';
import Wallet from './pages/Wallet';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import SipPage from './pages/Sip';
import { AiAgents, AiAgentEdit } from './pages/AiAgents';
import { cp } from './paths';
import { LangSwitcher, useLang } from './i18n';
import SupportChat from './SupportChat';
import AdminSuggestions from './pages/AdminSuggestions';
import Help from './pages/Help';
import { CrashGuard, CrashProbe, OfflineBanner } from './safety';
import { UpdateBanner } from './update';
import { WhatsNew } from './WhatsNew';
import { UnsavedGuard, confirmLeave } from './guard';
import { Shortcuts, helpFor } from './shortcuts';
import { Palette, openPalette, isMac } from './Palette';

const ShellCtx = createContext(null);
export const useShell = () => useContext(ShellCtx);

const ICON_BTN = 'relative w-11 h-11 shrink-0 flex items-center justify-center rounded-full hover:bg-[#151515] transition-colors';

export function FreeBadge() {
  const shell = useContext(ShellCtx);
  if (!shell?.summary?.ivrTrial) return null;
  return <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#6366f1] text-white" data-testid="nav-quick-call-free-badge">1 free</span>;
}

// Green dot on "Live" while a campaign is calling.
export function LiveDot({ testid = 'nav-live-dot' }) {
  const shell = useContext(ShellCtx);
  if (!(shell?.summary?.liveCampaigns > 0)) return null;
  return <span className="ml-auto w-2 h-2 rounded-full bg-[#34d399] civr-live-dot" role="img" aria-label="Calling now" title="Calling now" data-testid={testid} />;
}

function SideNav() {
  return (
    <nav className="flex flex-col gap-6" data-testid="nav-header">
      {NAV.map(([group, items]) => (
        <div key={group} data-testid={`nav-group-${group.toLowerCase()}`}>
          <div className="px-3 mb-2 text-xs font-mono uppercase tracking-widest text-[#a1a1aa]">{group}</div>
          <div className="flex flex-col gap-1">
            {items.map(([to, label, Icon, id]) => (
              <NavLink key={id} end={to === ''} to={appPath(to)} className={({ isActive }) => `civr-nav-link ${isActive ? 'active' : ''}`} data-testid={id}>
                <Icon className="w-4 h-4" />{label}{id === 'nav-quick-call' && <FreeBadge />}{id === 'nav-live' && <LiveDot />}
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
      <Link to={cp('/app')} className="font-display text-3xl font-extrabold tracking-tight px-3 mb-8 flex items-center gap-2.5" data-testid="sidebar-logo"><Wordmark iconClass="w-10 h-10" /></Link>
      <SideNav />
      <div className="mt-auto pt-6 flex flex-col gap-1" data-testid="nav-group-support">
        <div className="px-3 mb-1 text-xs font-mono uppercase tracking-widest text-[#a1a1aa]">Support</div>
        {channelLink && <a href={channelLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="sidebar-channel-link"><Send className="w-4 h-4" />Telegram channel</a>}
        <Link to={cp('/app/settings#suggest')} className="civr-nav-link" data-testid="sidebar-suggest-link"><Lightbulb className="w-4 h-4" />Suggest a feature</Link>
        {supportLink && <a href={supportLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="sidebar-support-link"><LifeBuoy className="w-4 h-4" />Message support</a>}
      </div>
    </aside>
  );
}

function PrivateButton({ className = '' }) {
  const { on, toggle } = usePrivacy();
  const Icon = on ? EyeOff : Eye;
  const tip = on ? 'Private mode on — tap to show numbers and messages' : 'Private mode — hide numbers and messages';
  return (
    <button onClick={toggle} aria-pressed={on} aria-label={tip} title={tip} data-testid="topbar-private-mode-button" data-private={on ? 'on' : 'off'}
      className={`${ICON_BTN} ${className} ${on ? 'text-[#c4b5fd] bg-[#a78bfa]/15 hover:bg-[#a78bfa]/25' : ''}`}><Icon className="w-5 h-5" /></button>
  );
}

// Phones keep only balance, inbox and the browser phone here; language, private mode and sign-out live in the More menu.
function TopBar({ summary, onPhone }) {
  const { account, logout } = useCivrAuth();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  return (
    <header className="civr-glass sticky top-0 z-30 flex items-center gap-0.5 min-[400px]:gap-1 sm:gap-2 px-3 sm:px-4 md:px-8 h-16" data-civr-topbar>
      <Link to={cp('/app')} className="font-display text-xl sm:text-2xl font-extrabold tracking-tight mr-auto lg:hidden min-h-[44px] min-w-0 flex items-center gap-2" aria-label="CloudIVR home" data-testid="topbar-logo"><Wordmark iconClass="w-8 h-8" textClass="max-[379px]:sr-only" /></Link>
      <div className="hidden lg:block xl:hidden mr-auto" aria-hidden="true" />
      <div className="hidden xl:block mr-auto min-w-0 truncate text-sm text-[#a1a1aa]" title={account?.email} data-testid="topbar-greeting">Signed in as <span className="text-[#f4f4f5]">{account?.email}</span></div>
      <Link to={cp('/app/wallet')} className="civr-pill civr-pill-on !text-sm !normal-case !tracking-normal h-10 shrink-0 !px-3.5" data-testid="topbar-balance">{money(summary?.balance)}</Link>
      <Link to={cp('/app/wallet')} className="civr-btn civr-btn-ghost civr-btn-sm !hidden md:!inline-flex" data-testid="topbar-add-funds-button"><Plus className="w-4 h-4" />Add funds</Link>
      <LangSwitcher testid="topbar-lang-switcher" className="hidden lg:inline-flex" />
      <PrivateButton className="hidden lg:flex" />
      <ThemeButton className={`${ICON_BTN} hidden lg:flex`} />
      <button type="button" onClick={openPalette} className={ICON_BTN} data-testid="topbar-search-button" aria-label="Jump to a number, page or action" title={`Jump to… (${isMac ? '⌘' : 'Ctrl'} K)`}><Search className="w-5 h-5" /></button>
      <Link to={helpFor(pathname, search)} className={`${ICON_BTN} hidden sm:flex`} data-testid="topbar-help-button" aria-label="Help for this page" title="Help for this page (?)"><HelpCircle className="w-5 h-5" /></Link>
      <Link to={cp('/app/inbox')} className={ICON_BTN} data-testid="topbar-inbox-button" aria-label="Inbox">
        <Bell className="w-5 h-5" />
        {summary?.unread > 0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#6366f1] text-white text-[11px] font-bold flex items-center justify-center" data-testid="topbar-unread-count">{summary.unread > 99 ? '99+' : summary.unread}</span>}
      </Link>
      <button onClick={onPhone} className={ICON_BTN} data-testid="topbar-softphone-button" aria-label="Browser phone"><Phone className="w-5 h-5" /></button>
      <button onClick={async () => { if (!(await confirmLeave())) return; nav(cp(), { replace: true }); await logout(); }} className={`${ICON_BTN} hidden lg:flex`} data-testid="topbar-logout-button" aria-label="Sign out"><LogOut className="w-5 h-5" /></button>
    </header>
  );
}

export default function Shell() {
  const [summary, setSummary] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const refreshSummary = useCallback(() => api('/dashboard').then(setSummary).catch(() => {}), []);
  const openPhone = useCallback(() => setPhoneOpen(true), []);
  const closePhone = useCallback(() => setPhoneOpen(false), []);
  const { pathname } = useLocation();
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
    <ShellCtx.Provider value={{ summary, refreshSummary, catalog, openPhone }}>
     <PrivacyProvider>
     <RtcProvider>
      <ThemeRoot />
      <IncomingCalls openPhone={openPhone} />
      <UpgradeHost />
      <UnsavedGuard />
      <Shortcuts onEscape={closePhone} />
      <Palette openPhone={openPhone} />
      <div className="lg:flex">
        <Sidebar supportLink={catalog?.supportLink} channelLink={catalog?.channelLink} />
        <div className="flex-1 min-w-0">
          <PreviewBanner show={catalog?.dryRun} livePayments={catalog?.livePayments} />
          <OfflineBanner />
          <UpdateBanner />
          <TopBar summary={summary} onPhone={() => setPhoneOpen(o => !o)} />
          <PrivateBanner />
          <main className="px-4 md:px-8 min-[1800px]:px-12 pt-8 md:pt-10 pb-40 lg:pb-12 max-w-7xl min-[1600px]:max-w-[1440px] min-[1800px]:max-w-[1640px] min-[2300px]:max-w-[1880px] mx-auto" data-testid="app-main">
           <CrashGuard inApp resetKey={pathname} supportLink={catalog?.supportLink}>
            <CrashProbe />
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="numbers" element={<Numbers />} />
              <Route path="numbers/:phone" element={<NumberDetail />} />
              <Route path="sip" element={<SipPage />} />
              <Route path="buy" element={<BuyNumber />} />
              <Route path="orders/:id" element={<OrderStatus />} />
              <Route path="verification" element={<Verification />} />
              <Route path="audio" element={<AudioLibrary />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="texting" element={<Texting />} />
              <Route path="quick-call" element={<QuickCall />} />
              <Route path="text-call" element={<TextCall />} />
              <Route path="ai-agents" element={<AiAgents />} />
              <Route path="ai-agents/new" element={<AiAgentEdit />} />
              <Route path="ai-agents/:id" element={<AiAgentEdit />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="campaigns/new" element={<CampaignNew />} />
              <Route path="campaigns/:id" element={<CampaignDetail />} />
              <Route path="live" element={<Live />} />
              <Route path="do-not-call" element={<DoNotCall />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="settings" element={<Settings />} />
              <Route path="admin/suggestions" element={<AdminSuggestions />} />
              <Route path="help" element={<Help />} />
              <Route path="*" element={<Navigate to={cp('/app')} replace />} />
            </Routes>
           </CrashGuard>
          </main>
        </div>
      </div>
      <MobileNav />
      <Softphone open={phoneOpen} onClose={closePhone} />
      <SupportChat supportLink={catalog?.supportLink} />
      <WhatsNew />
     </RtcProvider>
     </PrivacyProvider>
    </ShellCtx.Provider>
  );
}
