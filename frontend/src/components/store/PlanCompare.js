import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus } from 'lucide-react';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const YES = true;

function Cell({ v }) {
  const { t } = useTranslation();
  if (v === true) return <Check size={18} className="lp-cmp-yes" aria-label={t('store.lp.cmpIncluded')} />;
  if (v === false) return <Minus size={18} className="lp-cmp-no" aria-label={t('store.lp.cmpNotIncluded')} />;
  return <>{v}</>;
}

export function PlanCompare({ plans, onBuy }) {
  const { t } = useTranslation();
  if (!plans.length) return null;
  const qty = (v) => (v === 'unlimited' ? t('store.lp.cmpUnlimited') : v);
  const rows = [
    ['price', p => <strong>{money(p.priceUsd)}<span className="lp-cmp-per">/{p.durationDays === 7 ? t('store.perWeek') : t('store.perMonth')}</span></strong>],
    ['billing', p => (p.durationDays === 7 ? t('store.billedWeekly') : t('store.billedMonthly'))],
    ['addons', p => qty(p.addons)],
    ['mysql', p => qty(p.mysql)],
    ['antired', () => YES],
    ['panel', () => YES],
    ['email', () => YES],
    ['apps', () => YES],
    ['captcha', p => !!p.captcha],
    ['geo', p => !!p.geo],
    ['guarantee', () => YES],
  ];
  return (
    <div className="lp-cmp" data-testid="store-compare-table">
      <h3 className="lp-h3 lp-cmp-title">{t('store.lp.cmpTitle')}</h3>
      <div className="lp-cmp-scroll" tabIndex={0} aria-label={t('store.lp.cmpTitle')}>
        <table className="lp-cmp-table">
          <thead>
            <tr>
              <th scope="col" className="lp-cmp-feat">{t('store.lp.cmpFeature')}</th>
              {plans.map(p => (
                <th scope="col" key={p.id} className={p.tier === 'gold' ? 'lp-cmp-gold' : ''} data-testid={`store-cmp-head-${p.id}`}>
                  {p.tier === 'gold' && <span className="lp-cmp-badge">{t('store.badgePopular')}</span>}
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, get]) => (
              <tr key={key} data-testid={`store-cmp-row-${key}`}>
                <th scope="row" className="lp-cmp-feat">{t(`store.lp.cmpRow_${key}`)}</th>
                {plans.map(p => (
                  <td key={p.id} className={p.tier === 'gold' ? 'lp-cmp-gold' : ''} data-testid={`store-cmp-${key}-${p.id}`}><Cell v={get(p)} /></td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="lp-cmp-feat" aria-label={t('store.buyNow')} />
              {plans.map(p => (
                <td key={p.id} className={p.tier === 'gold' ? 'lp-cmp-gold' : ''}>
                  <button type="button" className={`store-btn store-btn--primary ${p.tier === 'gold' ? 'store-btn--gold' : ''}`}
                    onClick={() => onBuy(p)} data-testid={`store-cmp-buy-${p.id}`}>{t('store.buyNow')}</button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
