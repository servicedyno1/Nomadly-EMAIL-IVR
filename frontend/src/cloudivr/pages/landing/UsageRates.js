import React from 'react';
import { usd } from '../../api';
import { Reveal } from './kit';

const per = (v, unit = 'min') => (v != null ? `${usd(v)} / ${unit}` : '—');

// Every pay-as-you-use rate, shown only on the pricing page.
export function UsageRates({ catalog, fax }) {
  const r = catalog?.rates || {};
  const rows = [
    ['ai-reception', 'AI receptionist (incoming calls)', 'Every plan', per(r.aiReceptionPerMin)],
    ['ai-campaign', 'AI conversation campaigns (outgoing)', 'Pro and Business', per(r.aiAgentPerMin)],
    ['outbound-usca', 'Outgoing calls to USA & Canada', 'Browser phone, softphone, Quick IVR, campaigns', per(r.outboundPerMinUsCa)],
    ['outbound-intl', 'Outgoing calls to other countries', 'Starting rate, varies by country', per(r.outboundPerMinIntl)],
    ['forwarding', 'Call forwarding', 'Forwarded to any phone', per(r.forwardingPerMin)],
    ['overage', 'Incoming minutes over your plan', 'After your included minutes', per(r.overagePerMin)],
    ['ai-summary', 'AI call summaries', 'Plus and up', per(r.aiSummaryPerMin)],
    ['sms', 'Texts sent over your plan', 'Receiving is free', per(r.overagePerSms, 'text')],
    ['fax', 'Fax pages', `After ${fax?.freePages ?? 25} free pages a month`, '$0.05 / page'],
    ['lookup', 'Number & email lookup', 'Per check', '$0.015 / number · $0.0015 / email'],
  ];
  return (
    <section id="rates" className="bg-white scroll-mt-20 border-t civr-l-rule" data-testid="usage-rates-section">
      <div className="max-w-4xl mx-auto px-6 md:px-8 py-16 md:py-20">
        <Reveal>
          <h2 className="civr-l-h text-3xl sm:text-4xl text-slate-950">Usage rates</h2>
          <p className="text-slate-600 mt-3">Paid from your wallet, only for what you use. Unanswered calls and browser tests are free.</p>
        </Reveal>
        <dl className="mt-10 divide-y divide-slate-100 border-y border-slate-100" data-testid="usage-rates-list">
          {rows.map(([id, label, note, price]) => (
            <div key={id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6" data-testid={`usage-rate-${id}`}>
              <dt className="flex-1 min-w-0"><span className="block font-semibold text-slate-950">{label}</span><span className="block text-sm text-slate-500">{note}</span></dt>
              <dd className="font-mono text-sm sm:text-base text-slate-900 sm:text-right" data-testid={`usage-rate-${id}-price`}>{price}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-500 mt-4">AI calls are billed per started minute. Recording an AI call adds $0.02 / min.</p>
      </div>
    </section>
  );
}
