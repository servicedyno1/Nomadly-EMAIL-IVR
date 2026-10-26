import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Gift, Loader2, PhoneOutgoing, PhoneCall, Volume2, Hash, Clock } from 'lucide-react';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { ScriptBox, fillScript } from './ScriptBox';
import { cp } from '../../paths';

const STEPS = [[PhoneCall, 'We ring the number you enter from our own number'], [Volume2, 'They hear your script in a natural voice'], [Hash, 'They press 1 and are connected to the phone you choose']];
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
  return (
    <div className="space-y-4" data-testid="quick-trial-done">
      <div className="civr-card p-4 text-sm" data-testid="quick-trial-result">{result.dryRun ? result.message : 'Calling now. If they answer, that uses your free call. No answer? You can try again in a few minutes.'}</div>
      <p className="text-sm text-[#a1a1aa]">Liked it? Get a number on the Pro plan or higher to call with your own caller ID, call several people at once and run Bulk IVR campaigns.</p>
      <Link to={cp('/app/buy?plan=pro')} className="civr-btn civr-btn-primary" data-testid="quick-trial-buy-link">Get your own number</Link>
    </div>
  );
}

// One free Quick IVR call for accounts with no calling number yet (our shared caller ID, connects on key 1).
export function TrialCall({ status, onUsed }) {
  const [f, setF] = useState({ to: '', transferTo: '', script: { text: '', values: {} } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const waiting = !result && status?.inProgress;
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await api('/calls/trial', { method: 'POST', body: { to: f.to, transferTo: f.transferTo, text: fillScript(f.script.text, f.script.values), templateName: f.script.templateName } });
      setResult(d); toast.success(d.dryRun ? 'Validated (preview — not dialed)' : 'Free call started'); onUsed();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} className="civr-card p-6 md:p-8 max-w-3xl space-y-6 !border-[#818cf8]/40" data-testid="quick-trial-form">
      <div className="flex items-start gap-4">
        <span className="w-11 h-11 rounded-xl bg-[#818cf8]/15 grid place-items-center shrink-0"><Gift className="w-5 h-5 text-[#818cf8]" /></span>
        <div><div className="font-display text-2xl font-bold">Your first Quick IVR call is free</div><p className="text-sm text-[#a1a1aa] mt-1">No number or wallet needed. The call shows our shared demo caller ID, not yours.</p></div>
      </div>
      <HowItWorks callerId={status?.callerId} />
      {result ? <Done result={result} /> : <>
        <Field label="Number to call" hint="With country code, e.g. +14155550100."><input className="civr-input font-mono" required value={f.to} onChange={e => setF({ ...f, to: e.target.value })} placeholder="+14155550100" data-testid="quick-trial-to-input" /></Field>
        <ScriptBox value={f.script} onChange={(s) => setF({ ...f, script: s })} testid="quick-trial-script" />
        <Field label="Connect to (when they press 1)" hint="Usually your own phone."><input className="civr-input font-mono" required value={f.transferTo} onChange={e => setF({ ...f, transferTo: e.target.value })} placeholder="+14155550199" data-testid="quick-trial-transfer-input" /></Field>
        <ErrorNote error={error} testid="quick-trial-error" />
        {waiting && <div className="flex items-center gap-2 text-sm text-[#fbbf24]" data-testid="quick-trial-in-progress"><Clock className="w-4 h-4" />Your free call is still going. If nobody answered, try again in about {mins(status.retryAt)} min.</div>}
        <button className="civr-btn civr-btn-primary" disabled={busy || waiting} data-testid="quick-trial-submit-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}Place my free call</button>
      </>}
    </form>
  );
}
