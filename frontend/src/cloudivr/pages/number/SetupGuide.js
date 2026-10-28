import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PhoneForwarded, MonitorSmartphone, Workflow, Bot, Voicemail, Disc3, MessageSquare, Headphones, Clock, Lock, Check, ArrowRight, X, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { useShell } from '../../Shell';

// [key, tab, plan gate, label, hint, Icon, done(features)]
const ANSWER = [
  ['forwarding', 'forwarding', 'callForwarding', 'Ring my phone', 'Forward calls to your mobile or office', PhoneForwarded, f => f?.callForwarding?.enabled],
  ['browser', 'browser', 'browserRing', 'Ring me in the browser', 'Answer from this tab or the app', MonitorSmartphone, f => f?.browserRing?.enabled],
  ['ivr', 'ivr', 'ivr', 'Keypad menu', '“Press 1 for sales…”', Workflow, f => f?.ivr?.enabled],
  ['ai', 'ai', 'aiAgent', 'AI voice agent', 'Talks with callers 24/7', Bot, f => f?.aiAgent?.enabled],
  ['voicemail', 'voicemail', 'voicemail', 'Take a voicemail', 'Transcribed into your inbox', Voicemail, f => f?.voicemail?.enabled],
];
const EXTRAS = [
  ['recording', 'recording', 'callRecording', 'Record calls', 'Keep recordings and transcripts', Disc3, f => f?.recording?.enabled],
  ['sms', 'sms', null, 'Read and reply to texts', 'Texts land in your inbox', MessageSquare, () => false],
  ['sip', 'sip', 'sipCredentials', 'Use a desk phone or softphone', 'SIP sign-in details', Headphones, () => false],
];
const HOURS = ['hours', 'hours', null, 'Set opening hours', 'Different answer when you’re closed', Clock, f => !!f?.hours];
const ALL = [...ANSWER, ...EXTRAS, HOURS];

function Choice({ item, on, locked, onClick, testid }) {
  const [, , , label, hint, Icon] = item;
  return (
    <button type="button" disabled={locked} onClick={onClick} aria-pressed={on} data-testid={testid}
      className={`text-left p-4 rounded-xl border-2 flex items-start gap-3 transition-colors ${locked ? 'opacity-60 cursor-not-allowed border-[#262626]' : on ? 'border-[#818cf8] bg-[#818cf8]/10' : 'border-[#262626] hover:border-[#3a3a3a]'}`}>
      <span className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${on ? 'bg-[#6366f1] text-white' : 'bg-[#1f1f1f] text-[#818cf8]'}`}>{on ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}</span>
      <span className="min-w-0"><span className="block font-semibold">{label}{locked && <Lock className="inline w-3.5 h-3.5 ml-1.5 text-[#fbbf24]" aria-label="Needs a higher plan" />}</span><span className="block text-sm text-[#a1a1aa]">{locked ? 'Available on a higher plan' : hint}</span></span>
    </button>
  );
}

// After buying a number: 3 short questions → a checklist that opens the right tabs. Every step is skippable.
export function SetupGuide({ n }) {
  const { onboarding, setOnboarding } = useShell();
  const [params, setParams] = useSearchParams();
  const plan = onboarding?.setups?.[n.phoneNumber];
  const [open, setOpen] = useState(params.get('setup') === '1');
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState(null);
  const [extras, setExtras] = useState([]);
  const [busy, setBusy] = useState(false);
  const locked = (it) => !!it[2] && !n.access?.[it[2]];
  const extrasOk = EXTRAS.filter(it => it[0] !== 'sms' || n.capabilities?.sms !== false);
  const save = async (items, done = false) => {
    setBusy(true);
    try { const d = await api(`/prefs/setup/${encodeURIComponent(n.phoneNumber)}`, { method: 'PUT', body: { items, done } }); setOnboarding({ ...onboarding, setups: { ...(onboarding?.setups || {}), [n.phoneNumber]: d.setup } }); setOpen(false); } finally { setBusy(false); }
  };
  const goTab = (tab) => { setParams({ tab }, { replace: true }); };
  if (!onboarding) return null;

  const wizard = open && (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="setup-title" data-testid="setup-guide">
      <div className="civr-card w-full max-w-2xl p-6 md:p-8 civr-rise max-h-[92vh] overflow-y-auto relative">
        <button type="button" onClick={() => setOpen(false)} className="absolute top-3 right-3 w-10 h-10 grid place-items-center text-[#a1a1aa] hover:text-white" aria-label="Close" data-testid="setup-close"><X className="w-5 h-5" /></button>
        <div className="text-sm text-[#a1a1aa]">Question {step + 1} of 3</div>
        <div className="flex gap-1.5 mt-2 mb-5" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i <= step ? 'w-10 bg-[#6366f1]' : 'w-5 bg-[#3f3f46]'}`} />)}</div>
        <h2 id="setup-title" className="civr-page-title text-2xl md:text-3xl">{['How should we answer your calls?', 'Anything else you need?', 'Are you open all the time?'][step]}</h2>
        <div key={step} className="grid sm:grid-cols-2 gap-3 mt-6 civr-rise" data-testid={`setup-step-${step}`}>
          {step === 0 && ANSWER.map(it => <Choice key={it[0]} item={it} on={answer === it[0]} locked={locked(it)} onClick={() => setAnswer(it[0])} testid={`setup-answer-${it[0]}`} />)}
          {step === 1 && extrasOk.map(it => <Choice key={it[0]} item={it} on={extras.includes(it[0])} locked={locked(it)} onClick={() => setExtras(x => (x.includes(it[0]) ? x.filter(y => y !== it[0]) : [...x, it[0]]))} testid={`setup-extra-${it[0]}`} />)}
          {step === 2 && [['always', 'Yes, answer the same way 24/7', 'You can add hours later'], ['hours', 'No, I have opening hours', 'Closed calls get a different answer']].map(([id, label, hint]) => (
            <Choice key={id} item={[id, null, null, label, hint, id === 'hours' ? Clock : Check]} on={false} onClick={() => save([answer, ...extras, id === 'hours' ? 'hours' : null].filter(Boolean))} testid={`setup-hours-${id}`} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 mt-7">
          <button type="button" className="text-sm text-[#a1a1aa] hover:underline min-h-[44px]" onClick={() => (step < 2 ? setStep(step + 1) : save([answer, ...extras].filter(Boolean)))} data-testid="setup-skip">Skip this question</button>
          <div className="flex gap-2">
            {step > 0 && <button type="button" className="civr-btn civr-btn-ghost" onClick={() => setStep(step - 1)} data-testid="setup-back">Back</button>}
            {step < 2 && <button type="button" className="civr-btn civr-btn-primary" disabled={busy || (step === 0 && !answer)} onClick={() => setStep(step + 1)} data-testid="setup-next">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Next <ArrowRight className="w-4 h-4" /></button>}
          </div>
        </div>
      </div>
    </div>
  );

  if (!plan) return (
    <>
      {wizard}
      <div className="civr-card p-5 mb-6 flex flex-wrap items-center gap-4 civr-rise" data-testid="setup-banner">
        <div className="flex-1 min-w-[14rem]"><div className="font-semibold text-lg">Set up this number in 3 quick questions</div><div className="text-sm text-[#a1a1aa]">We’ll only show what this number and your plan can do.</div></div>
        <button type="button" className="civr-btn civr-btn-primary" onClick={() => { setStep(0); setOpen(true); }} data-testid="setup-start">Start setup <ArrowRight className="w-4 h-4" /></button>
      </div>
    </>
  );
  if (plan.done || !plan.items.length) return wizard || null;
  const items = ALL.filter(it => plan.items.includes(it[0]));
  const doneCount = items.filter(it => it[6](n.features)).length;
  return (
    <>
      {wizard}
      <div className="civr-card p-5 mb-6 civr-rise" data-testid="setup-checklist">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1"><div className="font-semibold text-lg">Your setup · {doneCount} of {items.length} done</div><div className="h-1.5 rounded-full bg-[#262626] mt-2 max-w-sm overflow-hidden"><div className="h-full bg-[#34d399] transition-all duration-700" style={{ width: `${(doneCount / items.length) * 100}%` }} /></div></div>
          <button type="button" className="text-sm text-[#a1a1aa] hover:underline min-h-[44px]" onClick={() => { setStep(0); setOpen(true); }} data-testid="setup-redo">Change answers</button>
          <button type="button" className="text-sm text-[#a1a1aa] hover:underline min-h-[44px]" onClick={() => save(plan.items, true)} data-testid="setup-hide">Hide</button>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {items.map(it => { const done = it[6](n.features); const Icon = it[5]; return (
            <button key={it[0]} type="button" onClick={() => goTab(it[1])} className={`civr-pill ${done ? 'civr-pill-ok' : ''} !cursor-pointer`} data-testid={`setup-item-${it[0]}`} data-done={done ? 'true' : 'false'}>{done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}{it[3]}</button>
          ); })}
        </div>
      </div>
    </>
  );
}
