import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Field, Toggle } from '../../ui';
import { withPlusOne } from '../campaign/AiSetup';

const ACTIONS = [['transfer', 'Transfer to a person'], ['message', 'Take a message'], ['repeat', 'Repeat the information'], ['hangup', 'End the call']];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];

function KeyRow({ k, i, update, remove, used }) {
  return (
    <div className="grid grid-cols-[70px_1fr] sm:grid-cols-[70px_190px_1fr_1fr_40px] gap-2 items-center" data-testid={`ai-key-row-${i}`}>
      <select className="civr-input" value={k.key} onChange={e => update(i, { key: e.target.value })} aria-label="Key" data-testid={`ai-key-digit-${i}`}>{KEYS.filter(x => x === k.key || !used.includes(x)).map(x => <option key={x} value={x}>{x}</option>)}</select>
      <select className="civr-input" value={k.action} onChange={e => update(i, { action: e.target.value })} aria-label="Action" data-testid={`ai-key-action-${i}`}>{ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <input className="civr-input" value={k.label || ''} onChange={e => update(i, { label: e.target.value })} placeholder="to speak with billing" aria-label="What the AI says" data-testid={`ai-key-label-${i}`} />
      {k.action === 'transfer' ? <input className="civr-input font-mono" value={k.to || ''} onChange={e => update(i, { to: e.target.value })} placeholder="+14155550199 (or the transfer number)" aria-label="Transfer to" data-testid={`ai-key-to-${i}`} /> : <span className="hidden sm:block" />}
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => remove(i)} aria-label="Remove key" data-testid={`ai-key-remove-${i}`}><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

// Keypad options: pressing a key acts right away; the AI offers them during the call.
export function KeypadFields({ f, set }) {
  const keys = f.keys || [];
  const used = keys.map(k => k.key);
  const update = (i, v) => set('keys', keys.map((k, j) => (j === i ? { ...k, ...v } : k)));
  const remove = (i) => set('keys', keys.filter((_, j) => j !== i));
  const add = () => set('keys', [...keys, { key: KEYS.find(x => !used.includes(x)), action: 'transfer', label: '', to: '' }]);
  return (
    <div className="space-y-3" data-testid="ai-keypad-fields">
      <Field label="Keypad options (optional)" hint="Callers can press a key at any time — e.g. press 2 to talk to a person. The AI mentions them during the call.">
        <div className="space-y-2">{keys.map((k, i) => <KeyRow key={i} k={k} i={i} update={update} remove={remove} used={used} />)}</div>
      </Field>
      {keys.length < 12 && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={add} data-testid="ai-key-add-button"><Plus className="w-4 h-4" />Add a key</button>}
      <div className="flex items-center justify-between gap-4" data-testid="ai-hold-music-row">
        <span className="text-sm">Hold music while transferring<span className="block text-xs text-[#a1a1aa] mt-0.5">The caller hears music instead of ringing until the person picks up.</span></span>
        <Toggle checked={!!f.holdMusic} onChange={v => set('holdMusic', v)} testid="ai-hold-music-toggle" label="Hold music while transferring" />
      </div>
    </div>
  );
}

// Rings the owner's own phone with this agent right now (5 a day) — hear exactly what a lead hears.
export function CallMeTest({ id }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const d = await api(`/ai-agents/${id}/call-me`, { method: 'POST', body: { to } }); toast.success(d.simulated ? `Preview: test call to ${d.calling} simulated (${d.left} left today)` : `Calling ${d.calling} from ${d.from}… (${d.left} left today)`); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ai-call-me-test">
      <Field label="Call me to test" hint="Rings your own phone now so you hear the agent like a lead would. 5 test calls a day."><input className="civr-input font-mono" inputMode="tel" value={to} onChange={e => setTo(withPlusOne(e.target.value))} placeholder="+14155550100" data-testid="ai-call-me-input" /></Field>
      <button type="button" className="civr-btn civr-btn-ghost" disabled={busy || to.replace(/\D/g, '').length < 10} onClick={go} data-testid="ai-call-me-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Call me</button>
    </div>
  );
}
