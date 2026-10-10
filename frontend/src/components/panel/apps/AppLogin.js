// Admin login block for a ready app: reveal/copy credentials + two-step password reset.
import React, { useState } from 'react';

function CopyField({ label, value, testid, t }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_) { /* clipboard blocked */ }
  };
  return (
    <div className="apps-cred">
      <span className="apps-cred-label">{label}</span>
      <code className="apps-cred-value" data-testid={testid}>{value}</code>
      <button type="button" className="apps-copy-btn" onClick={copy} data-testid={`${testid}-copy`}>{copied ? t('apps.copied') : t('apps.copy')}</button>
    </div>
  );
}

export default function AppLogin({ app, login, busy, onToggle, onReset, t }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="apps-login" data-testid={`app-login-${app.id}`}>
      {login && (
        <div className="apps-creds">
          <CopyField label={t('apps.userLabel')} value={login.user || app.admin_user || ''} testid={`app-admin-user-${app.id}`} t={t} />
          <CopyField label={t('apps.passwordLabel')} value={login.password || ''} testid={`app-admin-password-${app.id}`} t={t} />
        </div>
      )}
      {confirming ? (
        <div className="apps-confirm" data-testid={`app-reset-confirm-${app.id}`}>
          <span>{t('apps.resetConfirm')}</span>
          <div className="acct-actions">
            <button type="button" className="acct-btn acct-btn--neutral" onClick={() => setConfirming(false)} disabled={busy} data-testid={`app-reset-cancel-${app.id}`}>{t('apps.cancel')}</button>
            <button type="button" className="acct-btn apps-btn-primary" onClick={async () => { await onReset(); setConfirming(false); }} disabled={busy} data-testid={`app-reset-go-${app.id}`}>{busy ? t('apps.resetting') : t('apps.resetGo')}</button>
          </div>
        </div>
      ) : (
        <div className="acct-actions">
          <button type="button" className="acct-btn" onClick={onToggle} disabled={busy} data-testid={`app-show-login-${app.id}`}>{login ? t('apps.hideLogin') : t('apps.showLogin')}</button>
          <button type="button" className="acct-btn acct-btn--neutral" onClick={() => setConfirming(true)} disabled={busy} data-testid={`app-reset-btn-${app.id}`}>{t('apps.resetBtn')}</button>
        </div>
      )}
    </div>
  );
}
