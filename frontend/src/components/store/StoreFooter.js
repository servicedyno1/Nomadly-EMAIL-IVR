import React from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '../../hooks/useBrand';
import { scrollToId } from './LandingSections';

export function StoreFooter({ brand, config, online }) {
  const { t } = useTranslation();
  const bot = (config?.botUsername || '').replace(/^@/, '');
  const links = [['plans', t('store.lp.navPlans')], ['faq', t('store.lp.navFaq')], ['store-signin', t('store.lp.navSignIn')]];
  return (
    <footer className="lp-footer" data-testid="store-footer">
      <div className="lp-wrap lp-footer-grid">
        <div className="lp-footer-brand">
          <div className="lp-footer-name">
            <BrandMark brand={brand} size={30} testId="store-footer-mark" />
            <span data-testid="store-footer-brand">{brand.brandName}</span>
          </div>
          <p>{t('store.lp.footerTagline')}</p>
          {online && <span className="lp-status" data-testid="store-footer-status"><i />{t('store.lp.footerStatus')}</span>}
        </div>
        <nav aria-label={t('store.lp.footerLinks')}>
          <h3 className="lp-footer-h">{t('store.lp.footerLinks')}</h3>
          {links.map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={e => scrollToId(e, id)} data-testid={`store-footer-link-${id}`}>{label}</a>
          ))}
        </nav>
        <div>
          <h3 className="lp-footer-h">{t('store.lp.footerSupport')}</h3>
          {config?.supportLink && (
            <a href={config.supportLink} target="_blank" rel="noopener noreferrer" data-testid="store-footer-support">{config.supportHandle}</a>
          )}
          {bot && (
            <a href={`https://t.me/${bot}`} target="_blank" rel="noopener noreferrer" data-testid="store-footer-bot">{t('store.lp.footerBot')} @{bot}</a>
          )}
        </div>
      </div>
      <div className="lp-wrap lp-footer-bottom" data-testid="store-footer-copy">
        {t('store.lp.footerRights', { year: new Date().getFullYear(), brand: brand.brandName })}
      </div>
    </footer>
  );
}
