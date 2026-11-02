import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { IN, Label, Err } from './EsimCheckout';

// Landing checkout: create the account (or sign in) with a code texted to a phone, no password.
export function PhoneAccount({ onDone, onMfa }) {
  const { setAccount, config } = useCivrAuth();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (!sent) return undefined; setLeft(30); const t = setInterval(() => setLeft(n => (n > 0 ? n - 1 : 0)), 1000); return () => clearInterval(t); }, [sent]);
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const send = (channel) => run(async () => { const d = await api('/auth/phone/start', { method: 'POST', body: { phone, channel } }); setCode(''); setSent({ ...d, phone }); });
  const verify = () => run(async () => {
    const r = await api('/auth/phone/verify', { method: 'POST', body: { challenge: sent.challenge, code, name } });
    if (r.twoFactor) { onMfa(); return; }
    setAccount(r.account); onDone(r.account);
  });
  if (!sent) return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send('sms'); }} data-testid="co-phone-form">
      <Label text="Name (optional)"><input className={IN} value={name} onChange={e => setName(e.target.value)} autoComplete="name" data-testid="co-phone-name" /></Label>
      <Label text="Mobile number" hint="Include the country code, like +1 or +44. We’ll text you a code, no password needed. Already have an account with this number? The code signs you in."><input className={IN} type="tel" required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 415 555 0100" autoComplete="tel" data-testid="co-phone-number" /></Label>
      <Err e={err} testid="co-phone-error" />
      <button type="submit" className="civr-l-btn w-full inline-flex items-center justify-center gap-2 min-h-[48px] disabled:opacity-50" disabled={busy || phone.replace(/\D/g, '').length < 8} data-testid="co-phone-send">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Text me a code</button>
    </form>
  );
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); verify(); }} data-testid="co-phone-code-step">
      <p className="text-sm text-slate-600">{sent.channel === 'voice' ? 'We’re calling' : 'We texted a code to'} <b className="text-slate-900">{sent.phone}</b>.</p>
      {sent.previewCode && <p className="text-xs font-mono text-indigo-700" data-testid="co-phone-preview-code">Preview test number: code {sent.previewCode}</p>}
      <Label text="Code"><input className={`${IN} font-mono tracking-[0.3em]`} inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} data-testid="co-phone-code" /></Label>
      <Err e={err} testid="co-phone-code-error" />
      <button type="submit" className="civr-l-btn w-full inline-flex items-center justify-center gap-2 min-h-[48px] disabled:opacity-50" disabled={busy || code.length < 3} data-testid="co-phone-verify">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Continue</button>
      <div className="flex flex-wrap gap-x-4 text-sm font-semibold text-slate-700">
        {left > 0 ? <span className="font-normal text-slate-500" data-testid="co-phone-wait">Didn’t get it? Ask again in {left}s.</span> : <>
          {config?.phoneVoice && <button type="button" onClick={() => send('voice')} className="underline underline-offset-4 py-2" data-testid="co-phone-call">Call me with the code</button>}
          <button type="button" onClick={() => send('sms')} className="underline underline-offset-4 py-2" data-testid="co-phone-resend">Text me again</button></>}
        <button type="button" onClick={() => { setSent(null); setErr(null); }} className="underline underline-offset-4 py-2" data-testid="co-phone-change">Use a different number</button>
      </div>
    </form>
  );
}
