import React, { useRef, useState } from 'react';
import { ask } from '../i18n';
import { toast } from 'sonner';
import { Music, Upload, Wand2, Trash2, Pencil, Loader2, Check, X } from 'lucide-react';
import { api, useApi, day, playUrl } from '../api';
import { PageHeader, Field, Spinner, ErrorNote, Empty } from '../ui';

function UploadCard({ onDone }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const pick = (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error('Audio files must be under 10 MB.'); return; }
    setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 60));
  };
  const send = async () => {
    const fd = new FormData(); fd.append('file', file); fd.append('name', name || file.name);
    setBusy(true);
    try { await api('/audio/upload', { method: 'POST', form: fd }); toast.success('Audio added'); setName(''); setFile(null); onDone(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-4" data-testid="audio-upload-card">
      <div className="flex items-center gap-2 font-display text-2xl font-bold"><Upload className="w-5 h-5 text-[#34d399]" />Upload</div>
      <input ref={ref} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" className="hidden" onChange={pick} data-testid="audio-upload-file-input" />
      <button type="button" className="civr-btn civr-btn-ghost w-full" disabled={busy} onClick={() => ref.current?.click()} data-testid="audio-upload-choose-button"><Music className="w-4 h-4" /><span className="truncate">{file ? file.name : 'Choose audio file'}</span></button>
      <Field label="Name"><input className="civr-input" value={name} onChange={e => setName(e.target.value)} placeholder="Main greeting" data-testid="audio-upload-name-input" /></Field>
      <button className="civr-btn civr-btn-primary w-full" disabled={!file || busy} onClick={send} data-testid="audio-upload-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{busy ? 'Converting…' : 'Upload'}</button>
      <p className="text-xs text-[#8a8a8a]">MP3, WAV, OGG, M4A · up to 10 MB. Converted for phone playback.</p>
    </div>
  );
}

function TtsCard({ onDone }) {
  const { data } = useApi('/audio/voices');
  const [f, setF] = useState({ text: '', voice: 'rachel', speed: 1, name: '' });
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { await api('/audio/tts', { method: 'POST', body: f }); toast.success('Voice message created'); setF({ ...f, text: '', name: '' }); onDone(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-4 lg:col-span-2" data-testid="audio-tts-card">
      <div className="flex items-center gap-2 font-display text-2xl font-bold"><Wand2 className="w-5 h-5 text-[#38bdf8]" />Text to speech</div>
      <Field label="What should the voice say?" hint={`${f.text.length}/1500`}><textarea rows={4} className="civr-input" maxLength={1500} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} placeholder="Thanks for calling. Press 1 for sales, 2 for support." data-testid="audio-tts-text-input" /></Field>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Voice"><select className="civr-input" value={f.voice} onChange={e => setF({ ...f, voice: e.target.value })} data-testid="audio-tts-voice-select">{(data?.voices || []).map(v => <option key={v.key} value={v.key}>{v.name} · {v.gender}</option>)}</select></Field>
        <Field label="Speed"><select className="civr-input" value={f.speed} onChange={e => setF({ ...f, speed: Number(e.target.value) })} data-testid="audio-tts-speed-select">{(data?.speeds || [1]).map(s => <option key={s} value={s}>{s}×</option>)}</select></Field>
        <Field label="Name (optional)"><input className="civr-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} data-testid="audio-tts-name-input" /></Field>
      </div>
      <button className="civr-btn civr-btn-primary" disabled={busy || f.text.trim().length < 3} onClick={make} data-testid="audio-tts-create-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}{busy ? 'Generating…' : 'Create audio'}</button>
    </div>
  );
}

function AudioRow({ a, i, reload }) {
  const [edit, setEdit] = useState(null);
  const rename = async () => { try { await api(`/audio/${a.id}`, { method: 'PATCH', body: { name: edit } }); setEdit(null); reload(); } catch (e) { toast.error(e.message); } };
  const remove = async () => { if (!ask(`Delete “${a.name}”? Numbers using it fall back to the default greeting.`)) return; try { await api(`/audio/${a.id}`, { method: 'DELETE' }); toast.success('Deleted'); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="civr-card p-4 flex flex-col md:flex-row md:items-center gap-3" data-testid={`audio-row-${i}`}>
      <div className="md:w-56 min-w-0">
        {edit !== null ? (
          <div className="flex gap-1"><input className="civr-input !h-9" value={edit} onChange={e => setEdit(e.target.value)} data-testid={`audio-row-${i}-rename-input`} /><button onClick={rename} className="p-2 text-[#34d399]" data-testid={`audio-row-${i}-rename-save`}><Check className="w-4 h-4" /></button><button onClick={() => setEdit(null)} className="p-2 text-[#888]" data-testid={`audio-row-${i}-rename-cancel`}><X className="w-4 h-4" /></button></div>
        ) : <div className="font-semibold truncate" data-testid={`audio-row-${i}-name`}>{a.name}</div>}
        <div className="text-xs text-[#8a8a8a] mt-0.5">{a.source === 'tts' ? 'Text to speech' : 'Upload'} · {day(a.createdAt)}</div>
      </div>
      <audio controls preload="none" src={playUrl(a.audioUrl)} className="h-9 flex-1 min-w-0" data-testid={`audio-row-${i}-player`} />
      <div className="flex gap-1">
        <button onClick={() => setEdit(a.name)} className="p-2 rounded-lg text-[#888] hover:text-white hover:bg-[#1a1a1a]" data-testid={`audio-row-${i}-rename-button`} aria-label="Rename"><Pencil className="w-4 h-4" /></button>
        <button onClick={remove} className="p-2 rounded-lg text-[#888] hover:text-[#fb7185] hover:bg-[#1a1a1a]" data-testid={`audio-row-${i}-delete-button`} aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export default function AudioLibrary() {
  const { data, error, loading, reload } = useApi('/audio');
  const audios = data?.audios || [];
  return (
    <div data-testid="audio-page">
      <PageHeader label="Audio" title="Audio library" sub="Greetings, IVR prompts and campaign messages. Upload your own or type it and pick a voice." testid="audio-header" />
      <div className="grid lg:grid-cols-3 gap-4"><UploadCard onDone={reload} /><TtsCard onDone={reload} /></div>
      <div className="mt-8 space-y-3">
        <ErrorNote error={error} />
        {loading && !data ? <Spinner /> : !audios.length ? <Empty icon={Music} title="No audio yet" sub="Your first upload or voice message shows up here." testid="audio-empty" /> : audios.map((a, i) => <AudioRow key={a.id} a={a} i={i} reload={reload} />)}
      </div>
    </div>
  );
}
