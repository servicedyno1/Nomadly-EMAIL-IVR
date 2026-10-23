import React, { useState } from 'react';
import { LangSwitcher } from '../i18n';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { toast } from 'sonner';
import { Loader2, Eye, EyeOff, ArrowLeft, Check } from 'lucide-react';
import { api } from '../api';
import { useCivrAuth } from '../AuthContext';
import { Field, ErrorNote } from '../ui';
import { cp } from '../paths';

const NEXT_STEPS = ['Add funds with crypto', 'Pick a number and plan', 'Choose what callers hear'];

// Plan picked on the pricing section (?plan=pro) — kept through sign-up so Buy opens with it selected.
function usePlanParam() {
  const [params] = useSearchParams();
  const plan = (params.get('plan') || '').toLowerCase().replace(/[^a-z]/g, '');
  return { plan, q: plan ? `?plan=${plan}` : '', dest: plan ? cp(`/app/buy?plan=${plan}`) : cp('/app') };
}

// REMINDER: Google sign-in uses the owner's own OAuth client id (GOOGLE_OAUTH_CLIENT_ID, served by /auth/config).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
// One Tap: Google's small "Continue as …" prompt appears on its own for visitors already signed in to Google.
function GoogleButton({ dest, signup }) {
  const { config, setAccount } = useCivrAuth();
  const nav = useNavigate();
  if (!config?.googleClientId) return null;
  return (
    <GoogleOAuthProvider clientId={config.googleClientId}>
      <div className="flex justify-center" data-testid="google-signin-button">
        <GoogleLogin theme="filled_black" shape="pill" width="320" text="continue_with"
          context={signup ? 'signup' : 'signin'} useOneTap use_fedcm_for_prompt cancel_on_tap_outside={false}
          onSuccess={async (r) => {
            try { const d = await api('/auth/google', { method: 'POST', body: { credential: r.credential } }); setAccount(d.account); nav(dest); } catch (e) { toast.error(e.message); }
          }}
          onError={() => toast.error('Google sign-in was cancelled or failed.')} />
      </div>
      <div className="flex items-center gap-4 my-6 text-xs text-[#9a9a9a] font-mono uppercase tracking-widest"><span className="flex-1 h-px bg-[#222]" />or<span className="flex-1 h-px bg-[#222]" /></div>
    </GoogleOAuthProvider>
  );
}

function SidePanel({ signup }) {
  return (
    <div className="hidden lg:flex relative flex-col justify-between p-12 border-r border-[#1a1a1a] overflow-hidden">
      <div className="civr-grain" />
      <Link to={cp()} className="font-display text-3xl font-extrabold" data-testid="auth-logo-link">CLOUD<span className="text-[#34d399]">IVR</span></Link>
      {signup ? (
        <div>
          <div className="civr-label">What happens next</div>
          <ol className="mt-6 flex flex-col gap-6" data-testid="auth-next-steps">
            {NEXT_STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-4 font-display text-3xl font-bold">
                <span className="w-10 h-10 rounded-full border border-[#34d399]/50 text-[#34d399] font-mono text-base flex items-center justify-center shrink-0">{i + 1}</span>{s}
              </li>
            ))}
          </ol>
        </div>
      ) : <p className="font-display text-5xl font-extrabold leading-[0.95] max-w-md">Your numbers, IVR and campaigns — one dashboard.</p>}
      <div className="text-xs text-[#9a9a9a] font-mono uppercase tracking-widest">Free to sign up · No contracts</div>
    </div>
  );
}

function AuthFrame({ title, sub, children, testid, signup }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2" data-testid={testid}>
      <SidePanel signup={signup} />
      <div className="flex flex-col min-h-screen">
        <div className="lg:hidden flex items-center justify-between px-6 h-16 border-b border-[#1a1a1a]">
          <Link to={cp()} className="font-display text-2xl font-extrabold" data-testid="auth-mobile-logo-link">CLOUD<span className="text-[#34d399]">IVR</span></Link>
          <div className="flex items-center gap-1"><LangSwitcher testid="auth-mobile-lang-switcher" /><Link to={cp()} className="flex items-center gap-2 text-sm text-[#a1a1aa] hover:text-white py-3" data-testid="auth-mobile-home-link"><ArrowLeft className="w-4 h-4" />Home</Link></div>
        </div>
        <div className="hidden lg:flex justify-end px-8 pt-6"><LangSwitcher testid="auth-lang-switcher" /></div>
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm civr-rise">
            <h1 className="font-display text-4xl font-extrabold">{title}</h1>
            {sub && <p className="text-sm text-[#a1a1aa] mt-2 mb-8" data-testid="auth-subtitle">{sub}</p>}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, minLength, autoComplete, testid, toggleTestid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input className="civr-input !pr-12" type={show ? 'text' : 'password'} required minLength={minLength} value={value} onChange={onChange} autoComplete={autoComplete} data-testid={testid} />
      <button type="button" onClick={() => setShow(s => !s)} className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-[#9a9a9a] hover:text-white" aria-label={show ? 'Hide password' : 'Show password'} data-testid={toggleTestid}>
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export function AuthPage({ mode }) {
  const signup = mode === 'signup';
  const { setAccount } = useCivrAuth();
  const nav = useNavigate();
  const { plan, q, dest } = usePlanParam();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await api(signup ? '/auth/register' : '/auth/login', { method: 'POST', body: f });
      setAccount(d.account); nav(dest);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthFrame signup={signup} testid={signup ? 'signup-page' : 'login-page'} title={signup ? 'Create your free account' : 'Welcome back'}
      sub={signup ? 'Free to create. Next you add funds with crypto and pick a number.' : 'Sign in to manage your numbers.'}>
      {plan && <div className="flex items-center gap-2 text-sm text-[#34d399] mb-6" data-testid="auth-chosen-plan"><Check className="w-4 h-4" /><span><span className="capitalize">{plan}</span> plan picked — you’ll choose your number next.</span></div>}
      <GoogleButton dest={dest} signup={signup} />
      <form onSubmit={submit} className="space-y-4">
        {signup && <Field label="Name (optional)"><input className="civr-input" value={f.name} onChange={set('name')} placeholder="Jane Doe" autoComplete="name" data-testid="auth-name-input" /></Field>}
        <Field label="Email"><input className="civr-input" type="email" required value={f.email} onChange={set('email')} placeholder="you@company.com" autoComplete="email" data-testid="auth-email-input" /></Field>
        <Field label="Password" hint={signup ? 'At least 8 characters.' : null}>
          <PasswordInput value={f.password} onChange={set('password')} minLength={signup ? 8 : 1} autoComplete={signup ? 'new-password' : 'current-password'} testid="auth-password-input" toggleTestid="auth-password-toggle" />
        </Field>
        <ErrorNote error={error} testid="auth-error" />
        <button className="civr-btn civr-btn-primary w-full" disabled={busy} data-testid="auth-submit-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{signup ? 'Create free account' : 'Sign in'}</button>
      </form>
      <div className="flex justify-between text-sm mt-6 text-[#a1a1aa]">
        {signup ? <Link to={cp(`/login${q}`)} className="hover:text-[#34d399] py-2" data-testid="auth-switch-link">Have an account? Sign in</Link>
          : <><Link to={cp(`/signup${q}`)} className="hover:text-[#34d399] py-2" data-testid="auth-switch-link">Create account</Link><Link to={cp('/forgot')} className="hover:text-[#34d399] py-2" data-testid="auth-forgot-link">Forgot password?</Link></>}
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
      {done ? <div className="civr-card p-6 text-sm" data-testid="forgot-success">{done}</div> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><input className="civr-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" data-testid="forgot-email-input" /></Field>
          <button className="civr-btn civr-btn-primary w-full" disabled={busy} data-testid="forgot-submit-button">Send reset link</button>
        </form>
      )}
      <Link to={cp('/login')} className="block text-sm text-[#a1a1aa] hover:text-[#34d399] mt-6 py-2" data-testid="forgot-back-link">Back to sign in</Link>
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
        <Field label="New password" hint="At least 8 characters.">
          <PasswordInput value={password} onChange={e => setPassword(e.target.value)} minLength={8} autoComplete="new-password" testid="reset-password-input" toggleTestid="reset-password-toggle" />
        </Field>
        <ErrorNote error={error} testid="reset-error" />
        <button className="civr-btn civr-btn-primary w-full" data-testid="reset-submit-button">Save password</button>
      </form>
    </AuthFrame>
  );
}
