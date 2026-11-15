import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, ChevronDown } from 'lucide-react';
import { usd } from '../../api';
import { Reveal } from './kit';

const byPrice = (plans) => [...(plans || [])].filter(p => p.available !== false).sort((a, b) => a.price - b.price);
const SHOW_FIRST = 9;

// Feature comparison across the plans, from the same catalogue the plan cards use. Rows come from the dearest plan's
// feature list (it has everything), so a new feature shows up here without a code change.
export function PlanCompare({ catalog, start }) {
  const plans = byPrice(catalog?.plans);
  const [all, setAll] = useState(false);
  if (plans.length < 2) return null;
  const top = plans[plans.length - 1];
  const rows = (top.webFeatures || []).map(f => [f.key, f.label, plans.map(p => !!(p.webFeatures || []).find(x => x.key === f.key)?.included)]);
  const shown = all ? rows : rows.slice(0, SHOW_FIRST);
  const ex = catalog?.extraNumber;
  return (
    <Reveal className="mt-14" data-testid="plan-compare">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="civr-l-eyebrow">Compare plans</div><h3 className="civr-l-h text-2xl sm:text-3xl text-slate-900 mt-3">Everything each plan includes.</h3></div>
        <p className="text-sm text-slate-500 max-w-sm">All plans: browser phone, call forwarding, call notes and on/off hours, plus a free USA, Canada or UK number. One monthly price per number.<span className="block md:hidden mt-1 text-xs text-slate-400">Swipe the table sideways to see every plan.</span></p>
      </div>
      <div className="mt-6 overflow-x-auto rounded-2xl border civr-l-rule bg-white" tabIndex={0} role="region" aria-label="Plan comparison table" data-testid="plan-compare-scroll">
        <table className="civr-keep-table civr-l-table" data-testid="plan-compare-table">
          <thead>
            <tr>
              <th scope="col">Feature</th>
              {plans.map(p => <th key={p.id} scope="col" className={p.recommended ? 'hot' : ''} data-testid={`compare-head-${p.id}`}>
                <span className="block text-slate-900 text-sm normal-case tracking-normal font-semibold">{p.name}{p.recommended && <span className="ml-2 text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-900 text-white align-middle">Most popular</span>}</span>
                <span className="block text-slate-500 normal-case tracking-normal font-medium mt-0.5" data-no-translate>{usd(p.price)}/mo</span>
              </th>)}
            </tr>
          </thead>
          <tbody>
            {ex && <tr data-testid="compare-row-extra"><td className="font-medium text-slate-900">Extra numbers on the plan</td>{plans.map(p => <td key={p.id} className={p.recommended ? 'hot' : ''} data-no-translate>up to {ex.limits?.[p.id] ?? '—'}</td>)}</tr>}
            {shown.map(([k, label, cols]) => (
              <tr key={k} data-testid={`compare-row-${k}`}>
                <td className="text-slate-700">{label}</td>
                {cols.map((on, i) => <td key={plans[i].id} className={plans[i].recommended ? 'hot' : ''}>{on ? <Check className="w-4 h-4 text-slate-900" aria-label="Included" /> : <Minus className="w-4 h-4 text-slate-300" aria-label="Not included" />}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td />{plans.map(p => <td key={p.id} className={p.recommended ? 'hot' : ''}><Link to={start(p.id)} className={`civr-l-btn civr-l-btn-sm ${p.recommended ? '' : 'civr-l-btn-ghost'}`} data-testid={`compare-choose-${p.id}`}>Choose {p.name}</Link></td>)}</tr>
          </tfoot>
        </table>
      </div>
      {rows.length > SHOW_FIRST && (
        <button type="button" onClick={() => setAll(a => !a)} aria-expanded={all} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-600 transition-colors min-h-[44px]" data-testid="plan-compare-toggle">
          {all ? 'Show fewer features' : `Show all ${rows.length} features`}<ChevronDown className={`w-4 h-4 transition-transform ${all ? 'rotate-180' : ''}`} />
        </button>
      )}
    </Reveal>
  );
}
