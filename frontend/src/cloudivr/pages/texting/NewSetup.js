import React, { useState } from 'react';
import { Loader2, Search, ShieldCheck, FileText, Layers, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { cp } from '../../paths';
import { useShell } from '../../Shell';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const planState = (p) => (p.status !== 'active' ? 'Plan not active, renew it first' : p.limit != null && p.used >= p.limit ? `Full: ${p.used} of ${p.limit} used` : p.limit == null ? `Unlimited · ${p.used} added` : `${p.used} of ${p.limit} used`);
const usable = (p) => p.status === 'active' && (p.limit == null || p.used < p.limit);

function Step({ n, title, children, testid }) {
  return <div className="space-y-3" data-testid={testid}><div className="flex items-center gap-2 font-semibold"><span className="w-6 h-6 rounded-full bg-[#818cf8]/15 text-[#818cf8] text-xs grid place-items-center">{n}</span>{title}</div>{children}</div>;
}

function PlanPick({ plans, value, onChange }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Plan this number joins">{plans.map(p => (
      <button key={p.phoneNumber} type="button" role="radio" aria-checked={value === p.phoneNumber} disabled={!usable(p)} onClick={() => onChange(p.phoneNumber)}
        className={`civr-card text-left p-4 disabled:opacity-50 disabled:cursor-not-allowed ${value === p.phoneNumber ? 'ring-1 ring-[#818cf8]/70' : ''}`} data-testid={`texting-plan-${p.phoneNumber.replace(/\D/g, '')}`}>
        <div className="flex items-center gap-2 font-semibold"><Layers className="w-4 h-4 text-[#818cf8]" />{cap(p.plan)} plan<span className="ml-auto font-mono">${p.price}</span></div>
        <div className="text-xs text-[#a1a1aa] mt-1"><span className="font-mono" data-no-translate>{p.phoneNumber}</span> · {planState(p)}</div>
      </button>
    ))}</div>
  );
}

const NoPlan = () => (
  <div className="rounded-xl border border-dashed border-[#3f3f46] p-4 text-sm space-y-3" data-testid="texting-needs-plan">
    <div>Landline to Texting is added to a plan: $150 per number on Starter (up to 5), $120 on Pro (up to 10), $100 on Business (unlimited). No monthly fee, it renews with the plan.</div>
    <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="texting-get-plan-link">Get a number with a plan</Link>
  </div>
);

// number → eligibility → plan it joins → how to prove ownership → pay from wallet. The phone bill is asked for after payment.
export function NewSetup({ data, onDone, onCancel }) {
  const { refreshSummary } = useShell();
  const plans = data.plans || [];
  const [phone, setPhone] = useState('');
  const [check, setCheck] = useState(null);
  const [planNumber, setPlanNumber] = useState((plans.find(usable) || {}).phoneNumber || '');
  const [mode, setMode] = useState('code');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const plan = plans.find(p => p.phoneNumber === planNumber);
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const doCheck = () => run(async () => setCheck(await api('/hosted-sms/check', { method: 'POST', body: { phone } })));
  const pay = () => run(async () => { const r = await api('/hosted-sms', { method: 'POST', body: { phone: check.phoneNumber, mode, planNumber } }); toast.success(`Paid $${r.item.paid}. Next: ${mode === 'code' ? 'confirm the code' : 'your details and phone bill'}`); refreshSummary(); onDone(r.item); });
  const opts = [['code', ShieldCheck, 'With ownership code', 'We send a code to the number by text or phone call; you enter it here.'], ['nocode', FileText, 'Without code', 'Skip the code. Your phone bill proves you own it.']];
  return (
    <div className="civr-card p-6 space-y-6 mb-6 civr-rise" data-testid="texting-new">
      <div><div className="font-display text-2xl font-bold">Text-enable a number</div>
        <p className="text-sm text-[#a1a1aa] mt-1" data-testid="texting-timeline">{`Pay once, then confirm the code (if chosen) and upload a recent phone bill (no bill? we collect it for +$${data.noBillFee ?? 50}). Carrier review usually takes ${data.reviewDays || '1–3 business days'}.`}</p></div>
      {!plans.length ? <NoPlan /> : <>
        <Step n={1} title="Your existing number" testid="texting-step-number">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
            <div className="flex-1"><Field label="Number with country code" hint="US or Canada landline or toll-free, e.g. +1 312 555 0100"><input className="civr-input font-mono" value={phone} onChange={e => { setPhone(e.target.value); setCheck(null); }} placeholder="+1 312 555 0100" data-testid="texting-phone-input" /></Field></div>
            <button type="button" onClick={doCheck} disabled={busy || phone.replace(/\D/g, '').length < 10} className="civr-btn civr-btn-ghost sm:mt-6" data-testid="texting-check-button">{busy && !check ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Check number</button>
          </div>
          {check && !check.eligible && <div className="text-sm text-[#fb7185]" data-testid="texting-check-result">✕ {check.phoneNumber} can’t be text-enabled. {check.detail}</div>}
          {check?.eligible && <div className="text-sm text-[#34d399] flex items-center gap-1.5" data-testid="texting-check-result"><Check className="w-4 h-4" /><span className="font-mono" data-no-translate>{check.phoneNumber}</span> can be text-enabled.</div>}
        </Step>
        {check?.eligible && <>
          <Step n={2} title="Which plan it joins" testid="texting-step-plan"><PlanPick plans={plans} value={planNumber} onChange={setPlanNumber} />
            <p className="text-xs text-[#a1a1aa]">One-time fee. No monthly fee: texting renews and pauses with that plan. Texts are ${data.textPrice ?? 0.05} each from your wallet.</p></Step>
          <Step n={3} title="How you prove it’s yours" testid="texting-step-mode">
            <div className="grid md:grid-cols-2 gap-3">{opts.map(([v, Icon, title, sub]) => (
              <button key={v} type="button" onClick={() => setMode(v)} aria-pressed={mode === v} className={`civr-card text-left p-4 ${mode === v ? 'ring-1 ring-[#818cf8]/70' : ''}`} data-testid={`texting-mode-${v}`}>
                <div className="flex items-center gap-2 font-semibold"><Icon className="w-4 h-4 text-[#818cf8]" />{title}</div><div className="text-xs text-[#a1a1aa] mt-1">{sub}</div>
              </button>
            ))}</div></Step>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={pay} disabled={busy || !plan || !usable(plan)} className="civr-btn civr-btn-primary" data-testid="texting-pay-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{plan ? `Pay $${plan.price} from wallet` : 'Pick a plan'}</button>
            <button type="button" onClick={onCancel} className="civr-btn civr-btn-ghost" data-testid="texting-new-cancel">Cancel</button>
            <span className="text-xs text-[#a1a1aa]">Refunded in full if not approved. <Link to={cp('/app/wallet')} className="underline">Wallet</Link></span>
          </div>
        </>}
      </>}
      <ErrorNote error={err} testid="texting-new-error" />
    </div>
  );
}
