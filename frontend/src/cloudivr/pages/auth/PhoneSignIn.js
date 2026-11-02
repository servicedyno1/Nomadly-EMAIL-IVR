import React, { useEffect, useState } from 'react';
import { Loader2, MessageSquareText, PhoneCall, RotateCw, ArrowLeft } from 'lucide-react';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { RememberBox } from './TwoFactorStep';
import { useCivrAuth } from '../../AuthContext';

const WAIT = 30;

function useCountdown(key) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    setLeft(WAIT);
    const t = setInterval(() => setLeft(n => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [key]);
  return left;
}

function CodeStep({ sent, voice, busy, error, onVerify, onSend, onBack }) {
  const [code, setCode] = useState('');
  const left = useCountdown(sent.challenge);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onVerify(code); }} className="space-y-4" data-testid="phone-code-step">
      <p className="text-sm text-[#a1a1aa]" data-testid="phone-code-sent-note">{sent.channel === 'voice' ? 'We’re calling' : 'We texted a code to'} <span className="text-[var(--c-text,#f4f4f5)] font-medium">{sent.phone}</span>{sent.channel === 'voice' ? ' to read you a code.' : '.'}</p>
      {sent.previewCode && <p className="text-xs font-mono text-[#818cf8]" data-testid="phone-preview-code">Preview test number: code {sent.previewCode}</p>}
      <Field label="Code"><input className="civr-input tracking-[0.3em] font-mono text-lg" inputMode="numeric" autoComplete="one-time-code" autoFocus required minLength={3} maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-testid="phone-code-input" /></Field>
      <ErrorNote error={error} testid="phone-error" />
      <button className="civr-btn civr-btn-primary w-full" disabled={busy || code.length < 3} data-testid="phone-verify-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Continue</button>
      <div className="text-sm text-[#a1a1aa]" data-testid="phone-resend-box">
        {left > 0 ? <span data-testid="phone-resend-wait">Didn’t get it? You can ask again in {left}s.</span> : (
          <div className="flex flex-wrap gap-2">
            {voice && <button type="button" onClick={() => onSend('voice')} disabled={busy} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="phone-call-me-button"><PhoneCall className="w-4 h-4" />Call me with the code</button>}
            <button type="button" onClick={() => onSend('sms')} disabled={busy} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="phone-resend-sms-button"><RotateCw className="w-4 h-4" />Text me again</button>
          </div>
        )}
      </div>
      <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm text-[#a1a1aa] hover:text-[#818cf8] py-2" data-testid="phone-change-number-button"><ArrowLeft className="w-4 h-4" />Use a different number</button>
    </form>
  );
}

// Sign up or sign in with a phone number: a code by text, or a call that reads it out.
export function PhoneSignIn({ signup, refCode, onDone, onMfa }) {
  const voice = !!useCivrAuth()?.config?.phoneVoice;
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [remember, setRemember] = useState(false);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async (channel = 'sms') => {
    setBusy(true); setError(null);
    try { const d = await api('/auth/phone/start', { method: 'POST', body: { phone, channel } }); setSent({ ...d, phone }); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const verify = async (code) => {
    setBusy(true); setError(null);
    try {
      const d = await api('/auth/phone/verify', { method: 'POST', body: { challenge: sent.challenge, code, remember, name: signup ? name : undefined, ref: signup && refCode ? refCode : undefined } });
      if (d.twoFactor) onMfa(d.twoFactor); else onDone(d);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  if (sent) return <CodeStep sent={sent} voice={voice} busy={busy} error={error} onVerify={verify} onSend={send} onBack={() => { setSent(null); setError(null); }} />;
  return (
    <form onSubmit={(e) => { e.preventDefault(); send('sms'); }} className="space-y-4" data-testid="phone-form">
      {signup && <Field label="Name (optional)"><input className="civr-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="name" data-testid="phone-name-input" /></Field>}
      <Field label="Mobile number" hint="Include the country code, like +1 or +44. We’ll text you a code — no password needed.">
        <input className="civr-input" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 415 555 0100" autoComplete="tel" data-testid="phone-number-input" />
      </Field>
      <RememberBox checked={remember} onChange={setRemember} />
      <ErrorNote error={error} testid="phone-error" />
      <button className="civr-btn civr-btn-primary w-full" disabled={busy || phone.replace(/\D/g, '').length < 8} data-testid="phone-send-code-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquareText className="w-4 h-4" />}Text me a code</button>
    </form>
  );
}
