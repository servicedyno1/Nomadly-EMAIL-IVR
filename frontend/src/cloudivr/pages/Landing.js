import React from 'react';
import { useApi } from '../api';
import { Hero } from './landing/Hero';
import { Coverage, HowItWorks, Facts, Statement } from './landing/Sections';
import { Platform } from './landing/Platform';
import { TryCall } from './landing/TryCall';
import { Pricing, Faq, FinalCta, Footer } from './landing/PricingFaq';
import { LandingNav } from './landing/Nav';
import SupportChat from '../SupportChat';

export { LANDING_LINKS } from './landing/Nav';

export default function Landing() {
  const { data: catalog } = useApi('/public/catalog');
  return (
    <div className="civr-l" data-testid="landing-page">
      <LandingNav catalog={catalog} />
      <main>
        <Hero catalog={catalog} />
        <Facts catalog={catalog} />
        <Statement />
        <Platform catalog={catalog} />
        <TryCall />
        <Coverage catalog={catalog} />
        <HowItWorks catalog={catalog} />
        <Pricing catalog={catalog} />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
      <SupportChat visitor supportLink={catalog?.supportLink} />
    </div>
  );
}
