import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PhoneOutgoing, Loader2 } from 'lucide-react';
import { api, useApi } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, Spinner, Empty, AudioSelect, KeyPicker, Toggle, ErrorNote } from '../ui';
import { cp } from '../paths';

// Active numbers allowed to place outbound IVR calls for `feature`.
export function useCallerNumbers(feature) {
  const { data, loading } = useApi('/numbers');
  return { loading, all: data?.numbers || [], numbers: (data?.numbers || []).filter(n => n.status === 'active' && n.access[feature]) };
}

export default function QuickCall() {
  const { refreshSummary } = useShell();
  const { numbers, all, loading } = useCallerNumbers('ivrOutbound');
  const { data: au } = useApi('/audio');
  const [f, setF] = useState({ callerId: '', to: '', audioId: '', transferTo: '', activeKeys: ['1'], holdMusic: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  if (loading) return <Spinner />;
  const callerId = f.callerId || numbers[0]?.phoneNumber || '';

  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError(null); setResult(null);
    try { const d = await api('/calls/quick', { method: 'POST', body: { ...f, callerId } }); setResult(d); toast.success(d.dryRun ? 'Validated (preview — not dialed)' : 'Calling now'); refreshSummary(); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div data-testid="quick-call-page">
      <PageHeader label="Outbound" title="Quick IVR call" sub="Call one person, play a message, and connect them to you when they press a key. Billed per minute from your wallet." testid="quick-call-header" />
      {!numbers.length ? (
        <Empty icon={PhoneOutgoing} title="No number can place IVR calls yet" sub={all.length ? 'Quick IVR calls need an active number on the Pro plan or higher. Upgrade one in its Billing tab.' : 'Buy a number on the Pro plan or higher to place IVR calls.'} testid="quick-call-empty">
          <Link to={all.length ? cp('/app/numbers') : cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="quick-call-empty-action">{all.length ? 'My numbers' : 'Buy a number'}</Link>
        </Empty>
      ) : (
        <form onSubmit={go} className="civr-card p-6 max-w-2xl space-y-6" data-testid="quick-call-form">
          <Field label="Call from"><select className="civr-input font-mono" value={callerId} onChange={set('callerId')} data-testid="quick-call-caller-select">{numbers.map(n => <option key={n.phoneNumber}>{n.phoneNumber}</option>)}</select></Field>
          <Field label="Number to call" hint="With country code, e.g. +14155550100."><input className="civr-input font-mono" required value={f.to} onChange={set('to')} placeholder="+14155550100" data-testid="quick-call-to-input" /></Field>
          <Field label="Message to play" hint={!au?.audios?.length ? <Link to={cp('/app/audio')} className="text-[#34d399]">Create audio first →</Link> : null}><AudioSelect value={f.audioId} onChange={set('audioId')} audios={au?.audios} by="id" testid="quick-call-audio-select" /></Field>
          <Field label="Connect to (when they press a key)"><input className="civr-input font-mono" required value={f.transferTo} onChange={set('transferTo')} placeholder="+14155550199" data-testid="quick-call-transfer-input" /></Field>
          <Field label="Keys that connect"><KeyPicker value={f.activeKeys} onChange={set('activeKeys')} testid="quick-call-keys" /></Field>
          <div className="flex items-center justify-between"><span className="text-sm">Hold music while connecting</span><Toggle checked={f.holdMusic} onChange={set('holdMusic')} testid="quick-call-hold-music-toggle" /></div>
          <ErrorNote error={error} testid="quick-call-error" />
          {result && <div className="civr-card p-4 text-sm" data-testid="quick-call-result">{result.dryRun ? result.message : `Call started · billed $${Number(result.rate).toFixed(2)}/min.`}</div>}
          <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="quick-call-submit-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}Place call</button>
        </form>
      )}
    </div>
  );
}
