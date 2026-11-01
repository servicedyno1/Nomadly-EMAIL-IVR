import React from 'react';
import { ArrowRight, Zap, QrCode, Radio, MessageSquareText } from 'lucide-react';
import { useApi } from '../../api';
import { Reveal } from './kit';
import { openEsimCheckout } from './EsimCheckout';

const slug = (id) => id.replace(/\W/g, '');
const POINTS = [[Radio, 'T-Mobile network', 'Nationwide US coverage on T-Mobile.'], [QrCode, 'Instant QR install', 'Pay, scan the QR code and the line is on your phone.'], [MessageSquareText, 'Calls & texts in the app', 'Use the same number on your phone and in CloudIVR.']];

// CloudIVR eSIM: live plans from the catalog (only the ones the owner put on sale); Buy opens the checkout.
export function EsimPlans() {
  const { data } = useApi('/public/esim-plans');
  const plans = data?.plans || [];
  return (
    <section id="esim" className="py-16 md:py-24 scroll-mt-24" data-testid="esim-section">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
        <Reveal>
          <div className="civr-l-kicker"><Zap className="w-3.5 h-3.5" />Instant QR install</div>
          <h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl mt-4 max-w-3xl">CloudIVR eSIM: a US mobile line on the T-Mobile network</h2>
          <p className="v2-muted mt-4 max-w-2xl text-lg">Buy it right here, scan the QR code and your new number works on your phone, with calls, texts and data. The same number makes calls and sends texts in the CloudIVR app too.</p>
        </Reveal>
        <div className="grid sm:grid-cols-3 gap-4 mt-8" data-testid="esim-points">{POINTS.map(([I, t, s]) => <div key={t} className="flex gap-3"><span className="w-10 h-10 rounded-xl grid place-items-center v2-hero shrink-0"><I className="w-5 h-5" /></span><div><div className="font-semibold">{t}</div><div className="text-sm v2-muted mt-0.5">{s}</div></div></div>)}</div>
        {plans.length ? (
          <div className={`grid gap-5 mt-10 ${plans.length === 1 ? 'max-w-md' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>{plans.map(p => (
            <div key={p.planId} className="v2-surface p-6 flex flex-col v2-lift" data-testid={`esim-landing-plan-${slug(p.planId)}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{p.name}</span><span className="text-xs v2-muted">{p.carrier}</span></div>
              <div className="civr-l-h text-4xl mt-4">{`$${p.price}`} <span className="text-base font-medium v2-muted">{`/ ${p.validityDays} days`}</span></div>
              <ul className="mt-4 space-y-1.5 text-sm flex-1">{[p.data && `${p.data} data`, p.voiceMinutes != null && `${p.voiceMinutes} minutes of calls`, p.sms && (p.sms === 'Unlimited' ? 'Unlimited texts' : `${p.sms} texts`), 'US phone number included', 'Calls and texts in the CloudIVR app'].filter(Boolean).map(x => <li key={x}>{x}</li>)}</ul>
              <button type="button" onClick={() => openEsimCheckout(p.planId)} className="civr-l-pill civr-l-pill-ink mt-6 inline-flex items-center justify-center gap-2" data-testid={`esim-landing-order-${slug(p.planId)}`}>Buy eSIM<ArrowRight className="w-4 h-4" /></button>
            </div>
          ))}</div>
        ) : <p className="v2-muted mt-8" data-testid="esim-landing-soon">Plans are being added. Sign up and we’ll show them in your account.</p>}
      </div>
    </section>
  );
}
