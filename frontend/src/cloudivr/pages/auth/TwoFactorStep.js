import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Smartphone, Mail } from 'lucide-react';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';

// Second sign-in step: 6-digit code from the authenticator app or email (or a backup code).
export function TwoFactorStep({ mfa, remember: rememberInit, onDone, onBack }) {
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(!!rememberInit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(mfa.previewCode || null);
  const isApp = mfa.method === 'totp';
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const d = await api('/auth/2fa/verify', { method: 'POST', body: { challenge: mfa.challenge, code, remember } }); onDone(d); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const resend = async () => {
    try { const d = await api('/auth/2fa/resend', { method: 'POST', body: { challenge: mfa.challenge } }); setPreview(d.previewCode || null); toast.success('New code sent'); } catch (err) { toast.error(err.message); }
  };
  const Icon = isApp ? Smartphone : Mail;
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="twofa-step">
      <div className="flex items-start gap-3 rounded-xl border border-[#34d399]/30 bg-[#34d399]/5 p-4 text-sm">
        <Icon className="w-5 h-5 text-[#34d399] shrink-0 mt-0.5" />
        <span data-testid="twofa-instructions">{isApp ? 'Open your authenticator app and type the 6-digit code for CloudIVR.' : `We emailed a 6-digit code to ${mfa.emailHint}.`}</span>
      </div>
      {preview && <div className="text-xs text-[#fbbf24]" data-testid="twofa-preview-code">Preview mode — your code is <span className="font-mono">{preview}</span></div>}
      <Field label="Code" hint="Lost your phone? Type one of your backup codes instead.">
        <input className="civr-input font-mono text-lg tracking-[0.3em]" inputMode="text" autoComplete="one-time-code" autoFocus required value={code} onChange={e => setCode(e.target.value)} placeholder="123456" data-testid="twofa-code-input" />
      </Field>
      <label className="flex items-center gap-3 text-sm cursor-pointer" data-testid="twofa-remember-label">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="w-4 h-4 accent-[#34d399]" data-testid="twofa-remember-checkbox" />Remember this browser for 30 days
      </label>
      <ErrorNote error={error} testid="twofa-error" />
      <button className="civr-btn civr-btn-primary w-full" disabled={busy} data-testid="twofa-submit-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}Verify and sign in</button>
      <div className="flex justify-between text-sm text-[#a1a1aa]">
        <button type="button" onClick={onBack} className="hover:text-[#34d399] py-2" data-testid="twofa-back-button">Use another account</button>
        {!isApp && <button type="button" onClick={resend} className="hover:text-[#34d399] py-2" data-testid="twofa-resend-button">Send a new code</button>}
      </div>
    </form>
  );
}

// "Remember this browser for 30 days" on the password form.
export function RememberBox({ checked, onChange }) {
  return (
    <label className="flex items-center gap-3 text-sm cursor-pointer" data-testid="auth-remember-label">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 accent-[#34d399]" data-testid="auth-remember-checkbox" />Remember this browser for 30 days
    </label>
  );
}

// Referral code from a share link (?ref=CODE) is kept until the account is created.
export function useRefCode(params) {
  const fromUrl = (params.get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (fromUrl) { try { localStorage.setItem('civr.ref', fromUrl); } catch (_) { /* private mode */ } }
  try { return fromUrl || localStorage.getItem('civr.ref') || ''; } catch (_) { return fromUrl; }
}
