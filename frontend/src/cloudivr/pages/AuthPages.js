import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { api } from '../api';
import { useCivrAuth } from '../AuthContext';
import { Field, ErrorNote } from '../ui';
import { cp } from '../paths';

// REMINDER: Google sign-in uses the owner's own OAuth client id (GOOGLE_OAUTH_CLIENT_ID, served by /auth/config).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
function GoogleButton() {
  const { config, setAccount } = useCivrAuth();
  const nav = useNavigate();
  if (!config?.googleClientId) return null;
  return (
    <GoogleOAuthProvider clientId={config.googleClientId}>
      <div className="flex justify-center" data-testid="google-signin-button">
        <GoogleLogin theme="filled_black" shape="pill" width="320"
          onSuccess={async (r) => {
            try { const d = await api('/auth/google', { method: 'POST', body: { credential: r.credential } }); setAccount(d.account); nav(cp('/app')); } catch (e) { toast.error(e.message); }
          }}
          onError={() => toast.error('Google sign-in was cancelled or failed.')} />
      </div>
      <div className="flex items-center gap-3 my-6 text-xs text-[#555] font-mono uppercase tracking-widest"><span className="flex-1 h-px bg-[#222]" />or<span className="flex-1 h-px bg-[#222]" /></div>
    </GoogleOAuthProvider>
  );
}

function AuthFrame({ title, sub, children, testid }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2" data-testid={testid}>
      <div className="hidden lg:flex relative flex-col justify-between p-12 border-r border-[#1a1a1a] overflow-hidden">
        <div className="civr-grain" />
        <Link to={cp()} className="font-display text-3xl font-extrabold" data-testid="auth-logo-link">CLOUD<span className="text-[#34d399]">IVR</span></Link>
        <div>
          <div className="civr-label">Speechcue network</div>
          <p className="font-display text-5xl font-extrabold leading-[0.95] mt-4 max-w-md">Your numbers, IVR and campaigns — one dashboard.</p>
        </div>
        <div className="text-xs text-[#555] font-mono">Separate from Telegram bot accounts.</div>
      </div>
      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm civr-rise">
          <h1 className="font-display text-4xl font-extrabold">{title}</h1>
          {sub && <p className="text-sm text-[#888] mt-2 mb-8">{sub}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function AuthPage({ mode }) {
  const signup = mode === 'signup';
  const { setAccount } = useCivrAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await api(signup ? '/auth/register' : '/auth/login', { method: 'POST', body: f });
      setAccount(d.account); nav(cp('/app'));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthFrame testid={signup ? 'signup-page' : 'login-page'} title={signup ? 'Create your account' : 'Welcome back'} sub={signup ? 'Web account for the CloudIVR dashboard.' : 'Sign in to manage your numbers.'}>
      <GoogleButton />
      <form onSubmit={submit} className="space-y-4">
        {signup && <Field label="Name"><input className="civr-input" value={f.name} onChange={set('name')} placeholder="Jane Doe" data-testid="auth-name-input" /></Field>}
        <Field label="Email"><input className="civr-input" type="email" required value={f.email} onChange={set('email')} placeholder="you@company.com" data-testid="auth-email-input" /></Field>
        <Field label="Password" hint={signup ? 'At least 8 characters.' : null}><input className="civr-input" type="password" required minLength={signup ? 8 : 1} value={f.password} onChange={set('password')} data-testid="auth-password-input" /></Field>
        <ErrorNote error={error} testid="auth-error" />
        <button className="civr-btn civr-btn-primary w-full" disabled={busy} data-testid="auth-submit-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <div className="flex justify-between text-sm mt-6 text-[#888]">
        {signup ? <Link to={cp('/login')} className="hover:text-[#34d399]" data-testid="auth-switch-link">Have an account? Sign in</Link>
          : <><Link to={cp('/signup')} className="hover:text-[#34d399]" data-testid="auth-switch-link">Create account</Link><Link to={cp('/forgot')} className="hover:text-[#34d399]" data-testid="auth-forgot-link">Forgot password?</Link></>}
      </div>
    </AuthFrame>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const d = await api('/auth/forgot', { method: 'POST', body: { email } }); setDone(d.message); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <AuthFrame testid="forgot-page" title="Reset password" sub="We’ll email you a link that works for 30 minutes.">
      {done ? <div className="civr-card p-5 text-sm" data-testid="forgot-success">{done}</div> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><input className="civr-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} data-testid="forgot-email-input" /></Field>
          <button className="civr-btn civr-btn-primary w-full" disabled={busy} data-testid="forgot-submit-button">Send reset link</button>
        </form>
      )}
      <Link to={cp('/login')} className="block text-sm text-[#888] hover:text-[#34d399] mt-6" data-testid="forgot-back-link">Back to sign in</Link>
    </AuthFrame>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const { setAccount } = useCivrAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    try { const d = await api('/auth/reset', { method: 'POST', body: { token: params.get('token'), password } }); setAccount(d.account); toast.success('Password updated'); nav(cp('/app')); } catch (err) { setError(err); }
  };
  return (
    <AuthFrame testid="reset-page" title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" hint="At least 8 characters."><input className="civr-input" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} data-testid="reset-password-input" /></Field>
        <ErrorNote error={error} testid="reset-error" />
        <button className="civr-btn civr-btn-primary w-full" data-testid="reset-submit-button">Save password</button>
      </form>
    </AuthFrame>
  );
}
