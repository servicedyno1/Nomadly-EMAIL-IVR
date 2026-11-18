import React, { useState } from 'react';
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
// plan ("Everything in Basic, plus:"). `tone`: 'app' (dark app UI), 'dark' / 'cream' (landing cards).
// The 3 biggest reasons to pick each plan, shown first; the rest stay behind "See all".
const TOP = { starter: ['emily', 'forwarding', 'voicemail'], standard: ['ivr', 'ringGroup', 'recording'], pro: ['aiCampaigns', 'bulk', 'quickIvr'], business: ['anyCallerId', 'textTriggers', 'encryptedCalls'] };
// Each plan's one job, shown under its name.
export const PLAN_JOB = { starter: 'Get a business number', standard: 'Answer like a business', pro: 'Reach out to your customers', business: 'Scale up, with full control' };
const GROUPS = [['answer', 'Answer calls'], ['calls', 'Make calls'], ['ai', 'AI'], ['account', 'Texts & account']];

export function PlanFeatures({ plan, plans, tone = 'app', compact = false, testid }) {
  const [all, setAll] = useState(false);
  const ladder = plans ? byPrice(plans.filter(p => p.available !== false)) : null;
  const prev = ladder ? ladder[ladder.findIndex(p => p.id === plan?.id) - 1] : null;
  const full = prev ? unlocks(plans, prev.id, plan.id) : (plan?.webFeatures || []).filter(f => !ladder || f.included);
  const top = TOP[plan?.id] || [];
  const sorted = [...full.filter(f => top.includes(f.key)).sort((a, b) => top.indexOf(a.key) - top.indexOf(b.key)), ...full.filter(f => !top.includes(f.key))];
  const short = ladder && sorted.length > 4 && top.some(k => full.some(f => f.key === k));
  const list = short && !all ? sorted.slice(0, 3) : sorted;
  // The full list reads in groups (Answer calls, Make calls, AI, Texts & account) once it is longer than a few lines.
  const grouped = (!short || all) && list.length > 4 && list.some(f => f.group);
  const toggle = (e) => { e.preventDefault(); e.stopPropagation(); setAll(a => !a); };
  const on = { app: 'text-[#818cf8]', dark: 'text-[#6366f1]', cream: 'text-slate-900' }[tone];
  const offText = { app: 'text-[#a1a1aa]', dark: 'text-white/35', cream: 'text-slate-400' }[tone];
  const onText = { app: 'text-[#d4d4d8]', dark: '', cream: 'text-slate-700' }[tone];
  const head = { app: 'text-[#e4e4e7]', dark: 'text-white', cream: 'text-slate-900' }[tone];
  return (
    <ul className={`flex flex-col ${compact ? 'gap-1 text-xs' : 'gap-2 text-sm'}`} data-testid={testid}>
      {ladder && <li className={`font-semibold ${head} ${compact ? 'mb-0.5' : 'mb-1'}`} data-testid={`${testid}-heading`}>{prev ? `Everything in ${prev.name}, plus:` : `${plan.name} includes:`}</li>}
      {(grouped ? GROUPS.map(([g, label]) => [label, list.filter(f => (f.group || 'account') === g)]).filter(([, fs]) => fs.length) : [[null, list]]).map(([label, fs]) => (
        <React.Fragment key={label || 'all'}>
          {label && <li className={`text-[11px] uppercase tracking-[.12em] font-semibold ${offText} ${compact ? 'mt-1' : 'mt-2'}`} data-testid={`${testid}-group-${label.split(' ')[0].toLowerCase()}`}>{label}</li>}
          {fs.map(f => (
            <li key={f.key} className={`flex gap-2 ${f.included ? onText : `${offText} line-through decoration-1`}`} data-testid={`${testid}-${f.key}`} data-included={f.included ? 'true' : 'false'}>
              {f.included ? <Check className={`w-4 h-4 mt-0.5 shrink-0 ${on}`} /> : <X className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />}
              <span className={short && !all && top.includes(f.key) ? `font-semibold ${head}` : ''}>{f.label}</span>
            </li>
          ))}
        </React.Fragment>
      ))}
      {short && <li><span role="button" tabIndex={0} onClick={toggle} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle(e)} className={`underline underline-offset-2 cursor-pointer ${on}`} data-testid={`${testid}-more`}>{all ? 'Show fewer' : `See all ${sorted.length} features`}</span></li>}
    </ul>
  );
}

export function RecommendedBadge({ tone = 'app', testid }) {
  const cls = tone === 'app' ? 'bg-[#6366f1] text-white font-mono uppercase tracking-widest font-bold' : 'border border-slate-900 bg-slate-900 text-white font-semibold';
  return <span className={`text-xs px-2.5 py-1 rounded-full ${cls}`} data-testid={testid}>Recommended</span>;
}
