import React, { useState } from 'react';
import { toast } from 'sonner';
import { Wand2, Loader2 } from 'lucide-react';
import { api, useApi, playUrl } from './api';

// Voices + speeds, with the account's saved default (Business "consistent voice").
export function useVoices() {
  const { data } = useApi('/audio/voices');
  const { data: p } = useApi('/prefs/voice');
  return { voices: data?.voices || [], speeds: data?.speeds || [1], def: { voice: p?.voice || 'rachel', speed: p?.speed || 1 }, canSave: !!p?.canSave };
}

export function VoiceSelect({ value, onChange, voices, testid }) {
  return (
    <select className="civr-input !w-auto max-w-full" value={value} onChange={e => onChange(e.target.value)} data-testid={testid} aria-label="Voice">
      {voices.map(v => <option key={v.key} value={v.key}>{v.name} · {v.desc}</option>)}
    </select>
  );
}

// Turns `text` into an AI-voice audio file (saved to the library) and previews it; onMade(audio).
export function VoiceMaker({ text, name, onMade, testid }) {
  const { voices, speeds, def } = useVoices();
  const [voice, setVoice] = useState('');
  const [speed, setSpeed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const v = voice || def.voice, s = speed || def.speed;
  const make = async () => {
    if (String(text || '').trim().length < 3) { toast.error('Type at least a few words first.'); return; }
    setBusy(true);
    try {
      const d = await api('/audio/tts', { method: 'POST', body: { text, voice: v, speed: s, name: name || String(text).slice(0, 40) } });
      setMade(d.audio); onMade && onMade(d.audio); toast.success('AI voice ready — saved to your audio library');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testid}>
      <VoiceSelect value={v} onChange={setVoice} voices={voices} testid={`${testid}-voice`} />
      <select className="civr-input !w-24" value={s} onChange={e => setSpeed(Number(e.target.value))} data-testid={`${testid}-speed`} aria-label="Speed">{speeds.map(x => <option key={x} value={x}>{x}×</option>)}</select>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={make} disabled={busy} data-testid={`${testid}-make`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{busy ? 'Making…' : 'Make AI voice'}</button>
      {made && <audio controls src={playUrl(made.audioUrl)} className="h-9 max-w-full" data-testid={`${testid}-preview`} />}
    </div>
  );
}
