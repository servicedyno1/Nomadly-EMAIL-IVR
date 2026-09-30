import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import {
  BarChart3, Link2, Phone, Target, Wallet, Server, Cloud, ArrowUpRight,
  Activity, Database, Cpu, Boxes,
} from 'lucide-react';
import CloudPhoneJourney from './components/CloudPhoneJourney';
import URLShortenerDomainJourney from './components/URLShortenerDomainJourney';
import { AuthProvider, useAuth } from './components/panel/AuthContext';
import PanelLogin from './pages/PanelLogin';
import PanelDashboard from './pages/PanelDashboard';
import PhoneTestPage from './pages/PhoneTestPage';
import Storefront from './pages/Storefront';
import SalesDashboard from './pages/SalesDashboard';
import BRAND from './branding';
import './App.css';
import './panel-v2.css';
import './store.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const PANEL_DOMAIN = (process.env.REACT_APP_PANEL_DOMAIN || 'panel.hostbay.io').toLowerCase();

// Detect if we're on the dedicated panel domain (matches panel.hostbay.io,
// panel.1.hostbay.io, or any "panel.*" host so the storefront is the landing).
const _host = window.location.hostname.toLowerCase();
const isPanelDomain = _host === PANEL_DOMAIN || _host.startsWith('panel.');

const VIEWS = {
  DASHBOARD: 'dashboard',
  CLOUD_PHONE: 'cloud_phone',
  URL_SHORTENER: 'url_shortener',
};

function PanelRoute() {
  const { user } = useAuth();
  return user ? <PanelDashboard /> : <PanelLogin />;
}

const STATUS_STYLES = {
  online: 'border-[#00E599]/25 bg-[#00E599]/10 text-[#00E599]',
  loading: 'border-[#00C2FF]/25 bg-[#00C2FF]/10 text-[#00C2FF]',
  degraded: 'border-[#FFB800]/25 bg-[#FFB800]/10 text-[#FFB800]',
  offline: 'border-[#FF3366]/25 bg-[#FF3366]/10 text-[#FF3366]',
};

function Eyebrow({ children }) {
  return (
    <div className="flex items-center gap-4">
      <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#71717A]">{children}</span>
      <span className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

function MainApp() {
  const [status, setStatus] = useState('loading');
  const [botHealth, setBotHealth] = useState(null);
  const [activeView, setActiveView] = useState(VIEWS.DASHBOARD);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/health`);
        if (res.ok) {
          const data = await res.json();
          setBotHealth(data);
          setStatus('online');
        } else {
          setStatus('degraded');
        }
      } catch {
        setStatus('offline');
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { view: VIEWS.DASHBOARD, label: 'Dashboard', testid: 'nav-dashboard' },
    { view: VIEWS.URL_SHORTENER, label: 'URL & Domains', testid: 'nav-url-shortener' },
    { view: VIEWS.CLOUD_PHONE, label: 'Cloud Phone', testid: 'nav-cloud-phone' },
  ];

  return (
    <div className="app-root min-h-screen bg-[#09090B] text-[#FAFAFA]" data-testid="app-root">
      <div className="grain-overlay" aria-hidden="true" />

      <header className="sticky top-0 z-40 backdrop-blur-2xl bg-[#09090B]/75 border-b border-white/[0.06]" data-testid="header">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button
              onClick={() => setActiveView(VIEWS.DASHBOARD)}
              data-testid="logo-home-btn"
              className={`w-9 h-9 rounded-lg flex items-center justify-center font-heading font-extrabold text-base transition-transform duration-200 hover:scale-105 ${BRAND.logoUrl ? 'bg-transparent' : 'bg-[#00E599] text-[#09090B]'}`}
            >
              {BRAND.logoUrl
                ? <img src={BRAND.logoUrl} alt={BRAND.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : (BRAND.name || 'N').charAt(0)}
            </button>
            <button
              onClick={() => setActiveView(VIEWS.DASHBOARD)}
              className="hidden sm:block font-heading font-bold tracking-tight text-[15px] text-[#FAFAFA]"
            >
              {BRAND.botName}
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <nav className="flex items-center gap-0.5 p-1 bg-[#121214] border border-white/[0.06] rounded-lg overflow-x-auto no-scrollbar" data-testid="header-nav">
              {navItems.map((n) => (
                <button
                  key={n.view}
                  onClick={() => setActiveView(n.view)}
                  data-testid={n.testid}
                  className={`px-3 py-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors duration-200 ${
                    activeView === n.view ? 'bg-white/[0.08] text-[#FAFAFA]' : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
                  }`}
                >
                  {n.label}
                </button>
              ))}
              <a
                href="/sales"
                data-testid="nav-sales"
                className="px-3 py-1.5 rounded-md text-[13px] font-medium whitespace-nowrap text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors duration-200"
              >
                Sales &amp; Profit
              </a>
            </nav>

            <div
              data-testid="status-badge"
              data-status={status}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-mono text-[11px] uppercase tracking-wide shrink-0 ${STATUS_STYLES[status]}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              <span className="hidden sm:inline">
                {status === 'loading' ? 'Checking' : status}
              </span>
            </div>
          </div>
        </div>
      </header>

      {activeView === VIEWS.DASHBOARD && (
        <main className="max-w-6xl mx-auto px-4 sm:px-8" data-testid="main-content">
          <section className="pt-14 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both">
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#00E599] mb-5">Admin — Control Center</p>
            <h1 className="font-heading text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05] max-w-2xl">
              Telegram Bot Admin
            </h1>
            <p className="text-[#A1A1AA] text-sm sm:text-base mt-4 max-w-xl leading-relaxed">
              Everything your bot business runs on — one quiet, fast control room.
            </p>
            <div className="flex flex-wrap gap-2 mt-6">
              {['URL Shortening', 'Domain Sales', 'Phone Leads', 'Crypto Payments', 'Cloud Phone'].map((s) => (
                <span key={s} className="px-2.5 py-1 rounded-md bg-[#121214] border border-white/[0.06] font-mono text-[11px] text-[#71717A]">
                  {s}
                </span>
              ))}
            </div>
          </section>

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both" style={{ animationDelay: '120ms' }}>
            <Eyebrow>System</Eyebrow>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5 mb-14" data-testid="stats-grid">
              <StatCard icon={Activity} title="Bot Status" value={status === 'online' ? 'Running' : status === 'loading' ? '...' : 'Stopped'} detail="Telegram Bot Engine" accent="emerald" />
              <StatCard icon={Database} title="Database" value={botHealth?.database === 'connected' || botHealth?.db === 'connected' ? 'Connected' : status === 'loading' ? '...' : 'N/A'} detail="MongoDB Instance" accent="sky" />
              <StatCard icon={Cpu} title="REST APIs" value={status === 'online' ? 'Active' : status === 'loading' ? '...' : 'Inactive'} detail="Express Server" accent="violet" />
              <StatCard icon={Boxes} title="Services" value="5+" detail="Integrated Modules" accent="amber" />
            </div>
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both" style={{ animationDelay: '240ms' }}>
            <Eyebrow>Services</Eyebrow>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5 mb-16" data-testid="features-grid">
              <FeatureCard icon="chart" title="Sales & Profit Dashboard" desc="Live revenue, cost and profit-margin analytics across every service with charts and CSV export" onClick={() => { window.location.href = '/sales'; }} />
              <FeatureCard icon="link" title="URL Shortener & Domains" desc="Domain purchase with shortener integration, custom branded links, DNS management" onClick={() => setActiveView(VIEWS.URL_SHORTENER)} />
              <FeatureCard icon="phone" title="Cloud Phone" desc="Virtual numbers, SMS to Telegram, call forwarding, voicemail, SIP access" onClick={() => setActiveView(VIEWS.CLOUD_PHONE)} />
              <FeatureCard icon="target" title="Targeted Leads" desc="Premium verified phone leads with carrier filtering and CNAM lookup" />
              <FeatureCard icon="wallet" title="Wallet System" desc="USD & NGN deposits via crypto (8 currencies) and bank transfer" />
              <FeatureCard icon="server" title="Offshore Hosting" desc="cPanel & Plesk plans with free trial, domain registration" />
              <FeatureCard icon="cloud" title="VPS Plans" desc="Virtual private servers with hourly billing and SSH key management" />
            </div>
          </div>
        </main>
      )}

      {activeView === VIEWS.URL_SHORTENER && (
        <main className="max-w-6xl mx-auto px-4 sm:px-8 py-10" data-testid="url-shortener-view">
          <URLShortenerDomainJourney />
        </main>
      )}

      {activeView === VIEWS.CLOUD_PHONE && (
        <main className="max-w-6xl mx-auto px-4 sm:px-8 py-10" data-testid="cloud-phone-view">
          <CloudPhoneJourney />
        </main>
      )}

      <footer className="border-t border-white/[0.06] mt-8" data-testid="footer">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] text-[#71717A]">{BRAND.botName} Admin Panel</p>
          <p className="font-mono text-[11px] text-[#71717A]">Powered by {BRAND.poweredBy}</p>
        </div>
      </footer>
    </div>
  );
}

const STAT_TINTS = {
  emerald: 'text-[#00E599]',
  sky: 'text-[#00C2FF]',
  violet: 'text-[#A78BFA]',
  amber: 'text-[#FFB800]',
};

function StatCard({ icon: Icon, title, value, detail, accent }) {
  return (
    <div className="bg-[#121214] border border-white/[0.06] rounded-xl p-5 hover:border-white/[0.14] transition-colors duration-300" data-testid={`stat-card-${accent}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[#A1A1AA] font-medium">{title}</span>
        <Icon className={`w-4 h-4 ${STAT_TINTS[accent]} opacity-80`} />
      </div>
      <div className={`font-mono text-lg sm:text-xl font-semibold tracking-tight ${STAT_TINTS[accent]}`}>{value}</div>
      <div className="text-[#71717A] text-xs mt-1.5">{detail}</div>
    </div>
  );
}

const FEATURE_ICONS = {
  chart: BarChart3, link: Link2, phone: Phone, target: Target,
  wallet: Wallet, server: Server, cloud: Cloud,
};

function FeatureCard({ icon, title, desc, onClick }) {
  const Icon = FEATURE_ICONS[icon];
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      data-testid={`feature-card-${icon}`}
      className={`group bg-[#121214] border border-white/[0.06] rounded-xl p-6 transition duration-200 ${
        clickable ? 'cursor-pointer hover:border-[#00E599]/40 hover:-translate-y-0.5' : 'hover:border-white/[0.12]'
      }`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-5 bg-white/[0.04] text-[#A1A1AA] transition-colors duration-200 ${clickable ? 'group-hover:bg-[#00E599]/10 group-hover:text-[#00E599]' : ''}`}>
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <h3 className="font-heading font-semibold text-[15px] tracking-tight mb-1.5 text-[#FAFAFA]">{title}</h3>
      <p className="text-[#A1A1AA] text-[13px] leading-relaxed">{desc}</p>
      {clickable && (
        <span className="inline-flex items-center gap-1 mt-4 font-mono text-[11px] uppercase tracking-wide text-[#00E599] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition duration-200">
          Open <ArrowUpRight className="w-3 h-3" />
        </span>
      )}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    if (BRAND.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = BRAND.faviconUrl;
    }
  }, []);
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {isPanelDomain ? (
            <>
              {/* On the panel domain, the STOREFRONT is the landing (buy + login). */}
              <Route path="/" element={<Storefront />} />
              <Route path="/store" element={<Storefront />} />
              <Route path="/store/*" element={<Storefront />} />
              <Route path="/panel" element={<PanelRoute />} />
              <Route path="/panel/*" element={<PanelRoute />} />
              <Route path="/*" element={<Storefront />} />
            </>
          ) : (
            <>
              <Route path="/panel" element={<PanelRoute />} />
              <Route path="/panel/*" element={<PanelRoute />} />
              <Route path="/store" element={<Storefront />} />
              <Route path="/store/*" element={<Storefront />} />
              <Route path="/phone/test" element={<PhoneTestPage />} />
              <Route path="/call" element={<PhoneTestPage />} />
              <Route path="/sales" element={<SalesDashboard />} />
              <Route path="/*" element={<MainApp />} />
            </>
          )}
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
