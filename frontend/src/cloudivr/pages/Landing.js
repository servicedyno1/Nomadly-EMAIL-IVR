import React from 'react';
import { useSiteLook } from './landing/kit';
import { useApi } from '../api';
import { Hero } from './landing/Hero';
import { Quotes } from './landing/V2Sections';
import { EsimCheckoutHost } from './landing/EsimCheckout';
import { Coverage, HowItWorks, Facts } from './landing/Sections';
import { Platform } from './landing/Platform';
import { Trust } from './landing/Trust';
import { TryCall } from './landing/TryCall';
import { Pricing, Faq, FinalCta, Footer } from './landing/PricingFaq';
import { LandingNav } from './landing/Nav';
import { StickyCta } from './landing/StickyCta';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import SupportChat from '../SupportChat';
import { Reviews } from './landing/HeroPhone';
import { ProductHero } from './landing/ProductHero';
import { MobileCheckoutHost } from './landing/MobileCheckout';
import { Showcase } from './landing/Showcase';

export { LANDING_LINKS } from './landing/Nav';

export default function Landing() {
  // The bundled snapshot paints pricing, coverage and facts at once; the live catalogue replaces it when it answers.
  const { data } = useApi('/public/catalog');
  const { data: esim } = useApi('/public/esim-plans');
  const { data: offer } = useApi('/public/mobile-offer');
  const catalog = data || CATALOG_SNAPSHOT;
  useSiteLook();
  return (
    <div className="civr-l civr-np" data-testid="landing-page" data-catalog={data ? 'live' : 'snapshot'}>
      <LandingNav catalog={catalog} />
      <main>
        <ProductHero esimPrice={esim?.plans?.[0]?.price} offer={offer} />
        <Showcase />
        <Hero catalog={catalog} />
        <Facts catalog={catalog} />
        <Platform catalog={catalog} />
        <TryCall />
        <Coverage catalog={catalog} />
        <Quotes />
        <Reviews />
        <Trust />
        <HowItWorks catalog={catalog} />
        <Pricing catalog={catalog} />
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
