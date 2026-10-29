import React, { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import { ErrorNote } from '../../ui';

// Email + password → 6-digit code emailed to the admin address.
export default function AdminLogin({ onIn }) {
  const [f, setF] = useState({ email: '', password: '', code: '' });
  const [ch, setCh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (!ch) { const r = await api('/admin/login', { method: 'POST', body: { email: f.email, password: f.password } }); setCh(r); if (r.devCode) setF(x => ({ ...x, code: r.devCode })); }
      else { await api('/admin/verify', { method: 'POST', body: { challenge: ch.challenge, code: f.code } }); onIn(); }
    } catch (x) { setErr(x); if (x.code === 'expired') setCh(null); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center px-6" data-testid="admin-login">
      <form onSubmit={submit} className="civr-card p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="w-5 h-5 text-[#818cf8]" />CloudIVR admin</div>
        {!ch ? (
          <>
            <input className="civr-input w-full" type="email" autoComplete="username" placeholder="Admin email" value={f.email} onChange={set('email')} data-testid="admin-login-email" />
            <input className="civr-input w-full" type="password" autoComplete="current-password" placeholder="Password" value={f.password} onChange={set('password')} data-testid="admin-login-password" />
          </>
        ) : (
          <>
            <p className="text-sm text-[#a1a1aa]" data-testid="admin-login-code-sent">We emailed a 6-digit code to {ch.sentTo}. It expires in 10 minutes.</p>
            <input className="civr-input w-full tracking-[0.4em] text-center text-lg" inputMode="numeric" maxLength={6} placeholder="••••••" value={f.code} onChange={set('code')} autoFocus data-testid="admin-login-code" />
          </>
        )}
        <button type="submit" className="civr-btn civr-btn-primary w-full" disabled={busy} data-testid="admin-login-submit">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{ch ? 'Verify & sign in' : 'Continue'}</button>
        {ch && <button type="button" className="text-xs text-[#a1a1aa] hover:underline" onClick={() => setCh(null)} data-testid="admin-login-back">Use a different login</button>}
        <ErrorNote error={err} testid="admin-login-error" />
      </form>
    </div>
  );
}
