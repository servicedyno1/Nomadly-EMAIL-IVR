import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSiteLook } from './landing/kit';
import { useApi } from '../api';
import { cp } from '../paths';
import { EsimCheckoutHost } from './landing/EsimCheckout';
import { HowItWorks } from './landing/Sections';
import { TryCall } from './landing/TryCall';
import { Faq, FinalCta, Footer } from './landing/PricingFaq';
import { OneHero, TrustBand } from './landing/Hero';
import { Bento } from './landing/Bento';
import { UseCases } from './landing/UseCases';
import { LandingPlans } from './landing/Plans';
import { LandingNav } from './landing/Nav';
import { QuotesStrip } from './landing/QuotesStrip';
import { StickyCta } from './landing/StickyCta';
import { CATALOG_SNAPSHOT } from './landing/catalogSnapshot';
import SupportChat from '../SupportChat';
import { AiSection } from './landing/AiSection';

export { LANDING_LINKS } from './landing/Nav';

export default function Landing() {
  // The bundled snapshot paints pricing, coverage and facts at once; the live catalogue replaces it when it answers.
  const { data } = useApi('/public/catalog');
  const { data: fax } = useApi('/public/fax-offer');
  const catalog = data || CATALOG_SNAPSHOT;
  const navigate = useNavigate();
  useSiteLook();
  // Old deep links to a kind of number (#pricing-fax …) now live on the Pricing page; other hashes scroll once rendered.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h.startsWith('pricing-')) { navigate(`${cp('/pricing')}#${h}`, { replace: true }); return undefined; }
    const t = setTimeout(() => { if (h) document.getElementById(h)?.scrollIntoView({ block: 'start' }); }, 450);
    return () => clearTimeout(t);
  }, [navigate]);
  return (
    <div className="civr-l civr-np" data-testid="landing-page" data-catalog={data ? 'live' : 'snapshot'}>
      <LandingNav catalog={catalog} />
      <main>
        <OneHero />
        <TrustBand catalog={catalog} />
        <TryCall />
        <Bento fax={fax} />
        <AiSection catalog={catalog} />
        <UseCases />
        <HowItWorks catalog={catalog} />
        <QuotesStrip />
        <LandingPlans catalog={catalog} />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />
      </main>
      <Footer catalog={catalog} />
      <StickyCta />
      <EsimCheckoutHost />
      <SupportChat visitor supportLink={catalog?.supportLink} />
    </div>
  );
}
