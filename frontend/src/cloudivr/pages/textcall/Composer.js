import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Grid3x3, Send } from 'lucide-react';
import { api } from '../../api';
import { Toggle } from '../../ui';
import { recall, remember } from '../../consent';

const PHRASES = {
  en: ['One moment, I’m typing.', 'Could you repeat that, please?', 'Please speak a little slower.', 'Yes.', 'No.', 'Thank you, goodbye.'],
  es: ['Un momento, estoy escribiendo.', '¿Puede repetirlo, por favor?', 'Hable un poco más despacio, por favor.', 'Sí.', 'No.', 'Gracias, adiós.'],
  fr: ['Un instant, j’écris.', 'Pouvez-vous répéter, s’il vous plaît ?', 'Parlez un peu plus lentement, s’il vous plaît.', 'Oui.', 'Non.', 'Merci, au revoir.'],
};
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const ABBR = /\b(mr|mrs|ms|dr|st|sr|jr|vs|etc|e\.g|i\.e|no|approx|apt|ave|sra|srta|mme|mlle|m)\.$/i;
const PING_MS = 2500;

// "Hi there. How are" → ["Hi there.", "How are"]: everything up to the last finished sentence (., !, ?, … then a space).
export function readySentences(v) {
  const re = /[.!?…]+["'”’»)\]]*\s+/g;
  let cut = -1, m;
  while ((m = re.exec(v))) { const head = v.slice(0, m.index + m[0].length).trim(); if (!ABBR.test(head) && /[\p{L}\p{N}]{2,}/u.test(head)) cut = m.index + m[0].length; }
  return cut > 0 ? [v.slice(0, cut).trim(), v.slice(cut)] : null;
}

function useFlag(key, def) {
  const [v, setV] = useState(() => (recall(key) ?? String(def)) === 'true');
  return [v, (x) => { remember('preferences', key, String(x)); setV(x); }];
}

function Keypad({ id }) {
  const queue = useRef(Promise.resolve());
  // One press at a time so the tones reach the phone menu in the order they were tapped.
  const press = (k) => { queue.current = queue.current.then(() => api(`/relay/calls/${id}/keys`, { method: 'POST', body: { digits: k } }).catch(err => toast.error(err.message))); };
  return (
    <div className="grid grid-cols-3 gap-2 max-w-[260px]" data-testid="relay-keypad">
      {KEYS.map(k => <button key={k} type="button" onClick={() => press(k)} className="civr-btn civr-btn-ghost h-12 text-lg font-mono" aria-label={`Press ${k}`} data-testid={`relay-key-btn-${k === '*' ? 'star' : k === '#' ? 'hash' : k}`}>{k}</button>)}
    </div>
  );
}

const Opt = ({ label, on, set, testid }) => <label className="inline-flex items-center gap-2 text-xs text-[#a1a1aa] cursor-pointer"><Toggle checked={on} onChange={set} testid={testid} />{label}</label>;

// Type → spoken to them. Enter sends; with "Speak each sentence" on, a finished sentence goes as soon as you type the space after it.
export function Composer({ call, maxText = 1000, extra }) {
  const [text, setText] = useState('');
  const [pad, setPad] = useState(false);
  const [stream, setStream] = useFlag('civr_relay_stream', true);
  const [clicks, setClicks] = useFlag('civr_relay_typing', true);
  const input = useRef(null);
  const queue = useRef(Promise.resolve());
  const lastPing = useRef(0);
  const live = call.status === 'live';
  useEffect(() => { if (live) input.current?.focus({ preventScroll: true }); }, [live]);
  // Messages are spoken in order, one request at a time; a failed one goes back into the box.
  const speak = (v) => {
    lastPing.current = 0;
    queue.current = queue.current.then(() => api(`/relay/calls/${call.id}/say`, { method: 'POST', body: { text: v } }))
      .catch(err => { toast.error(err.message); setText(t => (t.trim() ? `${v} ${t}` : v)); });
  };
  const send = (t) => { const v = String(t ?? text).trim(); if (!v || !live) return; if (t === undefined) setText(''); speak(v); };
  const ping = (on = true) => api(`/relay/calls/${call.id}/typing`, { method: 'POST', body: { on } }).catch(() => {});
  const onChange = (e) => {
    let v = e.target.value;
    if (live && clicks && v.trim() && Date.now() - lastPing.current > PING_MS) { lastPing.current = Date.now(); ping(); }
    const r = live && stream && e.target.selectionStart === v.length ? readySentences(v) : null;
    if (r) { speak(r[0]); v = r[1]; }
    setText(v);
  };
  const setTyping = (x) => { setClicks(x); if (!x && live) ping(false); };
  return (
    <div className="space-y-3" data-testid="relay-composer">
      <div className="flex gap-2 overflow-x-auto sm:flex-wrap pb-1 -mx-1 px-1" data-no-translate>
        {(PHRASES[call.lang] || PHRASES.en).map((p, i) => <button key={p} type="button" disabled={!live} onClick={() => send(p)} className="civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-9 shrink-0 disabled:opacity-40" data-testid={`relay-phrase-${i}`}>{p}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 items-end">
        <textarea ref={input} className="civr-input min-h-[56px] max-h-40 text-lg" rows={2} maxLength={maxText} disabled={!live} value={text} onChange={onChange} placeholder={live ? 'Type what they should hear…' : 'You can type once they answer'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} aria-label="Message to speak" data-testid="relay-input" />
        <button className="civr-btn civr-btn-primary h-14 px-5 shrink-0" disabled={!live || !text.trim()} data-testid="relay-send-button"><Send className="w-5 h-5" /><span className="hidden sm:inline">Speak</span></button>
      </form>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-testid="relay-options">
        <Opt label="Speak each sentence as I finish it" on={stream} set={setStream} testid="relay-stream-toggle" />
        <Opt label="Soft typing sound for them while I type" on={clicks} set={setTyping} testid="relay-typing-toggle" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setPad(p => !p)} disabled={!live} className="inline-flex items-center gap-1.5 text-sm text-[#a1a1aa] hover:text-[#818cf8] disabled:opacity-40" aria-expanded={pad} data-testid="relay-keypad-toggle"><Grid3x3 className="w-4 h-4" />{pad ? 'Hide keypad' : 'Keypad for phone menus'}</button>
        {extra}
      </div>
      {pad && live && <Keypad id={call.id} />}
    </div>
  );
}
