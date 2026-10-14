import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

/**
 * SiteStatusCard — toggle between online / maintenance / suspended.
 *
 * Mirrors the Telegram bot's site-offline flow exactly. Visibility-only;
 * does NOT pause expiry or auto-renewal — the UI shouts that loudly so
 * users don't expect billing relief.
 */
export default function SiteStatusCard() {
  const { t, i18n } = useTranslation();
  const { user, api } = useAuth();
  const [status, setStatus] = useState(null);
  const [stage, setStage] = useState('view'); // view | choosing-mode | confirming-offline | confirming-online | submitting
  const [pendingMode, setPendingMode] = useState(null); // 'maintenance' | 'suspended'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setError('');
    try {
      const data = await api('/account/site-status');
      setStatus(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const reset = () => {
    setStage('view');
    setPendingMode(null);
    setError('');
  };

  const startTakeOffline = () => {
    setError('');
    setStage('choosing-mode');
  };

  const pickMode = (mode) => {
    setPendingMode(mode);
    setStage('confirming-offline');
  };

  const startBringOnline = () => {
    setError('');
    setStage('confirming-online');
  };

  const submitOffline = async () => {
    if (!pendingMode) return;
    setError('');
    setStage('submitting');
    try {
      await api('/account/site-status', {
        method: 'POST',
        body: JSON.stringify({ action: 'take_offline', mode: pendingMode }),
      });
      await fetchStatus();
      reset();
    } catch (err) {
      setError(err.message || t('site.failedOffline'));
      setStage('confirming-offline');
    }
  };

  const submitOnline = async () => {
    setError('');
    setStage('submitting');
    try {
      await api('/account/site-status', {
        method: 'POST',
        body: JSON.stringify({ action: 'bring_online' }),
      });
      await fetchStatus();
      reset();
    } catch (err) {
      setError(err.message || t('site.failedOnline'));
      setStage('confirming-online');
    }
  };

  const formatDate = (iso) => {
    if (!iso) return t('site.dashPlaceholder');
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    const d = new Date(iso);
    if (isNaN(d.getTime())) return t('site.dashPlaceholder');
    try { return d.toLocaleDateString(i18n.language || 'en', opts); } catch { return d.toLocaleDateString(undefined, opts); }
  };

  if (loading) {
    return (
      <div className="acct-card" data-testid="site-status-loading">
        <p className="acct-card-body">{t('site.loading')}</p>
      </div>
    );
  }

  const current = status?.status || 'online';
  const cardClass = current === 'online' ? 'acct-card--online' : 'acct-card--offline';
  const statusLabel = current === 'online'
    ? `✅ ${t('site.statusOnline')}`
    : current === 'maintenance' ? `🛠️ ${t('site.statusMaintenance')}` : `🚫 ${t('site.statusSuspended')}`;
  const statusDesc = current === 'online'
    ? t('site.descOnline')
    : current === 'maintenance'
      ? t('site.descMaintenance')
      : t('site.descSuspended');

  return (
    <div className={`acct-card ${cardClass}`} data-testid="site-status-card">
      <div className="acct-card-head">
        <div className={`acct-card-icon ${current === 'online' ? '' : 'acct-card-icon--warn'}`} aria-hidden="true">
          {current === 'online' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
          )}
        </div>
        <div>
          <h3 className="acct-card-title">{t('site.cardTitle', { label: statusLabel })}</h3>
          <p className="acct-card-sub">{statusDesc}</p>
        </div>
      </div>

      <div className="acct-meta-grid" data-testid="site-status-meta">
        <div><span>{t('site.metaDomain')}</span><strong>{status?.domain || user?.domain}</strong></div>
        <div><span>{t('site.metaPlan')}</span><strong>{status?.plan || t('site.dashPlaceholder')}</strong></div>
        <div><span>{t('site.metaExpires')}</span><strong>{formatDate(status?.expiryDate)}</strong></div>
        <div><span>{t('site.metaAutoRenew')}</span><strong>{status?.autoRenew ? `✅ ${t('site.autoRenewOn')}` : `❌ ${t('site.autoRenewOff')}`}</strong></div>
      </div>

      {/* ── VIEW (no action selected yet) ─────────────────── */}
      {stage === 'view' && current === 'online' && (
        <div className="acct-actions">
          <button
            type="button"
            className="acct-btn acct-btn--warn"
            onClick={startTakeOffline}
            data-testid="site-take-offline-btn"
          >
            {t('site.takeOffline')}
          </button>
        </div>
      )}

      {stage === 'view' && current !== 'online' && (
        <div className="acct-actions">
          <button
            type="button"
            className="acct-btn acct-btn--success"
            onClick={startBringOnline}
            data-testid="site-bring-online-btn"
          >
            {t('site.bringOnline')}
          </button>
        </div>
      )}

      {/* ── CHOOSING MODE ──────────────────────────────────── */}
      {stage === 'choosing-mode' && (
        <div className="acct-mode-picker" data-testid="site-mode-picker">
          <div className="acct-billing-warning" data-testid="site-billing-warning" dangerouslySetInnerHTML={{ __html: t('site.headsUp') }} />
          <button
            type="button"
            className="acct-mode-option"
            onClick={() => pickMode('maintenance')}
            data-testid="site-mode-maintenance-btn"
          >
            <span className="acct-mode-emoji" aria-hidden="true">🛠️</span>
            <span className="acct-mode-text">
              <strong>{t('site.modeMaintenance')}</strong>
              <span className="acct-mode-desc">{t('site.modeMaintenanceDesc')}</span>
            </span>
          </button>
          <button
            type="button"
            className="acct-mode-option"
            onClick={() => pickMode('suspended')}
            data-testid="site-mode-suspend-btn"
          >
            <span className="acct-mode-emoji" aria-hidden="true">🚫</span>
            <span className="acct-mode-text">
              <strong>{t('site.modeSuspend')}</strong>
              <span className="acct-mode-desc">{t('site.modeSuspendDesc')}</span>
            </span>
          </button>
          <div className="acct-actions">
            <button
              type="button"
              className="acct-btn acct-btn--neutral"
              onClick={reset}
              data-testid="site-mode-cancel-btn"
            >
              {t('acct.goBack')}
            </button>
          </div>
        </div>
      )}

      {/* ── CONFIRMING OFFLINE ─────────────────────────────── */}
      {(stage === 'confirming-offline' || (stage === 'submitting' && pendingMode)) && (
        <div className="acct-confirm-box" data-testid="site-confirm-offline">
          <p
            className="acct-card-body"
            dangerouslySetInnerHTML={{
              __html: t(pendingMode === 'maintenance' ? 'site.confirmMaintenance' : 'site.confirmSuspend', { domain: status?.domain || '' }),
            }}
          />
          <p className="acct-card-body acct-billing-warning-inline" dangerouslySetInnerHTML={{ __html: t('site.reminderBilling') }} />
          {error && <p className="acct-error" data-testid="site-status-error">{error}</p>}
          <div className="acct-actions">
            <button
              type="button"
              className="acct-btn acct-btn--neutral"
              onClick={reset}
              disabled={stage === 'submitting'}
              data-testid="site-offline-back-btn"
            >
              {t('acct.goBack')}
            </button>
            <button
              type="button"
              className="acct-btn acct-btn--warn"
              onClick={submitOffline}
              disabled={stage === 'submitting'}
              data-testid="site-offline-confirm-btn"
            >
              {stage === 'submitting' ? t('site.working') : (pendingMode === 'suspended' ? t('site.suspendNow') : t('site.enableMaintenance'))}
            </button>
          </div>
        </div>
      )}

      {/* ── CONFIRMING ONLINE ──────────────────────────────── */}
      {(stage === 'confirming-online' || (stage === 'submitting' && !pendingMode)) && (
        <div className="acct-confirm-box" data-testid="site-confirm-online">
          <p
            className="acct-card-body"
            dangerouslySetInnerHTML={{ __html: t('site.bringOnlineConfirm', { domain: status?.domain || '' }) }}
          />
          {error && <p className="acct-error" data-testid="site-status-error">{error}</p>}
          <div className="acct-actions">
            <button
              type="button"
              className="acct-btn acct-btn--neutral"
              onClick={reset}
              disabled={stage === 'submitting'}
              data-testid="site-online-back-btn"
            >
              {t('acct.goBack')}
            </button>
            <button
              type="button"
              className="acct-btn acct-btn--success"
              onClick={submitOnline}
              disabled={stage === 'submitting'}
              data-testid="site-online-confirm-btn"
            >
              {stage === 'submitting' ? t('site.working') : t('site.bringOnlineNow')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
