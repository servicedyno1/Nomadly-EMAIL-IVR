import React, { useState } from 'react';
import { Loader2, PhoneCall, Hourglass, PauseCircle, XCircle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api';
import { ErrorNote } from '../../ui';
import { LoaStep, BillStep } from './DocumentsStep';
import { Thread } from './Thread';
import { useShell } from '../../Shell';

export const STATUS = {
  verify: { label: 'Step 2 · Ownership code', tone: 'text-[#fbbf24]' },
  loa: { label: 'Step 3 · Sign the authorization letter', tone: 'text-[#fbbf24]' },
  documents: { label: 'Step 4 · Upload your phone bill', tone: 'text-[#fbbf24]' },
  admin_docs: { label: 'Support is helping with your phone bill', tone: 'text-[#fbbf24]' },
  review: { label: 'Under review · 1–3 business days', tone: 'text-[#818cf8]' },
  active: { label: 'Active for texting', tone: 'text-[#34d399]' },
  paused: { label: 'Paused', tone: 'text-[#fb7185]' },
  rejected: { label: 'Not approved · refunded', tone: 'text-[#fb7185]' },
};

export function NumberPanel({ item, meta, onChange }) {
  const s = STATUS[item.status] || { label: item.status };
  return (
    <div className="civr-card p-6 space-y-5 civr-rise" data-testid="texting-panel" data-status={item.status}>
      <div>
        <div className="font-mono text-2xl font-bold" data-no-translate data-testid="texting-panel-number">{item.phoneNumber}</div>
        <div className={`text-sm mt-1 ${s.tone}`} data-testid="texting-panel-status">{s.label}</div>
        {item.note && !(item.status === 'paused' && item.planNumber) && <div className="text-sm text-[#fbbf24] mt-2" data-testid="texting-panel-note">{item.note}</div>}
      </div>
      {SETUP.includes(item.status) && <Progress item={item} />}
      {item.status === 'verify' && <VerifyStep item={item} onChange={onChange} />}
      {(item.status === 'loa' || (item.status === 'documents' && !item.holder)) && <LoaStep item={item} onChange={onChange} />}
      {['documents', 'admin_docs'].includes(item.status) && item.holder && <BillStep item={item} onChange={onChange} />}
      {item.status === 'review' && <Info icon={Hourglass} text={`${item.mode === 'code' ? 'Ownership confirmed with the code. Your number is' : 'Your documents are'} with the carrier${item.docsAt ? ` since ${String(item.docsAt).slice(0, 10)}` : ''}. Usually approved within 1–3 business days${item.expectedBy ? ` — expected by ${String(item.expectedBy).slice(0, 10)}` : ''}. We’ll message your Inbox the moment texting is on.`} testid="texting-review" />}
      {item.status === 'paused' && <Info icon={PauseCircle} text={item.planNumber ? `Texting is paused because the plan on ${item.planNumber} isn’t active. Renew that plan and texting turns back on by itself.` : `Texting is paused because the $${item.monthly} monthly fee couldn’t be paid. Top up your wallet and it turns back on within a day.`} testid="texting-paused" />}
      {item.status === 'rejected' && <Info icon={XCircle} text={`This number couldn’t be text-enabled. $${item.paid} was refunded to your wallet.`} testid="texting-rejected" />}
      {item.status === 'active' && <p className="text-xs text-[#a1a1aa]" data-testid="texting-billing">{item.planNumber ? <>Renews with your {item.plan[0].toUpperCase() + item.plan.slice(1)} plan on <span className="font-mono" data-no-translate>{item.planNumber}</span>, no monthly fee</> : <>Texting plan · next ${item.monthly} on {String(item.nextBillAt || '').slice(0, 10)}{item.inboundIncluded ? <> · <span data-testid="texting-inbound-used">{item.inboundUsed} of {item.inboundIncluded}</span> incoming texts used this month</> : null}</>} · then ${meta.textPrice.toFixed(2)} per text · incoming texts also land in your Inbox.</p>}
      {['active', 'paused'].includes(item.status) && <Thread item={item} meta={meta} />}
      {['verify', 'loa', 'documents', 'admin_docs'].includes(item.status) && <CancelButton item={item} onChange={onChange} />}
    </div>
  );
}

const SETUP = ['verify', 'loa', 'documents', 'admin_docs', 'review'];
// Paid → code (or skip) → LOA → bill → review. A verified code jumps straight to review.
function Progress({ item }) {
  const code = item.mode === 'code';
  const steps = [['Paid', true], ['Code', item.status !== 'verify', code ? 'Confirmed' : item.mode === 'nocode' ? 'Skipped' : null], ['Letter', code || (['documents', 'admin_docs', 'review'].includes(item.status) && !!item.holder), code ? 'Not needed' : null], ['Phone bill', code || item.status === 'review', code ? 'Not needed' : null], ['Review', false]];
  const cur = steps.findIndex(([, done]) => !done);
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Setup progress" data-testid="texting-progress">{steps.map(([label, done, sub], i) => (
      <li key={label} className="text-xs" data-testid={`texting-progress-${i}`} data-state={done ? 'done' : i === cur ? 'current' : 'todo'} aria-current={i === cur ? 'step' : undefined}>
        <div className={`h-1 rounded-full mb-2 ${done ? 'bg-[#34d399]' : i === cur ? 'bg-[#818cf8]' : 'bg-[#3f3f46]'}`} />
        <div className={`flex items-center gap-1 ${done ? 'text-[#d4d4d8]' : i === cur ? 'font-semibold' : 'text-[#a1a1aa]'}`}>{done && <Check className="w-3 h-3 text-[#34d399]" />}{label}</div>
        {sub && <div className="text-[#a1a1aa] mt-0.5">{sub}</div>}
      </li>
    ))}</ol>
  );
}

const Info = ({ icon: Icon, text, testid }) => <div className="flex gap-3 text-sm text-[#d4d4d8]" data-testid={testid}><Icon className="w-5 h-5 text-[#818cf8] shrink-0" />{text}</div>;

function VerifyStep({ item, onChange }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const run = async (k, fn) => { setBusy(k); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(null); } };
  const send = (method) => run(method, async () => { const r = await api(`/hosted-sms/${item.id}/code/send`, { method: 'POST', body: { method } }); toast.success(`Calling ${item.phoneNumber} now${r.preview ? ` · ${r.preview}` : ''}`); });
  const submit = () => run('code', async () => { await api(`/hosted-sms/${item.id}/code`, { method: 'POST', body: { code } }); toast.success('Ownership confirmed. No letter or bill needed'); onChange(); });
  const skip = () => run('skip', async () => { await api(`/hosted-sms/${item.id}/code/skip`, { method: 'POST' }); onChange(); });
  return (
    <div className="space-y-4" data-testid="texting-verify">
      <p className="text-sm text-[#d4d4d8]">We call <span className="font-mono" data-no-translate>{item.phoneNumber}</span> and read out a short code. Whoever answers there types it below, and you’re done.</p>
      <button type="button" onClick={() => send('call')} disabled={!!busy} className="civr-btn civr-btn-ghost" data-testid="texting-code-call">{busy === 'call' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}Call the number with the code</button>
      <div className="flex gap-2 max-w-sm">
        <input className="civr-input font-mono tracking-widest" value={code} onChange={e => setCode(e.target.value)} placeholder="Code" inputMode="numeric" data-testid="texting-code-input" />
        <button type="button" onClick={submit} disabled={!!busy || !code.trim()} className="civr-btn civr-btn-primary" data-testid="texting-code-submit">{busy === 'code' && <Loader2 className="w-4 h-4 animate-spin" />}Confirm</button>
      </div>
      <div className="text-sm text-[#a1a1aa] border-t border-[#27272a] pt-3">Can’t answer at that number? <button type="button" onClick={skip} disabled={!!busy} className="underline text-[#d4d4d8]" data-testid="texting-code-skip">{busy === 'skip' && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}Skip the code</button> and sign an authorization letter plus upload a recent phone bill instead.</div>
      <ErrorNote error={err} testid="texting-verify-error" />
    </div>
  );
}

function CancelButton({ item, onChange }) {
  const { refreshSummary } = useShell();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!window.confirm(`Cancel and refund $${item.paid} to your wallet?`)) return;
    setBusy(true);
    try { await api(`/hosted-sms/${item.id}/cancel`, { method: 'POST' }); toast.success(`Cancelled — $${item.paid} refunded`); refreshSummary(); onChange(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return <button type="button" onClick={go} disabled={busy} className="text-xs text-[#a1a1aa] underline hover:text-[#fb7185]" data-testid="texting-cancel-button">Cancel & refund ${item.paid}</button>;
}
