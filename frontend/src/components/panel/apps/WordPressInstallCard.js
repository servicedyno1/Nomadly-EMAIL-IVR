// One-click WordPress install form (folder, site title, admin email).
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const WpLogo = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M3.5 8.5l4.6 12.2M8 7.5h3M6.5 7.5l4.3 11.8L13.7 11M12.7 7.5h3.1M14.3 7.5l3.6 10 2-6.2" />
  </svg>
);

export default function WordPressInstallCard({ domain, onInstall, disabled }) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cleanPath = path.trim().replace(/^\/+|\/+$/g, '');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onInstall({ app: 'wordpress', path: cleanPath, title: title.trim() || undefined, admin_email: email.trim() || undefined });
      setPath(''); setTitle(''); setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="acct-card apps-install-card" onSubmit={submit} data-testid="wp-install-card">
      <div className="acct-card-head">
        <div className="acct-card-icon apps-wp-icon"><WpLogo /></div>
        <div>
          <h3 className="acct-card-title">{t('apps.wpName')}</h3>
          <p className="acct-card-sub">{t('apps.wpDesc')}</p>
        </div>
      </div>

      <div className="apps-form-grid">
        <label className="apps-field">
          <span className="apps-field-label">{t('apps.folderLabel')}</span>
          <div className="apps-path-input">
            <span className="apps-path-prefix" data-testid="wp-install-path-prefix">https://{domain}/</span>
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('apps.folderPlaceholder')} maxLength={64} disabled={busy} data-testid="wp-install-path-input" />
          </div>
          <span className="apps-field-hint">{t('apps.folderHint')}</span>
        </label>
        <label className="apps-field">
          <span className="apps-field-label">{t('apps.titleLabel')}</span>
          <input className="apps-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={domain || t('apps.titlePlaceholder')} maxLength={120} disabled={busy} data-testid="wp-install-title-input" />
        </label>
        <label className="apps-field">
          <span className="apps-field-label">{t('apps.emailLabel')}</span>
          <input className="apps-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={domain ? `admin@${domain}` : t('apps.emailPlaceholder')} maxLength={120} disabled={busy} data-testid="wp-install-email-input" />
        </label>
      </div>

      {error && <p className="acct-error" data-testid="wp-install-error">{error}</p>}

      <div className="acct-actions">
        <button type="submit" className="acct-btn apps-btn-primary" disabled={busy || disabled} data-testid="wp-install-submit-btn">
          {busy ? t('apps.starting') : t('apps.installBtn')}
        </button>
        <span className="apps-field-hint apps-install-meta">{t('apps.installMeta')}</span>
      </div>
    </form>
  );
}
