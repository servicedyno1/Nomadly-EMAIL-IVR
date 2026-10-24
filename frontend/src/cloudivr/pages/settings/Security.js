import React, { useState } from 'react';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Smartphone, Mail, Copy } from 'lucide-react';
import { api, useApi, day } from '../../api';
import { Field } from '../../ui';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

function BackupCodes({ codes, onClose }) {
  return (
    <div className="space-y-3" data-testid="twofa-backup-codes">
      <div className="text-sm">Two-step sign-in is on. Save these backup codes somewhere safe — each one works once if you lose your phone or email.</div>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm">{codes.map((c, i) => <div key={c} className="civr-card px-3 py-2" data-testid={`twofa-backup-code-${i}`}>{c}</div>)}</div>
      <div className="flex gap-2"><button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => copy(codes.join('\n'))} data-testid="twofa-backup-copy"><Copy className="w-4 h-4" />Copy all</button>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" onClick={onClose} data-testid="twofa-backup-done">I saved them</button></div>
    </div>
  );
}

function Setup({ method, onEnabled, onCancel }) {
  const [info, setInfo] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); try { setInfo(await api('/auth/2fa/setup', { method: 'POST', body: { method } })); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const enable = async (e) => { e.preventDefault(); setBusy(true); try { onEnabled(await api('/auth/2fa/enable', { method: 'POST', body: { method, code } })); } catch (err) { toast.error(err.message); } finally { setBusy(false); } };
  if (!info) return <div className="flex gap-2"><button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} onClick={start} data-testid={`twofa-start-${method}`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{method === 'totp' ? 'Show QR code' : 'Email me a code'}</button><button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onCancel} data-testid="twofa-cancel">Cancel</button></div>;
  return (
    <form onSubmit={enable} className="space-y-4" data-testid={`twofa-setup-${method}`}>
      {method === 'totp' ? <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="bg-white p-3 rounded-xl shrink-0" data-testid="twofa-qr"><QRCode value={info.otpauthUrl} size={140} /></div>
        <div className="text-sm space-y-2"><div>1. Scan this with Google Authenticator, Microsoft Authenticator or Authy.</div><div>2. Or type this key: <button type="button" onClick={() => copy(info.secret)} className="font-mono text-xs break-all text-[#34d399]" data-testid="twofa-secret">{info.secret}</button></div><div>3. Enter the 6-digit code it shows.</div></div>
      </div> : <div className="text-sm">We sent a 6-digit code to <b>{info.sentTo}</b>.{info.previewCode && <span className="text-[#fbbf24]" data-testid="twofa-setup-preview-code"> Preview mode — code {info.previewCode}</span>}</div>}
      <Field label="Code"><input className="civr-input font-mono !w-48 tracking-[0.3em]" inputMode="numeric" required value={code} onChange={e => setCode(e.target.value)} placeholder="123456" data-testid="twofa-setup-code-input" /></Field>
      <div className="flex gap-2"><button className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} data-testid="twofa-enable-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Turn on</button><button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onCancel} data-testid="twofa-setup-cancel">Cancel</button></div>
    </form>
  );
}

function TurnOff({ hasPassword, reload }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const off = async (e) => { e.preventDefault(); setBusy(true); try { await api('/auth/2fa/disable', { method: 'POST', body: hasPassword ? { password: v } : { code: v } }); toast.success('Two-step sign-in turned off'); reload(); } catch (err) { toast.error(err.message); } finally { setBusy(false); } };
  const forget = async () => { try { await api('/auth/2fa/forget-browsers', { method: 'POST', body: {} }); toast.success('Remembered browsers will ask for a code again'); } catch (err) { toast.error(err.message); } };
  return (
    <form onSubmit={off} className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2"><input type={hasPassword ? 'password' : 'text'} className="civr-input sm:!w-56" required value={v} onChange={e => setV(e.target.value)} placeholder={hasPassword ? 'Your password' : 'Current code'} data-testid="twofa-disable-input" />
        <button className="civr-btn civr-btn-danger civr-btn-sm" disabled={busy} data-testid="twofa-disable-button">Turn off</button></div>
      <button type="button" onClick={forget} className="text-xs text-[#a1a1aa] hover:text-[#34d399]" data-testid="twofa-forget-browsers">Forget all remembered browsers</button>
    </form>
  );
}

export function Security({ account, refresh }) {
  const { data, reload } = useApi('/auth/2fa');
  const [method, setMethod] = useState(null);
  const [codes, setCodes] = useState(null);
  const onEnabled = (d) => { setCodes(d.backupCodes); setMethod(null); reload(); refresh(); };
  return (
    <div className="civr-card p-6 space-y-5 lg:col-span-2" data-testid="settings-security-card">
      <div className="flex items-center gap-3"><ShieldCheck className="w-6 h-6 text-[#34d399]" /><div className="font-display text-2xl font-bold">Two-step sign-in</div>
        {data && <span className={`civr-pill ${data.enabled ? 'civr-pill-on' : ''}`} data-testid="twofa-status">{data.enabled ? `On · ${data.method === 'totp' ? 'authenticator app' : 'email code'}` : 'Off'}</span>}</div>
      <p className="text-sm text-[#a1a1aa]">After your password we ask for a 6-digit code, so nobody else can get into your numbers and wallet. Tick “Remember this browser for 30 days” when you sign in to skip the code on your own device.</p>
      {codes ? <BackupCodes codes={codes} onClose={() => setCodes(null)} />
        : data?.enabled ? <><div className="text-xs text-[#a1a1aa]" data-testid="twofa-details">On since {day(data.enabledAt)} · {data.backupCodesLeft} backup codes left</div><TurnOff hasPassword={account.hasPassword} reload={() => { reload(); refresh(); }} /></>
        : method ? <Setup method={method} onEnabled={onEnabled} onCancel={() => setMethod(null)} />
        : <div className="grid sm:grid-cols-2 gap-3">
          <button type="button" onClick={() => setMethod('totp')} className="civr-card p-4 text-left flex gap-3 hover:border-[#34d399]/50" data-testid="twofa-choose-totp"><Smartphone className="w-5 h-5 text-[#34d399] shrink-0" /><div><div className="font-semibold">Authenticator app</div><div className="text-xs text-[#a1a1aa] mt-1">Most secure. Works offline.</div></div></button>
          <button type="button" onClick={() => setMethod('email')} className="civr-card p-4 text-left flex gap-3 hover:border-[#34d399]/50" data-testid="twofa-choose-email"><Mail className="w-5 h-5 text-[#34d399] shrink-0" /><div><div className="font-semibold">Code by email</div><div className="text-xs text-[#a1a1aa] mt-1">We email a code each time you sign in.</div></div></button>
        </div>}
    </div>
  );
}
