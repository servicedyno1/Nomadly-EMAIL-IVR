import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mail, Phone } from 'lucide-react';
import { api } from '../../api';
import { useCivrAuth } from '../../AuthContext';
import { ErrorNote } from '../../ui';

// Accounts without a password first confirm with a code to their current phone/email (10-minute token).
function Confirm({ account, onToken }) {
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <div className="space-y-3 mt-3" data-testid="settings-confirm">
      <p className="text-sm text-[#a1a1aa]">First, confirm it’s you: we’ll send a code to <b className="text-[var(--c-text,#f4f4f5)]">{account.phone || account.email}</b>.</p>
      {sent?.previewCode && <p className="text-xs font-mono text-[#818cf8]" data-testid="settings-confirm-preview-code">Preview: code {sent.previewCode}</p>}
      {sent && <input className="civr-input font-mono tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Code" data-testid="settings-confirm-code" />}
      <ErrorNote error={err} testid="settings-confirm-error" />
      {!sent ? <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} onClick={() => run(async () => setSent(await api('/account/confirm/start', { method: 'POST', body: {} })))} data-testid="settings-confirm-send">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send me a code</button>
        : <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || code.length < 3} onClick={() => run(async () => onToken((await api('/account/confirm/verify', { method: 'POST', body: { challenge: sent.challenge, code } })).confirmToken))} data-testid="settings-confirm-verify">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm</button>}
    </div>
  );
}

// Add a phone (or, for phone accounts, an email) to the account. Needs the password (or a confirm code) first.
function AddContact({ kind, account, onDone, onCancel }) {
  const [token, setToken] = useState(null);
  const [password, setPassword] = useState('');
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const send = () => run(async () => { setSent(await api(`/account/${kind}/start`, { method: 'POST', body: { [kind]: value, ...(account.hasPassword ? { password } : { confirmToken: token }) } })); setCode(''); });
  const verify = () => run(async () => { const d = await api(`/account/${kind}/verify`, { method: 'POST', body: { challenge: sent.challenge, code } }); onDone(d.account); });
  const t = `settings-add-${kind}`;
  if (!account.hasPassword && !token) return <><Confirm account={account} onToken={setToken} /><button type="button" className="civr-btn civr-btn-ghost civr-btn-sm mt-2" onClick={onCancel} data-testid={`${t}-cancel`}>Cancel</button></>;
  return (
    <div className="space-y-3 mt-3" data-testid={t}>
      {!sent && account.hasPassword && <input className="civr-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" data-testid={`${t}-password`} />}
      {!sent ? <input className="civr-input" type={kind === 'email' ? 'email' : 'tel'} value={value} onChange={e => setValue(e.target.value)} placeholder={kind === 'email' ? 'you@company.com' : '+1 415 555 0100'} autoComplete={kind === 'email' ? 'email' : 'tel'} data-testid={`${t}-input`} />
        : <>
          <p className="text-sm text-[#a1a1aa]">{kind === 'email' ? 'We emailed a code to' : 'We texted a code to'} <b className="text-[var(--c-text,#f4f4f5)]">{value}</b>.</p>
          {sent.previewCode && <p className="text-xs font-mono text-[#818cf8]" data-testid={`${t}-preview-code`}>Preview: code {sent.previewCode}</p>}
          <input className="civr-input font-mono tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Code" data-testid={`${t}-code`} />
        </>}
      <ErrorNote error={err} testid={`${t}-error`} />
      <div className="flex flex-wrap gap-2">
        {!sent ? <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || value.trim().length < 5 || (account.hasPassword && !password)} onClick={send} data-testid={`${t}-send`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{kind === 'email' ? 'Email me a code' : 'Text me a code'}</button>
          : <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || code.length < 3} onClick={verify} data-testid={`${t}-verify`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm</button>}
        {sent && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={send} data-testid={`${t}-resend`}>Send again</button>}
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onCancel} data-testid={`${t}-cancel`}>Cancel</button>
      </div>
    </div>
  );
}

function Row({ icon: I, label, value, hint, testid, canAdd, kind }) {
  const { account, setAccount } = useCivrAuth();
  const [open, setOpen] = useState(false);
  const done = (acc) => { setAccount(acc); setOpen(false); toast.success(kind === 'email' ? 'Email added' : 'Phone added: you can now sign in with a code'); };
  return (
    <div className="py-3 border-b border-[#1f1f1f] last:border-0">
      <div className="flex items-center gap-3">
        <I className="w-4 h-4 text-[#a1a1aa] shrink-0" />
        <div className="flex-1 min-w-0"><div className="text-sm font-semibold">{label}</div><div className="text-sm text-[#a1a1aa] truncate" data-testid={testid}>{value || 'Not added'}</div>{hint && <div className="text-xs text-[#a1a1aa] mt-0.5">{hint}</div>}</div>
        {canAdd && !open && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setOpen(true)} data-testid={`${testid}-add`}>{value ? 'Change' : 'Add'}</button>}
      </div>
      {open && <AddContact kind={kind} account={account} onDone={done} onCancel={() => setOpen(false)} />}
    </div>
  );
}

export function SignInMethods({ account }) {
  return (
    <div className="civr-card p-6" data-testid="settings-signin-card">
      <div className="font-display text-2xl font-bold mb-2">Sign-in methods</div>
      <Row icon={Mail} kind="email" label="Email" value={account.email} testid="settings-email" canAdd={!account.email} hint={account.email ? (account.hasPassword ? 'Sign in with email and password.' : 'Set a password in the “Set a password” card below to use it.') : 'Add one for receipts and to sign in with email.'} />
      <Row icon={Phone} kind="phone" label="Phone number" value={account.phone} testid="settings-phone" canAdd hint={account.phone ? 'Sign in with a code texted to this number.' : 'Add one to sign in with a code instead of a password.'} />
    </div>
  );
}
