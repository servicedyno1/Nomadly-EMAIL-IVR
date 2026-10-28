import React, { useEffect } from 'react';
import { useApi } from '../api';
import { Hero } from './landing/Hero';
import { Coverage, HowItWorks, Facts, Statement } from './landing/Sections';
import { UseCases } from './landing/UseCases';
import { Platform } from './landing/Platform';
import { Trust } from './landing/Trust';
import { TryCall } from './landing/TryCall';
import { Pricing, Faq, FinalCta, Footer } from './landing/PricingFaq';
import { LandingNav } from './landing/Nav';
import { StickyCta } from './landing/StickyCta';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import SupportChat from '../SupportChat';
import { Bubbles } from './landing/Bubbles';
import { ProductCards } from './landing/ProductCards';
import './landing/np.css';

export { LANDING_LINKS } from './landing/Nav';

export default function Landing() {
  // The bundled snapshot paints pricing, coverage and facts at once; the live catalogue replaces it when it answers.
  const { data } = useApi('/public/catalog');
  const catalog = data || CATALOG_SNAPSHOT;
  // Lets portals (language menu, cookie banner) pick up the dark landing look.
  useEffect(() => { document.documentElement.dataset.civrNp = '1'; return () => { delete document.documentElement.dataset.civrNp; }; }, []);
  return (
    <div className="civr-l civr-np" data-testid="landing-page" data-catalog={data ? 'live' : 'snapshot'}>
      <LandingNav catalog={catalog} />
      <main>
        <Hero catalog={catalog} />
        <Facts catalog={catalog} />
        <Bubbles />
        <Statement />
        <UseCases />
        <Platform catalog={catalog} />
        <TryCall />
        <Coverage catalog={catalog} />
        <ProductCards />
        <Trust />
        <HowItWorks catalog={catalog} />
        <Pricing catalog={catalog} />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
      <StickyCta />
      <SupportChat visitor supportLink={catalog?.supportLink} />
    </div>
  );
}
