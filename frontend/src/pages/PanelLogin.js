import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../components/panel/AuthContext';
import useTheme from '../components/panel/useTheme';
import LanguageSwitcher from '../components/LanguageSwitcher';
import AutoDetectLanguageBanner from '../components/AutoDetectLanguageBanner';

const REMEMBER_KEY = 'panel_remember_username';

export default function PanelLogin() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [username, setUsername] = useState(() => localStorage.getItem(REMEMBER_KEY) || '');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [remember, setRemember] = useState(() => !!localStorage.getItem(REMEMBER_KEY));
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState(null); // server-reported
  const [loading, setLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Backend-authoritative lock: lockUntil is a wall-clock ms timestamp.
  // Initial value 0 — only set when the server returns a 429 with lockedSeconds.
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const usernameRef = useRef(null);
  const { theme, toggleTheme, isDark } = useTheme();

  // Set browser tab title
  useEffect(() => {
    document.title = 'HostBay | Hosting Panel';
  }, []);

  // Auto-focus username on mount (or PIN if remembered)
  useEffect(() => {
    if (username && document.getElementById('pin')) {
      document.getElementById('pin').focus();
    } else if (usernameRef.current) {
      usernameRef.current.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick clock when locked
  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockUntil]);

  // Auto-clear lock when expired
  useEffect(() => {
    if (lockUntil && lockUntil <= now) {
      setLockUntil(0);
      setError('');
      setAttemptsRemaining(null);
    }
  }, [lockUntil, now]);

  // Caps-lock detection on key events
  const handleKeyEvent = (e) => {
    if (typeof e.getModifierState === 'function') {
      setCapsOn(e.getModifierState('CapsLock'));
    }
  };

  const remainingLockSec = Math.max(0, Math.ceil((lockUntil - now) / 1000));
  const isLocked = lockUntil > now;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), pin.trim());
      // Success — clear local UI state; persist username if remember is on
      setAttemptsRemaining(null);
      if (remember) localStorage.setItem(REMEMBER_KEY, username.trim());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (err) {
      // Server-authoritative rate-limit: trust the lockedSeconds returned by the
      // backend. Falls back to plain error display when not rate-limited.
      if (err.rateLimited && err.lockedSeconds) {
        const until = Date.now() + err.lockedSeconds * 1000;
        setLockUntil(until);
        setError('');
      } else if (typeof err.attemptsRemaining === 'number') {
        setAttemptsRemaining(err.attemptsRemaining);
        setError(err.message);
      } else {
        setError(err.message);
      }
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`panel-login-page ${theme === 'light' ? 'panel-light' : ''}`} data-testid="panel-login-page" data-panel-theme={theme}>
      <AutoDetectLanguageBanner />
      <div style={{position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center', zIndex: 5}}>
        <LanguageSwitcher />
        <button onClick={toggleTheme} className="panel-theme-btn panel-theme-btn--login" data-testid="panel-theme-toggle-login" title={isDark ? t('login.switchToLight') : t('login.switchToDark')}>
          {isDark ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          )}
        </button>
      </div>

      <div className="panel-login-card" data-testid="panel-login-card">
        <div className="panel-login-logo">
          <div className="panel-login-icon" data-testid="panel-login-brand-mark" aria-label="HostBay">
            <svg width="34" height="34" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* HostBay logomark — H letterform (Host) over a gentle wave (Bay) */}
              <rect x="6" y="4" width="4" height="20" rx="1.5" fill="currentColor"/>
              <rect x="22" y="4" width="4" height="20" rx="1.5" fill="currentColor"/>
              <rect x="10" y="12" width="12" height="4" fill="currentColor"/>
              <path d="M5 28 Q10.5 25 16 28 T27 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.85"/>
            </svg>
          </div>
          <h1>{t('login.title')}</h1>
          <p>{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} data-testid="panel-login-form">
          {error && !isLocked && (
            <div className="panel-login-error" data-testid="panel-login-error">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink: 0}}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <span>
                {error}
                {typeof attemptsRemaining === 'number' && attemptsRemaining > 0 && attemptsRemaining <= 3 && (
                  <strong data-testid="panel-attempts-remaining" style={{ display: 'block', fontSize: 12, marginTop: 4, fontWeight: 600 }}>
                    {t(attemptsRemaining === 1 ? 'login.attemptsRemaining_one' : 'login.attemptsRemaining_other', { count: attemptsRemaining })}
                  </strong>
                )}
              </span>
            </div>
          )}

          {isLocked && (
            <div className="pv-rate-limit" data-testid="panel-login-rate-limit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink: 0}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              <span>{t('login.tooManyAttempts')}</span>
              <span className="pv-rate-limit-clock" data-testid="panel-login-rate-limit-clock">{String(Math.floor(remainingLockSec / 60)).padStart(2, '0')}:{String(remainingLockSec % 60).padStart(2, '0')}</span>
            </div>
          )}

          <div className="panel-input-group">
            <label htmlFor="username">{t('login.usernameLabel')}</label>
            <input
              id="username"
              ref={usernameRef}
              data-testid="panel-login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyEvent}
              onKeyUp={handleKeyEvent}
              placeholder={t('login.usernamePlaceholder')}
              autoComplete="username"
              disabled={isLocked}
              required
            />
            {capsOn && (
              <div className="pv-caps-lock" data-testid="panel-caps-lock-warning">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19v3"/><path d="M19 12H5L12 5l7 7z"/></svg>
                <span>{t('login.capsLockOn')}</span>
              </div>
            )}
          </div>

          <div className="panel-input-group">
            <label htmlFor="pin">{t('login.pinLabel')}</label>
            <div className="pv-pin-wrap">
              <input
                id="pin"
                data-testid="panel-login-pin"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={handleKeyEvent}
                onKeyUp={handleKeyEvent}
                placeholder={t('login.pinPlaceholder')}
                autoComplete="current-password"
                disabled={isLocked}
                required
              />
              <button
                type="button"
                className="pv-pin-toggle"
                onClick={() => setShowPin(v => !v)}
                data-testid="panel-login-pin-toggle"
                aria-label={showPin ? t('login.hidePin') : t('login.showPin')}
                title={showPin ? t('login.hidePin') : t('login.showPin')}
                tabIndex={-1}
              >
                {showPin ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          <label className="pv-remember" data-testid="panel-remember-username-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              data-testid="panel-remember-username"
            />
            <span>{t('login.rememberUsername')}</span>
          </label>

          <button
            type="submit"
            className="panel-login-btn"
            data-testid="panel-login-submit"
            disabled={loading || isLocked || !username || pin.length < 6}
          >
            {loading ? (
              <span className="panel-login-btn-loading">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="panel-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                {t('login.submitting')}
              </span>
            ) : t('login.submitButton')}
          </button>
        </form>

        <button
          className="panel-login-help-btn"
          onClick={() => setShowHelp(!showHelp)}
          data-testid="panel-help-toggle"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          {showHelp ? t('common.close') : t('login.forgotPin')}
        </button>

        {showHelp && (
          <div className="panel-login-help-box" data-testid="panel-help-box">
            <div className="panel-help-step">
              <span className="panel-help-num">1</span>
              <span>{t('login.forgotPinHint')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
