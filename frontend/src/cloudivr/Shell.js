import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ThemeRoot } from './theme';
import { Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { Bell, Phone, Plus, LifeBuoy, Send, Lightbulb, HelpCircle, Search, ChevronDown } from 'lucide-react';
import { api, money } from './api';
import { useCivrAuth } from './AuthContext';
import { PreviewBanner } from './ui';
import { PrivacyProvider, PrivateBanner } from './privacy';
import { AccountMenu } from './AccountMenu';
import Softphone from './Softphone';
import { RtcProvider } from './rtc';
import { IncomingCalls } from './Incoming';
import { UpgradeHost } from './Upgrade';
import MobileNav from './MobileNav';
import { Wordmark } from './Brand';
import { NAV, appPath, isSideActive } from './nav';
import SectionTabs, { AutoCrumbs } from './SectionTabs';
import Dashboard from './pages/Dashboard';
import AnswerCalls from './pages/AnswerCalls';
import Numbers from './pages/Numbers';
import NumberDetail from './pages/NumberDetail';
import BuyNumber from './pages/BuyNumber';
import OrderStatus from './pages/buy/OrderStatus';
import Verification from './pages/Verification';
import AudioLibrary from './pages/AudioLibrary';
import QuickCall from './pages/QuickCall';
import Contacts from './pages/Contacts';
import Texting from './pages/Texting';
import NumberLookup from './pages/NumberLookup';
import TravelEsim from './pages/TravelEsim';
import Esim from './pages/Esim';
import EsimLineDetail from './pages/esim/LineDetail';
import TextCall from './pages/TextCall';
import { Campaigns, CampaignNew } from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import Live from './pages/Live';
import DoNotCall from './pages/DoNotCall';
import Wallet from './pages/Wallet';
import Inbox from './pages/Inbox';
import Messages from './pages/Messages';
import Settings from './pages/Settings';
import SipPage from './pages/Sip';
import Fax from './pages/Fax';
import { AiAgents, AiAgentEdit } from './pages/AiAgents';
import Receptionist, { ReceptionistEdit } from './pages/Receptionist';
import { cp } from './paths';
import { useLang } from './i18n';
import SupportChat from './SupportChat';
import AdminSuggestions from './pages/AdminSuggestions';
import Help from './pages/Help';
import { CrashGuard, CrashProbe, OfflineBanner } from './safety';
import { UpdateBanner } from './update';
import { WhatsNew } from './WhatsNew';
import { ProfileBanner } from './profile/ProfilePrompts';
import { CardCheckBanner } from './compliance/CardCheck';
import { track } from './track';
import { UnsavedGuard } from './guard';
import { Shortcuts, helpFor } from './shortcuts';
import { Palette, openPalette, isMac } from './Palette';
import { Onboarding, useOnboarding } from './Onboarding';

const ShellCtx = createContext(null);
export const useShell = () => useContext(ShellCtx);

const ICON_BTN = 'relative w-11 h-11 shrink-0 flex items-center justify-center rounded-full hover:bg-[#151515] transition-colors';

export function FreeBadge() {
  const shell = useContext(ShellCtx);
  if (!shell?.summary?.ivrTrial) return null;
  return <span className="ml-auto text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#6366f1] text-white" data-testid="nav-quick-call-free-badge">1 free</span>;
}

// Green dot on "Live" while a campaign is calling.
export function LiveDot({ testid = 'nav-live-dot' }) {
  const shell = useContext(ShellCtx);
  if (!(shell?.summary?.liveCampaigns > 0)) return null;
  return <span className="ml-auto w-2 h-2 rounded-full bg-[#34d399] civr-live-dot" role="img" aria-label="Calling now" title="Calling now" data-testid={testid} />;
}

// One menu row: a page link, or (for "Browser phone") a button that opens the phone panel.
// Each menu group has its own icon colour (Bird-style product chips).
const TONE = { home: 'slate', numbers: 'blue', calls: 'amber', ai: 'violet', messaging: 'green', more: 'teal', tools: 'slate', account: 'slate' };
export function NavRow({ item, active, onPhone, testid, className = '', tone }) {
  const [to, label, Icon, id, sub] = item;
  const body = <>
    {tone ? <span className={`civr-chip civr-chip-${tone}`} aria-hidden><Icon className="w-3.5 h-3.5" /></span> : <Icon className="w-4 h-4" />}
    <span className="min-w-0 flex-1 leading-snug break-words">{label}{sub && <span className="civr-nav-sub" data-testid={`${testid || id}-sub`}>{sub}</span>}</span>
    {id === 'nav-calls' && <FreeBadge />}{id === 'nav-live' && <LiveDot />}{id === 'nav-messages' && <MsgBadge />}
  </>;
  if (to === '#phone') return <button type="button" onClick={onPhone} className={`civr-nav-link w-full text-left ${className}`} data-testid={testid || id}>{body}</button>;
  return <Link to={appPath(to)} aria-current={active ? 'page' : undefined} className={`civr-nav-link ${active ? 'active' : ''} ${className}`} data-testid={testid || id}>{body}</Link>;
}

function SideNav({ onPhone }) {
  const { pathname, search } = useLocation();
  const [shut, setShut] = useState(() => { try { return JSON.parse(localStorage.getItem('civr.navShut') || '{}'); } catch (_) { return {}; } });
  const toggle = (gid) => setShut(s => { const n = { ...s, [gid]: !s[gid] }; try { localStorage.setItem('civr.navShut', JSON.stringify(n)); } catch (_) {} return n; });
  return (
    <nav className="flex flex-col gap-3" data-testid="nav-header">
      <button type="button" onClick={openPalette} className="civr-side-search" data-testid="sidebar-search"><Search className="w-4 h-4" /><span className="flex-1 text-left">Search</span><kbd>⌘ K</kbd></button>
      {NAV.map(([gid, group, items]) => {
        const open = !shut[gid] || items.some(it => isSideActive(it, pathname, search));
        return (
          <div key={gid} data-testid={`nav-group-${gid}`}>
            {group && <button type="button" onClick={() => toggle(gid)} aria-expanded={open} className="civr-side-label civr-side-group w-full px-3 mb-1 flex items-center gap-1 text-[12px] font-medium text-[#a1a1aa]" data-testid={`nav-group-${gid}-toggle`}>{group}<ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} /></button>}
            {open && <div className="flex flex-col gap-0.5">
              {items.map((item) => <NavRow key={item[3]} item={item} tone={TONE[gid]} active={isSideActive(item, pathname, search)} onPhone={onPhone} />)}
            </div>}
          </div>
        );
      })}
    </nav>
  );
}

function Sidebar({ supportLink, channelLink, onPhone }) {
  return (
    <aside aria-label="Main navigation" className="civr-side hidden lg:flex lg:flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-[#1a1a1a] px-3 py-5 overflow-y-auto" data-testid="app-sidebar">
      <Link to={cp('/app')} className="civr-side-logo font-display text-2xl font-extrabold tracking-tight px-3 mb-6 flex items-center gap-2.5" data-testid="sidebar-logo"><Wordmark iconClass="w-8 h-8" /></Link>
      <SideNav onPhone={onPhone} />
      <div className="civr-side-rule mt-auto pt-4 border-t border-[#1a1a1a] flex flex-col gap-0.5" data-testid="nav-group-support">
        <div className="civr-side-label px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#a1a1aa]">Support</div>
        {channelLink && <a href={channelLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="sidebar-channel-link"><Send className="w-4 h-4" />Telegram channel</a>}
        <Link to={cp('/app/settings#suggest')} className="civr-nav-link" data-testid="sidebar-suggest-link"><Lightbulb className="w-4 h-4" />Suggest a feature</Link>
        {supportLink && <a href={supportLink} target="_blank" rel="noopener noreferrer" className="civr-nav-link" data-testid="sidebar-support-link"><LifeBuoy className="w-4 h-4" />Message support</a>}
      </div>
    </aside>
  );
}

// Phones keep only balance, inbox and the browser phone here; language, private mode and sign-out live in the More menu.
// Laptops get them in the account menu (avatar, top right).
function TopBar({ summary, onPhone }) {
  const { pathname, search } = useLocation();
  return (
    <header className="civr-glass sticky top-0 z-30 flex items-center gap-0.5 min-[400px]:gap-1 sm:gap-2 px-3 sm:px-4 md:px-8 h-16" data-civr-topbar>
      <Link to={cp('/app')} className="font-display text-xl sm:text-2xl font-extrabold tracking-tight mr-auto lg:hidden min-h-[44px] min-w-0 flex items-center gap-2" aria-label="CloudIVR home" data-testid="topbar-logo"><Wordmark iconClass="w-8 h-8" textClass="max-[379px]:sr-only" /></Link>
      <div className="hidden lg:block mr-auto" aria-hidden="true" />
      <Link to={cp('/app/wallet')} className="civr-pill civr-pill-on !text-sm !normal-case !tracking-normal h-10 shrink-0 !px-3.5" data-testid="topbar-balance">{money(summary?.balance)}</Link>
      <Link to={cp('/app/wallet')} className="civr-btn civr-btn-ghost civr-btn-sm !hidden md:!inline-flex" data-testid="topbar-add-funds-button"><Plus className="w-4 h-4" />Add funds</Link>
      <button type="button" onClick={openPalette} className={ICON_BTN} data-testid="topbar-search-button" aria-label="Jump to a number, page or action" title={`Jump to… (${isMac ? '⌘' : 'Ctrl'} K)`}><Search className="w-5 h-5" /></button>
      <Link to={helpFor(pathname, search)} className={`${ICON_BTN} hidden sm:flex`} data-testid="topbar-help-button" aria-label="Help for this page" title="Help for this page (?)"><HelpCircle className="w-5 h-5" /></Link>
      <Link to={cp('/app/inbox')} className={ICON_BTN} data-testid="topbar-inbox-button" aria-label="Notifications" title="Notifications">
        <Bell className="w-5 h-5" />
        {summary?.unread > 0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#6366f1] text-white text-xs font-bold flex items-center justify-center" data-testid="topbar-unread-count">{summary.unread > 99 ? '99+' : summary.unread}</span>}
      </Link>
      <button onClick={onPhone} className={ICON_BTN} data-testid="topbar-softphone-button" aria-label="Browser phone"><Phone className="w-5 h-5" /></button>
      <AccountMenu className="hidden lg:inline-flex ml-1" />
    </header>
  );
}

function MsgBadge() {
  const n = useShell()?.summary?.messagesUnread || 0;
  return n > 0 ? <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--c-accent-strong)] text-white text-xs font-bold flex items-center justify-center" data-testid="nav-messages-unread">{n > 99 ? '99+' : n}</span> : null;
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
  const onb = useOnboarding();
  useEffect(() => { track('page_view'); }, [pathname]);
  // Spoken IVR menus follow the app language (server swaps default greetings too).
  useEffect(() => { api('/prefs/lang', { method: 'PUT', body: { lang } }).catch(() => {}); }, [lang]);
  useEffect(() => {
    refreshSummary();
    api('/public/catalog').then(setCatalog).catch(() => {});
    const t = setInterval(refreshSummary, 30000);
    // The pay-the-difference window (outside the Shell) asks for a fresh balance after a payment lands.
    window.addEventListener('civr:wallet-changed', refreshSummary);
    return () => { clearInterval(t); window.removeEventListener('civr:wallet-changed', refreshSummary); };
  }, [refreshSummary]);

  return (
    <ShellCtx.Provider value={{ summary, refreshSummary, catalog, openPhone, onboarding: onb.data, setOnboarding: onb.setData }}>
     <PrivacyProvider>
     <RtcProvider>
      <ThemeRoot />
      <IncomingCalls openPhone={openPhone} />
      <UpgradeHost />
      <UnsavedGuard />
      <Shortcuts onEscape={closePhone} />
      <Palette openPhone={openPhone} />
      <Onboarding data={onb.data} setData={onb.setData} />
      <div className="lg:flex">
        <Sidebar supportLink={catalog?.supportLink} channelLink={catalog?.channelLink} onPhone={openPhone} />
        <div className="flex-1 min-w-0">
          <PreviewBanner show={catalog?.dryRun} livePayments={catalog?.livePayments} />
          <OfflineBanner />
          <UpdateBanner />
          <TopBar summary={summary} onPhone={() => setPhoneOpen(o => !o)} />
          <ProfileBanner />
          <CardCheckBanner />
          <PrivateBanner />
          <main className="px-4 md:px-8 min-[1800px]:px-12 pt-8 md:pt-10 pb-40 lg:pb-12 max-w-7xl min-[1600px]:max-w-[1440px] min-[1800px]:max-w-[1640px] min-[2300px]:max-w-[1880px] mx-auto" data-testid="app-main">
           <CrashGuard inApp resetKey={pathname} supportLink={catalog?.supportLink}>
            <CrashProbe />
            <SectionTabs />
            <AutoCrumbs />
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="answer/:mode" element={<AnswerCalls />} />
              <Route path="numbers" element={<Numbers />} />
              <Route path="numbers/:phone" element={<NumberDetail />} />
              <Route path="sip" element={<SipPage />} />
              <Route path="fax" element={<Fax />} />
              <Route path="buy" element={<BuyNumber />} />
              <Route path="orders/:id" element={<OrderStatus />} />
              <Route path="verification" element={<Verification />} />
              <Route path="audio" element={<AudioLibrary />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="texting" element={<Texting />} />
              <Route path="texting-number" element={<Navigate to={cp('/app/buy?purpose=texting&country=US')} replace />} />
              <Route path="international-texting" element={<Navigate to={cp('/app/buy?purpose=texting')} replace />} />
              <Route path="lookup" element={<NumberLookup />} />
              <Route path="travel-esim" element={<TravelEsim />} />
              <Route path="esim" element={<Esim />} />
              <Route path="esim/:id" element={<EsimLineDetail />} />
              <Route path="quick-call" element={<QuickCall />} />
              <Route path="text-call" element={<TextCall />} />
              <Route path="receptionist" element={<Receptionist />} />
              <Route path="receptionist/new" element={<ReceptionistEdit />} />
              <Route path="receptionist/:id" element={<ReceptionistEdit />} />
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
              <Route path="messages" element={<Messages />} />
              <Route path="settings" element={<Settings />} />
              <Route path="admin/suggestions" element={<AdminSuggestions />} />
              <Route path="help" element={<Help />} />
              <Route path="*" element={<Navigate to={cp('/app')} replace />} />
            </Routes>
           </CrashGuard>
          </main>
        </div>
      </div>
      <MobileNav onPhone={openPhone} />
      <Softphone open={phoneOpen} onClose={closePhone} />
      <SupportChat supportLink={catalog?.supportLink} />
      <WhatsNew />
     </RtcProvider>
     </PrivacyProvider>
    </ShellCtx.Provider>
  );
}
