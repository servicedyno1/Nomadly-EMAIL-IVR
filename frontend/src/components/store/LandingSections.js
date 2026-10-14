import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, Bitcoin, ShieldCheck, RefreshCw, XCircle, CheckCircle2, ArrowRight, ChevronDown,
  LayoutGrid, KeyRound, LifeBuoy, Info,
} from 'lucide-react';
import { HeroVisual } from './HeroVisual';
import { PlanCompare } from './PlanCompare';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export function scrollToId(e, id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (e) e.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function SectionHead({ kicker, title, sub, testId }) {
  return (
    <div className="lp-head" data-testid={testId}>
      {kicker && <span className="lp-kicker">{kicker}</span>}
      <h2 className="lp-h2">{title}</h2>
      {sub && <p className="lp-sub">{sub}</p>}
    </div>
  );
}

export function HeroSection({ plans }) {
  const { t } = useTranslation();
  const minPrice = plans.length ? Math.min(...plans.map(p => Number(p.priceUsd) || 0)) : null;
  const minPlan = plans.find(p => Number(p.priceUsd) === minPrice);
  const per = minPlan && minPlan.durationDays === 7 ? t('store.perWeek') : t('store.perMonth');
  return (
    <section className="lp-hero" data-testid="store-hero">
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow lp-rise" data-testid="store-hero-eyebrow"><i />{t('store.lp.heroEyebrow')}</span>
          <h1 className="lp-h1 lp-rise" style={{ animationDelay: '.06s' }} data-testid="store-hero-title">{t('store.heroTitle')}</h1>
          <p className="lp-lead lp-rise" style={{ animationDelay: '.12s' }} data-testid="store-hero-sub">{t('store.tagline')}</p>
          <p className="lp-explainer lp-rise" style={{ animationDelay: '.18s' }} data-testid="store-antired-explainer">
            <Info size={16} aria-hidden="true" /><span>{t('store.antiRedExplainer')}</span>
          </p>
          <div className="lp-cta-row lp-rise" style={{ animationDelay: '.24s' }}>
            <a href="#plans" onClick={e => scrollToId(e, 'plans')} className="lp-cta" data-testid="store-hero-cta">
              {t('store.lp.heroCta')} <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a href="#store-signin" onClick={e => scrollToId(e, 'store-signin')} className="lp-cta-ghost" data-testid="store-mobile-signin">
              {t('store.signInMobile')}
            </a>
          </div>
          {minPrice !== null && (
            <p className="lp-micro lp-rise" style={{ animationDelay: '.3s' }} data-testid="store-hero-from">
              {t('store.lp.heroFrom', { amount: `${money(minPrice)}/${per}` })}
            </p>
          )}
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

const TRUST = [
  { key: 'Instant', Icon: Zap },
  { key: 'Crypto', Icon: Bitcoin },
  { key: 'AntiRed', Icon: ShieldCheck },
  { key: 'Replace', Icon: RefreshCw },
];

export function TrustBar() {
  const { t } = useTranslation();
  return (
    <section className="lp-trust" aria-label={t('store.lp.trustAria')} data-testid="store-trust-bar">
      <div className="lp-wrap lp-trust-grid">
        {TRUST.map(({ key, Icon }) => (
          <div className="lp-trust-item" key={key} data-testid={`store-trust-${key.toLowerCase()}`}>
            <span className="lp-trust-icon"><Icon size={20} aria-hidden="true" /></span>
            <div>
              <h3 className="lp-trust-t">{t(`store.lp.trust${key}T`)}</h3>
              <p className="lp-trust-d">{t(`store.lp.trust${key}D`)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CompareSection({ brandName }) {
  const { t } = useTranslation();
  const rows = [1, 2, 3, 4];
  return (
    <section className="lp-section" id="why" data-testid="store-compare">
      <div className="lp-wrap">
        <SectionHead kicker={t('store.lp.compareKicker')} title={t('store.lp.compareTitle')} sub={t('store.lp.compareSub')} />
        <div className="lp-compare">
          <article className="lp-compare-card" data-testid="store-compare-standard">
            <h3 className="lp-h3">{t('store.lp.compareStdTitle')}</h3>
            <ul>{rows.map(i => <li key={i}><XCircle size={18} className="lp-x" aria-hidden="true" />{t(`store.lp.compareStd${i}`)}</li>)}</ul>
          </article>
          <article className="lp-compare-card lp-compare-card--ar" data-testid="store-compare-antired">
            <h3 className="lp-h3">{t('store.lp.compareArTitle', { brand: brandName })}</h3>
            <ul>{rows.map(i => <li key={i}><CheckCircle2 size={18} className="lp-check" aria-hidden="true" />{t(`store.lp.compareAr${i}`)}</li>)}</ul>
          </article>
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const { t } = useTranslation();
  return (
    <section className="lp-section lp-section--inset" id="how" data-testid="store-how">
      <div className="lp-wrap">
        <SectionHead kicker={t('store.lp.howKicker')} title={t('store.lp.howTitle')} />
        <ol className="lp-steps">
          {[1, 2, 3].map(i => (
            <li key={i} className="lp-step" data-testid={`store-how-step-${i}`}>
              <span className="lp-step-n">{i}</span>
              <h3 className="lp-h3">{t(`store.lp.how${i}T`)}</h3>
              <p>{t(`store.lp.how${i}D`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PlanCard({ p, onBuy }) {
  const { t } = useTranslation();
  const isGold = p.tier === 'gold';
  const per = p.durationDays === 7 ? t('store.perWeek') : t('store.perMonth');
  const moEq = p.durationDays === 7 ? (Number(p.priceUsd) * 30 / 7) : null;
  return (
    <article className={`store-plan-card ${isGold ? 'store-plan-card--gold' : ''}`} data-testid={`store-plan-${p.id}`}>
      {isGold && <div className="store-plan-badge" data-testid={`store-badge-${p.id}`}>{t('store.badgePopular')}</div>}
      <h3 className="store-plan-name">{p.name}</h3>
      <div className="store-plan-price" data-testid={`store-price-${p.id}`}>{money(p.priceUsd)}<span className="store-plan-per">/{per}</span></div>
      <div className="store-plan-billing" data-testid={`store-billing-${p.id}`}>
        {moEq ? `${t('store.moEquiv', { amount: money(moEq) })} · ${t('store.billedWeekly')}` : t('store.billedMonthly')}
      </div>
      <ul className="store-plan-feats">{(p.features || []).map((f, i) => <li key={i}><span className="store-feat-check" aria-hidden="true">✓</span>{f}</li>)}</ul>
      <button className={`store-btn store-btn--primary ${isGold ? 'store-btn--gold' : ''}`} onClick={() => onBuy(p)} data-testid={`store-buynow-${p.id}`}>
        {isGold ? t('store.getPlan', { name: (p.name || '').split(' ')[0] }) : t('store.buyNow')}
      </button>
    </article>
  );
}

export function PricingSection({ plans, onBuy, children }) {
  const { t } = useTranslation();
  return (
    <section className="lp-section" id="plans" data-testid="store-pricing">
      <div className="lp-wrap">
        <SectionHead kicker={t('store.lp.plansKicker')} title={t('store.lp.plansTitle')} sub={t('store.lp.plansSub')} />
        <div className="store-plan-grid" data-testid="store-plans">
          {plans.map(p => <PlanCard key={p.id} p={p} onBuy={onBuy} />)}
        </div>
        <PlanCompare plans={plans} onBuy={onBuy} />
        {children}
      </div>
    </section>
  );
}

const PROOF = [
  { i: 1, Icon: ShieldCheck },
  { i: 2, Icon: LayoutGrid },
  { i: 3, Icon: KeyRound },
  { i: 4, Icon: LifeBuoy },
];

export function ProofSection({ supportHandle, supportLink }) {
  const { t } = useTranslation();
  return (
    <section className="lp-section lp-section--surface" data-testid="store-proof">
      <div className="lp-wrap lp-proof">
        <div>
          <SectionHead kicker={t('store.lp.proofKicker')} title={t('store.lp.proofTitle')} />
          <div className="lp-proof-grid">
            {PROOF.map(({ i, Icon }) => (
              <div className="lp-proof-item" key={i} data-testid={`store-proof-${i}`}>
                <Icon size={20} aria-hidden="true" />
                <div>
                  <h3 className="lp-proof-t">{t(`store.lp.proof${i}T`)}</h3>
                  <p className="lp-proof-d">{t(`store.lp.proof${i}D`)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="lp-guarantee" data-testid="store-guarantee">
          <span className="lp-guarantee-icon"><RefreshCw size={26} aria-hidden="true" /></span>
          <h3 className="lp-h3">{t('store.lp.guaranteeTitle')}</h3>
          <p>{t('store.lp.guaranteeBody')}</p>
          {supportLink && (
            <a className="lp-cta-ghost" href={supportLink} target="_blank" rel="noopener noreferrer" data-testid="store-guarantee-support">
              {t('store.lp.guaranteeCta', { handle: supportHandle })}
            </a>
          )}
        </aside>
      </div>
    </section>
  );
}

export function FaqSection() {
  const { t } = useTranslation();
  const items = [1, 2, 3, 4, 5, 6, 7];
  return (
    <section className="lp-section" id="faq" data-testid="store-faq">
      <div className="lp-wrap lp-faq-wrap">
        <SectionHead kicker={t('store.lp.faqKicker')} title={t('store.lp.faqTitle')} />
        <div className="lp-faq">
          {items.map(i => (
            <details key={i} className="lp-faq-item" data-testid={`store-faq-item-${i}`}>
              <summary data-testid={`store-faq-q-${i}`}>
                <span>{t(`store.lp.faq${i}Q`)}</span><ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p data-testid={`store-faq-a-${i}`}>{i === 3 ? t('store.antiRedExplainer') : t(`store.lp.faq${i}A`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  const { t } = useTranslation();
  return (
    <section className="lp-final" data-testid="store-final-cta">
      <div className="lp-wrap lp-final-inner">
        <div>
          <h2 className="lp-h2">{t('store.lp.finalTitle')}</h2>
          <p className="lp-sub">{t('store.lp.finalSub')}</p>
        </div>
        <a href="#plans" onClick={e => scrollToId(e, 'plans')} className="lp-cta lp-cta--lg" data-testid="store-final-cta-btn">
          {t('store.lp.finalCta')} <ArrowRight size={18} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
