import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneCall, ListTree, Megaphone, Bot, MessageSquare, Smartphone, Check } from 'lucide-react';
import { cp } from '../../paths';
import { rememberUse, rememberedUse } from './setupIntent';

// "What will you use it for?" — each answer picks a Business Line plan or sends the customer to the right product.
export const USES = [
  ['calls', PhoneCall, 'Answer calls in my browser or forward them to my phone', { plan: 'starter' }],
  ['menu', ListTree, 'A call menu, voicemail or desk phones', { plan: 'pro' }],
  ['campaigns', Megaphone, 'Calling campaigns to a list of people', { plan: 'pro' }],
  ['ai', Bot, 'An AI receptionist, or showing your own verified caller ID', { plan: 'business' }],
  ['texts', MessageSquare, 'Send and receive texts in CloudIVR', { to: '/app/texting-number' }],
  ['phone', Smartphone, 'A USA line on my own phone', { to: '/app/esim' }],
];

export function PlanHelper({ plans, current, onPlan, onUse = () => {} }) {
  const nav = useNavigate();
  const [picked, setPicked] = useState(rememberedUse);
  const nameOf = (id) => plans.find(p => p.id === id && p.available)?.name;
  const choose = (key, go) => {
    if (go.to) return nav(cp(go.to));
    setPicked(key); rememberUse(key); onUse(key); onPlan(go.plan);
    document.querySelector('[data-testid="buy-plan-picker"], [data-testid="buy-search-form"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const hit = USES.find(u => u[0] === picked && u[3].plan === current);
  return (
    <div className="civr-card p-5 mb-6" data-testid="plan-helper">
      <div className="font-semibold">What will you use it for?</div>
      <div className="text-sm text-[var(--c-muted)] mt-0.5">Pick one and we’ll choose the right plan for you.</div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-4">
        {USES.filter(([, , , go]) => go.to || nameOf(go.plan)).map(([key, Icon, label, go]) => (
          <button key={key} type="button" onClick={() => choose(key, go)} aria-pressed={hit?.[0] === key} data-testid={`plan-helper-${key}`}
            className={`civr-btn civr-btn-ghost !justify-start !h-auto py-3 text-left ${hit?.[0] === key ? '!border-[var(--c-accent)] font-semibold' : ''}`}>
            <Icon className="w-4 h-4 shrink-0 text-[#818cf8]" /><span className="flex-1 text-left">{label}</span>{hit?.[0] === key && <Check className="w-4 h-4 text-[#818cf8]" />}
          </button>
        ))}
      </div>
      {hit && <p className="text-sm text-[var(--c-accent)] mt-3" data-testid="plan-helper-result">{`${nameOf(hit[3].plan)} plan picked for you — now find a number below.`}</p>}
    </div>
  );
}
