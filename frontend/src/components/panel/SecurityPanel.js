import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

function StatusBadge({ active, loading, label }) {
  if (loading) return <span className="sec-badge sec-badge--loading">{label}</span>;
  return (
    <span className={`sec-badge ${active ? 'sec-badge--active' : 'sec-badge--inactive'}`} data-testid={`sec-badge-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <span className={`sec-badge-dot ${active ? 'sec-badge-dot--on' : 'sec-badge-dot--off'}`} />
      {label}
    </span>
  );
}

// Layer keys drive both the data wiring (to security/status response) and the
// i18n lookup (sec.layers.<key>.label / .desc). Keep in sync with en.json.
const LAYER_KEYS = ['htaccessCloaking', 'scannerUaBlocking', 'cfWafRules', 'cfWorker', 'jsChallenge', 'honeypot'];

export default function SecurityPanel() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api('/security/status');
      setStatus(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const toggleJsChallenge = async () => {
    const current = status?.protectionLayers?.jsChallenge;
    if (captchaGoldOnly && !isGold) {
      setError(t('sec.captchaGoldOnlyError'));
      return;
    }
    if (current) {
      const confirmed = window.confirm(t('sec.captchaDisableWarning'));
      if (!confirmed) return;
    }
    setToggling(true);
    setError('');
    setSuccess('');
    try {
      const res = await api('/security/js-challenge/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled: !current }),
      });
      if (res.jsChallengeEnabled !== undefined) {
        setSuccess(res.jsChallengeEnabled ? t('sec.captchaStatusEnabled') : t('sec.captchaStatusDisabled'));
        fetchStatus();
      } else if (res.captchaGoldOnly) {
        setError(res.error || t('sec.captchaDefaultGoldError'));
      } else {
        setError(res.error || t('sec.failedToggle'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  };

  const toggleHoneypot = async () => {
    const current = status?.protectionLayers?.honeypot;
    if (honeypotMonthlyOnly && !isMonthly) {
      setError(t('sec.honeypotMonthlyOnlyError'));
      return;
    }
    if (current) {
      const confirmed = window.confirm(t('sec.honeypotDisableWarning'));
      if (!confirmed) return;
    }
    setToggling(true);
    setError('');
    setSuccess('');
    try {
      const res = await api('/security/honeypot/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled: !current }),
      });
      if (res.honeypotEnabled !== undefined) {
        setSuccess(res.honeypotEnabled ? t('sec.honeypotStatusEnabled') : t('sec.honeypotStatusDisabled'));
        fetchStatus();
      } else if (res.honeypotMonthlyOnly) {
        setError(res.error || t('sec.honeypotMonthlyOnlyError'));
      } else {
        setError(res.error || t('sec.failedToggle'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  };

  const layers = status?.protectionLayers || {};
  const stats = status?.stats || {};
  const sb = status?.antiRed?.safeBrowsing;  // eslint-disable-line no-unused-vars
  const bl = status?.antiRed?.blacklist;
  const isGold = !!status?.isGold;
  const captchaGoldOnly = !!status?.captchaGoldOnly;
  const isMonthly = status?.isMonthly !== false;
  const honeypotMonthlyOnly = !!status?.honeypotMonthlyOnly;
  const activeCount = Object.values(layers).filter(Boolean).length;
  const totalCount = LAYER_KEYS.length;

  return (
    <div className="sec" data-testid="security-panel">
      <div className="dl-header">
        <h2>{t('sec.title')}</h2>
        <div className="dl-header-actions">
          <button onClick={fetchStatus} className="fm-btn fm-btn--ghost" disabled={loading} data-testid="sec-refresh">
            {loading ? t('sec.checking') : t('sec.refresh')}
          </button>
        </div>
      </div>

      {error && <div className="fm-error" data-testid="sec-error">{error}</div>}
      {success && <div className="sec-success" data-testid="sec-success">{success}</div>}

      {loading ? (
        <div className="fm-loading">{t('sec.checkingStatus')}</div>
      ) : (
        <>
          {/* Overall Protection Score */}
          <div className="sec-overview" data-testid="sec-overview">
            <div className="sec-overview-ring">
              <svg viewBox="0 0 36 36" className="sec-ring-svg">
                <path className="sec-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path className="sec-ring-fill" strokeDasharray={`${(activeCount / totalCount) * 100}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <span className="sec-ring-text">{activeCount}/{totalCount}</span>
            </div>
            <div className="sec-overview-info">
              <span className="sec-overview-title">{t('sec.protectionActive')}</span>
              <span className="sec-overview-sub">{t('sec.protectionSub', { active: activeCount, total: totalCount })}</span>
            </div>
          </div>

          {/* Protection Layers */}
          <div className="sec-section" data-testid="sec-layers">
            <h3>{t('sec.protectionLayers')}</h3>
            <div className="sec-layers">
              {LAYER_KEYS.map(key => {
                const active = layers[key];
                const isJsChallenge = key === 'jsChallenge';
                const isHoneypot = key === 'honeypot';
                const label = t(`sec.layers.${key}.label`);
                const desc = t(`sec.layers.${key}.desc`);
                return (
                  <div key={key} className={`sec-layer ${active ? 'sec-layer--active' : 'sec-layer--inactive'}`} data-testid={`sec-layer-${key}`}>
                    <div className="sec-layer-left">
                      <span className={`sec-layer-indicator ${active ? 'sec-layer-indicator--on' : 'sec-layer-indicator--off'}`} />
                      <div className="sec-layer-text">
                        <span className="sec-layer-name">{label}</span>
                        <span className="sec-layer-desc">{desc}</span>
                      </div>
                    </div>
                    <div className="sec-layer-right">
                      {isJsChallenge ? (
                        captchaGoldOnly && !isGold ? (
                          <span
                            className="sec-badge sec-badge--locked"
                            title={t('sec.goldOnlyTooltip', { plan: status?.plan || t('sec.unknownPlan') })}
                            data-testid="sec-js-locked"
                          >
                            🔒 {t('sec.goldOnly')}
                          </span>
                        ) : (
                          <button
                            className={`sec-toggle ${active ? 'sec-toggle--on' : 'sec-toggle--off'}`}
                            onClick={toggleJsChallenge}
                            disabled={toggling}
                            data-testid="sec-js-toggle"
                            title={active ? t('sec.disableCaptchaTitle') : t('sec.enableCaptchaTitle')}
                          >
                            <span className="sec-toggle-knob" />
                          </button>
                        )
                      ) : isHoneypot ? (
                        honeypotMonthlyOnly && !isMonthly ? (
                          <span
                            className="sec-badge sec-badge--locked"
                            title={t('sec.monthlyOnlyTooltip', { plan: status?.plan || t('sec.unknownPlan') })}
                            data-testid="sec-honeypot-locked"
                          >
                            🔒 {t('sec.monthlyOnly')}
                          </span>
                        ) : (
                          <button
                            className={`sec-toggle ${active ? 'sec-toggle--on' : 'sec-toggle--off'}`}
                            onClick={toggleHoneypot}
                            disabled={toggling}
                            data-testid="sec-honeypot-toggle"
                            title={active ? t('sec.disableHoneypotTitle') : t('sec.enableHoneypotTitle')}
                          >
                            <span className="sec-toggle-knob" />
                          </button>
                        )
                      ) : (
                        <StatusBadge active={active} loading={false} label={active ? t('sec.active') : t('sec.inactive')} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          {(stats.scannerIpRanges > 0 || stats.scannerUserAgents > 0) && (
            <div className="sec-stats" data-testid="sec-stats">
              <div className="sec-stat">
                <span className="sec-stat-val">{stats.scannerIpRanges || 0}</span>
                <span className="sec-stat-label">{t('sec.blockedIpRanges')}</span>
              </div>
              <div className="sec-stat">
                <span className="sec-stat-val">{stats.scannerUserAgents || 0}</span>
                <span className="sec-stat-label">{t('sec.blockedUserAgents')}</span>
              </div>
              <div className="sec-stat">
                <span className="sec-stat-val">{stats.ja3Hashes || 0}</span>
                <span className="sec-stat-label">{t('sec.ja3Fingerprints')}</span>
              </div>
            </div>
          )}

          {/* Domain Health */}
          <div className="sec-section" data-testid="sec-health">
            <h3>{t('sec.domainHealth')}</h3>
            <div className="sec-health-items">
              <div className={`sec-health-item ${bl?.listed === false ? 'sec-health-item--ok' : bl?.listed === true ? 'sec-health-item--bad' : 'sec-health-item--unknown'}`} data-testid="sec-health-bl">
                <span className={`sec-health-dot ${bl?.listed === false ? 'sec-health-dot--ok' : bl?.listed === true ? 'sec-health-dot--bad' : 'sec-health-dot--unknown'}`} />
                <span className="sec-health-name">{t('sec.ipBlacklist')}</span>
                <span className="sec-health-status">
                  {bl?.listed === false
                    ? t('sec.blCleanFormat', { ip: bl?.ip || '' })
                    : bl?.listed === true ? t('sec.blListed') : t('sec.naShort')}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
