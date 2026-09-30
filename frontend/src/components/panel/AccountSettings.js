import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';

/**
 * AccountSettings — Danger Zone.
 * Currently exposes "Cancel Hosting Plan" which mirrors the Telegram bot's
 * confirmCancelHostingPlan action: terminates the cPanel account on WHM,
 * cleans up Cloudflare for primary + every addon, and soft-deletes the record.
 *
 * UX guard rails:
 *   1. Two-step flow: review → type-to-confirm.
 *   2. User must type the literal word "CANCEL" (case-sensitive) before the
 *      confirm button is enabled. Backend independently re-validates the same
 *      string in the request body.
 *   3. On success, the user is auto-signed-out so a stale session can't try
 *      to interact with a torn-down cPanel account.
 */
export default function AccountSettings() {
  const { t } = useTranslation();
  const { user, api, logout } = useAuth();
  const [stage, setStage] = useState('idle'); // idle | reviewing | submitting | done | error
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  const requiredPhrase = 'CANCEL';
  const isPhraseValid = confirmText === requiredPhrase;

  const startReview = () => {
    setError('');
    setConfirmText('');
    setStage('reviewing');
  };

  const cancelReview = () => {
    setError('');
    setConfirmText('');
    setStage('idle');
  };

  const submitCancel = async () => {
    if (!isPhraseValid) return;
    setError('');
    setStage('submitting');
    try {
      await api('/account/cancel', {
        method: 'POST',
        body: JSON.stringify({ confirm: requiredPhrase }),
      });
      setStage('done');
    } catch (err) {
      setError(err.message || t('acct.defaultErr'));
      setStage('error');
    }
  };

  if (stage === 'done') {
    return (
      <div className="acct-section" data-testid="account-cancel-done">
        <div className="acct-card acct-card--success">
          <div className="acct-card-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 className="acct-card-title">{t('acct.cancelDoneTitle')}</h2>
          <p className="acct-card-body" dangerouslySetInnerHTML={{ __html: t('acct.cancelDoneBody1', { domain: user?.domain || '' }) }} />
          <p className="acct-card-body" dangerouslySetInnerHTML={{ __html: t('acct.cancelDoneBody2') }} />
          <button
            type="button"
            className="acct-btn acct-btn--neutral"
            onClick={logout}
            data-testid="account-cancel-signout-btn"
          >
            {t('acct.signOut')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="acct-section" data-testid="account-settings-section">
      <div className="acct-header">
        <h2 className="acct-header-title">{t('acct.sectionTitle')}</h2>
        <p
          className="acct-header-sub"
          dangerouslySetInnerHTML={{ __html: t('acct.signedInAs', { username: user?.username || '', domain: user?.domain || '' }) }}
        />
      </div>

      <div className="acct-card acct-card--danger" data-testid="account-danger-zone">
        <div className="acct-card-head">
          <div className="acct-card-icon acct-card-icon--danger" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <h3 className="acct-card-title">{t('acct.dangerCancelTitle')}</h3>
            <p
              className="acct-card-sub"
              dangerouslySetInnerHTML={{ __html: t('acct.dangerCancelSub', { domain: user?.domain || '' }) }}
            />
          </div>
        </div>

        {stage === 'idle' && (
          <>
            <ul className="acct-warn-list">
              <li>{t('acct.warn1')}</li>
              <li>{t('acct.warn2')}</li>
              <li>{t('acct.warn3')}</li>
              <li>{t('acct.warn4')}</li>
              <li dangerouslySetInnerHTML={{ __html: t('acct.warn5') }} />
              <li>{t('acct.warn6')}</li>
            </ul>
            <div className="acct-actions">
              <button
                type="button"
                className="acct-btn acct-btn--danger"
                onClick={startReview}
                data-testid="account-cancel-start-btn"
              >
                {t('acct.cancelBtnIdle')}
              </button>
            </div>
          </>
        )}

        {(stage === 'reviewing' || stage === 'submitting' || stage === 'error') && (
          <>
            <div className="acct-confirm-box">
              <p
                className="acct-confirm-prompt"
                dangerouslySetInnerHTML={{ __html: t('acct.confirmPrompt') }}
              />
              <input
                type="text"
                className="acct-confirm-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={t('acct.confirmPlaceholder')}
                aria-label={t('acct.confirmAria')}
                disabled={stage === 'submitting'}
                autoFocus
                data-testid="account-cancel-confirm-input"
              />
              {error && (
                <p className="acct-error" data-testid="account-cancel-error">{error}</p>
              )}
            </div>
            <div className="acct-actions">
              <button
                type="button"
                className="acct-btn acct-btn--neutral"
                onClick={cancelReview}
                disabled={stage === 'submitting'}
                data-testid="account-cancel-back-btn"
              >
                {t('acct.goBack')}
              </button>
              <button
                type="button"
                className="acct-btn acct-btn--danger"
                onClick={submitCancel}
                disabled={!isPhraseValid || stage === 'submitting'}
                data-testid="account-cancel-confirm-btn"
              >
                {stage === 'submitting' ? t('acct.cancelling') : t('acct.permanentlyCancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
