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

// What a plan includes (✓) and leaves out (✗). `tone`: 'app' (dark app UI), 'dark' / 'cream' (landing cards).
export function PlanFeatures({ plan, tone = 'app', compact = false, testid }) {
  const list = plan?.webFeatures || [];
  const on = { app: 'text-[#34d399]', dark: 'text-[#00E3AA]', cream: 'text-[#3434EF]' }[tone];
  const offText = { app: 'text-[#6b6b6b]', dark: 'text-white/35', cream: 'text-black/35' }[tone];
  const onText = { app: 'text-[#d4d4d8]', dark: '', cream: '' }[tone];
  return (
    <ul className={`flex flex-col ${compact ? 'gap-1 text-xs' : 'gap-2 text-sm'}`} data-testid={testid}>
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
  const cls = tone === 'app' ? 'bg-[#34d399] text-[#04130d]' : 'bg-[#00E3AA] text-[#0A0D0E]';
  return <span className={`text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full font-bold ${cls}`} data-testid={testid}>Recommended</span>;
}
