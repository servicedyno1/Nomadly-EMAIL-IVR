import React from 'react';
import { useSiteLook } from './landing/kit';
import { useApi } from '../api';
import { HeroV2 } from './landing/HeroV2';
import { TrustStrip, Pillars, ChannelSlider, FinalCtaV2, Quotes } from './landing/V2Sections';
import { Coverage, HowItWorks } from './landing/Sections';
import { UseCases } from './landing/UseCases';
import { Platform } from './landing/Platform';
import { Trust } from './landing/Trust';
import { TryCall } from './landing/TryCall';
import { Pricing, Faq, Footer } from './landing/PricingFaq';
import { LandingNav } from './landing/Nav';
import { StickyCta } from './landing/StickyCta';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import SupportChat from '../SupportChat';
import { Reviews } from './landing/HeroPhone';

export { LANDING_LINKS } from './landing/Nav';

export default function Landing() {
  // The bundled snapshot paints pricing, coverage and facts at once; the live catalogue replaces it when it answers.
  const { data } = useApi('/public/catalog');
  const catalog = data || CATALOG_SNAPSHOT;
  useSiteLook();
  return (
    <div className="civr-l civr-np" data-testid="landing-page" data-catalog={data ? 'live' : 'snapshot'}>
      <LandingNav catalog={catalog} />
      <main>
        <HeroV2 catalog={catalog} />
        <TrustStrip catalog={catalog} />
        <Pillars />
        <ChannelSlider />
        <Platform catalog={catalog} />
        <UseCases />
        <TryCall />
        <HowItWorks catalog={catalog} />
        <Coverage catalog={catalog} />
        <Quotes />
        <Reviews />
        <Pricing catalog={catalog} />
        <Trust />
        <Faq catalog={catalog} />
        <FinalCtaV2 />
      </main>
      <Footer catalog={catalog} />
      <StickyCta />
      <SupportChat visitor supportLink={catalog?.supportLink} />
    </div>
  );
}
