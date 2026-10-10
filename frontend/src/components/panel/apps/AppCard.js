// One installed app: state + install progress, site/admin links, login reveal and password reset.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import AppLogin from './AppLogin';

const STAGES = ['preflight', 'database', 'download', 'files', 'config', 'install'];

function InstallProgress({ stage, t }) {
  const idx = STAGES.indexOf(stage);
  return (
    <div className="apps-progress" data-testid="app-install-progress">
      <div className="apps-progress-bar"><span style={{ width: `${Math.max(8, ((idx + 1) / STAGES.length) * 100)}%` }} /></div>
      <span className="apps-progress-label">{t(`apps.stage.${stage || 'queued'}`, { defaultValue: t('apps.stage.queued') })}</span>
    </div>
  );
}

export default function AppCard({ app, onChanged }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [login, setLogin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const showLogin = async () => {
    if (login) { setLogin(null); return; }
    setBusy(true); setError('');
    try {
      const res = await api(`/apps/${app.id}`);
      setLogin({ user: res.app.admin_user, password: res.app.admin_password });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const resetPassword = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      const res = await api(`/apps/${app.id}/admin-password`, { method: 'POST' });
      if (res.dryRun) setNote(t('apps.resetDryRun'));
      else { setLogin({ user: res.admin_user, password: res.admin_password }); setNote(t('apps.resetDone')); onChanged(); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const when = app.installed_at || app.failed_at || app.created_at;
  const locale = ['en', 'fr', 'hi', 'zh'].find((l) => String(i18n.language || '').toLowerCase().startsWith(l)) || 'en';
  const whenText = when ? new Date(when).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  return (
    <div className={`acct-card apps-card apps-card--${app.state}`} data-testid={`app-card-${app.id}`}>
      <div className="apps-card-top">
        <div className="apps-card-name">
          <span className="apps-card-title">{app.title || app.domain}</span>
          <span className="apps-card-path">/{app.path || ''}</span>
        </div>
        <span className={`apps-badge apps-badge--${app.state}`} data-testid={`app-state-${app.id}`}>{t(`apps.state.${app.state}`, { defaultValue: app.state })}</span>
      </div>

      {app.state === 'installing' && <InstallProgress stage={app.stage} t={t} />}

      {app.site_url && (
        <div className="apps-links">
          <a href={app.site_url} target="_blank" rel="noopener noreferrer" data-testid={`app-site-link-${app.id}`}>{t('apps.siteLabel')}: {app.site_url.replace(/^https?:\/\//, '')}</a>
          {app.state === 'ready' && <a href={app.admin_url} target="_blank" rel="noopener noreferrer" data-testid={`app-admin-link-${app.id}`}>{t('apps.adminLabel')} ↗</a>}
        </div>
      )}

      {app.state === 'failed' && <p className="acct-error" data-testid={`app-error-${app.id}`}>{app.error}</p>}
      {app.state === 'dry_run' && <p className="apps-field-hint" data-testid={`app-dryrun-${app.id}`}>{t('apps.dryRunBody')}</p>}

      {app.state === 'ready' && (
        <AppLogin app={app} login={login} busy={busy} onToggle={showLogin} onReset={resetPassword} t={t} />
      )}

      {note && <p className="apps-note apps-note--inline" data-testid={`app-note-${app.id}`}>{note}</p>}
      {error && <p className="acct-error" data-testid={`app-action-error-${app.id}`}>{error}</p>}
      {whenText && <div className="apps-card-meta">{t(`apps.when.${app.state}`, { date: whenText, defaultValue: whenText })}{app.version ? ` · WordPress ${app.version}` : ''}</div>}
    </div>
  );
}
