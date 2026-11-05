import React, { useState } from 'react';
import { useSiteLook } from './landing/kit';
import { useApi } from '../api';
import { EsimCheckoutHost } from './landing/EsimCheckout';
import { HowItWorks } from './landing/Sections';
import { Platform } from './landing/Platform';
import { TryCall } from './landing/TryCall';
import { Faq, FinalCta, Footer } from './landing/PricingFaq';
import { OneHero, AllPlans, CompareTable } from './landing/OnePage';
import { startPrice } from '../api';
import { LandingNav } from './landing/Nav';
import { StickyCta } from './landing/StickyCta';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import SupportChat from '../SupportChat';
import { Reviews } from './landing/HeroPhone';
import { MobileCheckoutHost } from './landing/MobileCheckout';

export { LANDING_LINKS } from './landing/Nav';

export default function Landing() {
  // The bundled snapshot paints pricing, coverage and facts at once; the live catalogue replaces it when it answers.
  const { data } = useApi('/public/catalog');
  const { data: esim } = useApi('/public/esim-plans');
  const { data: offer } = useApi('/public/mobile-offer');
  const catalog = data || CATALOG_SNAPSHOT;
  const [tab, setTab] = useState('ivr');
  useSiteLook();
  return (
    <div className="civr-l civr-np" data-testid="landing-page" data-catalog={data ? 'live' : 'snapshot'}>
      <LandingNav catalog={catalog} />
      <main>
        <OneHero setTab={setTab} from={startPrice(catalog)} />
        <AllPlans catalog={catalog} tab={tab} setTab={setTab} esimPrice={esim?.plans?.[0]?.price} offer={offer} />
        <CompareTable catalog={catalog} />
        <Platform catalog={catalog} />
        <HowItWorks catalog={catalog} />
        <TryCall />
        <Reviews />
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
