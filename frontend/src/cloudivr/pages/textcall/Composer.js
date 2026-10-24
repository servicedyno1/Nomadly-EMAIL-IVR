import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Grid3x3, Loader2, Send } from 'lucide-react';
import { api } from '../../api';

const PHRASES = {
  en: ['One moment, I’m typing.', 'Could you repeat that, please?', 'Please speak a little slower.', 'Yes.', 'No.', 'Thank you, goodbye.'],
  es: ['Un momento, estoy escribiendo.', '¿Puede repetirlo, por favor?', 'Hable un poco más despacio, por favor.', 'Sí.', 'No.', 'Gracias, adiós.'],
  fr: ['Un instant, j’écris.', 'Pouvez-vous répéter, s’il vous plaît ?', 'Parlez un peu plus lentement, s’il vous plaît.', 'Oui.', 'Non.', 'Merci, au revoir.'],
};
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

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

// Type → spoken to them. Enter sends, Shift+Enter makes a new line.
export function Composer({ call, maxText = 1000, extra }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pad, setPad] = useState(false);
  const input = useRef(null);
  const live = call.status === 'live';
  useEffect(() => { if (live) input.current?.focus({ preventScroll: true }); }, [live]);
  const send = async (t) => {
    const v = String(t ?? text).trim();
    if (!v || !live || busy) return;
    setBusy(true);
    try { await api(`/relay/calls/${call.id}/say`, { method: 'POST', body: { text: v } }); if (t === undefined) setText(''); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3" data-testid="relay-composer">
      <div className="flex gap-2 overflow-x-auto sm:flex-wrap pb-1 -mx-1 px-1" data-no-translate>
        {(PHRASES[call.lang] || PHRASES.en).map((p, i) => <button key={p} type="button" disabled={!live} onClick={() => send(p)} className="civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-9 shrink-0 disabled:opacity-40" data-testid={`relay-phrase-${i}`}>{p}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 items-end">
        <textarea ref={input} className="civr-input min-h-[56px] max-h-40 text-lg" rows={2} maxLength={maxText} disabled={!live} value={text} onChange={e => setText(e.target.value)} placeholder={live ? 'Type what they should hear…' : 'You can type once they answer'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} aria-label="Message to speak" data-testid="relay-input" />
        <button className="civr-btn civr-btn-primary h-14 px-5 shrink-0" disabled={!live || busy || !text.trim()} data-testid="relay-send-button">{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}<span className="hidden sm:inline">Speak</span></button>
      </form>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setPad(p => !p)} disabled={!live} className="inline-flex items-center gap-1.5 text-sm text-[#a1a1aa] hover:text-[#34d399] disabled:opacity-40" aria-expanded={pad} data-testid="relay-keypad-toggle"><Grid3x3 className="w-4 h-4" />{pad ? 'Hide keypad' : 'Keypad for phone menus'}</button>
        {extra}
      </div>
      {pad && live && <Keypad id={call.id} />}
    </div>
  );
}
