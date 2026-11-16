import React, { useState } from 'react';
import { CallsFrom } from './SipCallerId';
import { Link } from 'react-router-dom';
import { ask } from '../../i18n';
import { toast } from 'sonner';
import { Copy, Eye, RefreshCw, Phone, PhoneOutgoing, Loader2, KeyRound, Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, enc } from '../../api';
import { useShell } from '../../Shell';
import { usePrivacy } from '../../privacy';
import { cp } from '../../paths';
import { ExtraSipLogins } from './ExtraSip';
import { SipQr } from './SipQr';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Copied'));

// Opens a 90 s window: dial anything from the softphone, we catch the call for free and report in the Inbox.
function TestOutbound({ num }) {
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  React.useEffect(() => { if (left <= 0) return undefined; const t = setTimeout(() => setLeft(l => l - 1), 1000); return () => clearTimeout(t); }, [left]);
  const go = async () => {
    setBusy(true);
    try { const d = await api(`/numbers/${enc(num.phoneNumber)}/test-sip`, { method: 'POST' }); setMsg(d.message); if (!d.dryRun) setLeft(d.seconds || 90); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 lg:col-span-3" data-testid="sip-test-outbound-card">
      <div className="font-display text-2xl font-bold">Test outbound SIP</div>
      <p className="text-sm text-[#a1a1aa] mt-1 mb-4">Checks that calls from your softphone reach us with these credentials. Free — the test call is hung up before it rings anyone.</p>
      <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={go} disabled={busy || left > 0} data-testid="sip-test-outbound-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}{left > 0 ? `Waiting for your call… ${left}s` : 'Start 90-second test'}</button>
      {msg && <div className="text-sm text-[#d4d4d8] mt-3" data-testid="sip-test-outbound-result">{msg}</div>}
    </div>
  );
}

// One click: signs in to our SIP server with this number's login and says whether the problem is ours or the app's.
const CHECK_TONE = { connected: 'border-[#065f46] bg-[#022c22] text-[#6ee7b7]', ready_not_connected: 'border-[#78350f] bg-[#2a1a05] text-[#fcd34d]', locked: 'border-[#78350f] bg-[#2a1a05] text-[#fcd34d]' };
export function SipCheck({ num, prefix = 'sip' }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const go = async () => {
    setBusy(true);
    try { setR(await api(`/numbers/${enc(num.phoneNumber)}/sip/check`, { method: 'POST' })); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 lg:col-span-3" data-testid={`${prefix}-check-card`}>
      <div className="font-display text-2xl font-bold">Test my SIP registration</div>
      <p className="text-sm text-[#a1a1aa] mt-1 mb-4">Softphone not connecting? We sign in to our server with this number’s login and tell you whether the line is ready and whether any app is signed in right now.</p>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={go} disabled={busy} data-testid={`${prefix}-check-button`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}{busy ? 'Testing…' : r ? 'Test again' : 'Run test'}</button>
      {r && (
        <div className={`mt-4 rounded-lg border p-4 ${CHECK_TONE[r.code] || 'border-[#7f1d1d] bg-[#2a0a0a] text-[#fca5a5]'}`} data-testid={`${prefix}-check-result`} data-code={r.code}>
          <div className="flex items-center gap-2 font-semibold" data-testid={`${prefix}-check-title`}>{r.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}{r.title}</div>
          <p className="text-sm text-[#d4d4d8] mt-2" data-testid={`${prefix}-check-message`}>{r.message}</p>
          {r.tips?.length > 0 && <ol className="list-decimal pl-5 mt-3 space-y-1 text-sm text-[#d4d4d8]" data-testid={`${prefix}-check-tips`}>{r.tips.map((t, i) => <li key={i}>{t}</li>)}</ol>}
          {r.lastSeenAt && r.code !== 'connected' && <div className="text-xs text-[#a1a1aa] mt-3" data-testid={`${prefix}-check-last-seen`}>{`Last signed in: ${new Date(r.lastSeenAt).toLocaleString()}${r.lastApp ? ` (${r.lastApp})` : ''}`}</div>}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, id, secret }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-[#a1a1aa] shrink-0">{k}</span>
      <span className="flex items-center gap-1.5 min-w-0"><code className="text-sm text-[#f3f4f6] truncate" data-testid={id} data-no-translate>{v}</code>
        {v && !secret && <button type="button" onClick={() => copy(v)} className="w-10 h-10 -my-2 flex items-center justify-center rounded-md text-[#a1a1aa] hover:text-[#818cf8] hover:bg-white/5 shrink-0" aria-label={`Copy ${k}`} data-testid={`${id}-copy`}><Copy className="w-3.5 h-3.5" /></button>}</span>
    </div>
  );
}

// Username / password / server for one number, with reveal + reset. `prefix` keeps test ids unique on the SIP page.
export function SipCredentials({ num, prefix = 'sip', heading, className = 'lg:col-span-2' }) {
  const pv = usePrivacy();
  const [creds, setCreds] = useState(null);
  const [busy, setBusy] = useState(false);
  const reveal = async () => { try { setCreds(await api(`/numbers/${enc(num.phoneNumber)}/sip`)); } catch (e) { toast.error(e.message); } };
  const reset = async () => {
    if (!(await ask('Create new SIP credentials? Softphones using the old ones will stop working.', { danger: true, ok: 'Create new credentials' }))) return;
    setBusy(true);
    try { const c = await api(`/numbers/${enc(num.phoneNumber)}/sip/reset`, { method: 'POST' }); setCreds({ ...creds, ...c }); toast.success('New SIP credentials ready'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const hide = pv.on;
  return (
    <div className={`civr-card p-6 ${className}`} data-testid={`${prefix}-credentials-card`}>
      <div className="flex items-start gap-3">
        <KeyRound className="w-5 h-5 text-[#818cf8] mt-1 shrink-0" />
        <div className="min-w-0">
          <div className="font-display text-2xl font-bold">{heading || 'SIP credentials'}</div>
          <p className="text-sm text-[#a1a1aa] mt-1">Use these in any softphone (Zoiper, Linphone, MicroSIP) to call and receive calls on this number.</p>
        </div>
      </div>
      <div className="divide-y divide-[#262626] mt-4">
        <Row k="Username" v={hide ? '••••••' : (creds?.username || num.sipUsername)} id={`${prefix}-username`} secret={hide} />
        <Row k="Password" v={creds && !hide ? creds.password : '••••••••••'} id={`${prefix}-password`} secret={!creds || hide} />
        <Row k="Server (domain)" v={num.sipDomain} id={`${prefix}-domain`} />
        <Row k="Port" v="5060 (UDP/TCP) · 5061 (TLS)" id={`${prefix}-port`} secret />
        <Row k="STUN" v={`Off (or ${num.sipDomain}:3478)`} id={`${prefix}-stun`} secret />
      </div>
      <div className="flex flex-wrap items-start gap-2 mt-5">
        {!creds && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={reveal} data-testid={`${prefix}-reveal-button`}><Eye className="w-4 h-4" />Show password</button>}
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={reset} disabled={busy} data-testid={`${prefix}-reset-button`}><RefreshCw className="w-4 h-4" />New credentials</button>
        <SipQr key={creds?.username ? `${creds.username}:${creds.password}` : 'q'} num={num} prefix={prefix} />
      </div>
    </div>
  );
}

export function BrowserPhoneCard() {
  const { openPhone } = useShell();
  return (
    <div className="civr-card p-6" data-testid="sip-browser-phone-card">
      <div className="font-display text-2xl font-bold">Browser phone</div>
      <p className="text-sm text-[#a1a1aa] mt-1 mb-6">Call from this tab with this number’s SIP line.</p>
      <button type="button" className="civr-btn civr-btn-primary" onClick={openPhone} data-testid="sip-open-softphone-button"><Phone className="w-4 h-4" />Open phone</button>
    </div>
  );
}

export default function SipTab({ num }) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <SipCredentials num={num} />
      <BrowserPhoneCard />
      <SipCheck num={num} />
      <TestOutbound num={num} />
      <CallsFrom num={num} card testid="sip-main-calls-from" />
      <ExtraSipLogins num={num} />
      <div className="lg:col-span-3 text-sm text-[#a1a1aa]">All your numbers’ SIP logins and a setup guide: <Link to={cp('/app/sip')} className="text-[#818cf8] hover:underline" data-testid="sip-tab-all-link">SIP & softphones</Link></div>
    </div>
  );
}
