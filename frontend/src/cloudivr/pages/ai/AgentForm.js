import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { ask } from '../../i18n';
import { Field, Toggle, ErrorNote } from '../../ui';
import { BookingFields, browserZone } from './BookingFields';

const LANGS = [['en', 'English'], ['fr', 'French'], ['es', 'Spanish']];
export const EMPTY_AGENT = {
  name: '', businessName: '', language: 'en', voice: 'marin', goal: '', greeting: '', knowledge: '', transferTo: '', takeMessages: true, maxMinutes: 5, record: true,
  booking: { enabled: false, calendarId: 'primary', calendarName: null, slotMinutes: 30, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', timeZone: browserZone() },
};

const Text = ({ f, set, k, rows, ph, testid }) => rows
  ? <textarea rows={rows} className="civr-input" value={f[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} data-testid={testid} />
  : <input className="civr-input" value={f[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} data-testid={testid} />;

function Basics({ f, set, voices }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label="Agent name"><Text f={f} set={set} k="name" ph="Ava" testid="ai-agent-name-input" /></Field>
      <Field label="Business name"><Text f={f} set={set} k="businessName" ph="Sunrise Dental" testid="ai-agent-business-input" /></Field>
      <Field label="Language" hint="The agent switches if the caller speaks another language.">
        <select className="civr-input" value={f.language} onChange={e => set('language', e.target.value)} data-testid="ai-agent-language-select">{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      </Field>
      <Field label="Voice">
        <select className="civr-input capitalize" value={f.voice} onChange={e => set('voice', e.target.value)} data-testid="ai-agent-voice-select">{(voices || []).map(v => <option key={v} value={v}>{v}</option>)}</select>
      </Field>
    </div>
  );
}

function Actions({ f, set, recordRate = 0.02, recordingDays = 90 }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4 items-start">
      <Field label="Transfer to a human (optional)" hint="When the caller asks for a person or is ready to go ahead."><Text f={f} set={set} k="transferTo" ph="+14155550199" testid="ai-agent-transfer-input" /></Field>
      <Field label="Longest call (minutes)"><input type="number" min={1} max={15} className="civr-input" value={f.maxMinutes} onChange={e => set('maxMinutes', e.target.value)} data-testid="ai-agent-max-minutes-input" /></Field>
      <div className="flex items-center justify-between sm:col-span-2"><span className="text-sm">Take messages (name, callback number, message)</span><Toggle checked={!!f.takeMessages} onChange={v => set('takeMessages', v)} testid="ai-agent-take-messages-toggle" /></div>
      <div className="flex items-center justify-between gap-4 sm:col-span-2" data-testid="ai-agent-record-row">
        <span className="text-sm">Record calls<span className="block text-xs text-[#a1a1aa] mt-0.5">{`The agent says “this call may be recorded” when it answers. +$${Number(recordRate).toFixed(2)} per started minute · kept ${recordingDays} days, then deleted.`}</span></span>
        <Toggle checked={f.record !== false} onChange={v => set('record', v)} testid="ai-agent-record-toggle" />
      </div>
    </div>
  );
}

// Create / edit an AI agent: personality + script, FAQs, transfer and message taking.
export function AgentForm({ initial, voices, recordRate, recordingDays, onSaved, onDeleted }) {
  const [f, setF] = useState({ ...EMPTY_AGENT, ...initial, transferTo: initial?.transferTo || '', record: initial?.record !== false, booking: { ...EMPTY_AGENT.booking, ...(initial?.booking || {}) } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const d = await api(f.id ? `/ai-agents/${f.id}` : '/ai-agents', { method: f.id ? 'PUT' : 'POST', body: f });
      toast.success('Agent saved'); onSaved(d.agent);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!ask('Delete this agent? Numbers using it go back to normal call handling.')) return;
    try { await api(`/ai-agents/${f.id}`, { method: 'DELETE' }); toast.success('Agent deleted'); onDeleted(); } catch (err) { toast.error(err.message); }
  };
  return (
    <form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="ai-agent-form">
      <Basics f={f} set={set} voices={voices} />
      <Field label="Personality & script" hint="What the agent does, how it talks and what it should find out."><Text f={f} set={set} k="goal" rows={5} ph="Friendly receptionist. Answer questions, book cleanings and get the caller's name and preferred time." testid="ai-agent-goal-input" /></Field>
      <Field label="Opening line (optional)" hint="Said right after the agent introduces itself as an AI assistant."><Text f={f} set={set} k="greeting" ph="How can I help you today?" testid="ai-agent-greeting-input" /></Field>
      <Field label="FAQs & facts" hint="Prices, hours, policies — the agent only uses what is here."><Text f={f} set={set} k="knowledge" rows={6} ph={'Q: Are you open Saturday? A: No, Monday–Friday 9am–5pm.\nCleaning: $90.'} testid="ai-agent-knowledge-input" /></Field>
      <Actions f={f} set={set} recordRate={recordRate} recordingDays={recordingDays} />
      <BookingFields f={f} set={set} />
      <ErrorNote error={error} testid="ai-agent-form-error" />
      <div className="flex flex-wrap gap-2">
        <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="ai-agent-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save agent</button>
        {f.id && <button type="button" className="civr-btn civr-btn-danger" onClick={remove} data-testid="ai-agent-delete-button"><Trash2 className="w-4 h-4" />Delete</button>}
      </div>
    </form>
  );
}
