import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Globe, ExternalLink, RefreshCw, Mail, ShoppingCart, Power, CalendarClock, Layers, Crown, AlertTriangle } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useBrand } from '../../hooks/useBrand';

function daysLeft(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (isNaN(ms)) return null;
  return ms < 0 ? Math.min(-1, Math.floor(ms / 86400000)) : Math.floor(ms / 86400000);
}

function ExpiryBanner({ days, autoRenew, renewUrl }) {
  const { t } = useTranslation();
  if (days === null || days > 3) return null;
  const expired = days < 0;
  const title = expired ? t('dashboard.ov.expBannerExpired') : days === 0 ? t('dashboard.ov.expBannerToday') : t('dashboard.ov.expBannerSoon', { count: days });
  const body = expired ? t('dashboard.ov.expExpiredBody') : autoRenew ? t('dashboard.ov.expAutoOn') : t('dashboard.ov.expAutoOff');
  return (
    <div className={`pov-exp ${expired ? 'pov-exp--bad' : ''}`} role="alert" data-testid="panel-expiry-banner" data-state={expired ? 'expired' : 'soon'}>
      <AlertTriangle size={22} aria-hidden="true" className="pov-exp-icon" />
      <div className="pov-exp-text">
        <strong data-testid="panel-expiry-title">{title}</strong>
        <span data-testid="panel-expiry-body">{body}</span>
      </div>
      {renewUrl && (
        <a className="pov-exp-btn" href={renewUrl} target="_blank" rel="noopener noreferrer" data-testid="panel-expiry-renew">
          <RefreshCw size={16} aria-hidden="true" />{t('dashboard.ov.expRenewNow')}
        </a>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, note, tone = '', action, testId }) {
  return (
    <div className={`pov-stat ${tone ? `pov-stat--${tone}` : ''}`} data-testid={testId}>
      <div className="pov-stat-top"><span className="pov-stat-icon"><Icon size={18} aria-hidden="true" /></span><span className="pov-stat-label">{label}</span></div>
      <div className="pov-stat-value" data-testid={`${testId}-value`}>{value}</div>
      <div className="pov-stat-foot">{note && <span className="pov-stat-note">{note}</span>}{action}</div>
    </div>
  );
}

function QuickAction({ icon: Icon, title, desc, onClick, href, testId }) {
  const inner = (<><span className="pov-qa-icon"><Icon size={20} aria-hidden="true" /></span><span className="pov-qa-text"><strong>{title}</strong><span>{desc}</span></span></>);
  return href
    ? <a className="pov-qa" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" data-testid={testId}>{inner}</a>
    : <button type="button" className="pov-qa" onClick={onClick} data-testid={testId}>{inner}</button>;
}

export default function PanelOverview({ onNavigate }) {
  const { t, i18n } = useTranslation();
  const { user, api } = useAuth();
  const brand = useBrand();
  const [status, setStatus] = useState(null);
  const [domainCount, setDomainCount] = useState(null);

  useEffect(() => {
    api('/account/site-status').then(setStatus).catch(() => setStatus({}));
    api('/domains').then(r => {
      const d = r?.data;
      if (d && (d.main_domain || d.addon_domains)) setDomainCount((d.main_domain ? 1 : 0) + (d.addon_domains || []).length);
    }).catch(() => {});
  }, [api]);

  const s = status?.status || 'online';
  const days = daysLeft(status?.expiryDate);
  const expTone = days === null ? '' : days < 0 ? 'bad' : days <= 7 ? 'warn' : 'ok';
  const expNote = days === null ? '' : days < 0 ? t('dashboard.ov.expired') : days === 0 ? t('dashboard.ov.expiresToday') : t('dashboard.ov.daysLeft', { count: days });
  const fmtDate = (iso) => {
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    try { return new Date(iso).toLocaleDateString(i18n.language, opts); } catch { return new Date(iso).toLocaleDateString(undefined, opts); }
  };
  const bot = (brand.botUsername || '').replace(/^@/, '');
  const renewUrl = bot ? `https://t.me/${bot}?start=renew` : '';
  const loading = status === null;

  return (
    <div className="pov" data-testid="panel-overview">
      <section className="pov-hero">
        <div>
          <h1 className="pov-h1" data-testid="panel-overview-title">{t('dashboard.welcome', { name: user?.username })}</h1>
          <p className="pov-sub">{t('dashboard.ov.subtitle', { domain: user?.domain })}</p>
        </div>
        {user?.isGold && <span className="pov-gold" data-testid="panel-overview-gold"><Crown size={14} aria-hidden="true" />{t('dashboard.ov.goldBadge')}</span>}
      </section>

      <ExpiryBanner days={days} autoRenew={!!status?.autoRenew} renewUrl={renewUrl} />

      <section className="pov-stats" aria-label={t('dashboard.tabs.overview')}>
        <StatCard icon={Power} testId="panel-ov-status" label={t('dashboard.ov.statusLabel')} tone={s === 'online' ? 'ok' : 'warn'}
          value={loading ? t('dashboard.ov.loading') : t(`dashboard.ov.${s}`)}
          action={<button type="button" className="pov-link" onClick={() => onNavigate('site')} data-testid="panel-ov-status-manage">{t('dashboard.ov.manage')}</button>} />
        <StatCard icon={Layers} testId="panel-ov-plan" label={t('dashboard.planLabel')}
          value={loading ? t('dashboard.ov.loading') : (status?.plan || user?.plan || '—')}
          note={status && Object.keys(status).length ? (status.autoRenew ? t('dashboard.ov.autoRenewOn') : t('dashboard.ov.autoRenewOff')) : ''} />
        <StatCard icon={CalendarClock} testId="panel-ov-expiry" label={t('dashboard.expiresLabel')} tone={expTone}
          value={loading ? t('dashboard.ov.loading') : (status?.expiryDate ? fmtDate(status.expiryDate) : '—')} note={expNote} />
        <StatCard icon={Globe} testId="panel-ov-domains" label={t('dashboard.ov.domainsLabel')}
          value={domainCount === null ? '—' : domainCount}
          action={<button type="button" className="pov-link" onClick={() => onNavigate('domains')} data-testid="panel-ov-domains-view">{t('dashboard.ov.view')}</button>} />
      </section>

      <section className="pov-qa-wrap">
        <h2 className="pov-h2">{t('dashboard.ov.quickTitle')}</h2>
        <div className="pov-qa-grid">
          <QuickAction icon={Upload} testId="panel-qa-upload" title={t('dashboard.ov.qaUpload')} desc={t('dashboard.ov.qaUploadD')} onClick={() => onNavigate('files')} />
          <QuickAction icon={Globe} testId="panel-qa-domain" title={t('dashboard.ov.qaDomain')} desc={t('dashboard.ov.qaDomainD')} onClick={() => onNavigate('domains')} />
          <QuickAction icon={ExternalLink} testId="panel-qa-open" title={t('dashboard.ov.qaOpen')} desc={t('dashboard.ov.qaOpenD')} href={`https://${user?.domain}`} />
          <QuickAction icon={Mail} testId="panel-qa-email" title={t('dashboard.ov.qaEmail')} desc={t('dashboard.ov.qaEmailD')} onClick={() => onNavigate('email')} />
          {renewUrl && <QuickAction icon={RefreshCw} testId="panel-qa-renew" title={t('dashboard.ov.qaRenew')} desc={t('dashboard.ov.qaRenewD')} href={renewUrl} />}
          <QuickAction icon={ShoppingCart} testId="panel-qa-buy" title={t('dashboard.ov.qaBuy')} desc={t('dashboard.ov.qaBuyD')} href="/store" />
        </div>
      </section>
    </div>
  );
}
