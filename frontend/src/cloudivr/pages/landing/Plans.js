import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MessageSquareText, Printer, Smartphone } from 'lucide-react';
import { Reveal } from './kit';
import { cp } from '../../paths';
import { PlanCard, useStart } from './PricingFaq';

const OTHER = [['mobile', MessageSquareText, 'Calls + texting'], ['fax', Printer, 'Fax only'], ['esim', Smartphone, 'USA eSIM']];

// One row of plans; every other detail lives on the Pricing page.
export function LandingPlans({ catalog }) {
  const start = useStart();
  const plans = (catalog?.plans || []).filter(p => p.available !== false);
  const hasRec = plans.some(p => p.recommended);
  return (
    <section id="pricing" className="lx-soft scroll-mt-16" data-testid="pricing-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24 md:py-28">
        <Reveal className="max-w-3xl"><div className="civr-l-eyebrow">Plans</div><h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl text-slate-950 mt-4">One monthly price per number.</h2><p className="text-base md:text-lg text-slate-600 mt-4">No contract. Cancel any time.</p></Reveal>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch mt-12">{plans.map((p, i) => <PlanCard key={p.id} p={p} plans={plans} hot={hasRec ? p.recommended : i === 1} start={start} delay={i * 80} />)}</div>
        <Link to={cp('/app/bulk-sms')} className="mt-8 flex flex-wrap items-center gap-2 text-sm text-slate-700 hover:text-[#1d6fd8] transition-colors" data-testid="pricing-bulksms-line">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500 text-white">New</span>
          <b>Bulk SMS</b> to USA &amp; Canada mobiles — $0.10 a text (500 minimum, $50), single texts $1, 10% off scheduled a day ahead. No plan needed.<ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
        <div className="mt-10 flex flex-wrap items-center gap-3" data-testid="pricing-other-kinds">
          <span className="text-sm text-slate-600 mr-1">Other kinds of number:</span>
          {OTHER.map(([id, I, t]) => <Link key={id} to={cp(`/pricing#pricing-${id}`)} className="lx-chip hover:!border-[#1d6fd8] transition-colors" data-testid={`pricing-kind-${id}`}><I className="w-4 h-4 text-[#1d6fd8]" aria-hidden="true" />{t}</Link>)}
          <Link to={cp('/pricing')} className="group inline-flex items-center gap-2 min-h-[44px] text-sm font-semibold text-[#1d6fd8] sm:ml-auto" data-testid="pricing-full-link">Compare plans and see all pricing<ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  );
}
