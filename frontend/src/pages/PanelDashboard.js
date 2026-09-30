import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../components/panel/AuthContext';
import FileManager from '../components/panel/FileManager';
import DomainList from '../components/panel/DomainList';
import EmailManager from '../components/panel/EmailManager';
import MysqlManager from '../components/panel/MysqlManager';
import GeoManager from '../components/panel/GeoManager';
import Analytics from '../components/panel/Analytics';
import SecurityPanel from '../components/panel/SecurityPanel';
import AccountSettings from '../components/panel/AccountSettings';
import SiteStatusCard from '../components/panel/SiteStatusCard';
import LanguageSwitcher from '../components/LanguageSwitcher';
import useTheme from '../components/panel/useTheme';

const TABS = [
  { id: 'site', i18nKey: 'site', icon: 'power' },
  { id: 'files', i18nKey: 'files', icon: 'folder' },
  { id: 'domains', i18nKey: 'domains', icon: 'globe' },
  { id: 'email', i18nKey: 'email', icon: 'mail' },
  { id: 'mysql', i18nKey: 'mysql', icon: 'database' },
  { id: 'security', i18nKey: 'security', icon: 'shield' },
  { id: 'geo', i18nKey: 'geo', icon: 'lock' },
  { id: 'analytics', i18nKey: 'analytics', icon: 'chart' },
  { id: 'account', i18nKey: 'account', icon: 'user' },
];

export default function PanelDashboard() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('files');
  const { theme, toggleTheme, isDark } = useTheme();
  // Cross-tab navigation: DomainList → FileManager
  const [fileManagerTargetDir, setFileManagerTargetDir] = useState(null);

  const navigateToFileManager = useCallback((dir) => {
    setFileManagerTargetDir(dir);
    setActiveTab('files');
  }, []);

  // Set browser tab title — overrides static "Speechcue | Cloud Phone" from index.html
  useEffect(() => {
    document.title = 'HostBay | Hosting Panel';
  }, []);

  return (
    <div className={`panel-dashboard ${theme === 'light' ? 'panel-light' : ''}`} data-testid="panel-dashboard" data-panel-theme={theme}>
      <header className="panel-header" data-testid="panel-header">
        <div className="panel-header-left">
          <div className="panel-header-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="20" height="8" rx="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2"/>
              <circle cx="6" cy="6" r="1" fill="currentColor"/>
              <circle cx="6" cy="18" r="1" fill="currentColor"/>
            </svg>
          </div>
          <span className="panel-header-title">Nomadly Hosting</span>
          <a 
            href={`https://${user?.domain}`} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="panel-header-domain" 
            data-testid="panel-domain"
            title={t('dashboard.visitWebsite')}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>
            {user?.domain}
          </a>
        </div>
        <div className="panel-header-right">
          <a href="/store" className="panel-header-domain" data-testid="panel-store-link" title="Buy another hosting plan">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
            Buy more
          </a>
          <LanguageSwitcher />
          <button onClick={toggleTheme} className="panel-theme-btn" data-testid="panel-theme-toggle" title={isDark ? t('login.switchToLight') : t('login.switchToDark')}>
            {isDark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            )}
          </button>
          <span className="panel-header-user" data-testid="panel-username">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            {user?.username}
          </span>
          <button onClick={logout} className="panel-logout-btn" data-testid="panel-logout-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            {t('account.logout')}
          </button>
        </div>
      </header>

      <nav className="panel-tabs" data-testid="panel-tabs">
        {TABS.map(tab => {
          // Tab-level lock badges (small lock icon next to tab label):
          //   - mysql: locked for the 1-Week trial only (Premium Monthly + Gold OK)
          //   - geo:   locked for everyone except Gold (matches storefront card)
          const planLc = String(user?.plan || '').toLowerCase();
          const isWeeklyTrial = /1-week|\bweek\b|\(7 days\)/.test(planLc) && !/month/.test(planLc);
          const isGold = !!user?.isGold;
          let locked = false;
          if (tab.id === 'mysql') locked = isWeeklyTrial;
          else if (tab.id === 'geo') locked = !isGold;
          return (
            <button
              key={tab.id}
              className={`panel-tab ${activeTab === tab.id ? 'panel-tab--active' : ''} ${locked ? 'panel-tab--locked' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`panel-tab-${tab.id}`}
              data-locked={locked ? 'true' : undefined}
              title={t(`dashboard.tabs.${tab.i18nKey}`)}
            >
              <TabIcon name={tab.icon} />
              <span>{t(`dashboard.tabs.${tab.i18nKey}`)}</span>
              {locked && (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  style={{ marginLeft: 4, opacity: 0.6 }}
                  data-testid={`panel-tab-${tab.id}-lock`}
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              )}
            </button>
          );
        })}
      </nav>

      <main className="panel-main" data-testid="panel-main">
        {activeTab === 'site' && (
          <div className="acct-section" data-testid="site-status-section">
            <SiteStatusCard />
          </div>
        )}
        {activeTab === 'files' && <FileManager targetDir={fileManagerTargetDir} onTargetDirConsumed={() => setFileManagerTargetDir(null)} />}
        {activeTab === 'domains' && <DomainList onNavigateToFileManager={navigateToFileManager} />}
        {activeTab === 'email' && <EmailManager />}
        {activeTab === 'mysql' && <MysqlManager />}
        {activeTab === 'security' && <SecurityPanel />}
        {activeTab === 'geo' && <GeoManager />}
        {activeTab === 'analytics' && <Analytics />}
        {activeTab === 'account' && <AccountSettings />}
      </main>
    </div>
  );
}

function TabIcon({ name }) {
  const icons = {
    folder: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>,
    globe: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>,
    mail: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    database: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6"/></svg>,
    shield: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    lock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
    chart: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    user: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    power: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>,
  };
  return icons[name] || null;
}
