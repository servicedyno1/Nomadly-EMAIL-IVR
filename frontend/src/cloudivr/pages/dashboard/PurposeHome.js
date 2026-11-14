import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Settings2 } from 'lucide-react';
import { cp } from '../../paths';
import { useShell } from '../../Shell';
import { PURPOSES } from '../../purpose';

// Home: one card per service the customer said they need at signup ("What do you need?").
export function PurposeHome() {
  const { onboarding, setOnboarding } = useShell();
  const picked = PURPOSES.filter(p => (onboarding?.purposes || []).includes(p[0]) && p[0] !== 'other');
  if (!picked.length) return null;
  return (
    <section className="mb-8" data-testid="dashboard-purpose-home">
      <div className="flex items-end justify-between gap-3 mb-4">
        <h2 className="font-display text-xl font-bold">Your services</h2>
        <button type="button" className="text-sm text-[var(--c-muted)] hover:underline inline-flex items-center gap-1.5 min-h-[36px]" onClick={() => setOnboarding({ ...onboarding, onboarded: false })} data-testid="dashboard-purpose-change"><Settings2 className="w-4 h-4" />Change what I need</button>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {picked.map(([id, Icon, label, sub, steps], i) => (
          <div key={id} className="civr-card p-6 civr-rise flex flex-col" style={{ animationDelay: `${i * 70}ms` }} data-testid={`dashboard-purpose-${id}`}>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-lg grid place-items-center bg-[#6366f1]/15 text-[#818cf8] shrink-0"><Icon className="w-5 h-5" /></span>
              <span><span className="block font-semibold">{label}</span><span className="block text-sm text-[var(--c-muted)]">{sub}</span></span>
            </div>
            <Link to={cp(steps[0][1])} className="civr-btn civr-btn-primary mt-5 justify-between" data-testid={`dashboard-purpose-${id}-primary`}>{steps[0][0]}<ArrowRight className="w-4 h-4" /></Link>
            <div className="mt-3 flex flex-col">
              {steps.slice(1).map(([l, to], k) => <Link key={to} to={cp(to)} className="text-sm py-1.5 inline-flex items-center gap-1 hover:text-[#818cf8]" data-testid={`dashboard-purpose-${id}-link-${k}`}>{l}<ArrowRight className="w-3.5 h-3.5 opacity-60" /></Link>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
