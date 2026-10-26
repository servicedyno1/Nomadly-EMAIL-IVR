import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Gift, Loader2, PhoneOutgoing, PhoneCall, Volume2, Hash, Clock } from 'lucide-react';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { ScriptBox, fillScript } from './ScriptBox';
import { cp } from '../../paths';
import { OtpLive, OtpHowTo } from './Otp';

const STEPS = [[PhoneCall, 'We ring the number you enter from our own number'], [Volume2, 'They hear your script in a natural voice'], [Hash, 'They press 1 to reach your phone, or type a code you accept or decline']];
const MODES = [['transfer', 'Connect on key 1'], ['otp', 'Collect a code']];
const mins = (at) => Math.max(1, Math.ceil((new Date(at).getTime() - Date.now()) / 60000));

function HowItWorks({ callerId }) {
  return (
    <ol className="grid sm:grid-cols-3 gap-3" data-testid="quick-trial-steps">
      {STEPS.map(([Icon, t], i) => (
        <li key={t} className="rounded-xl border border-[#222] p-4 text-sm" data-testid={`quick-trial-step-${i + 1}`}>
          <Icon className="w-4 h-4 text-[#818cf8]" />
          <div className="mt-2 text-[#d4d4d8]">{t}</div>
          {i === 0 && callerId && <div className="mt-1 font-mono text-xs text-[#a1a1aa]" data-testid="quick-trial-caller-id" data-no-translate>{callerId}</div>}
        </li>
      ))}
    </ol>
  );
}

function Done({ result }) {
  const live = result.mode === 'otp' ? (result.results || []).find(r => r.callControlId) : null;
  return (
    <div className="space-y-4" data-testid="quick-trial-done">
      <div className="civr-card p-4 text-sm" data-testid="quick-trial-result">{result.dryRun ? result.message : 'Calling now. If they answer, that uses your free call. No answer? You can try again in a few minutes.'}</div>
      {live && <OtpLive ccid={live.callControlId} testid="quick-trial-otp-live" />}
      <p className="text-sm text-[#a1a1aa]">Liked it? Get a number on the Pro plan or higher to call with your own caller ID, call up to 10 people at once, schedule calls and run Bulk IVR campaigns. Business adds custom accept / decline messages and redial.</p>
      <Link to={cp('/app/buy?plan=pro')} className="civr-btn civr-btn-primary" data-testid="quick-trial-buy-link">Get your own number</Link>
    </div>
  );
}

// One free Quick IVR call for accounts with no calling number yet (our shared caller ID, connects on key 1).
export function TrialCall({ status, onUsed }) {
  const [f, setF] = useState({ to: '', mode: 'transfer', length: 6, transferTo: '', script: { text: '', values: {} } });
  const otp = f.mode === 'otp';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const waiting = !result && status?.inProgress;
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await api('/calls/trial', { method: 'POST', body: { to: f.to, mode: f.mode, otp: otp ? { length: f.length } : undefined, transferTo: f.transferTo, text: fillScript(f.script.text, f.script.values), templateName: f.script.templateName } });
      setResult(d); toast.success(d.dryRun ? 'Validated (preview — not dialed)' : 'Free call started'); onUsed();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} className="civr-card p-6 md:p-8 max-w-3xl space-y-6 !border-[#818cf8]/40" data-testid="quick-trial-form">
      <div className="flex items-start gap-4">
        <span className="w-11 h-11 rounded-xl bg-[#818cf8]/15 grid place-items-center shrink-0"><Gift className="w-5 h-5 text-[#818cf8]" /></span>
        <div><div className="font-display text-2xl font-bold" data-testid="quick-trial-title">{result ? 'Your free Quick IVR call' : 'Your first Quick IVR call is free'}</div><p className="text-sm text-[#a1a1aa] mt-1">No number or wallet needed. The call shows our shared demo caller ID, not yours.</p></div>
      </div>
      <HowItWorks callerId={status?.callerId} />
      {result ? <Done result={result} /> : <>
        <Field label="Number to call" hint="With country code, e.g. +14155550100."><input className="civr-input font-mono" required value={f.to} onChange={e => setF({ ...f, to: e.target.value })} placeholder="+14155550100" data-testid="quick-trial-to-input" /></Field>
        <ScriptBox value={f.script} onChange={(s) => setF({ ...f, script: s })} testid="quick-trial-script" />
        <Field label="When they press 1">
          <div className="flex flex-wrap gap-2">{MODES.map(([m, l]) => <button key={m} type="button" onClick={() => setF({ ...f, mode: m })} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-9 ${f.mode === m ? 'civr-pill-on' : ''}`} data-testid={`quick-trial-mode-${m}`}>{l}</button>)}</div>
        </Field>
        {otp && <div className="space-y-4" data-testid="quick-trial-otp-fields">
          <OtpHowTo />
          <Field label="Code length"><select className="civr-input !w-40" value={f.length} onChange={e => setF({ ...f, length: Number(e.target.value) })} data-testid="quick-trial-otp-length">{[4, 5, 6, 8].map(n => <option key={n} value={n}>{`${n} digits`}</option>)}</select></Field>
        </div>}
        <Field label={otp ? 'Connect them after you accept (optional)' : 'Connect to (when they press 1)'} hint={otp ? 'Leave empty to end the call after the confirmation.' : 'Usually your own phone.'}><input className="civr-input font-mono" required={!otp} value={f.transferTo} onChange={e => setF({ ...f, transferTo: e.target.value })} placeholder="+14155550199" data-testid="quick-trial-transfer-input" /></Field>
        <ErrorNote error={error} testid="quick-trial-error" />
        {waiting && <div className="flex items-center gap-2 text-sm text-[#fbbf24]" data-testid="quick-trial-in-progress"><Clock className="w-4 h-4" />Your free call is still going. If nobody answered, try again in about {mins(status.retryAt)} min.</div>}
        <button className="civr-btn civr-btn-primary" disabled={busy || waiting} data-testid="quick-trial-submit-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}Place my free call</button>
      </>}
    </form>
  );
}
