import React, { useState } from 'react';
import { Loader2, MessageSquare, PhoneCall, Hourglass, PauseCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api';
import { ErrorNote } from '../../ui';
import { DocumentsStep } from './DocumentsStep';
import { Thread } from './Thread';
import { useShell } from '../../Shell';

export const STATUS = {
  verify: { label: 'Waiting for ownership code', tone: 'text-[#fbbf24]' },
  documents: { label: 'Waiting for details & phone bill', tone: 'text-[#fbbf24]' },
  review: { label: 'Under review · 1–3 business days', tone: 'text-[#818cf8]' },
  active: { label: 'Active for texting', tone: 'text-[#34d399]' },
  paused: { label: 'Paused · monthly fee due', tone: 'text-[#fb7185]' },
  rejected: { label: 'Not approved · refunded', tone: 'text-[#fb7185]' },
};

export function NumberPanel({ item, meta, onChange }) {
  const s = STATUS[item.status] || { label: item.status };
  return (
    <div className="civr-card p-6 space-y-5 civr-rise" data-testid="texting-panel" data-status={item.status}>
      <div>
        <div className="font-mono text-2xl font-bold" data-no-translate data-testid="texting-panel-number">{item.phoneNumber}</div>
        <div className={`text-sm mt-1 ${s.tone}`} data-testid="texting-panel-status">{s.label}</div>
        {item.note && <div className="text-sm text-[#fbbf24] mt-2" data-testid="texting-panel-note">{item.note}</div>}
      </div>
      {item.status === 'verify' && <VerifyStep item={item} onChange={onChange} />}
      {item.status === 'documents' && <DocumentsStep item={item} onChange={onChange} />}
      {item.status === 'review' && <Info icon={Hourglass} text="Your documents are with the carrier. We’ll message your Inbox the moment texting is on — usually 1–3 business days." testid="texting-review" />}
      {item.status === 'paused' && <Info icon={PauseCircle} text={`Texting is paused because the $${meta.monthly} monthly fee couldn’t be paid. Top up your wallet — it turns back on within a day.`} testid="texting-paused" />}
      {item.status === 'rejected' && <Info icon={XCircle} text={`This number couldn’t be text-enabled. $${item.paid} was refunded to your wallet.`} testid="texting-rejected" />}
      {item.status === 'active' && <p className="text-xs text-[#a1a1aa]" data-testid="texting-billing">Next ${meta.monthly} on {String(item.nextBillAt || '').slice(0, 10)} · ${meta.textPrice.toFixed(2)} per text sent · incoming texts also land in your Inbox.</p>}
      {['active', 'paused'].includes(item.status) && <Thread item={item} meta={meta} />}
      {['verify', 'documents'].includes(item.status) && <CancelButton item={item} onChange={onChange} />}
    </div>
  );
}

const Info = ({ icon: Icon, text, testid }) => <div className="flex gap-3 text-sm text-[#d4d4d8]" data-testid={testid}><Icon className="w-5 h-5 text-[#818cf8] shrink-0" />{text}</div>;

function VerifyStep({ item, onChange }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const run = async (k, fn) => { setBusy(k); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(null); } };
  const send = (method) => run(method, async () => { const r = await api(`/hosted-sms/${item.id}/code/send`, { method: 'POST', body: { method } }); toast.success(`Code sent by ${method === 'call' ? 'phone call' : 'text'}${r.preview ? ` · ${r.preview}` : ''}`); });
  const submit = () => run('code', async () => { await api(`/hosted-sms/${item.id}/code`, { method: 'POST', body: { code } }); toast.success('Ownership confirmed'); onChange(); });
  return (
    <div className="space-y-4" data-testid="texting-verify">
      <p className="text-sm text-[#d4d4d8]">We send a one-time code to <span className="font-mono">{item.phoneNumber}</span>. Landline? Choose a phone call — the code is read out.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => send('sms')} disabled={!!busy} className="civr-btn civr-btn-ghost" data-testid="texting-code-sms">{busy === 'sms' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}Send by text</button>
        <button type="button" onClick={() => send('call')} disabled={!!busy} className="civr-btn civr-btn-ghost" data-testid="texting-code-call">{busy === 'call' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}Send by call</button>
      </div>
      <div className="flex gap-2 max-w-sm">
        <input className="civr-input font-mono tracking-widest" value={code} onChange={e => setCode(e.target.value)} placeholder="Code" inputMode="numeric" data-testid="texting-code-input" />
        <button type="button" onClick={submit} disabled={!!busy || !code.trim()} className="civr-btn civr-btn-primary" data-testid="texting-code-submit">{busy === 'code' && <Loader2 className="w-4 h-4 animate-spin" />}Confirm</button>
      </div>
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
