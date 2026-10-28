import React, { useState } from 'react';
import { Loader2, Search, ShieldCheck, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { cp } from '../../paths';

// Step 1–3: number → eligibility → how to prove ownership → pay from wallet.
export function NewSetup({ data, onDone, onCancel }) {
  const [phone, setPhone] = useState('');
  const [check, setCheck] = useState(null);
  const [mode, setMode] = useState('code');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const doCheck = () => run(async () => setCheck(await api('/hosted-sms/check', { method: 'POST', body: { phone } })));
  const pay = () => run(async () => { const r = await api('/hosted-sms', { method: 'POST', body: { phone: check.phoneNumber, mode } }); toast.success(`Paid $${r.item.paid} — next: ${mode === 'code' ? 'confirm the code' : 'your details & bill'}`); onDone(r.item); });
  const opts = [['code', ShieldCheck, `With ownership code — $${data.prices.code}`, 'We send a code to the number by text or phone call; you enter it here.'], ['nocode', FileText, `Without code — $${data.prices.nocode}`, 'Skip the code — just your details and phone bill.']];
  return (
    <div className="civr-card p-6 space-y-5 mb-6 civr-rise" data-testid="texting-new">
      <div className="font-display text-2xl font-bold">Text-enable a number</div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-1"><Field label="Your existing number" hint="With country code, e.g. +1 312 555 0100"><input className="civr-input font-mono" value={phone} onChange={e => { setPhone(e.target.value); setCheck(null); }} placeholder="+1 312 555 0100" data-testid="texting-phone-input" /></Field></div>
        <button type="button" onClick={doCheck} disabled={busy || phone.replace(/\D/g, '').length < 10} className="civr-btn civr-btn-ghost sm:mb-6" data-testid="texting-check-button">{busy && !check ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Check number</button>
      </div>
      {check && !check.eligible && <div className="text-sm text-[#fb7185]" data-testid="texting-check-result">✕ {check.phoneNumber} can’t be text-enabled. {check.detail}</div>}
      {check?.eligible && (
        <>
          <div className="text-sm text-[#34d399]" data-testid="texting-check-result">✓ <span className="font-mono" data-no-translate>{check.phoneNumber}</span> can be text-enabled.</div>
          <div className="grid md:grid-cols-2 gap-3">{opts.map(([v, Icon, title, sub]) => (
            <button key={v} type="button" onClick={() => setMode(v)} aria-pressed={mode === v} className={`civr-card text-left p-4 ${mode === v ? 'ring-1 ring-[#818cf8]/70' : ''}`} data-testid={`texting-mode-${v}`}>
              <div className="flex items-center gap-2 font-semibold"><Icon className="w-4 h-4 text-[#818cf8]" />{title}</div>
              <div className="text-xs text-[#a1a1aa] mt-1">{sub}</div>
            </button>
          ))}</div>
          <p className="text-xs text-[#a1a1aa]">Then ${data.monthly}/month from your wallet once active. Refunded in full if not approved. <Link to={cp('/app/wallet')} className="underline">Wallet</Link></p>
          <div className="flex gap-2">
            <button type="button" onClick={pay} disabled={busy} className="civr-btn civr-btn-primary" data-testid="texting-pay-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Pay ${data.prices[mode]} from wallet</button>
            <button type="button" onClick={onCancel} className="civr-btn civr-btn-ghost" data-testid="texting-new-cancel">Cancel</button>
          </div>
        </>
      )}
      <ErrorNote error={err} testid="texting-new-error" />
    </div>
  );
}
