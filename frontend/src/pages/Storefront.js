import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { Sun, Moon } from 'lucide-react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { StoreProvider, useStore } from '../components/store/StoreContext';
import useTheme from '../components/panel/useTheme';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const BACKEND = process.env.REACT_APP_BACKEND_URL || '';
const COIN_OPTS = [
  ['USDT-TRC20', 'USDT (TRC20)'], ['BTC', 'Bitcoin'], ['ETH', 'Ethereum'], ['LTC', 'Litecoin'],
  ['DOGE', 'Dogecoin'], ['USDT-ERC20', 'USDT (ERC20)'], ['BCH', 'Bitcoin Cash'], ['TRX', 'TRON'],
];

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

// ── Point #5: lifecycle — humanize a plan's expiry into a status chip ──
function expiryInfo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: 'Expired', cls: 'exp', days };
  if (days === 0) return { label: 'Expires today', cls: 'warn', days };
  if (days <= 7) return { label: `Expires in ${days}d`, cls: 'warn', days };
  return { label: `${days}d left`, cls: 'ok', days };
}

// Tokens already consumed in this page session. We track them at module scope
// (not in component state / ref) so React 18 StrictMode's double-mount in dev
// AND any spurious re-renders cannot replay a single-use bot-login token.
const BT_CONSUMED = new Set();

// ── Point #6: web checkout recovery ──
// Persist an unfinished crypto order so a shopper who closes the tab mid-payment
// can resume it. Cleared once provisioned/failed/dismissed. 24h self-expiry.
const PENDING_KEY = 'nomadly_pending_order';
const savePendingOrder = (o) => {
  try {
    if (o && o.orderId) localStorage.setItem(PENDING_KEY, JSON.stringify({
      orderId: o.orderId, coin: o.coin, amountUsd: o.amountUsd, address: o.address,
      plan: o.plan, domain: o.domain, at: Date.now(),
    }));
  } catch { /* ignore */ }
};
const loadPendingOrder = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o?.orderId || (o.at && Date.now() - o.at > 24 * 3600 * 1000)) { localStorage.removeItem(PENDING_KEY); return null; }
    return o;
  } catch { return null; }
};
const clearPendingOrder = () => { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } };

/* Shared crypto payment box — polls the public order endpoint until provisioned */
function CryptoPayBox({ order, onProvisioned }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('pending');
  const [creds, setCreds] = useState(null);
  useEffect(() => {
    let iv; let done = false;
    const poll = async () => {
      try {
        const r = await fetch(`${BACKEND}/api/store/order/${order.orderId}`).then(x => x.json());
        if (done || !r) return;
        setStatus(r.status);
        if (r.status === 'provisioned') { done = true; clearInterval(iv); setCreds(r); clearPendingOrder(); onProvisioned && onProvisioned(r); }
        if (r.status === 'failed') { done = true; clearInterval(iv); setStatus('failed'); clearPendingOrder(); }
      } catch { /* keep polling */ }
    };
    poll(); iv = setInterval(() => { if (!done) poll(); }, 6000);
    return () => { done = true; clearInterval(iv); };
  }, [order.orderId, onProvisioned]);

  if (creds) {
    return (
      <div className="store-success" data-testid="store-crypto-provisioned">
        <h2>{t('store.readyTitle')}</h2>
        <p>Domain: <b>{creds.domain}</b></p>
        <div className="store-creds">
          <div><span>{t('store.username')}</span><code data-testid="store-cred-user">{creds.username}</code></div>
          <div><span>{t('store.pin')}</span><code data-testid="store-cred-pin">{creds.pin}</code></div>
        </div>
        <p className="store-muted">{t('store.credsEmailed')}</p>
        {Array.isArray(creds.nameservers) && creds.nameservers.length >= 2 && (
          <div className="store-ns-callout" data-testid="store-crypto-ns-callout">
            <p><b>⚠️ Point your domain to these nameservers at your registrar:</b></p>
            <ul className="store-ns-list">
              {creds.nameservers.slice(0, 4).map((ns, i) => (
                <li key={i}><span>NS{i + 1}:</span> <code data-testid={`store-crypto-ns-${i + 1}`}>{ns}</code></li>
              ))}
            </ul>
            <p className="store-muted">Propagation can take up to 24h. Your site is live the moment DNS updates.</p>
          </div>
        )}
        <a className="store-btn store-btn--primary" href="/panel" data-testid="store-crypto-open-panel">{t('store.goPanel')}</a>
      </div>
    );
  }
  return (
    <div className="store-topup-box" data-testid="store-crypto-pending">
      <p>{t('store.sendToAddr', { coin: order.coin, amount: money(order.amountUsd) })}</p>
      <div className="store-qr" data-testid="store-crypto-qr"><QRCode value={String(order.address || '')} size={148} bgColor="#ffffff" fgColor="#0b0e14" /></div>
      <code className="store-addr" data-testid="store-crypto-address">{order.address}</code>
      <p className="store-muted">{status === 'failed' ? t('store.paymentIssue') : t('store.waitingChain')}</p>
    </div>
  );
}

/* Guest "Buy now" modal — no account needed */
function GuestBuyModal({ plan, onClose }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [domain, setDomain] = useState('');
  const [domainMode, setDomainMode] = useState('byo');
  const [coin, setCoin] = useState('USDT-TRC20');
  const [search, setSearch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState(null);
  const modalRef = useRef(null);

  const doSearch = async () => {
    if (!domain.trim()) return;
    setSearch(null); setError('');
    try { setSearch(await fetch(`${BACKEND}/api/store/domain/search?domain=${encodeURIComponent(domain.trim())}`).then(r => r.json())); }
    catch (e) { setError(e.message); }
  };
  const total = plan.priceUsd + (domainMode === 'buy' && search?.available ? Number(search.priceUsd) : 0);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`${BACKEND}/api/store/guest/checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, domain: domain.trim().toLowerCase(), domainMode, email: email.trim().toLowerCase(), coin }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Checkout failed');
      setOrder(d);
      savePendingOrder(d);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // Once the shopper has typed anything (or an order exists), a stray backdrop
  // click must NOT wipe their entry. Backdrop is guarded; the × button and Esc
  // are explicit and always close.
  const dirty = Boolean(email.trim() || domain.trim() || order || search || coin !== 'USDT-TRC20');
  const guardedClose = useCallback(() => { if (!dirty) onClose(); }, [dirty, onClose]);

  // Accessibility: Esc closes, Tab is trapped inside the dialog, first field is
  // focused on open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && modalRef.current) {
        const f = modalRef.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const el = modalRef.current && modalRef.current.querySelector('input,select,button');
    const tmr = setTimeout(() => { if (el) el.focus(); }, 30);
    return () => { document.removeEventListener('keydown', onKey, true); clearTimeout(tmr); };
  }, [onClose]);

  return (
    <div className="store-modal-overlay" onClick={guardedClose} data-testid="store-guest-modal" role="dialog" aria-modal="true">
      <div className="store-modal" ref={modalRef} onClick={e => e.stopPropagation()}>
        <button className="store-modal-x" onClick={onClose} data-testid="store-guest-close">×</button>
        <h2>Buy {plan.name}</h2>
        <div className="store-total" data-testid="store-guest-total">Total: <b>{money(total)}</b></div>
        {order ? <CryptoPayBox order={order} /> : (
          <>
            {error && <div className="store-error" data-testid="store-guest-error">{error}</div>}
            <label className="store-label">{t('store.guestEmailLabel')}</label>
            <input type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} data-testid="store-guest-email" />
            <label className="store-label">Domain</label>
            <div className="store-domain-mode">
              <label><input type="radio" checked={domainMode === 'byo'} onChange={() => { setDomainMode('byo'); setSearch(null); }} data-testid="store-guest-byo" /> {t('store.ownDomain')}</label>
              <label><input type="radio" checked={domainMode === 'buy'} onChange={() => setDomainMode('buy')} data-testid="store-guest-buy" /> {t('store.buyDomain')}</label>
            </div>
            {domainMode === 'byo' && <p className="store-hint" data-testid="store-byo-hint">{t('store.byoHint')}</p>}
            <div className="store-domain-row">
              <input type="text" placeholder="mysite.com" value={domain} onChange={e => setDomain(e.target.value)} data-testid="store-guest-domain" />
              {domainMode === 'buy' && <button className="store-btn" onClick={doSearch} data-testid="store-guest-check">Check</button>}
            </div>
            {domainMode === 'buy' && search && <div className={`store-domain-result ${search.available ? 'ok' : 'no'}`}>{search.available ? `✓ ${search.domain} — ${money(search.priceUsd)}` : `✕ ${search.message || 'Not available'}`}</div>}
            <label className="store-label">{t('store.payWith')}</label>
            <select value={coin} onChange={e => setCoin(e.target.value)} data-testid="store-guest-coin">
              {COIN_OPTS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
            <button className="store-btn store-btn--primary" disabled={busy || !email.trim() || !domain.trim() || (domainMode === 'buy' && !search?.available)} onClick={submit} data-testid="store-guest-submit">
              {busy ? 'Creating order…' : `Pay ${money(total)} with crypto →`}
            </button>
            <p className="store-muted">{t('store.guestNote')}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Storefront() {
  return (
    <StoreProvider>
      <StoreInner />
    </StoreProvider>
  );
}

function StoreInner() {
  const { user, botLogin } = useStore();
  const [plans, setPlans] = useState([]);
  const [config, setConfig] = useState({ botUsername: 'NomadlyBot', botStartPayload: 'web-login' });
  const [botLoginStatus, setBotLoginStatus] = useState('idle'); // idle | exchanging | failed
  const [botLoginError, setBotLoginError] = useState('');
  const [pending, setPending] = useState(() => loadPendingOrder());
  const [resumeOpen, setResumeOpen] = useState(false);
  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/store/plans`).then(r => r.json()).then(d => setPlans(d.plans || [])).catch(() => {});
    fetch(`${BACKEND_URL}/api/store/config`).then(r => r.json()).then(d => setConfig(c => ({ ...c, ...d }))).catch(() => {});
  }, [BACKEND_URL]);

  // Auto-exchange ?bt=<token> for a web session (bot-issued one-tap login).
  // Use a module-level Set (not a ref) so React 18 StrictMode's double-mount
  // in dev cannot consume the single-use token twice.
  useEffect(() => {
    if (user) return;
    const params = new URLSearchParams(window.location.search);
    const bt = params.get('bt');
    if (!bt) return;
    if (BT_CONSUMED.has(bt)) return;
    BT_CONSUMED.add(bt);
    setBotLoginStatus('exchanging');
    botLogin(bt)
      .then(() => {
        // Scrub the token from URL so a reload doesn't 401 (single-use).
        params.delete('bt');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
        setBotLoginStatus('idle');
      })
      .catch((err) => {
        setBotLoginStatus('failed');
        setBotLoginError(err.message || 'Auto-login failed.');
      });
  }, [user, botLogin]);

  return (
    <div className="store-root" data-testid="storefront">
      {botLoginStatus === 'exchanging' && (
        <div className="store-bot-toast" data-testid="store-bot-toast">Signing you in via Telegram…</div>
      )}
      {pending && !resumeOpen && (
        <PendingOrderBanner
          order={pending}
          onResume={() => setResumeOpen(true)}
          onDismiss={() => { clearPendingOrder(); setPending(null); }}
        />
      )}
      {resumeOpen && pending && (
        <ResumePayModal
          order={pending}
          onClose={() => setResumeOpen(false)}
          onDone={() => { clearPendingOrder(); setPending(null); setResumeOpen(false); }}
        />
      )}
      {user ? <Dashboard plans={plans} /> : <AuthGate plans={plans} config={config} botLoginError={botLoginStatus === 'failed' ? botLoginError : ''} />}
    </div>
  );
}

/* ── Point #6: pending-payment recovery banner + resume modal ── */
function PendingOrderBanner({ order, onResume, onDismiss }) {
  return (
    <div className="store-resume-banner" data-testid="store-resume-banner">
      <span className="store-resume-banner__text">
        ⏳ You have an unfinished payment for <b>{order.plan}</b>{order.domain ? <> · <b>{order.domain}</b></> : null} — {money(order.amountUsd)} in {order.coin}.
      </span>
      <span className="store-resume-banner__actions">
        <button className="store-btn store-btn--primary" onClick={onResume} data-testid="store-resume-btn">Resume payment →</button>
        <button className="store-link" onClick={onDismiss} data-testid="store-resume-dismiss">Dismiss</button>
      </span>
    </div>
  );
}

function ResumePayModal({ order, onClose, onDone }) {
  return (
    <div className="store-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" data-testid="store-resume-modal">
      <div className="store-modal" onClick={e => e.stopPropagation()}>
        <button className="store-modal-x" onClick={onClose} data-testid="store-resume-close">×</button>
        <h2>Resume payment</h2>
        <div className="store-total" data-testid="store-resume-total">Plan: <b>{order.plan}</b>{order.domain ? <> · Domain: <b>{order.domain}</b></> : null}</div>
        <CryptoPayBox order={order} onProvisioned={() => onDone && onDone()} />
      </div>
    </div>
  );
}

/* ───────────── Theme + brand row used on every storefront page ───────────── */
// Brand mark that degrades gracefully: if a logo URL is supplied but fails to
// load (wrong host / offline asset), we fall back to the letter mark instead of
// showing a broken-image icon on the hero.
function BrandLogo({ logoUrl, letter }) {
  const [broken, setBroken] = useState(false);
  if (logoUrl && !broken) {
    return (
      <img
        className="store-logo store-logo--img"
        src={logoUrl}
        alt=""
        onError={() => setBroken(true)}
        data-testid="store-logo-img"
      />
    );
  }
  return <span className="store-logo" data-testid="store-logo-letter">{letter || 'H'}</span>;
}

function StoreHeader({ rightExtras, logoUrl, brandName = 'HostBay' }) {
  const { theme, toggleTheme, isDark } = useTheme();
  const { t } = useTranslation();
  return (
    <header className="store-top">
      <div className="store-brand">
        <BrandLogo logoUrl={logoUrl} letter={(brandName || 'H').charAt(0).toUpperCase()} />
        <span className="store-brand-name">{brandName}</span>
        <span className="store-sub">Anti-Red Hosting</span>
      </div>
      <div className="store-top-right">
        {rightExtras}
        <LanguageSwitcher />
        <button
          className="store-icon-btn"
          onClick={toggleTheme}
          aria-label={t('store.themeToggle')}
          title={t('store.themeToggle')}
          data-testid="store-theme-toggle"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}

/* Trust row shown under the plans + inside checkout — reassurance for a
   crypto-only, instant-delivery product. */
function TrustRow({ supportHandle }) {
  const { t } = useTranslation();
  const items = [t('store.trustInstant'), t('store.trustReplace'), t('store.trustUptime'), t('store.trustNoLogin')];
  if (supportHandle) items.push(t('store.trustSupport', { handle: supportHandle }));
  return (
    <div className="store-trust-row" data-testid="store-trust-row">
      {items.map((x, i) => <span key={i} className="store-trust-item">✓ {x}</span>)}
    </div>
  );
}

/* ─────────────── Not logged in: showcase + UNIFIED auth ─────────────── */
function AuthGate({ plans, config, botLoginError }) {
  const { login: webLogin } = useStore();
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(botLoginError || '');
  const [buyPlan, setBuyPlan] = useState(null);

  // Surface bot-login failure as a regular form error so it's visible.
  useEffect(() => { if (botLoginError) setError(botLoginError); }, [botLoginError]);

  // Build the Telegram deep-link used by the QR + "Open Telegram" button.
  const botUsername = (config?.botUsername || 'NomadlyBot').replace(/^@/, '');
  const startPayload = config?.botStartPayload || 'web-login';
  const tgDeepLink = `https://t.me/${botUsername}?start=${encodeURIComponent(startPayload)}`;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    const id = identifier.trim();
    const pw = secret;
    try {
      if (isEmail(id)) {
        // Email → web storefront login (existing webUser collection)
        await webLogin(id.toLowerCase(), pw);
        // success → useStore() user becomes truthy → Dashboard renders
      } else {
        // Username → HostPanel login. On success, store panel_session and route to /panel.
        const res = await fetch(`${BACKEND}/api/panel/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: id, pin: pw }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Login failed (${res.status})`);
        const session = {
          token: body.token,
          username: body.username,
          domain: body.domain,
          isGold: !!body.isGold,
          plan: body.plan || '',
        };
        sessionStorage.setItem('panel_session', JSON.stringify(session));
        window.location.href = '/panel';
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="store-landing">
      <StoreHeader logoUrl={config?.logoUrl} brandName={config?.brandName || 'HostBay'} />

      <div className="store-landing-grid">
        {/* RIGHT column on desktop, BELOW plans on mobile: unified single login */}
        <aside className="store-landing-right" id="store-signin">
          <section className="store-auth-card" data-testid="store-auth-card">
            <h2 className="store-auth-title">{t('store.loginTitle')}</h2>
            <p className="store-muted store-auth-sub">{t('store.loginSub')}</p>
            <p className="store-auth-hint" data-testid="store-login-helper">{t('store.loginHelper')}</p>
            <form onSubmit={submit}>
              {error && <div className="store-error" data-testid="store-auth-error">{error}</div>}
              <label className="store-label" htmlFor="store-id-input">{t('store.userOrEmail')}</label>
              <input
                id="store-id-input"
                type="text"
                inputMode="email"
                autoComplete="username"
                placeholder={t('store.userOrEmailPh')}
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                required
                autoFocus
                data-testid="store-id-input"
              />
              <label className="store-label" htmlFor="store-secret-input">{t('store.passOrPin')}</label>
              <input
                id="store-secret-input"
                type="password"
                autoComplete="current-password"
                placeholder={t('store.passOrPinPh')}
                value={secret}
                onChange={e => setSecret(e.target.value)}
                required
                data-testid="store-secret-input"
              />
              <button type="submit" className="store-btn store-btn--primary" disabled={busy || !identifier.trim() || !secret} data-testid="store-auth-submit">
                {busy ? t('store.pleaseWait') : t('store.signInBtn')}
              </button>
            </form>
            <p className="store-muted store-auth-help" data-testid="store-no-acct">
              {t('store.noAcct')}
            </p>

            {/* ── Continue with Telegram: one-tap login via the bot ── */}
            <div className="store-tg-section" data-testid="store-tg-section">
              <div className="store-tg-divider"><span>{t('store.orDivider')}</span></div>
              <a
                href={tgDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="store-btn store-btn--telegram"
                data-testid="store-tg-button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.871 4.326-2.96-.924c-.643-.204-.66-.643.135-.953l11.566-4.458c.532-.196.998.128.832.938z"/></svg>
                {t('store.tgButton')}
              </a>
              <div className="store-tg-qr-wrap">
                <div className="store-tg-qr" data-testid="store-tg-qr">
                  <QRCode value={tgDeepLink} size={132} bgColor="#ffffff" fgColor="#0b0e14" />
                </div>
                <p className="store-muted store-tg-qr-cap">{t('store.tgScanCap')}</p>
              </div>
            </div>
          </section>
        </aside>

        {/* LEFT column on desktop, FIRST on mobile: hero + plans */}
        <div className="store-landing-left">
          <section className="store-hero">
            <h1>{t('store.heroTitle')}</h1>
            <p>{t('store.tagline')}</p>
            <p className="store-hero-explainer" data-testid="store-antired-explainer">{t('store.antiRedExplainer')}</p>
            <a href="#store-signin" className="store-hero-signin" data-testid="store-mobile-signin">{t('store.signInMobile')} ↓</a>
          </section>

          <section className="store-plan-grid" data-testid="store-plans">
            {plans.map(p => {
              const isGold = p.tier === 'gold';
              const per = p.durationDays === 7 ? t('store.perWeek') : t('store.perMonth');
              const moEq = p.durationDays === 7 ? (Number(p.priceUsd) * 30 / 7) : null;
              return (
                <div key={p.id} className={`store-plan-card ${isGold ? 'store-plan-card--gold' : ''}`} data-testid={`store-plan-${p.id}`}>
                  {isGold && <div className="store-plan-badge" data-testid={`store-badge-${p.id}`}>{t('store.badgePopular')}</div>}
                  <div className="store-plan-name">{p.name}</div>
                  <div className="store-plan-price">{money(p.priceUsd)}<span className="store-plan-per">/{per}</span></div>
                  <div className="store-plan-billing" data-testid={`store-billing-${p.id}`}>
                    {moEq ? `${t('store.moEquiv', { amount: money(moEq) })} · ${t('store.billedWeekly')}` : t('store.billedMonthly')}
                  </div>
                  <ul className="store-plan-feats">{(p.features || []).map((f, i) => <li key={i}><span className="store-feat-check" aria-hidden="true">✓</span>{f}</li>)}</ul>
                  <button
                    className={`store-btn store-btn--primary ${isGold ? 'store-btn--gold' : ''}`}
                    onClick={() => setBuyPlan(p)}
                    data-testid={`store-buynow-${p.id}`}
                  >
                    {isGold ? t('store.getPlan', { name: (p.name || '').split(' ')[0] }) : t('store.buyNow')}
                  </button>
                </div>
              );
            })}
          </section>

          <TrustRow supportHandle={config?.supportHandle} />
        </div>
      </div>

      {buyPlan && <GuestBuyModal plan={buyPlan} onClose={() => setBuyPlan(null)} />}
    </div>
  );
}

/* ─────────────── Logged in: dashboard ─────────────── */
function Dashboard({ plans }) {
  const { user, logout } = useStore();
  const { t } = useTranslation();
  const [tab, setTab] = useState('buy');

  return (
    <div className="store-dash">
      <StoreHeader
        rightExtras={
          <>
            <span className="store-wallet-pill" data-testid="store-wallet-balance">{t('store.walletLabel')} {money(user.walletUsd)}</span>
            {user.tgLinked && (
              <span className="store-tg-pill" title={`Telegram chatId ${user.tgChatId}${user.tgDisplay ? ` — ${user.tgDisplay}` : ''}`} data-testid="store-tg-linked">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.871 4.326-2.96-.924c-.643-.204-.66-.643.135-.953l11.566-4.458c.532-.196.998.128.832.938z"/></svg>
                {t('store.tgLinked')}
              </span>
            )}
            <span className="store-email">{user.email}</span>
            <button className="store-link" onClick={logout} data-testid="store-logout">{t('store.logout')}</button>
          </>
        }
      />

      <nav className="store-tabs" data-testid="store-tabs">
        <button className={tab === 'buy' ? 'active' : ''} onClick={() => setTab('buy')} data-testid="store-tab-buy">{t('store.tabBuy')}</button>
        <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')} data-testid="store-tab-wallet">{t('store.tabWallet')}</button>
        <button className={tab === 'plans' ? 'active' : ''} onClick={() => setTab('plans')} data-testid="store-tab-plans">{t('store.tabPlans')}</button>
      </nav>

      <main className="store-main">
        {tab === 'buy' && <BuyTab plans={plans} goWallet={() => setTab('wallet')} goPlans={() => setTab('plans')} />}
        {tab === 'wallet' && <WalletTab />}
        {tab === 'plans' && <PlansTab />}
      </main>
    </div>
  );
}

function openPanel(api, cpUser, setBusy, setError) {
  setBusy(true); setError('');
  api('/open-panel', { method: 'POST', body: JSON.stringify({ cpUser }) })
    .then(r => {
      const session = { token: r.token, username: r.cpUser, domain: r.domain, isGold: false, plan: '' };
      sessionStorage.setItem('panel_session', JSON.stringify(session));
      window.location.href = '/panel';
    })
    .catch(err => { setError(err.message); setBusy(false); });
}

/* ── Buy Hosting ── */
function BuyTab({ plans, goWallet, goPlans }) {
  const { api, setWallet } = useStore();
  const [planId, setPlanId] = useState(plans[0]?.id || '');
  const [domain, setDomain] = useState('');
  const [domainMode, setDomainMode] = useState('byo');
  const [search, setSearch] = useState(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [openBusy, setOpenBusy] = useState(false);
  const [payMethod, setPayMethod] = useState('wallet');
  const [coin, setCoin] = useState('USDT-TRC20');
  const [cryptoOrder, setCryptoOrder] = useState(null);

  useEffect(() => { if (!planId && plans[0]) setPlanId(plans[0].id); }, [plans, planId]);
  const plan = plans.find(p => p.id === planId);

  const doSearch = async () => {
    if (!domain.trim()) return;
    setSearching(true); setSearch(null); setError('');
    try { setSearch(await api(`/domain/search?domain=${encodeURIComponent(domain.trim())}`)); }
    catch (err) { setError(err.message); } finally { setSearching(false); }
  };

  const total = (plan?.priceUsd || 0) + (domainMode === 'buy' && search?.available ? Number(search.priceUsd) : 0);

  const buy = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      if (payMethod === 'crypto') {
        const r = await api('/hosting/pay-crypto', { method: 'POST', body: JSON.stringify({ planId, domain: domain.trim().toLowerCase(), domainMode, coin }) });
        setCryptoOrder(r);
        savePendingOrder(r);
      } else {
        const r = await api('/hosting/purchase', { method: 'POST', body: JSON.stringify({ planId, domain: domain.trim().toLowerCase(), domainMode }) });
        if (r.success) { setResult(r); if (typeof r.balanceUsd === 'number') setWallet(r.balanceUsd); }
      }
    } catch (err) {
      if (err.status === 402) setError(`${err.message}`);
      else setError(err.message);
    } finally { setBusy(false); }
  };

  if (cryptoOrder) {
    return (
      <div className="store-card" data-testid="store-buy-crypto">
        <h2>Pay with crypto</h2>
        <p className="store-muted">Plan: <b>{cryptoOrder.plan}</b> · Domain: <b>{cryptoOrder.domain}</b></p>
        <CryptoPayBox order={cryptoOrder} onProvisioned={() => {}} />
      </div>
    );
  }

  if (result) {
    return (
      <div className="store-card store-success" data-testid="store-purchase-success">
        <h2>🎉 Your hosting is being set up!</h2>
        <p>Domain: <b>{result.domain}</b> · Plan: <b>{result.plan}</b></p>
        <div className="store-creds">
          <div><span>HostPanel Username</span><code data-testid="store-cred-user">{result.username}</code></div>
          <div><span>HostPanel PIN</span><code data-testid="store-cred-pin">{result.pin}</code></div>
        </div>
        <p className="store-muted">These were also emailed to you. Use them to log into the panel anytime.</p>
        {Array.isArray(result.nameservers) && result.nameservers.length >= 2 && (
          <div className="store-ns-callout" data-testid="store-purchase-ns-callout">
            <p><b>⚠️ Point your domain to these nameservers at your registrar:</b></p>
            <ul className="store-ns-list">
              {result.nameservers.slice(0, 4).map((ns, i) => (
                <li key={i}><span>NS{i + 1}:</span> <code data-testid={`store-purchase-ns-${i + 1}`}>{ns}</code></li>
              ))}
            </ul>
            <p className="store-muted">Propagation can take up to 24h. Your site is live the moment DNS updates.</p>
          </div>
        )}
        <button className="store-btn store-btn--primary" disabled={openBusy} onClick={() => openPanel(api, result.username, setOpenBusy, setError)} data-testid="store-open-panel-success">
          {openBusy ? 'Opening…' : 'Open HostPanel →'}
        </button>
        <button className="store-btn" onClick={goPlans}>View My Plans</button>
        {error && <div className="store-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="store-card" data-testid="store-buy">
      <h2>Buy a Hosting Plan</h2>
      {error && (
        <div className="store-error" data-testid="store-buy-error">
          {error} {error.includes('top up') && <button className="store-link" onClick={goWallet} data-testid="store-goto-wallet">Top up wallet →</button>}
        </div>
      )}

      <label className="store-label">Plan</label>
      <div className="store-plan-pick">
        {plans.map(p => (
          <button key={p.id} className={`store-pick ${planId === p.id ? 'store-pick--active' : ''}`} onClick={() => setPlanId(p.id)} data-testid={`store-pick-${p.id}`}>
            <span>{p.name}</span><b>{money(p.priceUsd)}</b>
          </button>
        ))}
      </div>

      <label className="store-label">Domain</label>
      <div className="store-domain-mode">
        <label><input type="radio" checked={domainMode === 'byo'} onChange={() => { setDomainMode('byo'); setSearch(null); }} data-testid="store-domain-byo" /> I already own a domain</label>
        <label><input type="radio" checked={domainMode === 'buy'} onChange={() => setDomainMode('buy')} data-testid="store-domain-buy" /> Buy a new domain</label>
      </div>
      <div className="store-domain-row">
        <input type="text" placeholder="mysite.com" value={domain} onChange={e => setDomain(e.target.value)} data-testid="store-domain-input" />
        {domainMode === 'buy' && <button className="store-btn" onClick={doSearch} disabled={searching} data-testid="store-domain-check">{searching ? 'Checking…' : 'Check'}</button>}
      </div>
      {domainMode === 'buy' && search && (
        <div className={`store-domain-result ${search.available ? 'ok' : 'no'}`} data-testid="store-domain-result">
          {search.available ? `✓ ${search.domain} is available — ${money(search.priceUsd)}` : `✕ ${search.message || 'Not available'}`}
        </div>
      )}

      <div className="store-total" data-testid="store-total">Total: <b>{money(total)}</b> {domainMode === 'buy' && search?.available ? `(plan ${money(plan?.priceUsd)} + domain ${money(search.priceUsd)})` : ''}</div>

      <label className="store-label">Payment method</label>
      <div className="store-domain-mode">
        <label><input type="radio" checked={payMethod === 'wallet'} onChange={() => setPayMethod('wallet')} data-testid="store-pay-wallet" /> Pay from wallet</label>
        <label><input type="radio" checked={payMethod === 'crypto'} onChange={() => setPayMethod('crypto')} data-testid="store-pay-crypto" /> Pay with crypto directly</label>
      </div>
      {payMethod === 'crypto' && (
        <select value={coin} onChange={e => setCoin(e.target.value)} data-testid="store-pay-coin" style={{ marginBottom: 8 }}>
          {COIN_OPTS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      )}

      <button
        className="store-btn store-btn--primary"
        onClick={buy}
        disabled={busy || !planId || !domain.trim() || (domainMode === 'buy' && !search?.available)}
        data-testid="store-buy-submit"
      >
        {busy ? 'Processing…' : (payMethod === 'crypto' ? `Pay ${money(total)} with crypto →` : `Pay ${money(total)} from wallet →`)}
      </button>
    </div>
  );
}

/* ── Wallet + crypto top-up ── */
function WalletTab() {
  const { api, setWallet } = useStore();
  const { t } = useTranslation();
  const [wallet, setW] = useState(null);
  const [coin, setCoin] = useState('USDT-TRC20');
  const [amount, setAmount] = useState('25');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [topup, setTopup] = useState(null);

  const load = useCallback(async () => {
    try { const w = await api('/wallet'); setW(w); if (typeof w.balanceUsd === 'number') setWallet(w.balanceUsd); }
    catch (err) { setError(err.message); }
  }, [api, setWallet]);

  useEffect(() => { load(); }, [load]);

  const minFor = (c) => (wallet?.coins || []).find(x => x.code === c)?.min || 10;

  const startTopup = async () => {
    setBusy(true); setError(''); setTopup(null);
    try {
      const r = await api('/wallet/topup', { method: 'POST', body: JSON.stringify({ amountUsd: Number(amount), coin }) });
      setTopup(r);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!topup?.orderId || topup.status === 'credited') return;
    const iv = setInterval(async () => {
      try {
        const s = await api(`/wallet/topup/${topup.orderId}`);
        if (s.status === 'credited') { setTopup(t => ({ ...t, status: 'credited' })); if (typeof s.balanceUsd === 'number') setWallet(s.balanceUsd); load(); clearInterval(iv); }
      } catch { /* keep polling */ }
    }, 6000);
    return () => clearInterval(iv);
  }, [topup, api, setWallet, load]);

  return (
    <div className="store-card" data-testid="store-wallet">
      <div className="store-wallet-head">
        <div>{t('store.balanceLabel')}</div>
        <div className="store-bigbal" data-testid="store-wallet-bigbal">{money(wallet?.balanceUsd)}</div>
      </div>
      {error && <div className="store-error">{error}</div>}

      <h3>{t('store.topupTitle')}</h3>
      <div className="store-topup-row">
        <select value={coin} onChange={e => setCoin(e.target.value)} data-testid="store-topup-coin">
          {(wallet?.coins || []).map(c => <option key={c.code} value={c.code}>{c.name} (min ${c.min})</option>)}
        </select>
        <input type="number" min={minFor(coin)} value={amount} onChange={e => setAmount(e.target.value)} data-testid="store-topup-amount" />
        <button className="store-btn store-btn--primary" onClick={startTopup} disabled={busy} data-testid="store-topup-submit">
          {busy ? t('store.pleaseWait') : t('store.getAddress')}
        </button>
      </div>
      <div className="store-muted">Minimum {money(minFor(coin))} for {coin}.</div>

      {topup && (
        <div className="store-topup-box" data-testid="store-topup-box">
          {topup.status === 'credited' ? (
            <div className="store-success-inline" data-testid="store-topup-credited">✓ Payment received — wallet credited!</div>
          ) : (
            <>
              <p>Send <b>{coin}</b> worth <b>{money(topup.amountUsd)}</b> to:</p>
              <div className="store-qr" data-testid="store-topup-qr"><QRCode value={String(topup.address || '')} size={148} bgColor="#ffffff" fgColor="#0b0e14" /></div>
              <code className="store-addr" data-testid="store-topup-address">{topup.address}</code>
              <p className="store-muted">Waiting for payment confirmation… this updates automatically.</p>
            </>
          )}
        </div>
      )}

      <h3>{t('store.recentActivity')}</h3>
      <div className="store-txns" data-testid="store-txns">
        {(wallet?.txns || []).length === 0 && <div className="store-muted">{t('store.noTxns')}</div>}
        {(wallet?.txns || []).map(t => (
          <div key={t.id} className="store-txn">
            <span>{t.note || t.type}</span>
            <b className={t.amountUsd >= 0 ? 'pos' : 'neg'}>{t.amountUsd >= 0 ? '+' : ''}{money(t.amountUsd)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── My Plans ── */
function PlansTab() {
  const { api } = useStore();
  const { t } = useTranslation();
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [openBusy, setOpenBusy] = useState('');

  useEffect(() => { api('/my-plans').then(d => setPlans(d.plans || [])).catch(e => setError(e.message)); }, [api]);

  return (
    <div className="store-card" data-testid="store-myplans">
      <h2>{t('store.myPlansTitle')}</h2>
      {error && <div className="store-error">{error}</div>}
      {plans === null ? <div className="store-muted">{t('store.loading')}</div> :
        plans.length === 0 ? <div className="store-muted">{t('store.noPlans')}</div> :
        plans.map(p => {
          const exp = expiryInfo(p.expiryDate);
          return (
          <div key={p.cpUser} className="store-myplan" data-testid={`store-myplan-${p.domain}`}>
            <div>
              <div className="store-myplan-domain">{p.domain}</div>
              <div className="store-muted">{p.plan} · {p.addonCount} addon(s){p.suspended ? ' · SUSPENDED' : ''}</div>
              {exp && (
                <div className="store-myplan-lifecycle" data-testid={`store-myplan-expiry-${p.domain}`}>
                  <span className={`store-exp-chip store-exp-chip--${exp.cls}`}>{exp.label}</span>
                  {(exp.cls === 'warn' || exp.cls === 'exp') && (
                    <span className="store-exp-hint">{exp.cls === 'exp' ? 'Renew now to restore your site.' : 'Top up your wallet to auto-renew.'}</span>
                  )}
                </div>
              )}
            </div>
            <button
              className="store-btn store-btn--primary"
              disabled={openBusy === p.cpUser}
              onClick={() => { setOpenBusy(p.cpUser); openPanel(api, p.cpUser, () => {}, setError); }}
              data-testid={`store-open-${p.domain}`}
            >
              {openBusy === p.cpUser ? t('store.opening') : t('store.openPanel')}
            </button>
          </div>
          );
        })}
    </div>
  );
}
