import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { money, enc, useApi } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Spinner } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { useCivrAuth } from '../AuthContext';
import { BuyProfileGate } from '../profile/ProfilePrompts';
import { kindById, kindOfPurpose } from '../kinds';
import { KindPicker, KindChosen, useKindFacts } from './buy/KindPicker';
import { CallsBuy } from './buy/CallsBuy';
import { TextingBuy } from './buy/TextingBuy';
import { FaxNumberBuy } from './buy/FaxNumberBuy';

// One progress bar for every kind of number: what it's for → pick a number → pay.
function Steps({ labels, current, onBack }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3 mb-6 civr-rise" aria-label="Steps" data-testid="buy-steps">
      {labels.map((label, i) => {
        const k = i + 1; const state = k < current ? 'done' : k === current ? 'current' : 'todo';
        const dot = <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-xs font-bold transition-colors ${state === 'done' ? 'bg-[#34d399] text-[#052e1f]' : state === 'current' ? 'bg-[var(--c-accent-strong,#6366f1)] text-white' : 'border border-[var(--c-border-hover,#2a2a2a)] text-[var(--c-muted)]'}`} aria-hidden="true">{state === 'done' ? <Check className="w-4 h-4" /> : k}</span>;
        const text = <span className={`text-sm leading-snug ${state === 'current' ? 'font-semibold' : 'text-[var(--c-muted)]'} ${state === 'todo' ? 'hidden sm:inline' : ''}`}>{label}</span>;
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3 min-w-0" aria-current={state === 'current' ? 'step' : undefined} data-state={state} data-testid={`buy-step-${k}`}>
            {k === 1 && state === 'done' && onBack ? <button type="button" onClick={onBack} className="flex items-center gap-2 sm:gap-3 min-h-[44px]" data-testid="buy-step-1-back">{dot}{text}</button> : <>{dot}{text}</>}
            {i < labels.length - 1 && <span aria-hidden="true" className={`h-px w-6 sm:w-10 shrink-0 ${state === 'done' ? 'bg-[#34d399]' : 'bg-[var(--c-border-hover,#2a2a2a)]'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export default function BuyNumber() {
  const { catalog, summary, refreshSummary } = useShell();
  const needsProfile = !useCivrAuth()?.account?.profileComplete;
  const [params, setParams] = useSearchParams();
  const pv = usePrivacy();
  const extraOf = params.get('extra');
  const { data: myNums } = useApi('/numbers');
  const { data: extra } = useApi(extraOf ? `/numbers/${enc(extraOf)}/extra` : null);
  const facts = useKindFacts(catalog, myNums);
  // The address bar holds the answer to step 1, so links and the back button land on the right kind.
  const kindId = extraOf ? 'calls' : kindOfPurpose(params.get('purpose')) || (params.get('resume') || params.get('plan') || params.get('coupon') ? 'calls' : null);
  const kind = kindById(kindId);
  const [stage, setStage] = useState(2);
  useEffect(() => { setStage(2); }, [kindId]);
  useEffect(() => { if (!extraOf && kindId && params.get('purpose') !== kindId) setParams(p => { const n = new URLSearchParams(p); n.set('purpose', kindId); return n; }, { replace: true }); }, [extraOf, kindId, params, setParams]);
  const onStage = useCallback((s) => setStage(s), []);
  const choose = (id) => setParams(p => { const n = new URLSearchParams(p); n.set('purpose', id); return n; });
  const change = () => setParams({});
  if (!catalog) return <Spinner />;
  if (extraOf) return (
    <div data-testid="buy-page">
      <PageHeader label="Phone numbers · Extra number" title="Add an extra number" sub={`Shares the plan of ${pv.phone(extraOf)} — ${money(extra?.price || 25)}/month, same features.${extra ? ` ${extra.used} of ${extra.limit} used.` : ''}`} testid="buy-header" />
      <p className="text-sm text-[var(--c-muted)] -mt-2 mb-6" data-testid="buy-extra-back"><Link to={cp('/app/buy')} className="inline-block py-2 text-[var(--c-accent)] underline underline-offset-2" data-testid="buy-extra-back-button">Get a brand-new number instead</Link></p>
      <Steps labels={['Pick a number', 'Pay']} current={stage - 1} />
      <CallsBuy extraOf={extraOf} onStage={onStage} />
    </div>
  );
  return (
    <div data-testid="buy-page" data-kind={kindId || ''}>
      <PageHeader label="Phone numbers" title="Get a number" sub="Three steps: say what it’s for, pick the number, pay. Month to month, paid from your wallet." testid="buy-header" />
      <Steps labels={['What it’s for', 'Pick a number', 'Pay']} current={kind ? stage : 1} onBack={change} />
      {!kind ? <KindPicker facts={facts} onPick={choose} /> : <>
        <KindChosen kind={kind} onChange={change} />
        {kindId === 'calls' && <CallsBuy onStage={onStage} />}
        {kindId === 'texting' && <TextingBuy onStage={onStage} startCountry={(params.get('country') || '').toUpperCase()} />}
        {kindId === 'fax' && (needsProfile ? <BuyProfileGate /> : <FaxNumberBuy balance={summary?.balance} onBought={refreshSummary} onStage={onStage} />)}
      </>}
    </div>
  );
}
