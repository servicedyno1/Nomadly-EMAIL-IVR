import React, { useState } from 'react';
import { Loader2, Search, Check, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { cp } from '../../paths';
import { useShell } from '../../Shell';

// Number → check → pay. Every number is its own Texting plan; proof of ownership comes after payment.
export function NewSetup({ data, onDone, onCancel }) {
  const { refreshSummary } = useShell();
  const t = data.texting;
  const [phone, setPhone] = useState('');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const doCheck = () => run(async () => setCheck(await api('/hosted-sms/check', { method: 'POST', body: { phone } })));
  const pay = () => run(async () => { const r = await api('/hosted-sms', { method: 'POST', body: { phone: check.phoneNumber } }); toast.success(`Paid $${r.item.paid}. Let’s finish setting up ${r.item.phoneNumber}`); refreshSummary(); onDone(r.item); });
  return (
    <div className="civr-card p-6 space-y-5 mb-6 civr-rise" data-testid="texting-new">
      <div>
        <div className="font-semibold">Texting plan</div>
        <p className="text-sm text-[#a1a1aa] mt-1" data-testid="texting-plan-note">{`$${t.setup} once, includes your first month. Then $${t.monthly}/month from your wallet. Incoming texts are free.`}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
        <div className="flex-1"><Field label="Your business number, with country code" hint="US or Canada landline or toll-free, e.g. +1 312 555 0100"><input className="civr-input font-mono" inputMode="tel" value={phone} onChange={e => { setPhone(e.target.value); setCheck(null); }} placeholder="+1 312 555 0100" data-testid="texting-phone-input" /></Field></div>
        <button type="button" onClick={doCheck} disabled={busy || phone.replace(/\D/g, '').length < 10} className="civr-btn civr-btn-ghost sm:mt-6" data-testid="texting-check-button">{busy && !check ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Check number</button>
      </div>
      {check && !check.eligible && <div className="text-sm text-[#fb7185]" role="alert" data-testid="texting-check-result">✕ {check.phoneNumber} can’t get texting. {check.detail}</div>}
      {check?.eligible && <>
        <div className="text-sm text-[#34d399] flex items-center gap-1.5" role="status" data-testid="texting-check-result"><Check className="w-4 h-4" /><span className="font-mono" data-no-translate>{check.phoneNumber}</span> can get texting.</div>
        <p className="text-xs text-[#a1a1aa] flex gap-1.5" data-testid="texting-receive-note"><Inbox className="w-3.5 h-3.5 mt-px shrink-0 text-[#818cf8]" />{`Receives texts only. Your customers text this number and you read every message here. Usually live within ${data.reviewDays}.`}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={pay} disabled={busy} className="civr-btn civr-btn-primary" data-testid="texting-pay-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{`Pay $${t.setup} from wallet`}</button>
          {onCancel && <button type="button" onClick={onCancel} className="civr-btn civr-btn-ghost" data-testid="texting-new-cancel">Cancel</button>}
          <span className="text-xs text-[#a1a1aa]">Full refund if the number isn’t approved. <Link to={cp('/app/wallet')} className="underline">Wallet</Link></span>
        </div>
      </>}
      <ErrorNote error={err} testid="texting-new-error" />
    </div>
  );
}
