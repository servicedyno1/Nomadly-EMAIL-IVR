import React, { useEffect, useState } from 'react';
import { X, Loader2, MailCheck, ArrowRight } from 'lucide-react';
import { sendCode, verifyCode } from './tryApi';

// Email check before the free test call: send a 6-digit code, then verify it.
export default function EmailGate({ open, onClose, onVerified }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setStep('email'); setCode(''); setError(null); setPreview(''); } }, [open]);
  if (!open) return null;

  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const send = (e) => { e.preventDefault(); run(async () => { const d = await sendCode(email.trim()); setPreview(d.previewCode || ''); setStep('code'); }); };
  const verify = (e) => { e.preventDefault(); run(async () => onVerified(await verifyCode(email.trim(), code.trim()))); };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose} data-testid="civr-email-gate-modal">
      <div className="civr-l civr-l-dark w-full max-w-md rounded-3xl border border-white/10 p-6 sm:p-8 civr-rise" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="civr-gate-title">
        <div className="flex items-start justify-between gap-4">
          <div className="civr-l-eyebrow"><MailCheck className="w-4 h-4" />Step {step === 'email' ? '1' : '2'} of 2</div>
          <button onClick={onClose} className="w-11 h-11 -mt-2 -mr-2 flex items-center justify-center rounded-full hover:bg-white/10" aria-label="Close" data-testid="civr-email-gate-close-btn"><X className="w-5 h-5" /></button>
        </div>
        <h3 id="civr-gate-title" className="civr-l-h text-4xl mt-3">{step === 'email' ? 'Confirm your email' : 'Enter your code'}</h3>
        <p className="text-sm civr-l-muted mt-2">{step === 'email' ? 'We send a 6-digit code to stop abuse. One free 60-second call per email.' : <>We sent it to <span className="text-[#FEFDF5]">{email}</span>. It expires in 10 minutes.</>}</p>
        {step === 'email' ? (
          <form onSubmit={send} className="mt-6 space-y-4">
            <input type="email" autoFocus required className="civr-l-input !font-sans" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} data-testid="civr-email-gate-input" />
            <button className="civr-l-btn w-full" disabled={busy || !email.trim()} data-testid="civr-email-gate-send-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}Send code</button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-4">
            <input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} className="civr-l-input text-center !text-2xl tracking-[0.5em]" placeholder="••••••" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} data-testid="civr-email-gate-code-input" />
            {preview && <div className="text-xs font-mono text-[#fbbf24]" data-testid="civr-email-gate-preview-code">Preview mode — your code is {preview}</div>}
            <button className="civr-l-btn w-full" disabled={busy || code.length !== 6} data-testid="civr-email-gate-submit-btn">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Verify &amp; start call</button>
            <button type="button" className="text-sm civr-l-muted hover:text-[#00E3AA] w-full py-2" onClick={() => setStep('email')} data-testid="civr-email-gate-change-email">Use a different email</button>
          </form>
        )}
        {error && <div className="mt-4 text-sm text-[#fb7185] border border-[#fb7185]/30 bg-[#fb7185]/10 rounded-xl px-4 py-3" data-testid="civr-email-gate-error">{error.message}</div>}
      </div>
    </div>
  );
}
