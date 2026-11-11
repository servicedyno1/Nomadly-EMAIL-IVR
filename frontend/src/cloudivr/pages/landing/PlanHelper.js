import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { USES } from '../buy/PlanHelper';
import { rememberUse } from '../buy/setupIntent';

// Website version of "What will you use it for?": highlights the right plan card or switches to the eSIM / Texting Number tab.
export function LandingPlanHelper({ plans, onPlan, setTab }) {
  const [picked, setPicked] = useState(null);
  const nameOf = (id) => plans.find(p => p.id === id)?.name;
  const choose = (key, go) => {
    setPicked(key);
    if (go.plan) { rememberUse(key); onPlan(go.plan); setTab('ivr'); }
    else setTab(go.to === '/app/esim' ? 'esim' : 'mobile');
  };
  const hit = USES.find(u => u[0] === picked);
  return (
    <div className="mt-8 rounded-2xl bg-white border civr-l-rule p-5" data-testid="landing-plan-helper">
      <div className="font-semibold text-slate-900">What will you use it for?</div>
      <div className="text-sm text-slate-600 mt-0.5">Pick one and we’ll point you to the right plan.</div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-4">
        {USES.filter(([, , , go]) => go.to || nameOf(go.plan)).map(([key, Icon, label, go]) => (
          <button key={key} type="button" onClick={() => choose(key, go)} aria-pressed={picked === key} data-testid={`landing-plan-helper-${key}`}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-left text-slate-800 transition-colors ${picked === key ? 'border-slate-900 bg-slate-50 font-semibold' : 'civr-l-rule hover:bg-slate-50'}`}>
            <Icon className="w-4 h-4 shrink-0 text-slate-500" /><span className="flex-1">{label}</span>{picked === key && <Check className="w-4 h-4" />}
          </button>
        ))}
      </div>
      {hit && <p className="text-sm text-slate-700 mt-3" data-testid="landing-plan-helper-result">{hit[3].plan ? `${nameOf(hit[3].plan)} fits best — it’s highlighted below.` : hit[3].to === '/app/esim' ? 'A USA eSIM fits best — see it below.' : 'A Texting Number fits best — see it below.'}</p>}
    </div>
  );
}
