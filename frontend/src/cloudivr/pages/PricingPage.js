import React, { useEffect, useState } from 'react';
import { useApi } from '../api';
import { useSiteLook } from './landing/kit';
import { LandingNav } from './landing/Nav';
import { AllPlans } from './landing/OnePage';
import { UsageRates } from './landing/UsageRates';
import { Faq, FinalCta, Footer } from './landing/PricingFaq';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import { EsimCheckoutHost } from './landing/EsimCheckout';
import { MobileCheckoutHost } from './landing/MobileCheckout';

export default function PricingPage() {
  useSiteLook();
  const { data } = useApi('/public/catalog');
  const { data: esim } = useApi('/public/esim-plans');
  const { data: offer } = useApi('/public/mobile-offer');
  const { data: fax } = useApi('/public/fax-offer');
  const catalog = data || CATALOG_SNAPSHOT;
  const [tab, setTab] = useState('ivr');
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h.startsWith('pricing-')) setTab(h.slice(8));
    if (!h || h.startsWith('pricing-')) { window.scrollTo(0, 0); return undefined; }
    const t = setTimeout(() => document.getElementById(h)?.scrollIntoView({ block: 'start' }), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="civr-l civr-np" data-testid="pricing-page">
      <LandingNav catalog={catalog} />
      <main className="pt-16">
        <AllPlans catalog={catalog} tab={tab} setTab={setTab} esimPrice={esim?.plans?.[0]?.price} offer={offer} fax={fax} full />
        <UsageRates catalog={catalog} fax={fax} />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
      <EsimCheckoutHost />
      <MobileCheckoutHost offer={offer} />
    </div>
  );
}
