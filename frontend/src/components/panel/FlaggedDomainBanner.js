import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import { useBrand } from '../../hooks/useBrand';

// Main domain refused by Cloudflare (abuse block): explain + let the user swap in a new main domain for free.
export const FlaggedDomainBanner = ({ onReplaced }) => {
  const { t } = useTranslation();
  const { api, updateSession } = useAuth();
  const brand = useBrand();
  const [info, setInfo] = useState(null);
  const [choice, setChoice] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    try { setInfo(await api('/domains/flagged-primary')); } catch { setInfo(null); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const link = async () => {
    const domain = (choice === '__other' || !choice ? typed : choice).trim();
    if (!domain) return;
    setBusy(true); setError('');
    try {
      const r = await api('/domains/replace-flagged-primary', { method: 'POST', body: JSON.stringify({ domain }) });
      if (r.token) updateSession({ token: r.token, domain: r.newDomain });
      setDone(r); setInfo({ blocked: false });
      onReplaced && onReplaced(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (done) return <FlaggedDone done={done} t={t} />;
  if (!info?.blocked) return null;
  const bot = String(brand.botUsername || '').replace(/^@/, '');
  const useTyped = choice === '__other' || !info.eligible?.length;
  return (
    <div className="fm-error" data-testid="flagged-domain-banner" style={{ display: 'block', marginBottom: '1rem' }}>
      <strong data-testid="flagged-domain-title">{t('fdb.title', { domain: info.domain, defaultValue: '{{domain}} is flagged and blocked by our nameserver provider (Cloudflare)' })}</strong>
      <p style={{ margin: '0.5rem 0' }}>{t('fdb.body', { defaultValue: 'Your hosting plan is active — only this domain can\'t be used, because Cloudflare won\'t give it DNS. Link a new main domain below; it\'s free.' })}</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {info.eligible?.length > 0 && (
          <select className="fm-input" value={choice} onChange={e => setChoice(e.target.value)} data-testid="flagged-domain-select">
            <option value="">{t('fdb.pick', { defaultValue: 'Choose one of your domains…' })}</option>
            {info.eligible.map(d => <option key={d} value={d}>{d}</option>)}
            <option value="__other">{t('fdb.other', { defaultValue: 'A domain from elsewhere…' })}</option>
          </select>
        )}
        {useTyped && (
          <input className="fm-input" placeholder="example.com" value={typed} onChange={e => setTyped(e.target.value)} data-testid="flagged-domain-input" />
        )}
        <button type="button" className="fm-btn fm-btn--primary" disabled={busy || !(useTyped ? typed.trim() : choice)} onClick={link} data-testid="flagged-domain-link-btn">
          {busy ? t('fdb.linking', { defaultValue: 'Linking…' }) : t('fdb.link', { defaultValue: 'Link as main domain' })}
        </button>
        {bot && (
          <a className="fm-btn fm-btn--ghost" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer" data-testid="flagged-domain-buy-btn">
            {t('fdb.buy', { defaultValue: 'Register a new domain' })}
          </a>
        )}
      </div>
      {bot && <p style={{ margin: '0.5rem 0 0', fontSize: '0.85em', opacity: 0.85 }}>{t('fdb.buyHint', { defaultValue: 'Register it in the bot under 🌐 Bulletproof Domains, then come back here — it will be in the list.' })}</p>}
      {error && <p style={{ margin: '0.5rem 0 0' }} data-testid="flagged-domain-error">{error}</p>}
    </div>
  );
};

const FlaggedDone = ({ done, t }) => (
  <div className="fm-success" data-testid="flagged-domain-done" style={{ display: 'block', marginBottom: '1rem' }}>
    <strong>{t('fdb.done', { domain: done.newDomain, defaultValue: '{{domain}} is now your main domain.' })}</strong>
    {done.external && done.nameservers?.length > 0 ? (
      <p style={{ margin: '0.5rem 0 0' }} data-testid="flagged-domain-ns">
        {t('fdb.setNs', { defaultValue: 'One step left: at your domain registrar, set the nameservers to:' })}{' '}
        {done.nameservers.map(n => <code key={n} style={{ marginRight: 8 }}>{n}</code>)}
      </p>
    ) : (
      <p style={{ margin: '0.5rem 0 0' }}>{t('fdb.auto', { defaultValue: 'DNS and protection are set up automatically — your site goes live within a few minutes.' })}</p>
    )}
  </div>
);

export default FlaggedDomainBanner;
