import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Gift, Loader2, PhoneOutgoing } from 'lucide-react';
import { api } from '../../api';
import { Field, ErrorNote } from '../../ui';
import { ScriptBox, fillScript } from './ScriptBox';
import { cp } from '../../paths';

// One free Quick IVR call for accounts with no calling number yet (shared demo caller ID, transfer on key 1).
export function TrialCall({ onUsed }) {
  const [f, setF] = useState({ to: '', transferTo: '', script: { text: '', values: {} } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await api('/calls/trial', { method: 'POST', body: { to: f.to, transferTo: f.transferTo, text: fillScript(f.script.text, f.script.values), templateName: f.script.templateName } });
      setResult(d); toast.success(d.dryRun ? 'Validated (preview — not dialed)' : 'Free call started'); onUsed();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} className="civr-card p-6 max-w-2xl space-y-6" data-testid="quick-trial-form">
      <div className="flex items-start gap-3"><Gift className="w-6 h-6 text-[#34d399] shrink-0" />
        <div><div className="font-display text-2xl font-bold">Try one call free</div><p className="text-sm text-[#a1a1aa] mt-1">You don’t have a calling number yet, so your first Quick IVR call is on us. It shows our demo caller ID and connects on key 1.</p></div></div>
      <Field label="Number to call" hint="With country code, e.g. +14155550100."><input className="civr-input font-mono" required value={f.to} onChange={e => setF({ ...f, to: e.target.value })} placeholder="+14155550100" data-testid="quick-trial-to-input" /></Field>
      <ScriptBox value={f.script} onChange={(s) => setF({ ...f, script: s })} testid="quick-trial-script" />
      <Field label="Connect to (when they press 1)"><input className="civr-input font-mono" required value={f.transferTo} onChange={e => setF({ ...f, transferTo: e.target.value })} placeholder="+14155550199" data-testid="quick-trial-transfer-input" /></Field>
      <ErrorNote error={error} testid="quick-trial-error" />
      {result ? <>
        <div className="civr-card p-4 text-sm" data-testid="quick-trial-result">{result.dryRun ? result.message : 'Free call started.'}</div>
        <p className="text-sm text-[#a1a1aa]">That was your free call. Get a number on the Pro plan or higher to keep calling with your own caller ID.</p>
        <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="quick-trial-buy-link">Buy a number</Link>
      </> : <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="quick-trial-submit-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}Place free call</button>}
    </form>
  );
}
