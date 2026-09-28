import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import { pickErrorMessage, friendlyMessage, isTransientError } from './shared/cpanelErrors';
import PanelEmptyState from './shared/PanelEmptyState';

// ── Shared subdomain name helpers ───────────────────────────────────────
// The /subdomains payload varies by source: production list_domains returns
// objects whose `domain` is ALREADY the full FQDN (api.example.com); the
// string-mapped path exposes `fullDomain`; the WHM api2 fallback returns
// `domain` as just the label + a separate `rootdomain`. The old render did
// `${s.domain}.${rootdomain}` unconditionally → "api.example.com.example.com".
// These helpers derive the display FQDN and docroot correctly for every shape
// (and are reused by the optimistic-delete filter so both agree).
function subDisplayName(s) {
  if (!s) return '';
  if (typeof s === 'string') return s;
  if (s.fullDomain) return s.fullDomain;
  const domainField = typeof s.domain === 'string' ? s.domain : '';
  const rootDom = s.rootdomain || '';
  if (domainField.includes('.')) return domainField;       // already an FQDN
  if (domainField && rootDom) return `${domainField}.${rootDom}`;
  return domainField || String(s);
}
function subDocRoot(s) {
  if (!s || typeof s === 'string') return `public_html/${String(s || '')}`;
  if (s.dir) return s.dir;
  if (s.documentroot) return s.documentroot;
  const domainField = typeof s.domain === 'string' ? s.domain : '';
  const rootDom = s.rootdomain || '';
  const prefix = s.subdomain
    || (domainField.includes('.') && rootDom ? domainField.slice(0, -(rootDom.length + 1)) : domainField)
    || '';
  return `public_html/${prefix}`;
}

export default function DomainList() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en').slice(0, 2);
  const { api, updateSession, user } = useAuth();
  const [domains, setDomains] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorRaw, setErrorRaw] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [nsStatus, setNsStatus] = useState({});
  const [nsLoading, setNsLoading] = useState({});
  const [addResult, setAddResult] = useState(null);
  // SSL
  const [sslStatus, setSslStatus] = useState({});
  const [sslLoading, setSslLoading] = useState(false);
  const [cfSSLMode, setCfSSLMode] = useState(null);
  // Subdomain
  const [showSubCreate, setShowSubCreate] = useState(false);
  const [subName, setSubName] = useState('');
  const [subRoot, setSubRoot] = useState('');
  const [creatingSub, setCreatingSub] = useState(false);
  // Bulk subdomain import (paste a comma/newline-separated list → /subdomains/bulk-create)
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [subdomains, setSubdomains] = useState([]);
  const [subLoading, setSubLoading] = useState(true);
  // Domain document-root mode (mirror primary vs own folder) + set-primary
  const [docrootModes, setDocrootModes] = useState({});
  const [modeBusy, setModeBusy] = useState({});
  const [primaryBusy, setPrimaryBusy] = useState({});
  const [addMode, setAddMode] = useState('own');
  const [actionMsg, setActionMsg] = useState(null);

  const fetchDomains = useCallback(async () => {
    setLoading(true);
    setError('');
    setErrorRaw('');
    try {
      const res = await api('/domains');
      if (res.errors?.length || res.code === 'CPANEL_DOWN') {
        setError(pickErrorMessage(res, t, lang));
        setErrorRaw((res.errors && res.errors[0]) || res.code || '');
      } else {
        setDomains(res.data || {});
      }
    } catch (err) {
      setError(friendlyMessage(err.message, t) || err.message);
      setErrorRaw(err.message || '');
    } finally {
      setLoading(false);
    }
  }, [api, t, lang]);

  // FQDNs of subdomains just deleted by the user. WHM's listsubdomains lags for
  // a few seconds after a delete, so an eager refetch would re-show a row the
  // user just removed (the "reappears after delete" flicker). We hide guarded
  // names until WHM confirms they're gone, then auto-clear the guard.
  const recentlyDeletedSubsRef = useRef(new Set());

  const fetchSubdomains = useCallback(async () => {
    setSubLoading(true);
    try {
      const res = await api('/subdomains');
      if (res.data && Array.isArray(res.data)) {
        const guard = recentlyDeletedSubsRef.current;
        // A guarded name no longer returned by WHM has propagated → stop guarding it.
        for (const name of Array.from(guard)) {
          if (!res.data.some(s => subDisplayName(s) === name)) guard.delete(name);
        }
        // Hide any just-deleted names WHM is still (stale-)listing.
        setSubdomains(res.data.filter(s => !guard.has(subDisplayName(s))));
      }
    } catch (_) {}
    setSubLoading(false);
  }, [api]);

  const fetchSSL = useCallback(async () => {
    setSslLoading(true);
    try {
      const res = await api('/domains/ssl');
      if (res.data) {
        setSslStatus(res.data);
      }
      if (res.cfSSLMode) {
        setCfSSLMode(res.cfSSLMode);
      }
    } catch (_) {}
    setSslLoading(false);
  }, [api]);

  const fetchDocrootModes = useCallback(async () => {
    try {
      const res = await api('/domains/docroot-modes');
      setDocrootModes(res.modes || {});
    } catch (_) {}
  }, [api]);

  useEffect(() => {
    fetchDomains();
    fetchSubdomains();
    fetchSSL();
    fetchDocrootModes();
  }, [fetchDomains, fetchSubdomains, fetchSSL, fetchDocrootModes]);

  // Auto-check NS status for all domains on load
  useEffect(() => {
    if (!domains) return;
    const mainDomain = domains.main_domain;
    const addonDomains = domains.addon_domains || [];
    const allDoms = [mainDomain, ...addonDomains].filter(Boolean);
    allDoms.forEach((d) => {
      if (!nsStatus[d] && !nsLoading[d]) {
        checkNS(d);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains]);

  const checkNS = async (domain) => {
    setNsLoading(p => ({ ...p, [domain]: true }));
    try {
      const res = await api(`/domains/ns-status?domain=${encodeURIComponent(domain)}`);
      setNsStatus(p => ({ ...p, [domain]: res }));
      // If NS is active, refresh SSL status (but don't auto-trigger AutoSSL — that's a manual action)
      if (res.status === 'active') {
        fetchSSL();
      }
    } catch (_) {
      setNsStatus(p => ({ ...p, [domain]: { status: 'error' } }));
    }
    setNsLoading(p => ({ ...p, [domain]: false }));
  };

  const [autoSSLLoading, setAutoSSLLoading] = useState(false);
  const [autoSSLResult, setAutoSSLResult] = useState(null);

  // Visitor Captcha (Anti-Red) per-domain toggle state
  const [captchaInfo, setCaptchaInfo] = useState({ isGold: false, plan: '', goldPrice: 100, botUrl: '', loaded: false });
  const [captchaByDomain, setCaptchaByDomain] = useState({});
  const [captchaToggling, setCaptchaToggling] = useState({});
  const [captchaError, setCaptchaError] = useState('');

  const fetchCaptcha = useCallback(async () => {
    try {
      const res = await api('/security/captcha/status');
      const map = {};
      (res.domains || []).forEach(d => { map[d.domain] = d; });
      setCaptchaByDomain(map);
      setCaptchaInfo({
        isGold: !!res.isGold,
        plan: res.plan || '',
        goldPrice: Number(res.goldPrice) || 100,
        botUrl: res.botUrl || 'https://t.me/nomadlybot',
        loaded: true,
      });
    } catch (_) {
      setCaptchaInfo({ isGold: false, plan: '', goldPrice: 100, botUrl: 'https://t.me/nomadlybot', loaded: true });
    }
  }, [api]);

  useEffect(() => { fetchCaptcha(); }, [fetchCaptcha]);

  const toggleCaptcha = async (domain) => {
    const current = captchaByDomain[domain];
    if (!current) return;
    if (!captchaInfo.isGold) return; // locked — handled in UI
    if (!current.hasCloudflare) {
      setCaptchaError(t('dl.captchaNotCloudflare', { domain }));
      return;
    }
    if (current.enabled) {
      const ok = window.confirm(t('dl.captchaDisableConfirm', { domain }));
      if (!ok) return;
    }
    setCaptchaToggling(p => ({ ...p, [domain]: true }));
    setCaptchaError('');
    try {
      const res = await api('/security/captcha/toggle', {
        method: 'POST',
        body: JSON.stringify({ domain, enabled: !current.enabled }),
      });
      if (res.success) {
        setCaptchaByDomain(p => ({ ...p, [domain]: { ...p[domain], enabled: !!res.enabled } }));
      } else {
        setCaptchaError(res.error || t('dl.captchaFailedToggle'));
      }
    } catch (err) {
      setCaptchaError(err.message);
    } finally {
      setCaptchaToggling(p => ({ ...p, [domain]: false }));
    }
  };

  const renderCaptchaBadge = (domain) => {
    const info = captchaByDomain[domain];
    const isGold = captchaInfo.isGold;
    const toggling = !!captchaToggling[domain];
    if (!captchaInfo.loaded || !info) {
      return <span className="dl-cap-badge dl-cap-badge--loading" data-testid={`dl-cap-loading-${domain}`}>{t('dl.captchaLoading')}</span>;
    }
    if (!isGold) {
      return (
        <span
          className="dl-cap-badge dl-cap-badge--locked"
          title={t('dl.captchaGoldTooltip', { price: captchaInfo.goldPrice, plan: captchaInfo.plan || t('sec.unknownPlan') })}
          data-testid={`dl-cap-locked-${domain}`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          🔒 {t('dl.captchaGoldBadge', { price: captchaInfo.goldPrice })}
        </span>
      );
    }
    if (!info.hasCloudflare) {
      return (
        <span className="dl-cap-badge dl-cap-badge--nocf" title={t('dl.captchaNAtooltip')} data-testid={`dl-cap-nocf-${domain}`}>
          {t('dl.captchaNA')}
        </span>
      );
    }
    return (
      <button
        type="button"
        className={`dl-cap-toggle ${info.enabled ? 'dl-cap-toggle--on' : 'dl-cap-toggle--off'}`}
        onClick={() => toggleCaptcha(domain)}
        disabled={toggling}
        title={info.enabled ? t('dl.captchaOnTooltip') : t('dl.captchaOffTooltip')}
        data-testid={`dl-cap-toggle-${domain}`}
      >
        <span className="dl-cap-knob" />
        <span className="dl-cap-label">{toggling ? '...' : (info.enabled ? `🛡️ ${t('dl.captchaOnLabel')}` : `🛡️ ${t('dl.captchaOffLabel')}`)}</span>
      </button>
    );
  };

  const triggerAutoSSL = async () => {
    setAutoSSLLoading(true);
    setAutoSSLResult(null);
    try {
      const res = await api('/domains/ssl/autossl', { method: 'POST' });
      if (res.success) {
        setAutoSSLResult({ success: true, message: res.message || t('dl.autosslStarted') });
        // Refresh SSL status after a delay to let certs issue
        setTimeout(() => fetchSSL(), 10000);
      } else {
        setAutoSSLResult({ success: false, message: res.error || t('dl.autosslFailed') });
      }
    } catch (err) {
      setAutoSSLResult({ success: false, message: err.message || t('dl.autosslRequestFailed') });
    }
    setAutoSSLLoading(false);
  };

  const handleAdd = async () => {
    if (!newDomain.trim()) return;
    setAdding(true);
    setError('');
    setAddResult(null);
    try {
      const res = await api('/domains/add-enhanced', {
        method: 'POST',
        body: JSON.stringify({ domain: newDomain.trim(), mode: addMode }),
      });
      if (res.errors?.length) {
        setError(res.errors[0]);
      } else {
        setAddResult(res.nsInfo || null);
        // Update NS status immediately for the new domain
        if (res.nsInfo) {
          setNsStatus(p => ({ ...p, [newDomain.trim()]: res.nsInfo }));
        }
        setNewDomain('');
        setAddMode('own');
        fetchDomains();
        fetchSubdomains();
        fetchSSL();
        fetchDocrootModes();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (domain) => {
    if (!window.confirm(t('dl.removeAddonConfirm', { domain }))) return;
    // Optimistic: strip the domain from the local view immediately so removal
    // feels instant. Snapshot first — on any failure (incl. the backend's new
    // 502/503 orphan-guard) we roll back and surface the error, and the domain
    // stays in the list so the user can retry.
    const prevDomains = domains;
    setDomains(d => (d ? { ...d, addon_domains: (d.addon_domains || []).filter(x => x !== domain) } : d));
    setError('');
    try {
      const res = await api('/domains/remove', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      if (res.errors?.length) {
        setDomains(prevDomains); // rollback
        setError(res.errors[0]);
      } else {
        fetchDomains(); // background reconcile
      }
    } catch (err) {
      setDomains(prevDomains); // rollback
      setError(err.message);
    }
  };

  // Toggle an addon between "mirror primary site" and "own folder"
  const handleToggleMode = async (domain) => {
    const current = docrootModes[domain] === 'mirror' ? 'mirror' : 'own';
    const next = current === 'mirror' ? 'own' : 'mirror';
    const primary = user?.domain || '';
    const confirmMsg = next === 'mirror'
      ? t('dl.modeMirrorConfirm', { domain, primary })
      : t('dl.modeOwnConfirm', { domain });
    if (!window.confirm(confirmMsg)) return;
    setModeBusy(p => ({ ...p, [domain]: true }));
    setError('');
    try {
      const res = await api('/domains/docroot-mode', {
        method: 'POST',
        body: JSON.stringify({ domain, mode: next }),
      });
      if (res.success) {
        setDocrootModes(p => ({ ...p, [domain]: res.mode }));
      } else {
        setError(res.error || t('dl.modeUpdateFailed'));
      }
    } catch (err) {
      setError(err.message || t('dl.modeUpdateFailed'));
    } finally {
      setModeBusy(p => ({ ...p, [domain]: false }));
    }
  };

  // Promote an addon domain to be the account's primary domain
  const handleSetPrimary = async (domain) => {
    const oldPrimary = user?.domain || '';
    if (!window.confirm(t('dl.setPrimaryConfirm', { domain, old: oldPrimary }))) return;
    setPrimaryBusy(p => ({ ...p, [domain]: true }));
    setError('');
    setActionMsg(null);
    try {
      const res = await api('/domains/set-primary', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      if (res.success) {
        if (res.token) updateSession({ token: res.token, domain: res.newDomain });
        setActionMsg({ success: true, message: t('dl.setPrimarySuccess', { domain: res.newDomain }) });
        fetchDomains();
        fetchSubdomains();
        fetchSSL();
        fetchDocrootModes();
      } else {
        setError(res.error || t('dl.setPrimaryFailed'));
      }
    } catch (err) {
      setError(err.message || t('dl.setPrimaryFailed'));
    } finally {
      setPrimaryBusy(p => ({ ...p, [domain]: false }));
    }
  };

  const handleCreateSub = async () => {
    if (!subName.trim() || !subRoot) return;
    setCreatingSub(true);
    setError('');
    try {
      const res = await api('/subdomains/create', {
        method: 'POST',
        body: JSON.stringify({ subdomain: subName.trim(), rootdomain: subRoot }),
      });
      if (res.errors?.length) {
        setError(res.errors[0]);
      } else {
        setSubName('');
        setShowSubCreate(false);
        fetchSubdomains();
        fetchDomains();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingSub(false);
    }
  };

  const handleBulkCreate = async () => {
    const raw = bulkText.trim();
    if (!raw || !subRoot) { setError(t('dl.bulkEmpty')); return; }
    setBulkBusy(true);
    setError('');
    setBulkResult(null);
    try {
      const res = await api('/subdomains/bulk-create', {
        method: 'POST',
        body: JSON.stringify({ subdomains: raw, rootdomain: subRoot }),
      });
      // Backend returns { status, results:[{subdomain,fqdn,ok,error}], summary:{total,succeeded,failed} }
      setBulkResult(res);
      // Refresh the list in the background so newly-created subdomains appear.
      fetchSubdomains();
      fetchDomains();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDeleteSub = async (sub) => {
    if (!window.confirm(t('dl.deleteSubConfirm', { subdomain: sub }))) return;
    // Optimistic + GUARDED removal BEFORE the API call: the row vanishes at once,
    // and because the render filter reads this same guard, no refetch (WHM's
    // listsubdomains lags a few seconds after a delete, and unrelated effects can
    // trigger fetchSubdomains) can re-show the just-deleted row. Rollback on failure.
    const snapshot = subdomains;
    recentlyDeletedSubsRef.current.add(sub);
    setSubdomains(prev => prev.filter(s => subDisplayName(s) !== sub));
    setError('');
    try {
      const res = await api('/subdomains/delete', {
        method: 'POST',
        body: JSON.stringify({ subdomain: sub }),
      });
      if (res.errors?.length) {
        // Hard failure -> unguard + restore the row + surface the error.
        recentlyDeletedSubsRef.current.delete(sub);
        setSubdomains(snapshot);
        setError(res.errors[0]);
      } else {
        // Success -> reconcile after WHM propagates. The name stays guarded until a
        // refetch confirms it's gone (fetchSubdomains auto-clears it); 60s backstop.
        fetchDomains();
        setTimeout(() => { fetchSubdomains(); }, 3000);
        setTimeout(() => { recentlyDeletedSubsRef.current.delete(sub); }, 60000);
      }
    } catch (err) {
      // Network / thrown (incl. backend 502/503 hard-fail) -> rollback.
      recentlyDeletedSubsRef.current.delete(sub);
      setSubdomains(snapshot);
      setError(err.message);
    }
  };

  const mainDomain = domains?.main_domain;
  const addonDomains = domains?.addon_domains || [];
  const allDomains = [mainDomain, ...addonDomains].filter(Boolean);

  // Render-time guard: never show a subdomain the user just deleted, even if a
  // refetch briefly returns it (WHM listsubdomains propagation lag). This is the
  // single source of truth for what's displayed — no fetch can bypass it.
  const visibleSubdomains = subdomains.filter(s => !recentlyDeletedSubsRef.current.has(subDisplayName(s)));

  // Set default root domain for subdomain creation
  useEffect(() => {
    if (allDomains.length > 0 && !subRoot) setSubRoot(allDomains[0]);
  }, [allDomains, subRoot]);

  const renderNSBadge = (domain) => {
    const info = nsStatus[domain];
    const isLoading = nsLoading[domain];
    if (isLoading) return <span className="dl-ns-badge dl-ns-badge--loading">{t('dl.nsChecking')}</span>;
    if (!info) return (
      <button className="dl-ns-check-btn" onClick={() => checkNS(domain)} data-testid={`dl-ns-check-${domain}`}>
        {t('dl.nsCheck')}
      </button>
    );
    if (info.status === 'active') return <span className="dl-ns-badge dl-ns-badge--active" data-testid={`dl-ns-active-${domain}`}>{t('dl.nsActive')}</span>;
    if (info.status === 'pending' && info.autoManaged) return (
      <span className="dl-ns-badge dl-ns-badge--propagating" data-testid={`dl-ns-propagating-${domain}`}>
        {t('dl.nsPropagating')}
      </span>
    );
    if (info.status === 'pending') return (
      <span className="dl-ns-badge dl-ns-badge--pending" data-testid={`dl-ns-pending-${domain}`}>
        {t('dl.nsPending')}
      </span>
    );
    return <span className="dl-ns-badge dl-ns-badge--unknown" data-testid={`dl-ns-unknown-${domain}`}>{t('dl.nsUnknown')}</span>;
  };

  const renderSSLBadge = (domain) => {
    const info = sslStatus[domain];
    if (sslLoading && !info) return <span className="dl-ssl-badge dl-ssl-badge--loading" data-testid={`dl-ssl-loading-${domain}`}>{t('dl.sslLoading')}</span>;
    if (!info) return <span className="dl-ssl-badge dl-ssl-badge--none" data-testid={`dl-ssl-none-${domain}`}>{t('dl.sslNone')}</span>;
    if (info.status === 'valid') {
      const isCF = info.cloudflare;
      const tip = isCF
        ? t('dl.sslValidCfTip', { mode: info.cfSSLMode || 'active' })
        : (info.daysLeft != null && info.daysLeft >= 0
          ? t('dl.sslValidDaysLeftTip', { issuer: info.issuer, days: info.daysLeft })
          : t('dl.sslValidNoDaysTip', { issuer: info.issuer }));
      return (
        <span className={`dl-ssl-badge dl-ssl-badge--valid${isCF ? ' dl-ssl-badge--cf' : ''}`} title={tip} data-testid={`dl-ssl-valid-${domain}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          {isCF ? t('dl.sslCf') : t('dl.sslLabel')}
          {!isCF && info.daysLeft != null && info.daysLeft >= 0 && <span className="dl-ssl-days">{info.daysLeft}d</span>}
        </span>
      );
    }
    if (info.status === 'expiring') {
      return (
        <span className="dl-ssl-badge dl-ssl-badge--expiring" title={t('dl.sslExpiringTip', { days: info.daysLeft })} data-testid={`dl-ssl-expiring-${domain}`}>
          {t('dl.sslExpiring', { days: info.daysLeft })}
        </span>
      );
    }
    if (info.status === 'expired') {
      return (
        <span className="dl-ssl-badge dl-ssl-badge--expired" data-testid={`dl-ssl-expired-${domain}`}>
          {t('dl.sslExpired')}
        </span>
      );
    }
    return <span className="dl-ssl-badge dl-ssl-badge--none" data-testid={`dl-ssl-none-${domain}`}>{t('dl.sslNone')}</span>;
  };

  // Inline NS pending info render helper (plain function — not a nested
  // component — so React doesn't remount the subtree every render).
  const renderNSPendingInfo = (domain) => {
    const info = nsStatus[domain];
    if (!info || info.status !== 'pending') return null;

    // Auto-managed domains (registered through our platform): NS already set, just propagating
    if (info.autoManaged) {
      return (
        <div className="dl-ns-inline-info dl-ns-inline-info--auto" data-testid={`dl-ns-info-${domain}`}>
          <div className="dl-ns-inline-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>{t('dl.nsAutoConfigured')}</span>
          </div>
          <p className="dl-ns-inline-note">{t('dl.nsAutoNote')} <button className="dl-ns-recheck-btn" onClick={() => checkNS(domain)} data-testid={`dl-ns-recheck-${domain}`}>{t('dl.nsRecheckNow')}</button></p>
        </div>
      );
    }

    // External domains: show NS update instructions
    if (!info.nameservers?.length) return null;
    return (
      <div className="dl-ns-inline-info" data-testid={`dl-ns-info-${domain}`}>
        <div className="dl-ns-inline-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>{t('dl.nsExternalUpdate')}</span>
        </div>
        <div className="dl-ns-inline-codes">
          {info.nameservers.map((ns, i) => (
            <code key={i} className="dl-ns-code" data-testid={`dl-ns-code-${domain}-${i}`}>{ns}</code>
          ))}
        </div>
        <p className="dl-ns-inline-note">{t('dl.nsExternalNote')} <button className="dl-ns-recheck-btn" onClick={() => checkNS(domain)} data-testid={`dl-ns-recheck-${domain}`}>{t('dl.nsRecheckNow')}</button> {t('dl.nsExternalNoteTail')}</p>
      </div>
    );
  };

  return (
    <div className="dl" data-testid="domain-list">
      <div className="dl-header">
        <h2>{t('dl.title')}</h2>
        <div className="dl-header-actions">
          <button onClick={triggerAutoSSL} className="fm-btn fm-btn--ghost" data-testid="dl-autossl-btn" title={t('dl.runAutoSSLTitle')} disabled={autoSSLLoading}>
            {autoSSLLoading ? t('dl.running') : `🔒 ${t('dl.runAutoSSL')}`}
          </button>
          <button onClick={fetchSSL} className="fm-btn fm-btn--ghost" data-testid="dl-refresh-ssl" title={t('dl.refreshSSLTitle')} disabled={sslLoading}>
            {sslLoading ? t('dl.nsChecking') : t('dl.refreshSSL')}
          </button>
          <button onClick={() => { setShowSubCreate(!showSubCreate); setShowAdd(false); }} className="fm-btn fm-btn--ghost" data-testid="dl-sub-btn">
            {t('dl.addSubdomain')}
          </button>
          <button onClick={() => { setShowAdd(!showAdd); setShowSubCreate(false); }} className="fm-btn fm-btn--primary" data-testid="dl-add-btn">
            {t('dl.addDomain')}
          </button>
        </div>
      </div>

      {/* AutoSSL Result Banner */}
      {autoSSLResult && (
        <div className={`fm-${autoSSLResult.success ? 'success' : 'error'}`} data-testid="dl-autossl-result" style={{marginBottom: '0.5rem'}}>
          {autoSSLResult.success ? '✅' : '❌'} {autoSSLResult.message}
          {autoSSLResult.success && <span style={{marginLeft: '0.5rem', opacity: 0.7}}>{t('dl.autosslRefreshing')}</span>}
        </div>
      )}

      {actionMsg && (
        <div className={`fm-${actionMsg.success ? 'success' : 'error'}`} data-testid="dl-action-result" style={{marginBottom: '0.5rem'}}>
          {actionMsg.success ? '✅' : '❌'} {actionMsg.message}
        </div>
      )}

      {/* Cloudflare SSL Mode Indicator */}
      {cfSSLMode && (
        <div className="dl-cf-ssl-mode" data-testid="dl-cf-ssl-mode">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>{t('dl.cfSslLabel')} <strong>{cfSSLMode}</strong></span>
        </div>
      )}

      {error && (
        <div className="fm-error" data-testid="dl-error">
          <span>{error}</span>
          {!loading && !domains && isTransientError(errorRaw) && (
            <button
              type="button"
              className="fm-btn fm-btn--ghost"
              onClick={fetchDomains}
              data-testid="dl-error-retry"
              style={{ marginLeft: '0.75rem' }}
            >
              {t('errors.retry')}
            </button>
          )}
        </div>
      )}
      {captchaError && <div className="fm-error" data-testid="dl-captcha-error">{captchaError}</div>}

      {/* Visitor Captcha plan banner */}
      {captchaInfo.loaded && !captchaInfo.isGold && (
        <div className="dl-captcha-banner" data-testid="dl-captcha-upgrade-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          <div className="dl-captcha-banner-text">
            <strong>🛡️ {t('dl.upgradeCaptchaHeading')}</strong>
            <span dangerouslySetInnerHTML={{ __html: t('dl.upgradeCaptchaBody', { price: captchaInfo.goldPrice }) }} />
            <a
              className="dl-captcha-upgrade-cta"
              href={captchaInfo.botUrl || 'https://t.me/nomadlybot'}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="dl-captcha-upgrade-cta"
            >
              ⬆️ {t('dl.upgradeCaptchaCta', { price: captchaInfo.goldPrice })} →
            </a>
          </div>
        </div>
      )}

      {/* Add Domain Form */}
      {showAdd && (
        <div className="dl-add-form" data-testid="dl-add-form">
          <div className="dl-add-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span dangerouslySetInnerHTML={{ __html: t('dl.addNote') }} />
          </div>
          <div className="dl-add-mode" data-testid="dl-add-mode">
            <div className="dl-add-mode-q">{t('dl.addModeQuestion')}</div>
            <label className={`dl-mode-opt ${addMode === 'own' ? 'dl-mode-opt--active' : ''}`}>
              <input type="radio" name="dl-add-mode" checked={addMode === 'own'} onChange={() => setAddMode('own')} data-testid="dl-add-mode-own" />
              <span className="dl-mode-opt-body">
                <span className="dl-mode-opt-title">{t('dl.addModeOwn')}</span>
                <span className="dl-mode-opt-hint">{t('dl.addModeOwnHint', { domain: newDomain.trim() || 'domain.com' })}</span>
              </span>
            </label>
            <label className={`dl-mode-opt ${addMode === 'mirror' ? 'dl-mode-opt--active' : ''}`}>
              <input type="radio" name="dl-add-mode" checked={addMode === 'mirror'} onChange={() => setAddMode('mirror')} data-testid="dl-add-mode-mirror" />
              <span className="dl-mode-opt-body">
                <span className="dl-mode-opt-title">{t('dl.addModeMirror')}</span>
                <span className="dl-mode-opt-hint">{t('dl.addModeMirrorHint')}</span>
              </span>
            </label>
          </div>
          <div className="dl-add-row">
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder={t('dl.addPlaceholder')}
              data-testid="dl-add-input"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button onClick={handleAdd} className="fm-btn fm-btn--primary" disabled={adding} data-testid="dl-add-submit">
              {adding ? t('dl.adding') : t('dl.add')}
            </button>
            <button onClick={() => { setShowAdd(false); setNewDomain(''); setAddResult(null); }} className="fm-btn fm-btn--ghost">{t('dl.cancel')}</button>
          </div>
        </div>
      )}

      {/* Add Domain Result - NS Info */}
      {addResult && (
        <div className={`dl-ns-result ${addResult.autoUpdated ? 'dl-ns-result--auto' : 'dl-ns-result--manual'}`} data-testid="dl-add-result">
          <div className="dl-ns-result-header">
            {addResult.autoUpdated ? (
              <><span className="dl-ns-icon dl-ns-icon--ok">&#10003;</span> {t('dl.dnsAutoConfigured')}</>
            ) : (
              <><span className="dl-ns-icon dl-ns-icon--warn">!</span> {t('dl.updateNameservers')}</>
            )}
          </div>
          {!addResult.autoUpdated && addResult.nameservers?.length > 0 && (
            <div className="dl-ns-list">
              <p>{t('dl.pointNameserversTo')}</p>
              {addResult.nameservers.map((ns, i) => (
                <code key={i} className="dl-ns-code" data-testid={`dl-ns-${i}`}>{ns}</code>
              ))}
              <p className="dl-ns-note">{t('dl.pendingNote')}</p>
            </div>
          )}
          <button onClick={() => setAddResult(null)} className="fm-btn fm-btn--ghost dl-ns-dismiss">{t('dl.dismiss')}</button>
        </div>
      )}

      {/* Subdomain Create Form */}
      {showSubCreate && (
        <div className="dl-add-form dl-sub-form" data-testid="dl-sub-form">
          {/* Single / Bulk mode toggle */}
          <div className="dl-bulk-toggle" data-testid="dl-sub-mode-toggle">
            <button
              type="button"
              className={`dl-bulk-tab ${!bulkMode ? 'dl-bulk-tab--active' : ''}`}
              onClick={() => { setBulkMode(false); setBulkResult(null); }}
              data-testid="dl-sub-mode-single"
            >{t('dl.bulkSingle')}</button>
            <button
              type="button"
              className={`dl-bulk-tab ${bulkMode ? 'dl-bulk-tab--active' : ''}`}
              onClick={() => { setBulkMode(true); setError(''); }}
              data-testid="dl-sub-mode-bulk"
            >{t('dl.bulkImport')}</button>
          </div>

          {!bulkMode ? (
            <>
              <div className="dl-add-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span dangerouslySetInnerHTML={{ __html: t('dl.addSubdomainNote') }} />
              </div>
              <div className="dl-sub-input-row">
                <input
                  type="text"
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  placeholder={t('dl.subdomainPlaceholder')}
                  data-testid="dl-sub-name-input"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateSub()}
                />
                <span className="dl-sub-dot">.</span>
                <select value={subRoot} onChange={(e) => setSubRoot(e.target.value)} data-testid="dl-sub-root-select">
                  {allDomains.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="dl-sub-actions">
                <button onClick={handleCreateSub} className="fm-btn fm-btn--primary" disabled={creatingSub || !subName.trim()} data-testid="dl-sub-submit">
                  {creatingSub ? t('dl.creating') : t('dl.create')}
                </button>
                <button onClick={() => { setShowSubCreate(false); setSubName(''); }} className="fm-btn fm-btn--ghost">{t('dl.cancel')}</button>
              </div>
            </>
          ) : (
            <>
              <div className="dl-add-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>{t('dl.bulkNote')}</span>
              </div>
              <div className="dl-bulk-row">
                <textarea
                  className="dl-bulk-textarea"
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={t('dl.bulkPlaceholder')}
                  rows={5}
                  data-testid="dl-bulk-textarea"
                />
                <div className="dl-bulk-side">
                  <span className="dl-sub-dot">.</span>
                  <select value={subRoot} onChange={(e) => setSubRoot(e.target.value)} data-testid="dl-bulk-root-select">
                    {allDomains.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="dl-sub-actions">
                <button onClick={handleBulkCreate} className="fm-btn fm-btn--primary" disabled={bulkBusy || !bulkText.trim()} data-testid="dl-bulk-submit">
                  {bulkBusy ? t('dl.bulkCreating') : t('dl.bulkCreateAll')}
                </button>
                <button onClick={() => { setShowSubCreate(false); setBulkText(''); setBulkResult(null); }} className="fm-btn fm-btn--ghost">{t('dl.cancel')}</button>
              </div>

              {bulkResult?.summary && (
                <div className="dl-bulk-result" data-testid="dl-bulk-result">
                  <div className={`dl-bulk-summary ${bulkResult.summary.failed ? 'dl-bulk-summary--warn' : 'dl-bulk-summary--ok'}`}>
                    {bulkResult.summary.failed ? '⚠️' : '✅'} {t('dl.bulkSummary', { succeeded: bulkResult.summary.succeeded, failed: bulkResult.summary.failed, total: bulkResult.summary.total })}
                  </div>
                  <ul className="dl-bulk-list">
                    {(bulkResult.results || []).map((r, i) => (
                      <li key={i} className={`dl-bulk-item ${r.ok ? 'dl-bulk-item--ok' : 'dl-bulk-item--fail'}`} data-testid={`dl-bulk-item-${i}`}>
                        <span className="dl-bulk-item-icon">{r.ok ? '✓' : '✕'}</span>
                        <span className="dl-bulk-item-name">{r.fqdn || r.subdomain}</span>
                        {!r.ok && r.error && <span className="dl-bulk-item-err">{r.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="fm-loading">{t('dl.loading')}</div>
      ) : (
        <div className="dl-sections">
          {/* Main Domain */}
          {mainDomain && (
            <div className="dl-section">
              <h3>{t('dl.mainDomain')}</h3>
              <div className="dl-domain-card dl-domain-card--main" data-testid="dl-main-domain">
                <div className="dl-domain-card-top">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>
                  <span className="dl-domain-name">{mainDomain}</span>
                  <div className="dl-badges-row">
                    {renderSSLBadge(mainDomain)}
                    {renderNSBadge(mainDomain)}
                    {renderCaptchaBadge(mainDomain)}
                    <span className="dl-badge dl-badge--primary">{t('dl.primaryBadge')}</span>
                  </div>
                </div>
                <div className="dl-domain-docroot">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                  <span>{t('dl.docRootLabel')} <code>public_html/</code></span>
                </div>
              </div>
              {renderNSPendingInfo(mainDomain)}
            </div>
          )}

          {/* Addon Domains */}
          {addonDomains.length > 0 && (
            <div className="dl-section">
              <h3>{t('dl.addonDomains', { count: addonDomains.length })}</h3>
              {addonDomains.map((d, i) => {
                const mode = docrootModes[d] === 'mirror' ? 'mirror' : 'own';
                return (
                <React.Fragment key={i}>
                  <div className="dl-domain-card" data-testid={`dl-addon-${d}`}>
                    <div className="dl-domain-card-top">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>
                      <span className="dl-domain-name">{d}</span>
                      <div className="dl-badges-row">
                        {renderSSLBadge(d)}
                        {renderNSBadge(d)}
                        {renderCaptchaBadge(d)}
                        <span className={`dl-badge dl-badge--mode${mode === 'mirror' ? ' dl-badge--mirror' : ''}`} data-testid={`dl-mode-badge-${d}`}>
                          {mode === 'mirror' ? t('dl.modeMirrorBadge') : t('dl.modeOwnBadge')}
                        </span>
                        <span className="dl-badge">{t('dl.addonBadge')}</span>
                      </div>
                      <button onClick={() => handleRemove(d)} className="fm-action-btn fm-action-btn--danger" title={t('dl.removeTitle')} data-testid={`dl-remove-${d}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </div>
                    <div className="dl-domain-docroot">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                      <span>{t('dl.docRootLabel')} <code>{mode === 'mirror' ? t('dl.docRootMirror') : `public_html/${d}`}</code></span>
                    </div>
                    <div className="dl-domain-actions" data-testid={`dl-domain-actions-${d}`}>
                      <button
                        onClick={() => handleToggleMode(d)}
                        className="fm-btn fm-btn--ghost dl-mode-btn"
                        disabled={!!modeBusy[d]}
                        data-testid={`dl-mode-toggle-${d}`}
                      >
                        {modeBusy[d] ? t('dl.modeUpdating') : (mode === 'mirror' ? t('dl.modeSwitchToOwn') : t('dl.modeSwitchToMirror'))}
                      </button>
                      <button
                        onClick={() => handleSetPrimary(d)}
                        className="fm-btn fm-btn--primary dl-setprimary-btn"
                        disabled={!!primaryBusy[d]}
                        title={t('dl.setPrimaryTitle')}
                        data-testid={`dl-setprimary-${d}`}
                      >
                        {primaryBusy[d] ? t('dl.setPrimaryWorking') : `\u2b50 ${t('dl.setPrimary')}`}
                      </button>
                    </div>
                  </div>
                  {renderNSPendingInfo(d)}
                </React.Fragment>
                );
              })}
            </div>
          )}

          {/* Subdomains */}
          {!subLoading && visibleSubdomains.length > 0 && (
            <div className="dl-section">
              <h3>{t('dl.subdomains', { count: visibleSubdomains.length })}</h3>
              {visibleSubdomains.map((s, i) => {
                const display = subDisplayName(s);
                const docRoot = subDocRoot(s);
                return (
                  <div key={i} className="dl-domain-card" data-testid={`dl-sub-${display}`}>
                    <div className="dl-domain-card-top">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                      <span className="dl-domain-name">{display}</span>
                      <div className="dl-badges-row">
                        {renderSSLBadge(display)}
                        <span className="dl-badge dl-badge--sub">{t('dl.subBadge')}</span>
                      </div>
                      <button onClick={() => handleDeleteSub(display)} className="fm-action-btn fm-action-btn--danger" title={t('dl.deleteTitle')} data-testid={`dl-sub-del-${display}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </div>
                    <div className="dl-domain-docroot">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                      <span>{t('dl.docRootLabel')} <code>{docRoot}</code></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!mainDomain && addonDomains.length === 0 && visibleSubdomains.length === 0 && (
            <PanelEmptyState
              testId="dl-empty"
              icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>}
              title={t('dl.emptyTitle')}
              description={t('dl.emptyDesc')}
              actionLabel={t('dl.addDomain')}
              onAction={() => { setShowAdd(true); setShowSubCreate(false); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
