import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, PhoneIncoming, Megaphone, MessageSquareText, Bot, KeyRound, ChevronDown, CheckCircle2, Circle, X, ArrowRight } from 'lucide-react';
import { useApi } from '../../api';
import { useShell } from '../../Shell';
import { cp } from '../../paths';
import { answering } from '../NumberDetail';

// Task → [id, Icon, title, one-liner, steps]; step → [text, link | 'phone'].
const TASKS = [
  ['number', PlusCircle, 'Get a business number', 'Local, toll-free or mobile numbers in minutes.', [
    ['Pick a country and the number you like', '/app/buy'], ['Choose a plan — every plan calls and texts from your browser', '/app/buy'], ['Pay from your wallet or with crypto', '/app/wallet']]],
  ['answer', PhoneIncoming, 'Answer my calls', 'A keypad menu, forwarding to your phone, or an AI receptionist.', [
    ['Pick the number callers will dial', '/app/numbers'], ['Keypad menu — "press 1 for sales"', '/app/answer/ivr'], ['…or forward to your phone, with voicemail', '/app/answer/forwarding'],
    ['…or let an AI receptionist pick up', '/app/ai-agents?use=inbound'], ['Test it: call your number from the browser phone', 'phone']]],
  ['leads', Megaphone, 'Call a list of leads', 'Bulk voice campaigns with press-1 transfer to you.', [
    ['Add or upload your contacts', '/app/contacts'], ['Record or pick the message they hear', '/app/audio'], ['Start the campaign and watch it live', '/app/campaigns/new']]],
  ['texts', MessageSquareText, 'Send texts', 'Text customers from your business number.', [
    ['Use a number with texting — or add texting to your landline', '/app/texting'], ['Open Messages and send your first text', '/app/messages']]],
  ['agent', Bot, 'Set up an AI agent', 'An AI that answers or calls, in 20 languages.', [
    ['Create the agent and give it a script', '/app/ai-agents/new'], ['Talk to it in your browser — free', '/app/ai-agents'], ['Give it its own number to answer', '/app/ai-agents?use=inbound']]],
  ['connect', KeyRound, 'Connect my phone or softphone', 'Use your number in Zoiper, a desk phone or the browser.', [
    ['Create a softphone (SIP) login', '/app/sip'], ['Or open the browser phone right now', 'phone'], ['Want a real mobile line? Get an eSIM', '/app/esim']]],
];

function Steps({ steps, openPhone, id }) {
  return (
    <ol className="mt-4 space-y-1.5" data-testid={`task-${id}-steps`}>
      {steps.map(([text, to], i) => {
        const inner = <><span className="civr-step-num">{i + 1}</span><span className="flex-1">{text}</span><ArrowRight className="w-3.5 h-3.5 opacity-60 shrink-0" /></>;
        const cls = 'civr-step flex items-center gap-3 w-full text-left text-sm min-h-[44px] px-3 rounded-lg transition-colors';
        return <li key={text}>{to === 'phone'
          ? <button type="button" onClick={openPhone} className={cls} data-testid={`task-${id}-step-${i}`}>{inner}</button>
          : <Link to={cp(to)} className={cls} data-testid={`task-${id}-step-${i}`}>{inner}</Link>}</li>;
      })}
    </ol>
  );
}

function TaskCard({ task, open, onToggle, suggested, openPhone }) {
  const [id, Icon, title, sub, steps] = task;
  return (
    <div className={`civr-card civr-task p-5 ${open ? 'civr-task-open' : ''}`} data-testid={`task-card-${id}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-start gap-4 text-left" data-testid={`task-card-${id}-toggle`}>
        <span className="civr-task-icon"><Icon className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-2 font-semibold text-[15px]">{title}{suggested && <span className="civr-pill civr-pill-on !text-[11px] !py-0 !px-2" data-testid={`task-card-${id}-suggested`}>Suggested next</span>}</span>
          <span className="block text-sm text-[#a1a1aa] mt-0.5">{sub}</span>
        </span>
        <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-[#a1a1aa] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <Steps steps={steps} openPhone={openPhone} id={id} />}
    </div>
  );
}

// Which task to put first for this account.
const nextTask = (active, answered) => (!active ? 'number' : !answered ? 'answer' : null);

export function TaskCards({ nums }) {
  const { summary: s, openPhone } = useShell();
  const active = s?.numbers?.active || 0;
  const answered = (nums || []).some(n => answering(n.features));
  const next = nextTask(active, answered);
  const order = next ? [TASKS.find(t => t[0] === next), ...TASKS.filter(t => t[0] !== next)] : TASKS;
  const [open, setOpen] = useState(next);
  return (
    <section aria-labelledby="civr-tasks-h" data-testid="home-tasks">
      <h2 id="civr-tasks-h" className="font-display text-xl font-bold mb-4">What do you want to do?</h2>
      <div className="grid md:grid-cols-2 gap-3 items-start">
        {order.map(t => <TaskCard key={t[0]} task={t} open={open === t[0]} onToggle={() => setOpen(o => (o === t[0] ? null : t[0]))} suggested={t[0] === next} openPhone={openPhone} />)}
      </div>
    </section>
  );
}

const DISMISS = 'civr.setupDone';
// "Your setup" checklist: stays until every step is done or the customer hides it.
export function SetupChecklist({ nums }) {
  const { summary: s } = useShell();
  const { data: camps } = useApi('/campaigns');
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS) === '1'; } catch (_) { return false; } });
  const steps = [
    ['number', 'Get a phone number', (s?.numbers?.active || 0) > 0, '/app/buy'],
    ['answer', 'Choose how calls are answered', (nums || []).some(n => answering(n.features)), '/app/answer/ivr'],
    ['wallet', 'Add funds to your wallet', (s?.balance || 0) > 0, '/app/wallet'],
    ['campaign', 'Run your first campaign', (camps?.campaigns || []).length > 0 || (s?.activeCampaigns || 0) > 0, '/app/campaigns/new'],
  ];
  const done = steps.filter(x => x[2]).length;
  if (hidden || done === steps.length) return null;
  const hide = () => { try { localStorage.setItem(DISMISS, '1'); } catch (_) { /* private mode */ } setHidden(true); };
  return (
    <aside className="civr-card p-5" aria-label="Your setup" data-testid="home-setup-checklist">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">Your setup</div>
        <button type="button" onClick={hide} className="w-9 h-9 -mr-2 rounded-lg flex items-center justify-center text-[#a1a1aa] hover:text-[var(--c-text)] hover:bg-[var(--c-card-hover)] transition-colors" aria-label="Hide setup checklist" data-testid="home-setup-dismiss"><X className="w-4 h-4" /></button>
      </div>
      <div className="text-xs text-[#a1a1aa] mt-0.5" data-testid="home-setup-progress">{`${done} of ${steps.length} done`}</div>
      <div className="civr-progress mt-3" aria-hidden="true"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="mt-4 space-y-1">
        {steps.map(([id, label, ok, to]) => (
          <li key={id}>
            <Link to={cp(to)} className={`flex items-center gap-3 min-h-[44px] px-2 -mx-2 rounded-lg text-sm transition-colors hover:bg-[var(--c-card-hover)] ${ok ? 'text-[#a1a1aa] line-through decoration-1' : ''}`} data-testid={`home-setup-${id}`} data-done={ok ? 'yes' : 'no'}>
              {ok ? <CheckCircle2 className="w-5 h-5 shrink-0 text-[#34d399]" /> : <Circle className="w-5 h-5 shrink-0 text-[#a1a1aa]" />}{label}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
