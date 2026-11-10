import React from 'react';
import { Scissors } from 'lucide-react';
import { Field } from '../ui';
import { VoiceMaker } from '../VoiceMaker';

// Voicemail keeps the gist and drops keypad prompts ("Press 1…") — nobody can press keys on a recording.
export const shortenForVoicemail = (text) => {
  const parts = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const keep = parts.filter(p => !/\b(press|dial|key|option|stay on the line|hold)\b/i.test(p));
  const body = (keep.length ? keep : parts).slice(0, 3).join(' ');
  return body ? `${body}${/[.!?]$/.test(body) ? '' : '.'} Please call us back at your earliest convenience. Thank you.` : '';
};

// "When voicemail answers → Write a voicemail script": short text → AI voice in one tap → used as the voicemail drop.
export function VoicemailScript({ value, onChange, mainText, onMade, madeName }) {
  const set = (p) => onChange({ ...value, ...p });
  const words = String(value.text || '').trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="border border-[#262626] rounded-xl p-4 space-y-3" data-testid="campaign-vm-script">
      <Field label="Voicemail script" hint="Keep it short (about 15–25 seconds): who you are, why you called, how to reach you. Keypad prompts don’t work on voicemail.">
        <textarea rows={3} maxLength={600} className="civr-input" value={value.text || ''} onChange={e => set({ text: e.target.value, audioId: '' })}
          placeholder="Hi, this is Acme Dental calling about your appointment on Friday. Please call us back at 415-555-0100. Thank you." data-testid="campaign-vm-script-text" />
      </Field>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#a1a1aa]">
        {mainText && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => set({ text: shortenForVoicemail(mainText), audioId: '' })} data-testid="campaign-vm-script-shorten"><Scissors className="w-4 h-4" />Start from my call script</button>}
        {words > 0 && <span data-testid="campaign-vm-script-length">{`${words} words · about ${Math.max(3, Math.round(words / 2.5))} seconds`}</span>}
      </div>
      <VoiceMaker text={value.text} name={madeName} onMade={onMade} choice={value} onChoice={set} testid="campaign-vm-script-voice" />
      {value.audioId && <div className="text-xs text-[#4ade80]" data-testid="campaign-vm-script-ready">Voicemail audio ready — it will be left after the beep.</div>}
    </div>
  );
}
