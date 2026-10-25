import React, { useState } from 'react';
import { Users, Plus, X, Loader2 } from 'lucide-react';
import { Field, Toggle } from '../../ui';
import { useUnsaved, SaveRow } from '../../guard';
import { Card, useSave } from './SettingsTabs';
import { OneAnswerNote } from './RouteSummary';

const MAX = 5;
const SKIP_NAMES = { forwarding: 'Forwarding', 'keypad menu': 'the keypad menu', 'browser ring': 'Browser ring' };

function Members({ list, onChange }) {
  const set = (i, v) => onChange(list.map((m, j) => (j === i ? v : m)));
  return (
    <div className="space-y-2" data-testid="ring-group-members">
      <span className="block text-[13px] font-medium text-[#d4d4d8]">Phones that ring together</span>
      {list.map((m, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="font-mono text-xs text-[#a1a1aa] w-6">{i + 1}</span>
          <input className="civr-input font-mono" value={m} onChange={e => set(i, e.target.value)} placeholder="+14155550100" aria-label={`Phone ${i + 1}`} data-testid={`ring-group-member-${i}-input`} />
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !px-2" disabled={list.length <= 1} onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove phone ${i + 1}`} data-testid={`ring-group-member-${i}-remove`}><X className="w-4 h-4" /></button>
        </div>
      ))}
      {list.length < MAX && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => onChange([...list, ''])} data-testid="ring-group-add-member"><Plus className="w-4 h-4" />Add a phone</button>}
      <span className="block text-xs text-[#a1a1aa]">Up to 5 phones, with the country code. They all ring at the same time — the first to answer gets the call.</span>
    </div>
  );
}

function Fallback({ f, setF, hasVm }) {
  return (
    <>
      <Field label="If nobody answers">
        <select className="civr-input" value={f.fallback} onChange={e => setF({ ...f, fallback: e.target.value })} data-testid="ring-group-fallback-select">
          <option value="voicemail" disabled={!hasVm}>Go to voicemail{hasVm ? '' : ' (Pro plan and up)'}</option>
          <option value="forward">Forward to one backup number</option>
          <option value="message">Play a “sorry, try later” message and hang up</option>
        </select>
      </Field>
      {f.fallback === 'forward' && <Field label="Backup number"><input className="civr-input font-mono" value={f.fallbackTo} onChange={e => setF({ ...f, fallbackTo: e.target.value })} placeholder="+14155550199" data-testid="ring-group-fallback-number-input" /></Field>}
      {f.fallback === 'message' && (
        <Field label="Message (optional)" hint={`${f.message.length}/300 · Leave empty for: “Sorry, no one is available to take your call right now. Please try again later.”`}>
          <textarea rows={2} maxLength={300} className="civr-input" value={f.message} onChange={e => setF({ ...f, message: e.target.value })} data-testid="ring-group-message-input" />
        </Field>
      )}
    </>
  );
}

export default function RingGroupTab({ num, reload }) {
  const rg = num.features.ringGroup;
  const hasVm = !!num.access?.voicemail;
  const [f, setF] = useState(() => ({ enabled: !!rg.enabled, members: rg.members?.length ? rg.members : ['', ''], ringTimeout: rg.ringTimeout || 25, fallback: hasVm || rg.fallback !== 'voicemail' ? rg.fallback : 'message', fallbackTo: rg.fallbackTo || '', message: rg.message || '' }));
  const [save, busy] = useSave(num, 'ring-group', reload);
  const u = useUnsaved(f);
  const ai = num.routeSummary?.primary === 'ai_agent';
  const okText = (res) => (res.skipped?.length ? `Ring group on — ${res.skipped.map(s => SKIP_NAMES[s] || s).join(', ')} won’t run while it’s on` : f.enabled ? 'Ring group on' : 'Ring group saved (off)');
  const submit = async () => { if (await save({ ...f, members: f.members.filter(m => m.trim()) }, 'PUT', okText)) u.reset(); };
  return (
    <Card title="Ring group" sub="Ring several phones at once — your mobile, a colleague, the front desk. Whoever answers first gets the caller." bind={u.bind}>
      <div className="flex items-center justify-between"><span className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-[#34d399]" />Ring all these phones for every call</span><Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} testid="ring-group-enabled-toggle" /></div>
      {ai && f.enabled && <OneAnswerNote testid="ring-group-ai-note">Your AI voice agent answers this number first. The ring group only runs if the agent can’t take the call.</OneAnswerNote>}
      {f.enabled && !ai && <p className="text-xs text-[#a1a1aa]" data-testid="ring-group-priority-note">While it’s on, every call rings the group — forwarding and the keypad menu are skipped. Your Hours schedule still applies.</p>}
      <Members list={f.members} onChange={v => setF({ ...f, members: v })} />
      <Field label="Ring for (seconds)"><input type="number" min={10} max={60} className="civr-input" value={f.ringTimeout} onChange={e => setF({ ...f, ringTimeout: e.target.value })} data-testid="ring-group-timeout-input" /></Field>
      <Fallback f={f} setF={setF} hasVm={hasVm} />
      <p className="text-xs text-[#a1a1aa]">The answered phone bills like a forwarded call from your wallet. Phones that only ring are free.</p>
      <SaveRow dirty={u.dirty} testid="ring-group-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="ring-group-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save ring group</button></SaveRow>
    </Card>
  );
}
