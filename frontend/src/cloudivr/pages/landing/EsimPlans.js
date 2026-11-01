import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap } from 'lucide-react';
import { useApi } from '../../api';
import { Reveal } from './kit';
import { useStart } from './PricingFaq';

const slug = (id) => id.replace(/\W/g, '');

// CloudIVR eSIM: live plans from the catalog (only the ones the owner put on sale).
export function EsimPlans() {
  const { data } = useApi('/public/esim-plans');
  const start = useStart();
  const plans = data?.plans || [];
  return (
    <section id="esim" className="py-16 md:py-24 scroll-mt-24" data-testid="esim-section">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
        <Reveal>
          <div className="civr-l-kicker"><Zap className="w-3.5 h-3.5" />Ready in minutes</div>
          <h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl mt-4 max-w-3xl">CloudIVR eSIM: a US mobile line on your phone</h2>
          <p className="v2-muted mt-4 max-w-2xl text-lg">Pay from your wallet, scan the QR code and your new number works in minutes, with calls, texts and data. Read and send its texts in CloudIVR too.</p>
        </Reveal>
        {plans.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">{plans.map(p => (
            <div key={p.planId} className="v2-surface p-6 flex flex-col v2-lift" data-testid={`esim-landing-plan-${slug(p.planId)}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{p.name}</span><span className="text-xs v2-muted">{p.carrier}</span></div>
              <div className="civr-l-h text-4xl mt-4">{`$${p.price}`} <span className="text-base font-medium v2-muted">{`/ ${p.validityDays} days`}</span></div>
              <ul className="mt-4 space-y-1.5 text-sm flex-1">{[p.data && `${p.data} data`, p.voiceMinutes != null && `${p.voiceMinutes} minutes of calls`, p.sms && (p.sms === 'Unlimited' ? 'Unlimited texts' : `${p.sms} texts`), 'US phone number included'].filter(Boolean).map(x => <li key={x}>{x}</li>)}</ul>
              <Link to={start('esim')} className="civr-l-pill civr-l-pill-ink mt-6" data-testid={`esim-landing-order-${slug(p.planId)}`}>Order eSIM<ArrowRight className="w-4 h-4" /></Link>
            </div>
          ))}</div>
        ) : <p className="v2-muted mt-8" data-testid="esim-landing-soon">Plans are being added. Sign up and we’ll show them in your account.</p>}
      </div>
    </section>
  );
}
