import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { StepNumbers } from './StepNumbers';
import { StepMessage } from './StepMessage';
import { StepTest } from './StepTest';
import { StepWhen } from './StepWhen';

const STEPS = ['Numbers', 'Message', 'Test', 'Send & pay'];

// 4 steps, like the bot: numbers → message → optional test → when + pay. The campaign exists from step 3 on.
export function Wizard({ data, onDone }) {
  const [step, setStep] = useState(0);
  const [list, setList] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [test, setTest] = useState(null);
  const restart = () => { setCampaign(null); setStep(1); };
  return (
    <div data-testid="bulksms-wizard">
      <ol className="flex items-center gap-2 mb-6 overflow-x-auto" data-testid="bulksms-stepper">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 shrink-0" data-testid={`bulksms-step-${i + 1}`} aria-current={i === step ? 'step' : undefined}>
            <span className={`w-7 h-7 rounded-full grid place-items-center text-xs font-semibold transition-colors ${i < step ? 'bg-[#34d399] text-black' : i === step ? 'bg-[#818cf8] text-black' : 'bg-[#1f1f1f] text-[#a1a1aa]'}`}>{i < step ? <Check className="w-4 h-4" /> : i + 1}</span>
            <span className={`text-sm ${i === step ? 'text-[var(--c-text)] font-semibold' : 'text-[var(--c-muted)]'}`}>{s}</span>
            {i < STEPS.length - 1 && <span className="w-8 h-px bg-[#262626]" />}
          </li>
        ))}
      </ol>
      <div className="civr-card p-5 sm:p-6 civr-rise" key={step}>
        {step === 0 && <StepNumbers data={data} onNext={(l) => { setList(l); setStep(1); }} />}
        {step === 1 && <StepMessage list={list} prices={data.prices} onBack={() => setStep(0)} onNext={(c, t) => { setCampaign(c); setTest(t); setStep(2); }} />}
        {step === 2 && campaign && <StepTest campaign={campaign} test={test} onEdit={restart} onRewrite={(text) => { setList({ ...list, rewrite: text }); restart(); }} onNext={() => setStep(3)} />}
        {step === 3 && campaign && <StepWhen campaign={campaign} prices={data.prices} onBack={() => setStep(2)} onDone={onDone} />}
      </div>
    </div>
  );
}
