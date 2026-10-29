import React from 'react';
import { Quote } from 'lucide-react';
import { useApi } from '../../api';
import { Reveal, CountUp, Wave } from './kit';

// Real platform counters (GET /public/stats, refreshed daily on the server). A counter the server can't back with
// data comes back null and is simply not shown — no invented customers, logos or ratings.
const COUNTERS = [
  ['callsHandled', 'Calls handled on the platform'],
  ['campaignCalls', 'Campaign calls placed by Bulk IVR and AI agents'],
  ['countries', 'Countries with numbers'],
];

// Attributed quotes go here when real ones exist: { quote, name, role, where }. Empty = the slot renders nothing.
const TESTIMONIALS = [];

function Testimonials() {
  if (!TESTIMONIALS.length) return null;
  return (
    <div className="grid md:grid-cols-3 gap-4 mt-8" data-testid="testimonials">
      {TESTIMONIALS.map((t, i) => (
        <Reveal key={t.name} delay={i * 90} className="civr-l-card-cream p-6" data-testid={`testimonial-${i}`}>
          <Quote className="w-5 h-5 text-slate-300" />
          <p className="text-sm text-slate-700 mt-4 leading-relaxed">“{t.quote}”</p>
          <div className="mt-5 text-sm font-semibold text-slate-900">{t.name}</div>
          <div className="text-xs text-slate-500">{t.role}{t.where ? ` · ${t.where}` : ''}</div>
        </Reveal>
      ))}
    </div>
  );
}

export function Proof() {
  const { data } = useApi('/public/stats');
  const items = COUNTERS.filter(([k]) => Number(data?.[k]) > 0);
  const real = items.filter(([k]) => k !== 'countries').length;
  if (!data || !real) return <Testimonials />;
  const day = data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  return (
    <div className="mt-12" data-testid="proof-strip">
      <Reveal className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="civr-l-eyebrow"><span className="civr-l-dot" />Live from the platform</span>
        <Wave on className="text-slate-900" />
        {day && <span className="text-xs text-slate-500" data-testid="proof-updated">Real figures · updated daily · last {day}</span>}
      </Reveal>
      <div className={`grid grid-cols-2 ${items.length > 3 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4 mt-5`}>
        {items.map(([k, label], i) => (
          <Reveal key={k} delay={i * 80} className="civr-l-card-cream px-5 py-6" data-testid={`proof-${k}`}>
            <div className="civr-l-h text-3xl md:text-4xl text-slate-900"><CountUp value={Number(data[k]).toLocaleString('en-US')} /></div>
            <div className="text-sm text-slate-500 mt-2">{label}</div>
          </Reveal>
        ))}
      </div>
      <Testimonials />
    </div>
  );
}
