import React from 'react';
import { Check, X } from 'lucide-react';

const byPrice = (plans) => [...(plans || [])].sort((a, b) => a.price - b.price);

// Cheapest available plan whose engine access includes `accessKey` (e.g. 'voicemail'), or null.
export const planFor = (plans, accessKey) => byPrice(plans).find(p => p.available !== false && p.access?.[accessKey]) || null;

// Web features the `to` plan adds on top of the `from` plan.
export function unlocks(plans, fromId, toId) {
  const from = (plans || []).find(p => p.id === fromId);
  const to = (plans || []).find(p => p.id === toId);
  if (!to) return [];
  const had = new Set((from?.webFeatures || []).filter(f => f.included).map(f => f.key));
  return (to.webFeatures || []).filter(f => f.included && !had.has(f.key));
}

export const availablePlans = (plans) => byPrice(plans).filter(p => p.available);

// What a plan includes (✓) and leaves out (✗). With `plans`, a plan card lists only what it adds over the next cheaper
// plan ("Everything in Starter, plus:"). `tone`: 'app' (dark app UI), 'dark' / 'cream' (landing cards).
export function PlanFeatures({ plan, plans, tone = 'app', compact = false, testid }) {
  const ladder = plans ? byPrice(plans.filter(p => p.available !== false)) : null;
  const prev = ladder ? ladder[ladder.findIndex(p => p.id === plan?.id) - 1] : null;
  const list = prev ? unlocks(plans, prev.id, plan.id) : (plan?.webFeatures || []).filter(f => !ladder || f.included);
  const on = { app: 'text-[#818cf8]', dark: 'text-[#6366f1]', cream: 'text-slate-900' }[tone];
  const offText = { app: 'text-[#a1a1aa]', dark: 'text-white/35', cream: 'text-slate-400' }[tone];
  const onText = { app: 'text-[#d4d4d8]', dark: '', cream: 'text-slate-700' }[tone];
  const head = { app: 'text-[#e4e4e7]', dark: 'text-white', cream: 'text-slate-900' }[tone];
  return (
    <ul className={`flex flex-col ${compact ? 'gap-1 text-xs' : 'gap-2 text-sm'}`} data-testid={testid}>
      {ladder && <li className={`font-semibold ${head} ${compact ? 'mb-0.5' : 'mb-1'}`} data-testid={`${testid}-heading`}>{prev ? `Everything in ${prev.name}, plus:` : `${plan.name} includes:`}</li>}
      {list.map(f => (
        <li key={f.key} className={`flex gap-2 ${f.included ? onText : `${offText} line-through decoration-1`}`} data-testid={`${testid}-${f.key}`} data-included={f.included ? 'true' : 'false'}>
          {f.included ? <Check className={`w-4 h-4 mt-0.5 shrink-0 ${on}`} /> : <X className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />}
          <span>{f.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function RecommendedBadge({ tone = 'app', testid }) {
  const cls = tone === 'app' ? 'bg-[#6366f1] text-white font-mono uppercase tracking-widest font-bold' : 'border border-slate-900 bg-slate-900 text-white font-semibold';
  return <span className={`text-xs px-2.5 py-1 rounded-full ${cls}`} data-testid={testid}>Recommended</span>;
}
