import React, { useState } from 'react';
import { Loader2, Search, Layers, Check, MessageSquareText, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { cp } from '../../paths';
import { useShell } from '../../Shell';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const planState = (p) => (p.status !== 'active' ? (p.plan === 'texting' ? (p.status === 'paused' ? 'Paused: monthly fee due' : 'Add more numbers once it’s active') : 'Plan not active, renew it first') : p.limit != null && p.used >= p.limit ? `Full: ${p.used} of ${p.limit} used` : p.limit == null ? `Unlimited · ${p.used} added` : `${p.used} of ${p.limit} used`);
const usable = (p) => p.status === 'active' && (p.limit == null || p.used < p.limit);

function Step({ n, title, children, testid }) {
  return <div className="space-y-3" data-testid={testid}><div className="flex items-center gap-2 font-semibold"><span className="w-6 h-6 rounded-full bg-[#818cf8]/15 text-[#818cf8] text-xs grid place-items-center">{n}</span>{title}</div>{children}</div>;
}

const Card = ({ on, disabled, onClick, testid, children }) => (
  <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onClick} data-testid={testid}
    className={`civr-card text-left p-4 disabled:opacity-50 disabled:cursor-not-allowed ${on ? 'ring-1 ring-[#818cf8]/70' : ''}`}>{children}</button>
);

// The new standalone Texting plan, then every plan the customer already has.
function PlanPick({ plans, t, value, onChange }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Plan this number goes on">
      <Card on={value === 'new'} onClick={() => onChange('new')} testid="texting-plan-new">
        <div className="flex items-center gap-2 font-semibold"><MessageSquareText className="w-4 h-4 text-[#818cf8]" />New Texting plan<span className="ml-auto font-mono">${t.setup}</span></div>
        <div className="text-xs text-[#a1a1aa] mt-1">{`Then $${t.monthly}/month · ${t.inbound} incoming texts a month included · more numbers $${t.extra} each`}</div>
      </Card>
      {plans.map(p => (
        <Card key={p.phoneNumber} on={value === p.phoneNumber} disabled={!usable(p)} onClick={() => onChange(p.phoneNumber)} testid={`texting-plan-${p.phoneNumber.replace(/\D/g, '')}`}>
          <div className="flex items-center gap-2 font-semibold"><Layers className="w-4 h-4 text-[#818cf8]" />{`Add to ${cap(p.plan)} plan`}<span className="ml-auto font-mono">${p.price}</span></div>
          <div className="text-xs text-[#a1a1aa] mt-1"><span className="font-mono" data-no-translate>{p.phoneNumber}</span> · {planState(p)}{p.plan === 'texting' ? '' : ' · no monthly fee'}</div>
        </Card>
      ))}
    </div>
  );
}

const pickNote = (value, t, textPrice, plan) => (value === 'new'
  ? `One-time $${t.setup}, then $${t.monthly}/month from your wallet. ${t.inbound} incoming texts a month are included, then $${textPrice} each.`
  : plan?.plan === 'texting' ? `One-time $${t.extra}. It shares that Texting plan’s monthly renewal and its ${t.inbound} included incoming texts.`
  : `One-time fee, no monthly fee: texting renews and pauses with that plan. Texts are $${textPrice} each from your wallet.`);

// Number → eligibility → plan → pay. Proof of ownership is handled step by step after payment.
export function NewSetup({ data, onDone, onCancel }) {
  const { refreshSummary } = useShell();
  const plans = data.plans || [];
  const t = data.texting || { setup: 150, monthly: 100, inbound: 50, extra: 150 };
  const textPrice = data.textPrice ?? 0.05;
  const [phone, setPhone] = useState('');
  const [check, setCheck] = useState(null);
  const [planNumber, setPlanNumber] = useState((plans.find(usable) || {}).phoneNumber || 'new');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const plan = planNumber === 'new' ? { price: t.setup, status: 'active', limit: null } : plans.find(p => p.phoneNumber === planNumber);
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const doCheck = () => run(async () => setCheck(await api('/hosted-sms/check', { method: 'POST', body: { phone } })));
  const pay = () => run(async () => { const r = await api('/hosted-sms', { method: 'POST', body: { phone: check.phoneNumber, planNumber } }); toast.success(`Paid $${r.item.paid}. Let’s finish setting up ${r.item.phoneNumber}`); refreshSummary(); onDone(r.item); });
  return (
    <div className="civr-card p-6 space-y-6 mb-6 civr-rise" data-testid="texting-new">
      <div><div className="font-display text-2xl font-bold">Add texting to your business number</div>
        <p className="text-sm text-[#a1a1aa] mt-1" data-testid="texting-timeline">{`Keep your number and your calls with your current provider. Customers text it and you read every message here. Usually live within ${data.reviewDays || '1–3 business days'}.`}</p></div>
      <Step n={1} title="Your business number" testid="texting-step-number">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
          <div className="flex-1"><Field label="Number with country code" hint="US or Canada landline or toll-free, e.g. +1 312 555 0100"><input className="civr-input font-mono" value={phone} onChange={e => { setPhone(e.target.value); setCheck(null); }} placeholder="+1 312 555 0100" data-testid="texting-phone-input" /></Field></div>
          <button type="button" onClick={doCheck} disabled={busy || phone.replace(/\D/g, '').length < 10} className="civr-btn civr-btn-ghost sm:mt-6" data-testid="texting-check-button">{busy && !check ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Check number</button>
        </div>
        {check && !check.eligible && <div className="text-sm text-[#fb7185]" data-testid="texting-check-result">✕ {check.phoneNumber} can’t get texting. {check.detail}</div>}
        {check?.eligible && <div className="text-sm text-[#34d399] flex items-center gap-1.5" data-testid="texting-check-result"><Check className="w-4 h-4" /><span className="font-mono" data-no-translate>{check.phoneNumber}</span> can get texting.</div>}
      </Step>
      {check?.eligible && <>
        <Step n={2} title="Choose a plan" testid="texting-step-plan">
          <PlanPick plans={plans} t={t} value={planNumber} onChange={setPlanNumber} />
          <p className="text-xs text-[#a1a1aa]" data-testid="texting-plan-note">{pickNote(planNumber, t, textPrice, plan)}</p>
          <p className="text-xs text-[#a1a1aa] flex gap-1.5" data-testid="texting-receive-note"><Inbox className="w-3.5 h-3.5 mt-px shrink-0 text-[#818cf8]" />Receive texts from anyone right away. Replying to US mobiles needs business texting registration (10DLC), and we can register it for you.</p>
          {!plans.length && <p className="text-xs text-[#a1a1aa]">Want calls, menus and AI agents too? <Link to={cp('/app/buy')} className="underline" data-testid="texting-get-plan-link">Get a CloudIVR number with a plan</Link> and add texting to it from $100.</p>}
        </Step>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={pay} disabled={busy || !plan || !usable(plan)} className="civr-btn civr-btn-primary" data-testid="texting-pay-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{plan ? `Pay $${plan.price} from wallet` : 'Pick a plan'}</button>
          {onCancel && <button type="button" onClick={onCancel} className="civr-btn civr-btn-ghost" data-testid="texting-new-cancel">Cancel</button>}
          <span className="text-xs text-[#a1a1aa]">Full refund if the number isn’t approved. <Link to={cp('/app/wallet')} className="underline">Wallet</Link></span>
        </div>
      </>}
      <ErrorNote error={err} testid="texting-new-error" />
    </div>
  );
}
