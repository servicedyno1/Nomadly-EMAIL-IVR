import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PhoneOutgoing, Loader2, Lock } from 'lucide-react';
import { api, useApi, playUrl } from '../api';
import { useShell } from '../Shell';
import { PageHeader, Field, Spinner, Empty, AudioSelect, KeyPicker, Toggle, ErrorNote } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { DateTimePicker } from '../DateTimePicker';
import { useVoices, VoiceSelect } from '../VoiceMaker';
import { ScriptBox, fillScript } from './quick/ScriptBox';
import { MenuBuilder, menuToApi } from './quick/MenuBuilder';
import { RecentCalls, ScheduledCalls, MenuStats, Presets } from './quick/Side';
import { TrialCall } from './quick/Trial';

// Active numbers allowed to place outbound IVR calls for `feature`.
export function useCallerNumbers(feature) {
  const { data, loading } = useApi('/numbers');
  return { loading, all: data?.numbers || [], numbers: (data?.numbers || []).filter(n => n.status === 'active' && n.access[feature]) };
}

const EMPTY = { callerId: '', targets: '', source: 'script', script: { templateKey: '', text: '', values: {} }, audioId: '', voice: '', mode: 'transfer', transferTo: '', activeKeys: ['1'], otp: { length: 6, confirmMsg: '', rejectMsg: '' }, menu: [], holdMusic: false, scheduleAt: '' };
const MODES = [['transfer', 'Connect on a key'], ['otp', 'Collect a code (OTP)'], ['menu', 'Route each key']];
const Pill = ({ on, onClick, children, testid, locked }) => <button type="button" onClick={onClick} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-9 ${on ? 'civr-pill-on' : ''}`} data-testid={testid}>{locked && <Lock className="w-3 h-3" />}{children}</button>;

function toBody(f, callerId) {
  const msg = f.source === 'audio' ? { audioId: f.audioId } : { text: fillScript(f.script.text, f.script.values), voice: f.voice || undefined, templateName: f.script.templateName || 'Custom script' };
  const action = f.mode === 'otp' ? { otp: f.otp } : f.mode === 'menu' ? { menu: menuToApi(f.menu) } : { transferTo: f.transferTo, activeKeys: f.activeKeys };
  return { callerId, targets: f.targets, holdMusic: f.holdMusic, mode: f.mode === 'otp' ? 'otp' : 'transfer', ...msg, ...action, ...(f.scheduleAt ? { scheduleAt: new Date(f.scheduleAt).toISOString() } : {}) };
}

function Recent({ onPick }) {
  const { data } = useApi('/calls/recent');
  const pv = usePrivacy();
  if (!data?.numbers?.length) return null;
  return <div className="flex flex-wrap gap-1.5 mt-2" data-testid="quick-recent-numbers">{data.numbers.map((n, i) => <button key={n} type="button" onClick={() => onPick(n)} className="civr-pill cursor-pointer font-mono !normal-case" data-testid={`quick-recent-${i}`}>{pv.phone(n)}</button>)}</div>;
}

function Message({ f, set, audios, reloadAudio }) {
  const { voices, def, ready } = useVoices();
  useEffect(() => { if (ready && !f.voice) set({ voice: def.voice }); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><Pill on={f.source === 'script'} onClick={() => set({ source: 'script' })} testid="quick-source-script">Script / template</Pill><Pill on={f.source === 'audio'} onClick={() => set({ source: 'audio' })} testid="quick-source-audio">Audio library</Pill></div>
      {f.source === 'script' ? <>
        <ScriptBox value={f.script} onChange={(s) => set({ script: s, ...(s.activeKeys ? { activeKeys: s.activeKeys } : {}) })} onAudio={(a) => { reloadAudio(); set({ source: 'audio', audioId: a.id }); }} testid="quick-script" />
        <Field label="Read out with" hint="Or make an AI voice file above for the most natural sound."><VoiceSelect value={f.voice || def.voice} onChange={(v) => set({ voice: v })} voices={voices} testid="quick-voice-select" /></Field>
      </> : <Field label="Message to play" hint={!audios.length ? <Link to={cp('/app/audio')} className="text-[#34d399]">Create audio first →</Link> : null}>
        <AudioSelect value={f.audioId} onChange={(v) => set({ audioId: v })} audios={audios} by="id" testid="quick-call-audio-select" />
        {f.audioId && <audio controls preload="none" src={playUrl(audios.find(a => a.id === f.audioId)?.audioUrl)} className="h-9 mt-2" data-testid="quick-audio-preview" />}
      </Field>}
    </div>
  );
}

function Answer({ f, set, isBiz }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{MODES.map(([m, l]) => <Pill key={m} on={f.mode === m} onClick={() => set({ mode: m })} testid={`quick-mode-${m}`}>{l}</Pill>)}</div>
      {f.mode === 'transfer' && <>
        <Field label="Connect to (when they press a key)"><input className="civr-input font-mono" value={f.transferTo} onChange={e => set({ transferTo: e.target.value })} placeholder="+14155550199" data-testid="quick-call-transfer-input" /></Field>
        <Field label="Keys that connect"><KeyPicker value={f.activeKeys} onChange={(v) => set({ activeKeys: v })} testid="quick-call-keys" /></Field>
        <div className="flex items-center justify-between"><span className="text-sm">Hold music while connecting</span><Toggle checked={f.holdMusic} onChange={(v) => set({ holdMusic: v })} testid="quick-call-hold-music-toggle" /></div>
      </>}
      {f.mode === 'otp' && <div className="space-y-4" data-testid="quick-otp-fields">
        <Field label="Code length" hint="They get 3 tries. The code shows up in your Inbox."><select className="civr-input !w-40" value={f.otp.length} onChange={e => set({ otp: { ...f.otp, length: Number(e.target.value) } })} data-testid="quick-otp-length">{[4, 5, 6, 8].map(n => <option key={n} value={n}>{`${n} digits`}</option>)}</select></Field>
        {isBiz ? <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Said after a valid code (optional)"><input className="civr-input" value={f.otp.confirmMsg} onChange={e => set({ otp: { ...f.otp, confirmMsg: e.target.value } })} placeholder="Thank you, your code is confirmed." data-testid="quick-otp-confirm" /></Field>
          <Field label="Said after a wrong code (optional)"><input className="civr-input" value={f.otp.rejectMsg} onChange={e => set({ otp: { ...f.otp, rejectMsg: e.target.value } })} placeholder="That code was not valid." data-testid="quick-otp-reject" /></Field>
        </div> : <div className="text-xs text-[#a1a1aa]">Custom confirm / reject messages are on the Business plan.</div>}
      </div>}
      {f.mode === 'menu' && <MenuBuilder value={f.menu} onChange={(v) => set({ menu: v })} testid="quick-menu" />}
    </div>
  );
}

const Section = ({ n, title, children }) => <div className="civr-card p-6 space-y-4"><div className="font-display text-xl font-bold"><span className="text-[#34d399] font-mono mr-2">{n}</span>{title}</div>{children}</div>;

export default function QuickCall() {
  const { refreshSummary } = useShell();
  const { numbers, all, loading } = useCallerNumbers('ivrOutbound');
  const { data: au, reload: reloadAudio } = useApi('/audio');
  const { data: trial, reload: reloadTrial } = useApi('/calls/trial');
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [stamp, setStamp] = useState(0);
  const [trialShown, setTrialShown] = useState(false);
  const set = (p) => setF(x => ({ ...x, ...p }));
  if (loading) return <Spinner />;
  const caller = numbers.find(n => n.phoneNumber === f.callerId) || numbers[0];
  const isBiz = caller?.plan === 'business';
  const audios = au?.audios || [];

  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError(null); setResult(null);
    try {
      const d = await api('/calls/quick', { method: 'POST', body: toBody(f, caller.phoneNumber) });
      setResult(d); setStamp(s => s + 1);
      toast.success(d.scheduled ? 'Call scheduled' : d.dryRun ? 'Validated (preview — not dialed)' : 'Calling now');
      refreshSummary();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const loadPreset = (p) => { setF({ ...EMPTY, ...(p.setup.ui || {}), targets: f.targets, callerId: p.setup.callerId || f.callerId }); toast.success(`Loaded “${p.name}”`); };

  return (
    <div data-testid="quick-call-page">
      <PageHeader label="Outbound" title="Quick IVR call" sub="Call one or a few people, play a script or recording, then connect them, collect a code or route each key. Billed per minute from your wallet." testid="quick-call-header" />
      {!numbers.length ? (trial?.available || trialShown ? <TrialCall onUsed={() => { setTrialShown(true); reloadTrial(); }} /> : (
        <Empty icon={PhoneOutgoing} title="No number can place IVR calls yet" sub={all.length ? 'Quick IVR calls need an active number on the Pro plan or higher. Upgrade one in its Billing tab.' : 'Buy a number on the Pro plan or higher to place IVR calls.'} testid="quick-call-empty">
          <Link to={all.length ? cp('/app/numbers') : cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="quick-call-empty-action">{all.length ? 'My numbers' : 'Buy a number'}</Link>
        </Empty>
      )) : (
        <div className="grid xl:grid-cols-3 gap-4 items-start">
          <form onSubmit={go} className="xl:col-span-2 space-y-4" data-testid="quick-call-form">
            <Section n="1" title="Who to call">
              <Field label="Call from"><select className="civr-input font-mono" value={caller.phoneNumber} onChange={e => set({ callerId: e.target.value })} data-testid="quick-call-caller-select">{numbers.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{`${n.phoneNumber} · ${n.planName}`}</option>)}</select></Field>
              <Field label="Number(s) to call" hint="With country code. Up to 10, separated by commas.">
                <input className="civr-input font-mono" required value={f.targets} onChange={e => set({ targets: e.target.value })} placeholder="+14155550100, +14155550101" data-testid="quick-call-to-input" />
                <Recent onPick={(n) => set({ targets: f.targets.includes(n) ? f.targets : [f.targets, n].filter(Boolean).join(', ') })} />
              </Field>
            </Section>
            <Section n="2" title="What they hear"><Message f={f} set={set} audios={audios} reloadAudio={reloadAudio} /></Section>
            <Section n="3" title="When they press a key"><Answer f={f} set={set} isBiz={isBiz} /></Section>
            <Section n="4" title="When to call">
              {isBiz ? <Field label="Schedule (optional)" hint="5 minutes to 24 hours from now. Leave empty to call now."><DateTimePicker value={f.scheduleAt} onChange={(v) => set({ scheduleAt: v })} maxDays={1} testid="quick-schedule" /></Field>
                : <div className="text-sm text-[#a1a1aa]" data-testid="quick-schedule-locked">Calls start right away. Scheduling, presets and redial are on the Business plan.</div>}
              <ErrorNote error={error} testid="quick-call-error" />
              {result && <div className="civr-card p-4 text-sm" data-testid="quick-call-result">{result.message || (result.scheduled ? `Scheduled ${result.scheduled} call(s).` : `Started ${result.started} call(s) · about $${Number(result.rate).toFixed(2)}/min.`)}</div>}
              <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="quick-call-submit-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}{f.scheduleAt ? 'Schedule call' : 'Place call'}</button>
            </Section>
          </form>
          <div className="space-y-4">
            {isBiz && <Presets stamp={stamp} onLoad={loadPreset} current={() => ({ ...toBody({ ...f, scheduleAt: '' }, caller.phoneNumber), targets: undefined, ui: { ...f, targets: '', scheduleAt: '' } })} />}
            <ScheduledCalls stamp={stamp} />
            <RecentCalls isBiz={isBiz} stamp={stamp} onDone={() => setStamp(s => s + 1)} />
            <MenuStats />
          </div>
        </div>
      )}
    </div>
  );
}
