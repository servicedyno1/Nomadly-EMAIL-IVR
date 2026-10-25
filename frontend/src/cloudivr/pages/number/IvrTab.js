import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, BarChart3 } from 'lucide-react';
import { useApi, enc } from '../../api';
import { Field, Toggle, AudioSelect } from '../../ui';
import { VoiceMaker } from '../../VoiceMaker';
import { IvrTemplates } from './IvrTemplates';
import { useSave } from './SettingsTabs';
import { OneAnswerNote } from './RouteSummary';
import { useUnsaved, SaveRow } from '../../guard';
import { cp } from '../../paths';
import { LANGS, tr, useLang } from '../../i18n';

// Built-in IVR texts per language (same as js/voicemail-greeting.js).
const DEFAULTS = {
  en: { greeting: 'Thank you for calling. Please select an option.', fallback: 'Thank you for calling. Please listen to the following options.', sub: 'Please select an option.' },
  fr: { greeting: 'Merci de votre appel. Veuillez choisir une option.', fallback: 'Merci de votre appel. Veuillez écouter les options suivantes.', sub: 'Veuillez choisir une option.' },
  es: { greeting: 'Gracias por llamar. Por favor, seleccione una opción.', fallback: 'Gracias por llamar. Por favor, escuche las siguientes opciones.', sub: 'Por favor, seleccione una opción.' },
};
const defOf = (lang) => DEFAULTS[lang] || DEFAULTS.en;
const isDef = (text, keys) => !String(text || '').trim() || Object.values(DEFAULTS).some(d => keys.some(k => d[k] === String(text).trim()));

const ACTIONS = [['forward', 'Forward to a phone'], ['message', 'Play a message'], ['voicemail', 'Take a voicemail'], ['submenu', 'Open a sub-menu']];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const toList = (opts) => Object.entries(opts || {}).map(([digit, o]) => ({ digit, ...o, subMenu: o.subMenu ? { ...o.subMenu, options: toList(o.subMenu.options) } : undefined }));
const toObj = (list) => Object.fromEntries(list.map(({ digit, subMenu, ...o }) => [digit, { ...o, ...(o.action === 'submenu' ? { subMenu: { ...(subMenu || {}), options: toObj(subMenu?.options || []) } } : {}) }]));

function Greeting({ g, set, audios, prefix, label = 'Greeting', onAudio }) {
  const audio = !!g.greetingAudioUrl || g.mode === 'audio';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm"><span className="text-[#d4d4d8] mr-2">{label}</span>
        {[['text', 'Spoken text'], ['audio', 'Audio file']].map(([m, l]) => <button key={m} type="button" onClick={() => set({ mode: m, greetingAudioUrl: m === 'text' ? null : g.greetingAudioUrl })} className={`civr-pill cursor-pointer ${(audio ? 'audio' : 'text') === m ? 'civr-pill-on' : ''}`} data-testid={`${prefix}-greeting-mode-${m}`}>{l}</button>)}
      </div>
      {audio ? <AudioSelect value={g.greetingAudioUrl} onChange={v => set({ greetingAudioUrl: v || null, mode: 'audio' })} audios={audios} testid={`${prefix}-greeting-audio-select`} />
        : <><textarea rows={2} className="civr-input" value={g.greeting || ''} onChange={e => set({ greeting: e.target.value })} data-testid={`${prefix}-greeting-text-input`} />
          {onAudio && <VoiceMaker text={g.greeting} name={label} onMade={(a) => { onAudio(); set({ greetingAudioUrl: a.audioUrl, mode: 'audio' }); }} testid={`${prefix}-greeting-voice`} />}</>}
    </div>
  );
}

function RowHead({ o, set, onRemove, used, depth, prefix }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select className="civr-input !w-20 font-mono" value={o.digit} onChange={e => set({ digit: e.target.value })} data-testid={`${prefix}-digit-select`}>{DIGITS.filter(d => d === o.digit || !used.includes(d)).map(d => <option key={d}>{d}</option>)}</select>
      <select className="civr-input !w-auto flex-1 min-w-0 max-w-full" value={o.action} onChange={e => set({ action: e.target.value })} data-testid={`${prefix}-action-select`}>{ACTIONS.filter(([a]) => depth === 0 || a !== 'submenu').map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
      <input className="civr-input !w-40" value={o.label || ''} onChange={e => set({ label: e.target.value })} placeholder="Label (e.g. Sales)" data-testid={`${prefix}-label-input`} />
      <button type="button" onClick={onRemove} className="p-2 text-[#a1a1aa] hover:text-[#fb7185]" data-testid={`${prefix}-remove-button`} aria-label="Remove option"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

function ActionFields({ o, set, audios, prefix, onAudio }) {
  if (o.action === 'message' && onAudio) return <div className="space-y-2"><div className="grid md:grid-cols-2 gap-2"><input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Text to read out" data-testid={`${prefix}-message-input`} /><AudioSelect value={o.audioUrl} onChange={v => set({ audioUrl: v || null })} audios={audios} placeholder="…or pick audio" testid={`${prefix}-message-audio-select`} /></div>{o.message && !o.audioUrl && <VoiceMaker text={o.message} name={o.label || `Key ${o.digit}`} onMade={(a) => { onAudio(); set({ audioUrl: a.audioUrl }); }} testid={`${prefix}-message-voice`} />}</div>;
  if (o.action === 'forward') return <input className="civr-input font-mono" value={o.forwardTo || ''} onChange={e => set({ forwardTo: e.target.value })} placeholder="+14155550100" data-testid={`${prefix}-forward-input`} />;
  if (o.action === 'message') return <div className="grid md:grid-cols-2 gap-2"><input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Text to read out" data-testid={`${prefix}-message-input`} /><AudioSelect value={o.audioUrl} onChange={v => set({ audioUrl: v || null })} audios={audios} placeholder="…or pick audio" testid={`${prefix}-message-audio-select`} /></div>;
  return null;
}

// Generic list of menu keys; `render(o, i, used, onChange, onRemove)` draws each row.
function OptionList({ list, setList, prefix, render }) {
  const used = list.map(o => o.digit);
  const free = DIGITS.find(d => !used.includes(d));
  return (
    <div className="space-y-3">
      {list.map((o, i) => render(o, i, used, (n) => setList(list.map((x, j) => (j === i ? n : x))), () => setList(list.filter((_, j) => j !== i))))}
      {free && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setList([...list, { digit: free, action: 'forward', label: '' }])} data-testid={`${prefix}-add-option-button`}><Plus className="w-4 h-4" />Add key {free}</button>}
    </div>
  );
}

function LeafRow({ o, onChange, onRemove, used, audios, prefix, onAudio }) {
  const set = (patch) => onChange({ ...o, ...patch });
  return (
    <div className="border border-[#222] rounded-xl p-4 space-y-3" data-testid={prefix}>
      <RowHead o={o} set={set} onRemove={onRemove} used={used} depth={1} prefix={prefix} />
      <ActionFields o={o} set={set} audios={audios} prefix={prefix} onAudio={onAudio} />
    </div>
  );
}

function TopRow({ o, onChange, onRemove, used, audios, prefix, onAudio }) {
  const { lang } = useLang();
  const set = (patch) => onChange({ ...o, ...patch });
  const sub = o.subMenu || { greeting: defOf(lang).sub, options: [] };
  const sp = `${prefix}-sub`;
  return (
    <div className="border border-[#222] rounded-xl p-4 space-y-3" data-testid={prefix}>
      <RowHead o={o} set={set} onRemove={onRemove} used={used} depth={0} prefix={prefix} />
      <ActionFields o={o} set={set} audios={audios} prefix={prefix} onAudio={onAudio} />
      {o.action === 'submenu' && (
        <div className="pl-4 border-l-2 border-[#34d399]/30 space-y-3">
          <Greeting g={sub} set={(p) => set({ subMenu: { ...sub, ...p } })} audios={audios} prefix={sp} label="Sub-menu greeting" onAudio={onAudio} />
          <OptionList list={sub.options || []} setList={(l) => set({ subMenu: { ...sub, options: l } })} prefix={sp}
            render={(so, i, u, ch, rm) => <LeafRow key={i} o={so} used={u} onChange={ch} onRemove={rm} audios={audios} prefix={`${sp}-option-${i}`} onAudio={onAudio} />} />
        </div>
      )}
    </div>
  );
}

function Analytics({ num }) {
  const { data } = useApi(`/numbers/${enc(num.phoneNumber)}/ivr/analytics`);
  const keys = data?.keys || [];
  const max = Math.max(1, ...keys.map(k => k.count));
  return (
    <div className="civr-card p-6 h-fit" data-testid="ivr-analytics">
      <div className="flex items-center gap-2 font-display text-2xl font-bold mb-4"><BarChart3 className="w-5 h-5 text-[#38bdf8]" />Last 30 days</div>
      {!keys.length ? <div className="text-sm text-[#a1a1aa]">No key presses yet.</div> : keys.map((k, i) => (
        <div key={i} className="mb-3" data-testid={`ivr-analytics-row-${i}`}><div className="flex justify-between text-sm"><span>Key {k.digit} · {k.action}</span><span className="font-mono">{k.count}</span></div><div className="h-1.5 bg-[#1c1c1c] rounded-full mt-1"><div className="h-full bg-[#38bdf8] rounded-full" style={{ width: `${(k.count / max) * 100}%` }} /></div></div>
      ))}
    </div>
  );
}

// Built-in template texts are English; show them in the app language (callers hear that language).
const locOpts = (opts) => Object.fromEntries(Object.entries(opts || {}).map(([d, o]) => [d, { ...o, label: o.label && tr(o.label), message: o.message && tr(o.message), subMenu: o.subMenu ? { ...o.subMenu, greeting: tr(o.subMenu.greeting || ''), options: locOpts(o.subMenu.options) } : undefined }]));

export default function IvrTab({ num, reload }) {
  const { lang } = useLang();
  const langName = (LANGS.find(([c]) => c === lang) || LANGS[0])[1];
  const ivr = num.features.ivr || {};
  const { data, reload: reloadAudio } = useApi('/audio');
  const audios = data?.audios || [];
  const [enabled, setEnabled] = useState(!!ivr.enabled);
  // Keep the switch in step with the saved value (the AI voice agent tab can switch the keypad menu off).
  useEffect(() => { setEnabled(!!ivr.enabled); }, [ivr.enabled]);
  const [g, setG] = useState({ greeting: ivr.greeting || defOf(lang).greeting, greetingAudioUrl: ivr.greetingAudioUrl || null });
  const [list, setList] = useState(toList(ivr.options));
  // On a language switch, greetings still on a built-in default follow the new language; custom text stays.
  useEffect(() => {
    const d = defOf(lang);
    setG(x => (isDef(x.greeting, ['greeting', 'fallback']) && x.greeting !== d.greeting ? { ...x, greeting: d.greeting } : x));
    setList(l => l.map(o => (o.subMenu && isDef(o.subMenu.greeting, ['sub']) && o.subMenu.greeting !== d.sub ? { ...o, subMenu: { ...o.subMenu, greeting: d.sub } } : o)));
  }, [lang]);
  const [save, busy] = useSave(num, 'ivr', reload);
  const u = useUnsaved({ enabled, g, list });
  const current = () => ({ greeting: g.greeting, greetingAudioUrl: g.greetingAudioUrl || null, options: toObj(list) });
  const submit = async () => { if (await save({ enabled, ...current(), language: lang }, 'PUT', (r) => (r?.aiAgentTurnedOff ? 'Saved. The AI voice agent is now off on this number.' : 'Saved'))) u.reset(); };
  const apply = (c) => { setG({ greeting: tr(c.greeting || ''), greetingAudioUrl: c.greetingAudioUrl || null }); setList(toList(locOpts(c.options))); };
  return (
    <div className="grid lg:grid-cols-3 gap-4" {...u.bind}>
      <div className="civr-card p-6 lg:col-span-2 space-y-6" data-testid="ivr-builder">
        <div className="flex items-center justify-between">
          <div><div className="font-display text-2xl font-bold">Keypad menu (IVR)</div><p className="text-sm text-[#a1a1aa]">Callers hear the greeting, then press a key.</p></div>
          <Toggle checked={enabled} onChange={setEnabled} testid="ivr-enabled-toggle" />
        </div>
        {num.features.aiAgent?.enabled && <OneAnswerNote testid="ivr-ai-agent-note">Your AI voice agent answers this number now. Turning the keypad menu on and saving switches the AI voice agent off — a number uses one or the other.</OneAnswerNote>}
        <Greeting g={g} set={(p) => setG({ ...g, ...p })} audios={audios} prefix="ivr" onAudio={reloadAudio} />
        <p className="text-xs text-[#a1a1aa] -mt-3" data-testid="ivr-language-note">{`Callers hear typed text in ${langName}, the app's language. Change the app language to change it.`}</p>
        {!audios.length && <div className="text-xs text-[#a1a1aa]">Want your own recordings? <Link to={cp('/app/audio')} className="text-[#34d399]" data-testid="ivr-audio-library-link">Open the audio library</Link>.</div>}
        <OptionList list={list} setList={setList} prefix="ivr"
          render={(o, i, u, ch, rm) => <TopRow key={i} o={o} used={u} onChange={ch} onRemove={rm} audios={audios} prefix={`ivr-option-${i}`} onAudio={reloadAudio} />} />
        <SaveRow dirty={u.dirty} testid="ivr-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="ivr-save-button">Save keypad menu</button></SaveRow>
      </div>
      <div className="space-y-4"><IvrTemplates current={current} onApply={apply} /><Analytics num={num} /></div>
    </div>
  );
}
