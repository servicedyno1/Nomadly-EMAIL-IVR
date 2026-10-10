// AppsManager — HostPanel "Apps" tab: one-click WordPress install + installed apps list.
// Polls while an install is running (backend: /api/panel/apps, shared with the reseller API).
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import WordPressInstallCard from './apps/WordPressInstallCard';
import AppCard from './apps/AppCard';

const POLL_MS = 4000;

export default function AppsManager() {
  const { t } = useTranslation();
  const { api, user } = useAuth();
  const [apps, setApps] = useState([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api('/apps');
      setApps(res.apps || []);
      setLive(res.live !== false);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const installing = apps.some((a) => a.state === 'installing');
  useEffect(() => {
    if (!installing) return undefined;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [installing, load]);

  const install = async (body) => {
    await api('/apps', { method: 'POST', body: JSON.stringify(body) });
    await load();
  };

  return (
    <div className="acct-section apps-section" data-testid="apps-section">
      <div className="acct-header">
        <h2 className="acct-header-title">{t('apps.title')}</h2>
        <p className="acct-header-sub" data-testid="apps-subtitle">{t('apps.subtitle', { domain: user?.domain || '' })}</p>
      </div>

      {!live && <div className="apps-note" data-testid="apps-sandbox-note">{t('apps.sandboxNote')}</div>}
      {error && <p className="acct-error" data-testid="apps-error">{error}</p>}

      <WordPressInstallCard domain={user?.domain || ''} onInstall={install} disabled={installing} />

      <h3 className="apps-list-title">{t('apps.installedTitle')}</h3>
      <div className="apps-list" data-testid="apps-list">
        {loading && <div className="apps-empty" data-testid="apps-loading">{t('apps.loading')}</div>}
        {!loading && apps.length === 0 && <div className="apps-empty" data-testid="apps-empty">{t('apps.empty')}</div>}
        {!loading && apps.map((a) => <AppCard key={a.id} app={a} onChanged={load} />)}
      </div>
    </div>
  );
}
