import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

// IP blocking / redirect per domain + IP Logs. Applied at Cloudflare (edge), so blocked visits never reach the site.
export default function IpManager() {
  const { api, user } = useAuth();
  const [own, setOwn] = useState([user?.domain, ...(user?.addonDomains || [])].filter(Boolean));
  const [domain, setDomain] = useState(user?.domain || '');
  const [view, setView] = useState('rules');

  useEffect(() => {
    api('/session').then(s => {
      const list = [s.domain, ...(s.addonDomains || [])].filter(Boolean);
      setOwn(list);
      setDomain(d => d || list[0] || '');
    }).catch(() => {});
  }, [api]);

  if (!domain) return <div className="fm-error" data-testid="ip-no-domain">No website is set up on this plan yet.</div>;

  return (
    <div data-testid="ip-manager">
      <div className="dl-header">
        <h2>IP access</h2>
        {own.length > 1 && (
          <select className="fm-input" value={domain} onChange={e => setDomain(e.target.value)} data-testid="ip-domain-select" style={{ maxWidth: 260 }}>
            {own.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>
      <div className="geo-mode-toggle" style={{ marginBottom: 16 }}>
        <button className={`geo-mode-btn ${view === 'rules' ? 'geo-mode-btn--active' : ''}`} onClick={() => setView('rules')} data-testid="ip-view-rules">IP rules</button>
        <button className={`geo-mode-btn ${view === 'logs' ? 'geo-mode-btn--active' : ''}`} onClick={() => setView('logs')} data-testid="ip-view-logs">IP Logs</button>
      </div>
      {view === 'rules' ? <Rules api={api} domain={domain} /> : <Logs api={api} domain={domain} />}
    </div>
  );
}

function Rules({ api, domain }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ips, setIps] = useState('');
  const [action, setAction] = useState('block');
  const [redirectTo, setRedirectTo] = useState('https://www.google.com');
  const [custom, setCustom] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await api(`/ip-rules?domain=${encodeURIComponent(domain)}`); setRules(r.rules || []); if (r.error) setError(r.error); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [api, domain]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true); setError('');
    try {
      const target = action === 'redirect' ? (custom ? redirectTo : 'https://www.google.com') : undefined;
      const r = await api('/ip-rules/create', { method: 'POST', body: JSON.stringify({ domain, ips, action, target, note }) });
      if (r.success) { setIps(''); setNote(''); load(); } else setError(r.error || 'Could not save the rule.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (rule) => {
    if (!window.confirm('Remove this rule?')) return;
    try { await api('/ip-rules/delete', { method: 'POST', body: JSON.stringify({ domain, ruleId: rule.id, kind: rule.kind }) }); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div data-testid="ip-rules">
      <p className="geo-mode-desc" style={{ marginTop: 0 }}>Block visitors from certain IP addresses, or send them to another website. Changes apply within a minute.</p>
      <div className="geo-create-form" data-testid="ip-create-form">
        <label className="fm-label">IP addresses or ranges (one per line or comma separated)</label>
        <textarea className="fm-input" rows={3} value={ips} onChange={e => setIps(e.target.value)} placeholder={'203.0.113.4\n198.51.100.0/24'} data-testid="ip-input" />
        <div className="geo-mode-toggle" style={{ marginTop: 12 }}>
          <button className={`geo-mode-btn ${action === 'block' ? 'geo-mode-btn--active geo-mode-btn--block' : ''}`} onClick={() => setAction('block')} data-testid="ip-action-block">Block them</button>
          <button className={`geo-mode-btn ${action === 'redirect' ? 'geo-mode-btn--active' : ''}`} onClick={() => setAction('redirect')} data-testid="ip-action-redirect">Redirect them</button>
        </div>
        {action === 'redirect' && (
          <div style={{ marginTop: 12 }} data-testid="ip-redirect-opts">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}>
              <input type="radio" checked={!custom} onChange={() => setCustom(false)} data-testid="ip-redirect-google" /> Send them to google.com
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: 'pointer', marginTop: 6 }}>
              <input type="radio" checked={custom} onChange={() => setCustom(true)} data-testid="ip-redirect-custom-radio" /> Send them to another address
            </label>
            {custom && <input className="fm-input" style={{ marginTop: 8 }} value={redirectTo} onChange={e => setRedirectTo(e.target.value)} placeholder="https://example.com" data-testid="ip-redirect-custom-input" />}
          </div>
        )}
        <input className="fm-input" style={{ marginTop: 12 }} value={note} onChange={e => setNote(e.target.value)} placeholder="Label (optional), e.g. Spam bot" data-testid="ip-note-input" />
        <button className="fm-btn fm-btn--primary" style={{ marginTop: 12 }} disabled={busy || !ips.trim()} onClick={create} data-testid="ip-create-btn">{busy ? 'Saving…' : 'Add rule'}</button>
      </div>
      {error && <div className="fm-error" data-testid="ip-error">{error}</div>}
      {loading ? <div data-testid="ip-loading">Loading…</div> : rules.length === 0 ? (
        <div className="geo-empty" data-testid="ip-empty">No IP rules yet.</div>
      ) : (
        <div className="geo-rules" data-testid="ip-rules-list">
          {rules.map(r => (
            <div key={r.id} className="geo-rule-card" data-testid={`ip-rule-${r.id}`}>
              <div>
                <span className={`geo-rule-badge ${r.kind === 'block' ? 'geo-rule-badge--block' : ''}`}>{r.kind === 'block' ? 'Block' : 'Redirect'}</span>
                <div style={{ fontFamily: 'monospace', fontSize: 13, marginTop: 6, wordBreak: 'break-all' }}>{r.ips.join(', ')}</div>
                {r.kind === 'redirect' && <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>→ {r.target}</div>}
                {r.note && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{r.note}</div>}
              </div>
              <button className="fm-btn fm-btn--ghost" onClick={() => remove(r)} data-testid={`ip-rule-${r.id}-delete`}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Logs({ api, domain }) {
  const [q, setQ] = useState('');
  const [hours, setHours] = useState(24);
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await api(`/ip-logs?domain=${encodeURIComponent(domain)}&q=${encodeURIComponent(q.trim())}&hours=${hours}`); setEvents(r.events || []); }
    catch (e) { setError(e.message); setEvents([]); } finally { setLoading(false); }
  }, [api, domain, q, hours]);
  useEffect(() => { search(); }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="ip-logs">
      <p className="geo-mode-desc" style={{ marginTop: 0 }}>Investigate traffic reaching your website. Search by IP address or Ray ID to review blocked requests, see where they came from and when they occurred.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <input className="fm-input" style={{ flex: 1, minWidth: 220 }} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="IP address or Ray ID (blank = all blocked)" data-testid="ip-logs-search" />
        <select className="fm-input" style={{ maxWidth: 150 }} value={hours} onChange={e => setHours(Number(e.target.value))} data-testid="ip-logs-hours">
          <option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={72}>Last 3 days</option>
        </select>
        <button className="fm-btn fm-btn--primary" onClick={search} disabled={loading} data-testid="ip-logs-search-btn">{loading ? 'Searching…' : 'Search'}</button>
      </div>
      {error && <div className="fm-error" data-testid="ip-logs-error">{error}</div>}
      {events === null ? null : events.length === 0 ? (
        <div className="geo-empty" data-testid="ip-logs-empty">No blocked or challenged requests found for this search.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="fm-table" data-testid="ip-logs-table" style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th>When (UTC)</th><th>IP</th><th>From</th><th>Action</th><th>Path</th><th>Ray ID</th></tr></thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} data-testid={`ip-logs-row-${i}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toISOString().slice(0, 19).replace('T', ' ')}</td>
                  <td style={{ fontFamily: 'monospace' }}>{e.ip}</td>
                  <td>{[e.country, e.asn].filter(Boolean).join(' · ')}</td>
                  <td><span className="geo-rule-badge geo-rule-badge--block">{e.action}</span></td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${e.method || ''} ${e.path || ''}`}>{e.path}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.rayId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
