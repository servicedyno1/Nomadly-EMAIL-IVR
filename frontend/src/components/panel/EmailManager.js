import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import PanelToolbar from './shared/PanelToolbar';
import PanelBulkBar from './shared/PanelBulkBar';
import PanelEmptyState from './shared/PanelEmptyState';

const SvgPlus = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SvgTrash = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

export default function EmailManager() {
  const { t } = useTranslation();
  const { api, user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', quota: '250', domain: '' });
  const [creating, setCreating] = useState(false);
  const [domains, setDomains] = useState([]);
  // Test email state
  const [testFrom, setTestFrom] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);
  // Multi-select + search (introduced via shared bulk bar)
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const headerCheckboxRef = useRef(null);

  useEffect(() => {
    fetchAccounts();
    fetchDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const res = await api('/email');
      if (res.errors?.length) {
        setError(res.errors[0]);
      } else {
        const list = res.data || [];
        setAccounts(list.filter(a => a.email && !a.email.startsWith(user?.username + '@')));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchDomains = async () => {
    try {
      const res = await api('/domains');
      if (res.data) {
        const all = [res.data.main_domain, ...(res.data.addon_domains || [])].filter(Boolean);
        setDomains(all);
        if (all.length > 0 && !form.domain) {
          setForm(f => ({ ...f, domain: all[0] }));
        }
      }
    } catch (_) {}
  };

  const handleCreate = async () => {
    if (!form.email || !form.password || !form.domain) return;
    setCreating(true);
    setError('');
    try {
      const res = await api('/email/create', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          quota: parseInt(form.quota) || 250,
          domain: form.domain,
        }),
      });
      if (res.errors?.length) {
        setError(res.errors[0]);
      } else {
        setForm({ email: '', password: '', quota: '250', domain: form.domain });
        setShowCreate(false);
        fetchAccounts();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Single-row delete (kept for the row's trash icon).
  const handleDelete = async (email, domain) => {
    if (!window.confirm(t('em.deleteSingleConfirm', { email: `${email}@${domain}` }))) return;
    try {
      const res = await api('/email/delete', {
        method: 'POST',
        body: JSON.stringify({ email, domain }),
      });
      if (res.errors?.length) {
        setError(res.errors[0]);
      } else {
        fetchAccounts();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const generatePassword = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
    let pw = '';
    for (let i = 0; i < 14; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setForm(f => ({ ...f, password: pw }));
  };

  const handleSendTest = async () => {
    if (!testFrom || !testTo) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await api('/email/test', {
        method: 'POST',
        body: JSON.stringify({ from: testFrom.split('@')[0], to: testTo }),
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTestSending(false);
    }
  };

  const openTestModal = (email) => {
    setTestFrom(email);
    setTestTo('');
    setTestResult(null);
  };

  const closeTestModal = () => {
    setTestFrom('');
    setTestTo('');
    setTestResult(null);
  };

  // ─── Multi-select helpers ─────────────────────────────────────
  const q = search.trim().toLowerCase();
  const visibleAccounts = q
    ? accounts.filter(a => (a.email || '').toLowerCase().includes(q))
    : accounts;

  const toggleSelect = (email) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === visibleAccounts.length && visibleAccounts.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleAccounts.map(a => a.email).filter(Boolean)));
    }
  };

  const allChecked = visibleAccounts.length > 0 && selected.size === visibleAccounts.length;
  const someChecked = selected.size > 0 && selected.size < visibleAccounts.length;

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someChecked;
  }, [someChecked]);

  // Reset selection when the visible list changes due to search filter
  useEffect(() => {
    if (selected.size === 0) return;
    const visibleEmails = new Set(visibleAccounts.map(a => a.email));
    let changed = false;
    const next = new Set();
    for (const e of selected) {
      if (visibleEmails.has(e)) next.add(e);
      else changed = true;
    }
    if (changed) setSelected(next);
  }, [visibleAccounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const performBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    setError('');
    let okCount = 0;
    const failures = [];
    for (const email of selected) {
      const acc = accounts.find(a => a.email === email);
      if (!acc) continue;
      const parts = (acc.email || '').split('@');
      const emailUser = parts[0];
      const emailDomain = parts[1] || acc.domain || '';
      try {
        const res = await api('/email/delete', {
          method: 'POST',
          body: JSON.stringify({ email: emailUser, domain: emailDomain }),
        });
        if (res.errors?.length) {
          failures.push({ email, msg: res.errors[0] });
        } else {
          okCount++;
        }
      } catch (err) {
        failures.push({ email, msg: err.message || t('em.deleteFailedGeneric') });
      }
    }
    setBulkDeleting(false);
    setBulkConfirm(false);
    setSelected(new Set());
    if (failures.length === 0) {
      setError('');
    } else {
      setError(t('em.bulkDeleteFailSummary', {
        ok: okCount,
        total: selected.size,
        fail: failures.length,
        email: failures[0].email,
        msg: failures[0].msg,
      }));
    }
    fetchAccounts();
  };

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="em" data-testid="email-manager">
      <PanelToolbar
        testid="em-toolbar"
        leftSlot={
          <div className="panel-toolbar-title">
            <h2>{t('em.title')}</h2>
            {accounts.length > 0 && (
              <span className="panel-toolbar-title-meta" data-testid="em-count">
                {visibleAccounts.length}
                {q ? t('em.countOfSuffix', { total: accounts.length }) : ''}{' '}
                {t(accounts.length === 1 ? 'em.countAccount_one' : 'em.countAccount_other')}
              </span>
            )}
          </div>
        }
        search={accounts.length > 0 ? {
          value: search,
          onChange: setSearch,
          placeholder: t('em.searchPlaceholder'),
          testid: 'em-search-input',
          ariaLabel: t('em.searchAriaLabel'),
        } : null}
        actions={[
          {
            key: 'create',
            label: showCreate ? t('em.cancel') : t('em.createAccount'),
            icon: showCreate ? null : SvgPlus,
            variant: 'primary',
            onClick: () => setShowCreate(!showCreate),
            testid: 'em-create-btn',
          },
        ]}
      />

      <PanelBulkBar
        count={selected.size}
        label={t(selected.size === 1 ? 'em.bulkLabel_one' : 'em.bulkLabel_other')}
        clearLabel={t('common.clear')}
        clearTitle={t('common.clearSelection')}
        testid="em-bulk-bar"
        countTestid="em-bulk-count"
        clearTestid="em-bulk-clear"
        onClear={() => setSelected(new Set())}
        actions={[
          {
            key: 'delete',
            label: t('fm.actions.delete'),
            icon: SvgTrash,
            variant: 'danger',
            onClick: () => setBulkConfirm(true),
            testid: 'em-bulk-delete',
            title: t('em.bulkDeleteTitle'),
          },
        ]}
      />

      {error && <div className="fm-error" data-testid="em-error">{error}</div>}

      {showCreate && (
        <div className="em-create-form" data-testid="em-create-form">
          <div className="em-form-row">
            <div className="em-form-field">
              <label>{t('em.emailLabel')}</label>
              <div className="em-email-input">
                <input
                  type="text"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder={t('em.emailPlaceholder')}
                  data-testid="em-input-email"
                />
                <span className="em-at">@</span>
                <select value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} data-testid="em-input-domain">
                  {domains.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="em-form-row">
            <div className="em-form-field">
              <label>{t('em.passwordLabel')}</label>
              <div className="em-email-input">
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={t('em.passwordPlaceholder')}
                  data-testid="em-input-password"
                />
                <button onClick={generatePassword} className="panel-btn panel-btn--ghost" type="button" data-testid="em-gen-password">{t('em.generatePassword')}</button>
              </div>
            </div>
            <div className="em-form-field em-form-field--small">
              <label>{t('em.quotaLabel')}</label>
              <input
                type="number"
                value={form.quota}
                onChange={(e) => setForm({ ...form, quota: e.target.value })}
                data-testid="em-input-quota"
              />
            </div>
          </div>
          <div className="em-form-actions">
            <button onClick={handleCreate} className="panel-btn panel-btn--primary" disabled={creating || !form.email || !form.password} data-testid="em-submit-create">
              {creating ? t('em.creating') : t('em.createAccountBtn')}
            </button>
            <button onClick={() => setShowCreate(false)} className="panel-btn panel-btn--ghost">{t('em.cancel')}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="fm-loading">{t('em.loading')}</div>
      ) : accounts.length === 0 ? (
        <PanelEmptyState
          testId="em-empty"
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
          title={t('em.emptyTitle')}
          description={t('em.emptyNoAccounts')}
          actionLabel={t('em.createAccount')}
          onAction={() => setShowCreate(true)}
        />
      ) : visibleAccounts.length === 0 ? (
        <div className="fm-empty" data-testid="em-empty-search">
          <p>{t('em.emptySearchFound', { query: search })}</p>
          <span dangerouslySetInnerHTML={{ __html: t('fm.searchTryAgain') }} />
        </div>
      ) : (
        <div className="em-list">
          {/* "Select all" header row, only visible when there are accounts */}
          <label className="em-select-all-row" data-testid="em-select-all-row">
            <input
              ref={headerCheckboxRef}
              type="checkbox"
              className="fm-checkbox"
              checked={allChecked}
              onChange={toggleSelectAll}
              data-testid="em-select-all"
              aria-label={t('em.selectAllAria')}
            />
            <span>
              {q ? t('em.selectAllMatching', { count: visibleAccounts.length }) : t('em.selectAll')}
            </span>
          </label>

          {visibleAccounts.map((acc, i) => {
            const parts = (acc.email || '').split('@');
            const emailUser = parts[0];
            const emailDomain = parts[1] || acc.domain || '';
            const usedBytes = acc._diskused ? parseFloat(acc._diskused) : 0;
            const usedMB = (usedBytes / (1024 * 1024)).toFixed(1);
            const used = usedBytes > 0 ? t('em.usedMB', { mb: usedMB }) : t('em.noUsage');
            const quotaRaw = acc._diskquota;
            const quota = quotaRaw === 'unlimited' || quotaRaw === 0
              ? t('em.unlimited')
              : `${Math.round(parseFloat(quotaRaw) / (1024 * 1024))} MB`;
            const isSelected = selected.has(acc.email);

            return (
              <div key={i} className={`em-account-card ${isSelected ? 'em-account-card--selected' : ''}`} data-testid={`em-account-${acc.email}`}>
                <div className="em-account-info">
                  <input
                    type="checkbox"
                    className="fm-checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(acc.email)}
                    data-testid={`em-select-${acc.email}`}
                    aria-label={`Select ${acc.email}`}
                  />
                  <div className="em-account-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </div>
                  <div>
                    <div className="em-account-email">{acc.email}</div>
                    <div className="em-account-meta">
                      {used} / {quota}
                    </div>
                  </div>
                </div>
                <div className="em-account-actions">
                  <button
                    onClick={() => openTestModal(acc.email)}
                    className="em-test-btn"
                    title={t('em.sendTestTitle')}
                    data-testid={`em-test-${acc.email}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    {t('em.testBtnLabel')}
                  </button>
                  <button
                    onClick={() => handleDelete(emailUser, emailDomain)}
                    className="fm-action-btn fm-action-btn--danger"
                    title={t('em.deleteBtnTitle')}
                    data-testid={`em-delete-${acc.email}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkConfirm && (
        <div className="fm-modal-overlay" data-testid="em-bulk-delete-modal">
          <div className="fm-modal fm-modal--sm">
            <div className="fm-modal-header">
              <span>
                {t(selected.size === 1 ? 'em.bulkDeleteHeading_one' : 'em.bulkDeleteHeading_other', { count: selected.size })}
              </span>
              <button onClick={() => !bulkDeleting && setBulkConfirm(false)} className="fm-modal-close">&times;</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--pv-text-secondary)', marginBottom: 12, maxHeight: 160, overflowY: 'auto' }} data-testid="em-bulk-delete-list">
                {Array.from(selected).slice(0, 12).map((email, idx) => (
                  <div key={idx} style={{ padding: '4px 0', wordBreak: 'break-all', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                    📧 {email}
                  </div>
                ))}
                {selected.size > 12 && (
                  <div style={{ padding: '4px 0', color: 'var(--pv-text-muted)', fontSize: 12 }}>
                    {t('em.bulkDeleteMore', { count: selected.size - 12 })}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--pv-text-muted)' }}>
                {t('em.bulkDeleteWarning')}
              </div>
            </div>
            <div className="fm-modal-actions">
              <button onClick={() => setBulkConfirm(false)} className="panel-btn panel-btn--ghost" disabled={bulkDeleting}>{t('em.cancel')}</button>
              <button
                onClick={performBulkDelete}
                className="panel-btn panel-btn--primary"
                disabled={bulkDeleting}
                data-testid="em-bulk-delete-confirm"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
              >
                {bulkDeleting ? t('em.deletingBtn') : t('em.bulkDeleteCount', { count: selected.size })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Test Email Modal */}
      {testFrom && (
        <div className="em-test-overlay" onClick={closeTestModal} data-testid="em-test-modal">
          <div className="em-test-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('em.sendTestModalTitle')}</h3>
            <p className="em-test-from">
              {t('em.sendTestFromLabel')} <strong>{testFrom}</strong>
            </p>
            <div className="em-test-field">
              <label>{t('em.sendTestToLabel')}</label>
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder={t('em.sendTestToPlaceholder')}
                data-testid="em-test-to-input"
                onKeyDown={(e) => e.key === 'Enter' && handleSendTest()}
                autoFocus
              />
            </div>

            {testResult && (
              <div className={`em-test-result ${testResult.success ? 'em-test-result--ok' : 'em-test-result--fail'}`} data-testid="em-test-result">
                {testResult.success ? (
                  <>
                    <span className="em-test-icon">&#10003;</span>
                    {testResult.message}
                  </>
                ) : (
                  <>
                    <span className="em-test-icon">&#10007;</span>
                    {testResult.error || t('em.sendTestFailDefault')}
                    {testResult.hint && <p className="em-test-hint">{testResult.hint}</p>}
                  </>
                )}
              </div>
            )}

            <div className="em-test-actions">
              <button
                onClick={handleSendTest}
                className="panel-btn panel-btn--primary"
                disabled={testSending || !testTo}
                data-testid="em-test-send-btn"
              >
                {testSending ? t('em.sending') : t('em.sendTestBtn')}
              </button>
              <button onClick={closeTestModal} className="panel-btn panel-btn--ghost">{t('em.closeBtn')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
