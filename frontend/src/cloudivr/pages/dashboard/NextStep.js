import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PlusCircle, PhoneIncoming, Wallet, BotMessageSquare, Megaphone, KeyRound, PhoneOutgoing, CalendarClock } from 'lucide-react';
import { useApi, money } from '../../api';
import { cp } from '../../paths';
import { answering } from '../NumberDetail';

const DAY = 86400000;
const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// The single most useful thing to do next, from what the account already has set up. First rule that applies wins.
export function pickNextStep({ s, nums, agents, camps }) {
  const lines = (nums || []).filter(n => n.status === 'active' && !n.isSubNumber && !n.replacedBy);
  const balance = s?.balance || 0;
  const can = (k) => lines.some(n => n.access?.[k]);
  if (!lines.length) return { id: 'number', Icon: PlusCircle, title: 'Get your first business number', why: 'Everything else — answering, campaigns, AI — starts with a number.', cta: 'Get a number', to: '/app/buy' };
  const due = lines.filter(n => n.autoRenew && n.expiresAt && new Date(n.expiresAt) - Date.now() < 7 * DAY && balance < (n.renewalPrice || 0))
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))[0];
  if (due) return { id: 'renew', Icon: CalendarClock, title: `Top up so ${due.phoneNumber} renews on ${shortDate(due.expiresAt)}`, why: `Renewal is ${money(due.renewalPrice)} and your wallet has ${money(balance)}. Without it the number is paused.`, cta: 'Add funds', to: `/app/wallet?need=${Math.max(0, (due.renewalPrice || 0) - balance).toFixed(2)}` };
  const quiet = lines.find(n => !answering(n.features));
  if (quiet) return { id: 'answer', Icon: PhoneIncoming, title: `Choose how ${quiet.phoneNumber} answers calls`, why: 'Right now callers just ring. Add a keypad menu, forward to your phone, or let Emily set it up for you.', cta: 'Set up answering', to: '/app/answer/ivr' };
  if (balance <= 0) return { id: 'wallet', Icon: Wallet, title: 'Add funds to your wallet', why: 'Calls out, campaigns and AI minutes are paid from your wallet.', cta: 'Add funds', to: '/app/wallet' };
  if (can('aiAgent') && agents && !agents.length) return { id: 'ai', Icon: BotMessageSquare, title: 'Let an AI receptionist answer for you', why: 'It picks up 24/7, answers questions and takes messages. Tell Emily about your business and it’s ready in a minute.', cta: 'Create AI receptionist', to: '/app/receptionist/new' };
  if (can('bulkCall') && camps && !camps.length) return { id: 'campaign', Icon: Megaphone, title: 'Run your first campaign', why: 'Call a whole list with one message and connect everyone who presses 1. Emily writes the script with you.', cta: 'Start a campaign', to: '/app/campaigns/new' };
  if (!lines.some(n => n.sipUsername)) return { id: 'sip', Icon: KeyRound, title: 'Take calls on your phone or computer', why: 'Create a login for Zoiper, a desk phone or any softphone app.', cta: 'Create a login', to: '/app/sip' };
  if (can('ivrOutbound')) return { id: 'quick', Icon: PhoneOutgoing, title: 'Send a quick automated call', why: 'Remind a customer or collect a code — Emily sets it up from one sentence.', cta: 'Make a quick call', to: '/app/quick-call' };
  return null;
}

export function NextStep({ s, nums }) {
  const { data: ag } = useApi('/ai-agents');
  const { data: cp_ } = useApi('/campaigns');
  if (!nums) return null;
  const step = pickNextStep({ s, nums, agents: ag?.agents, camps: cp_?.campaigns });
  if (!step) return null;
  const { Icon } = step;
  return (
    <section className="civr-card civr-next-step p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 civr-rise" aria-label="Your next step" data-testid="home-next-step" data-step={step.id}>
      <span className="hidden sm:grid w-11 h-11 shrink-0 rounded-xl place-items-center bg-[var(--c-card)] text-[var(--c-accent)]"><Icon className="w-5 h-5" /></span>
      <div className="flex-1 min-w-0">
        <div className="civr-label">Do this next</div>
        <div className="font-semibold text-[17px] mt-0.5" data-testid="home-next-step-title">{step.title}</div>
        <div className="text-sm text-[var(--c-muted)] mt-0.5" data-testid="home-next-step-why">{step.why}</div>
      </div>
      <Link to={cp(step.to)} className="civr-btn civr-btn-primary shrink-0" data-testid="home-next-step-action">{step.cta}<ArrowRight className="w-4 h-4" /></Link>
    </section>
  );
}
