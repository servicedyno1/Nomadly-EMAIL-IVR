import React, { useState } from 'react';
import { toast } from 'sonner';
import { api, enc, useApi } from '../../api';
import { Field, Toggle } from '../../ui';
import { Link } from 'react-router-dom';
import { cp } from '../../paths';

// Shared save helper for the simple PATCH settings forms.
export function useSave(num, path, reload) {
  const [busy, setBusy] = useState(false);
  const save = async (body, method = 'PATCH') => {
    setBusy(true);
    try { await api(`/numbers/${enc(num.phoneNumber)}/${path}`, { method, body }); toast.success('Saved'); reload(); return true; } catch (e) { toast.error(e.message); return false; } finally { setBusy(false); }
  };
  return [save, busy];
}

const Card = ({ title, sub, children }) => (
  <div className="civr-card p-6 max-w-2xl">
    <div className="font-display text-2xl font-bold">{title}</div>
    {sub && <p className="text-sm text-[#888] mt-1 mb-6">{sub}</p>}
    <div className="space-y-6">{children}</div>
  </div>
);

function Meter({ label, used, total, testid }) {
  const unlimited = total === 'Unlimited' || total === null || total === undefined;
  const pct = unlimited ? 0 : Math.min(100, (Number(used) / Number(total || 1)) * 100);
  return (
    <div data-testid={testid}>
      <div className="flex justify-between text-sm"><span className="text-[#aaa]">{label}</span><span className="font-mono">{used} / {unlimited ? '∞' : total}</span></div>
      <div className="h-2 rounded-full bg-[#1c1c1c] mt-2 overflow-hidden"><div className="h-full bg-[#34d399] rounded-full transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function OverviewTab({ num }) {
  const caps = num.capabilities || {};
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="civr-card p-6 lg:col-span-2 space-y-6">
        <div className="font-display text-2xl font-bold">This month</div>
        <Meter label="Inbound minutes" used={num.usage.minutesUsed} total={num.usage.minutesIncluded} testid="overview-minutes-meter" />
        <Meter label="SMS" used={num.usage.smsUsed} total={num.usage.smsIncluded} testid="overview-sms-meter" />
      </div>
      <div className="civr-card p-6 space-y-3 text-sm" data-testid="overview-capabilities">
        <div className="font-display text-2xl font-bold mb-2">Capabilities</div>
        {[['voice', 'Voice'], ['sms', 'SMS'], ['fax', 'Fax']].map(([c, l]) => <div key={c} className="flex justify-between"><span className="text-[#aaa]">{l}</span><span className={caps[c] ? 'text-[#34d399]' : 'text-[#8a8a8a]'} data-testid={`overview-capability-${c}`}>{caps[c] ? 'Yes' : 'No'}</span></div>)}
        <div className="flex justify-between"><span className="text-[#aaa]">SIP domain</span><span className="font-mono text-xs">{num.sipDomain}</span></div>
      </div>
    </div>
  );
}

export function ForwardingTab({ num, reload }) {
  const cf = num.features.callForwarding;
  const [f, setF] = useState({ mode: cf.mode || 'disabled', forwardTo: cf.forwardTo || '', ringTimeout: cf.ringTimeout || 25, holdMusic: !!cf.holdMusic });
  const [save, busy] = useSave(num, 'forwarding', reload);
  return (
    <Card title="Call forwarding" sub="Send calls to any phone. Forwarded minutes bill from your wallet.">
      <Field label="When to forward">
        <select className="civr-input" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })} data-testid="forwarding-mode-select">
          <option value="disabled">Off</option><option value="always">Always</option><option value="busy">When busy</option><option value="no_answer">When not answered</option>
        </select>
      </Field>
      {f.mode !== 'disabled' && <>
        <Field label="Forward to" hint="Include the country code, e.g. +14155550100."><input className="civr-input font-mono" value={f.forwardTo} onChange={e => setF({ ...f, forwardTo: e.target.value })} placeholder="+14155550100" data-testid="forwarding-number-input" /></Field>
        <Field label="Ring time before forwarding (seconds)"><input type="number" min={10} max={60} className="civr-input" value={f.ringTimeout} onChange={e => setF({ ...f, ringTimeout: e.target.value })} data-testid="forwarding-ring-timeout-input" /></Field>
        <div className="flex items-center justify-between"><span className="text-sm">Play hold music while connecting</span><Toggle checked={f.holdMusic} onChange={v => setF({ ...f, holdMusic: v })} testid="forwarding-hold-music-toggle" /></div>
      </>}
      <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => save(f)} data-testid="forwarding-save-button">Save forwarding</button>
    </Card>
  );
}

export function VoicemailTab({ num, reload }) {
  const vm = num.features.voicemail;
  const { data } = useApi('/audio');
  const [f, setF] = useState({ enabled: !!vm.enabled, greetingType: vm.greetingType === 'custom' ? 'custom' : 'default', customGreetingUrl: vm.customGreetingUrl || '', forwardToEmail: vm.forwardToEmail || '', ringTimeout: vm.ringTimeout || 25 });
  const [save, busy] = useSave(num, 'voicemail', reload);
  return (
    <Card title="Voicemail" sub="Unanswered callers can leave a message. Recordings land in your inbox.">
      <div className="flex items-center justify-between"><span className="text-sm">Voicemail on</span><Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} testid="voicemail-enabled-toggle" /></div>
      <Field label="Greeting">
        <select className="civr-input" value={f.greetingType} onChange={e => setF({ ...f, greetingType: e.target.value })} data-testid="voicemail-greeting-type-select">
          <option value="default">Standard greeting</option><option value="custom">From my audio library</option>
        </select>
      </Field>
      {f.greetingType === 'custom' && (
        <Field label="Greeting audio" hint={!data?.audios?.length ? 'Add audio in the Audio library first.' : null}>
          <select className="civr-input" value={f.customGreetingUrl} onChange={e => setF({ ...f, customGreetingUrl: e.target.value })} data-testid="voicemail-greeting-audio-select">
            <option value="">Pick audio…</option>{(data?.audios || []).map(a => <option key={a.id} value={a.audioUrl}>{a.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Also email voicemails to (optional)"><input className="civr-input" type="email" value={f.forwardToEmail} onChange={e => setF({ ...f, forwardToEmail: e.target.value })} data-testid="voicemail-email-input" /></Field>
      <Field label="Ring time before voicemail (seconds)"><input type="number" min={10} max={60} className="civr-input" value={f.ringTimeout} onChange={e => setF({ ...f, ringTimeout: e.target.value })} data-testid="voicemail-ring-timeout-input" /></Field>
      <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => save(f)} data-testid="voicemail-save-button">Save voicemail</button>
    </Card>
  );
}

export function SmsTab({ num, reload }) {
  const s = num.features.smsForwarding;
  const [f, setF] = useState({ toEmail: s.toEmail || '', webhookUrl: s.webhookUrl || '' });
  const [save, busy] = useSave(num, 'sms', reload);
  if (!num.capabilities?.sms) return <Card title="SMS" sub="This number can’t receive text messages." />;
  return (
    <Card title="SMS delivery" sub="Inbound texts always appear in your inbox. Add email or a webhook too (Pro and up).">
      <Field label="Email copy (optional)"><input className="civr-input" type="email" value={f.toEmail} disabled={!num.access.smsToEmail} onChange={e => setF({ ...f, toEmail: e.target.value })} data-testid="sms-email-input" /></Field>
      <Field label="Webhook URL (optional)" hint="We POST each message as JSON."><input className="civr-input font-mono" value={f.webhookUrl} disabled={!num.access.smsWebhook} onChange={e => setF({ ...f, webhookUrl: e.target.value })} placeholder="https://" data-testid="sms-webhook-input" /></Field>
      {!num.access.smsToEmail && <div className="text-xs text-[#fbbf24] flex flex-wrap items-center gap-2" data-testid="sms-upgrade-note">Email and webhook delivery are on the Pro plan and up. <Link to={cp(`/app/numbers/${enc(num.phoneNumber)}?tab=billing`)} className="text-[#34d399] underline" data-testid="sms-upgrade-link">Upgrade this number</Link></div>}
      <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => save(f)} data-testid="sms-save-button">Save SMS settings</button>
    </Card>
  );
}

export function RecordingTab({ num, reload }) {
  const [save, busy] = useSave(num, 'recording', reload);
  return (
    <Card title="Call recording" sub="Record inbound calls. Recordings show up in the Logs tab.">
      <div className="flex items-center justify-between"><span className="text-sm">Record calls</span><Toggle checked={num.features.recording} disabled={busy} onChange={v => save({ enabled: v })} testid="recording-toggle" /></div>
    </Card>
  );
}
