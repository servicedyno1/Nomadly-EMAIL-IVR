import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CloudPhoneJourney from './components/CloudPhoneJourney';
import URLShortenerDomainJourney from './components/URLShortenerDomainJourney';
import { AuthProvider, useAuth } from './components/panel/AuthContext';
import PanelLogin from './pages/PanelLogin';
import PanelDashboard from './pages/PanelDashboard';
import PhoneTestPage from './pages/PhoneTestPage';
import Storefront from './pages/Storefront';
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

  return (
    <div className="app-root" data-testid="app-root">
      <div className="dashboard-container">
        <header className="header" data-testid="header">
          <div className="logo-section">
            <button className="logo-mark" onClick={() => setActiveView(VIEWS.DASHBOARD)} data-testid="logo-home-btn">N</button>
            <h1 className="logo-text">
              <button className="logo-text-btn" onClick={() => setActiveView(VIEWS.DASHBOARD)}>NomadlyBot</button>
            </h1>
          </div>
          <div className="header-right">
            <nav className="header-nav" data-testid="header-nav">
              <button
                className={`header-nav__btn ${activeView === VIEWS.DASHBOARD ? 'header-nav__btn--active' : ''}`}
                onClick={() => setActiveView(VIEWS.DASHBOARD)}
                data-testid="nav-dashboard"
              >
                Dashboard
              </button>
              <button
                className={`header-nav__btn ${activeView === VIEWS.URL_SHORTENER ? 'header-nav__btn--active' : ''}`}
                onClick={() => setActiveView(VIEWS.URL_SHORTENER)}
                data-testid="nav-url-shortener"
              >
                URL & Domains
              </button>
              <button
                className={`header-nav__btn ${activeView === VIEWS.CLOUD_PHONE ? 'header-nav__btn--active' : ''}`}
                onClick={() => setActiveView(VIEWS.CLOUD_PHONE)}
                data-testid="nav-cloud-phone"
              >
                Cloud Phone
              </button>
            </nav>
            <div className="status-badge" data-testid="status-badge" data-status={status}>
              <span className="status-dot"></span>
              <span className="status-label">
                {status === 'loading' ? 'Checking...' : status === 'online' ? 'Online' : status === 'degraded' ? 'Degraded' : 'Offline'}
              </span>
            </div>
          </div>
        </header>

        {activeView === VIEWS.DASHBOARD && (
          <main className="main-content" data-testid="main-content">
            <section className="hero-section">
              <h2 className="hero-title">Telegram Bot Admin</h2>
              <p className="hero-subtitle">
                URL Shortening &middot; Domain Sales &middot; Phone Leads &middot; Crypto Payments &middot; Cloud Phone
              </p>
            </section>

            <div className="stats-grid" data-testid="stats-grid">
              <StatCard title="Bot Status" value={status === 'online' ? 'Running' : status === 'loading' ? '...' : 'Stopped'} detail="Telegram Bot Engine" accent="emerald" />
              <StatCard title="Database" value={botHealth?.database === 'connected' || botHealth?.db === 'connected' ? 'Connected' : status === 'loading' ? '...' : 'N/A'} detail="MongoDB Instance" accent="sky" />
              <StatCard title="REST APIs" value={status === 'online' ? 'Active' : status === 'loading' ? '...' : 'Inactive'} detail="Express Server" accent="violet" />
              <StatCard title="Services" value="5+" detail="Integrated Modules" accent="amber" />
            </div>

            <div className="features-grid" data-testid="features-grid">
              <FeatureCard icon="link" title="URL Shortener & Domains" desc="Domain purchase with shortener integration, custom branded links, DNS management" onClick={() => setActiveView(VIEWS.URL_SHORTENER)} accent="emerald" />
              <FeatureCard icon="phone" title="Cloud Phone" desc="Virtual numbers, SMS to Telegram, call forwarding, voicemail, SIP access" onClick={() => setActiveView(VIEWS.CLOUD_PHONE)} accent="sky" />
              <FeatureCard icon="target" title="Targeted Leads" desc="Premium verified phone leads with carrier filtering and CNAM lookup" />
              <FeatureCard icon="wallet" title="Wallet System" desc="USD & NGN deposits via crypto (8 currencies) and bank transfer" />
              <FeatureCard icon="server" title="Offshore Hosting" desc="cPanel & Plesk plans with free trial, domain registration" />
              <FeatureCard icon="cloud" title="VPS Plans" desc="Virtual private servers with hourly billing and SSH key management" />
            </div>
          </main>
        )}

        {activeView === VIEWS.URL_SHORTENER && (
          <main className="main-content" data-testid="url-shortener-view">
            <URLShortenerDomainJourney />
          </main>
        )}

        {activeView === VIEWS.CLOUD_PHONE && (
          <main className="main-content" data-testid="cloud-phone-view">
            <CloudPhoneJourney />
          </main>
        )}

        <footer className="footer" data-testid="footer">
          <p>NomadlyBot Admin Panel &middot; Powered by Speechcue</p>
        </footer>
      </div>
    </div>
  );
}

function StatCard({ title, value, detail, accent }) {
  return (
    <div className={`stat-card stat-card--${accent}`} data-testid={`stat-card-${accent}`}>
      <span className="stat-title">{title}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-detail">{detail}</span>
    </div>
  );
}

function FeatureCard({ icon, title, desc, onClick, accent }) {
  const icons = {
    link: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    phone: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
    target: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
    wallet: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
    server: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>,
    cloud: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>,
  };

  return (
    <div
      className={`feature-card ${onClick ? 'feature-card--clickable' : ''} ${accent ? `feature-card--${accent}` : ''}`}
      data-testid={`feature-card-${icon}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="feature-icon">{icons[icon]}</div>
      <h3 className="feature-title">{title}</h3>
      <p className="feature-desc">{desc}</p>
      {onClick && <span className="feature-card__arrow">View Journey &rarr;</span>}
    </div>
  );
}

export default function App() {
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
              <Route path="/*" element={<MainApp />} />
            </>
          )}
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
