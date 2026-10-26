import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, Plus, X } from 'lucide-react';
import { usd, money } from '../../api';
import { SectionHead, Slide, Reveal } from '../landing/kit';
import { faqItems, useStart } from '../landing/PricingFaq';
import { PaymentMethods } from '../landing/Payments';
import { andNames, byPrice, sipDomain, sipPick, sipPlans } from './shared';

// What a SIP buyer compares first; the full list is in "Compare every feature".
const ROWS = [
  ['browserPhone', 'Browser phone in any tab'],
  ['voicemail', 'Voicemail with transcripts'],
  ['ivr', 'Keypad menu (IVR)'],
  ['callRecording', 'Call recording'],
  ['ringGroup', 'Ring groups'],
  ['aiAgent', 'AI voice agent'],
];

function Tick({ on, className = 'w-4 h-4' }) {
  return on ? <Check className={`${className} text-[#4f46e5] shrink-0`} aria-label="Included" /> : <X className={`${className} text-slate-300 shrink-0`} aria-label="Not included" />;
}

function PlanCard({ p, hot, start, extra, delay }) {
  const sip = !!p.access?.sipCredentials;
  return (
    <Reveal delay={delay} className={`civr-l-card-cream p-8 flex flex-col ${hot ? '!border-[#6366f1] ring-1 ring-[#6366f1] shadow-[0_24px_48px_-24px_rgba(79,70,229,.35)]' : ''}`} data-testid={`sip-plan-card-${p.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold text-slate-900">{p.name}</div>
        {hot && <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-[#4338ca]" data-testid={`sip-plan-best-${p.id}`}>Best for SIP</span>}
      </div>
      <div className="civr-l-h text-5xl text-slate-900 mt-6" data-testid={`sip-plan-price-${p.id}`}>{usd(p.price)}<span className="text-base font-medium tracking-normal text-slate-500">/mo</span></div>
      <div className="text-sm text-slate-500 mt-2" data-testid={`sip-plan-allowance-${p.id}`}>{`${p.minutes} incoming minutes · ${p.sms} SMS included each month`}</div>
      <div className={`mt-6 rounded-xl px-4 py-3 flex items-start gap-3 text-sm font-semibold ${sip ? 'bg-indigo-50 text-[#3730a3] border border-indigo-100' : 'bg-slate-50 text-slate-500 border border-slate-200'}`} data-testid={`sip-plan-sip-${p.id}`} data-included={sip ? 'true' : 'false'}>
        <Tick on={sip} className="w-5 h-5 mt-px" />
        <span>{sip ? 'SIP logins for softphones and desk phones' : 'No SIP logins — browser phone only'}</span>
      </div>
      <ul className="mt-6 pt-6 border-t civr-l-rule flex-1 flex flex-col gap-2.5 text-sm">
        {ROWS.map(([k, label]) => (
          <li key={k} className={`flex items-center gap-2.5 ${p.access?.[k] ? 'text-slate-700' : 'text-slate-400'}`} data-testid={`sip-plan-${p.id}-${k}`} data-included={p.access?.[k] ? 'true' : 'false'}><Tick on={!!p.access?.[k]} />{label}</li>
        ))}
        {extra?.limits?.[p.id] != null && <li className="flex items-center gap-2.5 text-slate-700" data-testid={`sip-plan-${p.id}-extra`}><Plus className="w-4 h-4 text-[#4f46e5] shrink-0" />{`Up to ${extra.limits[p.id]} extra numbers`}</li>}
      </ul>
      <Link to={start(p.id)} className={`civr-l-btn mt-8 w-full ${hot ? '' : 'civr-l-btn-ghost'}`} data-testid={`sip-plan-choose-${p.id}`}><Slide>Choose {p.name}</Slide></Link>
    </Reveal>
  );
}

// Every feature, every plan — the same list the in-app plan picker uses.
function CompareTable({ plans }) {
  const keys = (plans[0]?.webFeatures || []).map(f => [f.key, f.label]);
  const has = (p, k) => !!(p.webFeatures || []).find(f => f.key === k)?.included;
  const top = [['Monthly price', p => <span className="font-semibold text-slate-900" data-no-translate>{usd(p.price)}</span>], ['Incoming minutes', p => <span data-no-translate>{p.minutes}</span>], ['SMS included', p => <span data-no-translate>{p.sms}</span>]];
  return (
    <details className="group mt-10 civr-l-card-cream overflow-hidden" data-testid="sip-compare">
      <summary className="flex items-center justify-between gap-4 cursor-pointer px-6 py-5 min-h-[56px] font-semibold text-slate-900 hover:text-[#4f46e5] transition-colors" data-testid="sip-compare-toggle">
        Compare every feature<ChevronDown className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="overflow-x-auto border-t civr-l-rule">
        <table className="w-full min-w-[560px] text-sm" data-testid="sip-compare-table">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-6 py-3 font-semibold text-slate-500">Feature</th>
              {plans.map(p => <th key={p.id} className="px-4 py-3 font-semibold text-slate-900 text-center">{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {top.map(([label, cell]) => (
              <tr key={label} className="border-t civr-l-rule">
                <td className="px-6 py-3 text-slate-700">{label}</td>
                {plans.map(p => <td key={p.id} className="px-4 py-3 text-center text-slate-700">{cell(p)}</td>)}
              </tr>
            ))}
            {keys.map(([k, label]) => (
              <tr key={k} className={`border-t civr-l-rule ${k === 'sip' ? 'bg-indigo-50/60' : ''}`} data-testid={`sip-compare-row-${k}`}>
                <td className={`px-6 py-3 ${k === 'sip' ? 'font-semibold text-[#3730a3]' : 'text-slate-700'}`}>{label}</td>
                {plans.map(p => <td key={p.id} className="px-4 py-3"><span className="flex justify-center"><Tick on={has(p, k)} /></span></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function SipPlans({ catalog }) {
  const start = useStart();
  const plans = byPrice(catalog?.plans);
  const pick = sipPick(catalog);
  const r = catalog?.rates;
  const ex = catalog?.extraNumber;
  return (
    <section id="plans" className="civr-l-cream civr-l-soft scroll-mt-16 border-t civr-l-rule" data-testid="sip-plans-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24">
        <SectionHead label="Plans" title="Pick your plan." sub={plans.length ? `SIP logins come with ${andNames(sipPlans(catalog))}. Every plan is month to month, per number, with no contracts.` : 'Every plan is month to month, per number, with no contracts.'} testid="sip-plans-head" />
        <div className="grid md:grid-cols-3 gap-4 mt-12 items-stretch">
          {plans.map((p, i) => <PlanCard key={p.id} p={p} hot={pick?.id === p.id} start={start} extra={ex} delay={i * 120} />)}
        </div>
        {plans.length > 0 && <CompareTable plans={plans} />}
        {r && (
          <p className="text-sm text-slate-500 mt-8 max-w-3xl" data-testid="sip-plans-usage">
            {`Incoming minutes over your plan cost ${money(r.overagePerMin)} each and extra SMS ${money(r.overagePerSms)} each. Outgoing calls from a softphone are billed per minute from your wallet. Extra numbers cost from ${usd(ex?.price || 25)}/month each.`}
          </p>
        )}
        <PaymentMethods catalog={catalog} className="mt-10 pt-8 border-t civr-l-rule" testid="sip-payment-methods" />
      </div>
    </section>
  );
}

export function sipFaqItems(c) {
  const domain = sipDomain(c);
  const sp = sipPlans(c);
  const pick = sipPick(c);
  const starter = byPrice(c?.plans).find(p => !p.access?.sipCredentials);
  const r = c?.rates;
  const general = Object.fromEntries(faqItems(c));
  return [
    [`Why doesn’t ${domain} open in my browser?`, `Because it isn’t a website. ${domain} is the server address your phone app connects to, so a browser has nothing to show there. Type it into your softphone or desk phone as the SIP server or domain.`],
    ['Which plan do I need for SIP?', sp.length ? `SIP logins come with ${andNames(sp)}${pick ? `, from ${usd(pick.price)}/month` : ''}.${starter ? ` ${starter.name} includes the browser phone and call forwarding, but no SIP logins.` : ''}` : 'SIP logins come with the Pro plan and up.'],
    ['Which apps and phones work?', 'Any softphone or desk phone that takes a standard SIP account. Zoiper, MicroSIP and Linphone are free and take a minute to set up.'],
    ['What do I enter in my app?', `Server or domain: ${domain}. Port 5060 over UDP or TCP, or 5061 for TLS. Your username and password are on the number’s SIP tab in your dashboard.`],
    ['Can I still use the browser phone?', 'Yes. Every plan includes the browser phone, so you can also make and take calls from any browser tab.'],
    ['What do calls cost?', `Incoming calls use your plan minutes${pick ? ` (${pick.minutes} a month on ${pick.name})` : ''}${r ? `; extra incoming minutes cost ${money(r.overagePerMin)} each` : ''}. Outgoing calls from a softphone are billed per minute from your wallet.`],
    ['Can I try before I pay?', 'Yes. Creating an account is free, and the home page has a free test call you can take before you buy a number.'],
    ...['How do I pay?', 'Can I cancel?'].filter(q => general[q]).map(q => [q, general[q]]),
  ];
}

export function SipFaq({ catalog }) {
  return (
    <section id="faq" className="civr-l-cream scroll-mt-16 border-t civr-l-rule" data-testid="sip-faq-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-24 grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4"><SectionHead label="FAQ" title="SIP questions, answered." /></div>
        <div className="lg:col-span-8 border-t civr-l-rule" data-testid="sip-faq-list">
          {sipFaqItems(catalog).map(([q, a], i) => (
            <Reveal as="details" key={q} delay={Math.min(i, 6) * 60} className="border-b civr-l-rule group" data-testid={`sip-faq-item-${i}`}>
              <summary className="flex items-center justify-between gap-4 cursor-pointer py-6 min-h-[56px] text-base md:text-lg font-semibold text-slate-900 hover:text-[#4f46e5] transition-colors" data-testid={`sip-faq-question-${i}`}>{q}<Plus className="civr-faq-chevron w-5 h-5 shrink-0 text-slate-400" /></summary>
              <p className="pb-6 text-sm text-slate-600 max-w-2xl" data-testid={`sip-faq-answer-${i}`}>{a}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SipFinalCta({ catalog }) {
  const start = useStart();
  const pick = sipPick(catalog);
  return (
    <section className="civr-l-cream py-24" data-testid="sip-final-cta">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <Reveal className="civr-l-dark relative overflow-hidden rounded-3xl px-8 py-16 md:px-16 flex flex-col md:flex-row md:items-end gap-8">
          <div className="absolute inset-0 civr-l-gridbg opacity-60" />
          <div className="relative flex-1">
            <h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl max-w-2xl">Your number, ringing on your softphone today.</h2>
            <p className="text-base mt-4 civr-l-muted">{pick ? `Free to sign up · SIP from ${usd(pick.price)}/month · No contracts` : 'Free to sign up · No contracts'}</p>
          </div>
          <div className="relative flex flex-wrap gap-3">
            <a href="#plans" className="civr-l-btn civr-l-btn-ghost" data-testid="sip-final-cta-compare"><Slide>Compare plans</Slide></a>
            <Link to={start(pick?.id)} className="civr-l-btn" data-testid="sip-final-cta-button"><Slide>{pick ? <>Choose {pick.name}</> : 'Get your number'}</Slide><ArrowRight className="w-4 h-4" /></Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
