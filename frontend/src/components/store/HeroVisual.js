import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Globe, Send, MessageCircle, CheckCircle2, Wallet } from 'lucide-react';

const ROWS = [
  { key: 'visBrowsers', Icon: Globe },
  { key: 'visTelegram', Icon: Send },
  { key: 'visWhatsapp', Icon: MessageCircle },
];

// Brand-neutral animated "link health" mock — decorative, no live data.
export function HeroVisual() {
  const { t } = useTranslation();
  return (
    <div className="lp-vis" data-testid="store-hero-visual" aria-hidden="true">
      <div className="lp-vis-grid" />
      <div className="lp-vis-card">
        <div className="lp-vis-head">
          <span className="lp-vis-shield"><ShieldCheck size={22} /></span>
          <div>
            <div className="lp-vis-title">{t('store.lp.visTitle')}</div>
            <div className="lp-vis-domain">{t('store.lp.visDomain')}</div>
          </div>
          <span className="lp-vis-live"><i />{t('store.lp.visLive')}</span>
        </div>
        <ul className="lp-vis-rows">
          {ROWS.map(({ key, Icon }, i) => (
            <li key={key} style={{ animationDelay: `${0.35 + i * 0.18}s` }}>
              <Icon size={16} />
              <span>{t(`store.lp.${key}`)}</span>
              <b className="lp-vis-ok"><CheckCircle2 size={14} />{t('store.lp.visClickable')}</b>
            </li>
          ))}
        </ul>
      </div>
      <div className="lp-vis-chip lp-vis-chip--a"><CheckCircle2 size={14} />{t('store.lp.visPanel')}</div>
      <div className="lp-vis-chip lp-vis-chip--b"><Wallet size={14} />{t('store.lp.visPaid')}</div>
    </div>
  );
}
