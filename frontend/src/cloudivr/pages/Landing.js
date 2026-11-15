import React, { useEffect, useState } from 'react';
import { useSiteLook } from './landing/kit';
import { useApi } from '../api';
import { EsimCheckoutHost } from './landing/EsimCheckout';
import { HowItWorks } from './landing/Sections';
import { TryCall } from './landing/TryCall';
import { Faq, FinalCta, Footer } from './landing/PricingFaq';
import { OneHero, AllPlans } from './landing/OnePage';
import { startPrice } from '../api';
import { LandingNav } from './landing/Nav';
import { QuotesStrip } from './landing/QuotesStrip';
import { StickyCta } from './landing/StickyCta';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import SupportChat from '../SupportChat';
import { MobileCheckoutHost } from './landing/MobileCheckout';

export { LANDING_LINKS } from './landing/Nav';

export default function Landing() {
  // The bundled snapshot paints pricing, coverage and facts at once; the live catalogue replaces it when it answers.
  const { data } = useApi('/public/catalog');
  const { data: esim } = useApi('/public/esim-plans');
  const { data: offer } = useApi('/public/mobile-offer');
  const { data: fax, error: faxError } = useApi('/public/fax-offer');
  const catalog = data || CATALOG_SNAPSHOT;
  const [tab, setTab] = useState('ivr');
  useSiteLook();
  // Footer "kind of number" links pick their pricing tab; deep links (#pricing-fax, #faq …) scroll once the page has rendered.
  useEffect(() => {
    const open = (t) => { if (t) setTab(t); document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const on = (e) => open(e.detail);
    window.addEventListener('civr-pricing-tab', on);
    const h = window.location.hash.slice(1);
    const t = setTimeout(() => { if (h.startsWith('pricing-')) open(h.slice(8)); else if (h) document.getElementById(h)?.scrollIntoView({ block: 'start' }); }, 450);
    return () => { window.removeEventListener('civr-pricing-tab', on); clearTimeout(t); };
  }, []);
  return (
    <div className="civr-l civr-np" data-testid="landing-page" data-catalog={data ? 'live' : 'snapshot'}>
      <LandingNav catalog={catalog} />
      <main>
        <OneHero setTab={setTab} from={startPrice(catalog)} fax={fax} faxFailed={!!faxError} />
        <QuotesStrip />
        <HowItWorks catalog={catalog} />
        <AllPlans catalog={catalog} tab={tab} setTab={setTab} esimPrice={esim?.plans?.[0]?.price} offer={offer} fax={fax} />
        <TryCall />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
      <StickyCta />
      <EsimCheckoutHost />
      <MobileCheckoutHost offer={offer} />
      <SupportChat visitor supportLink={catalog?.supportLink} />
    </div>
  );
}
