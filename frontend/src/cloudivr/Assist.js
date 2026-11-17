import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, RotateCcw, Send, Sparkles, Undo2, Check } from 'lucide-react';
import { api } from './api';

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k]]));
const openKey = (screen) => `civr-assist-open-${screen}`;

function Bubble({ m, i, prefix, canUndo, onUndo, labels }) {
  const user = m.role === 'user';
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'} civr-assist-in`} data-testid={`${prefix}-msg-${i}`}>
      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${user ? 'civr-assist-me rounded-br-md' : m.error ? 'civr-assist-err rounded-bl-md' : 'civr-assist-bot rounded-bl-md'}`}>
        {m.content}
        {m.changed?.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2" data-testid={`${prefix}-msg-${i}-changes`}>
            {m.undone ? <span className="text-[11px] civr-assist-sub" data-testid={`${prefix}-msg-${i}-undone`}>Changes undone</span>
              : m.changed.map(k => <span key={k} className="inline-flex items-center gap-1 rounded-full civr-assist-tag text-[11px] px-2 py-0.5"><Check className="w-3 h-3" />{labels[k] || k}</span>)}
            {canUndo && !m.undone && <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 text-[11px] civr-assist-link hover:underline ml-1 min-h-[28px]" data-testid={`${prefix}-undo`}><Undo2 className="w-3 h-3" />Undo</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// Chat that fills in the settings form next to it. Nothing is saved here — the page's own Save button does that.
// screen: backend schema id · current: form values sent to the AI · onApply(patch): merge values into the form.
export function Assist({ screen, title, hello, examples = [], current, onApply, labels = {}, testid }) {
  const prefix = testid || `assist-${screen}`;
  const [open, setOpen] = useState(() => localStorage.getItem(openKey(screen)) !== '0');
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null);
  const box = useRef(null);
  const input = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, busy]);
  const toggle = () => setOpen(o => { localStorage.setItem(openKey(screen), o ? '0' : '1'); return !o; });

  const send = async (raw) => {
    const t = String(raw ?? text).trim();
    if (!t || busy) return;
    const next = [...msgs.filter(m => !m.error), { role: 'user', content: t }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const d = await api(`/assist/${screen}`, { method: 'POST', body: { messages: next.map(({ role, content }) => ({ role, content })), current } });
      const keys = Object.keys(d.patch || {});
      if (keys.length) { setUndo({ at: next.length, before: pick(current, keys) }); onApply(d.patch); }
      setMsgs(m => [...m, { role: 'assistant', content: d.reply, changed: keys }]);
    } catch (err) {
      setMsgs(m => [...m, { role: 'assistant', content: err.message || 'Something went wrong. Try again.', error: true, retry: t }]);
    } finally { setBusy(false); setTimeout(() => input.current?.focus(), 0); }
  };
  const doUndo = () => { if (!undo) return; onApply(undo.before); setMsgs(m => m.map((x, i) => (i === undo.at ? { ...x, undone: true } : x))); setUndo(null); };
  const restart = () => { setMsgs([]); setUndo(null); setText(''); };
  const last = msgs[msgs.length - 1];

  return (
    <section className="civr-assist" data-testid={prefix}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex-1 min-w-0 flex items-center gap-3 text-left min-h-[40px]" data-testid={`${prefix}-toggle`}>
          <span className="shrink-0 w-8 h-8 rounded-xl civr-assist-icon grid place-items-center"><Sparkles className="w-4 h-4" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{title || 'Set this up by chatting'}</span>
            <span className="block text-xs civr-assist-sub sm:truncate">Describe it in your words — I fill in the form below. Nothing is saved until you press Save.</span>
          </span>
          <ChevronDown className={`w-4 h-4 civr-assist-sub ml-auto shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && msgs.length > 0 && <button type="button" onClick={restart} className="civr-btn civr-btn-ghost civr-btn-sm !px-2" aria-label="Start over" title="Start over" data-testid={`${prefix}-restart`}><RotateCcw className="w-4 h-4" /></button>}
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-3" data-testid={`${prefix}-panel`}>
          {msgs.length === 0 ? (
            <div className="space-y-2.5" data-testid={`${prefix}-intro`}>
              {hello && <p className="text-sm">{hello}</p>}
              <div className="flex flex-wrap gap-1.5">
                {examples.map((e, i) => <button key={e} type="button" onClick={() => send(e)} className="civr-assist-chip text-left text-xs rounded-full px-3 py-1.5 min-h-[32px]" data-testid={`${prefix}-example-${i}`}>{e}</button>)}
              </div>
            </div>
          ) : (
            <div ref={box} className="max-h-[320px] overflow-y-auto space-y-2 pr-1 overscroll-contain" aria-live="polite" data-testid={`${prefix}-messages`}>
              {msgs.map((m, i) => <Bubble key={i} m={m} i={i} prefix={prefix} labels={labels} canUndo={undo?.at === i} onUndo={doUndo} />)}
              {busy && <div className="flex items-center gap-2 text-xs civr-assist-sub px-1" data-testid={`${prefix}-typing`}><Loader2 className="w-3.5 h-3.5 animate-spin" />Filling in the form…</div>}
            </div>
          )}
          {last?.error && last.retry && !busy && <button type="button" onClick={() => send(last.retry)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${prefix}-retry`}><RotateCcw className="w-3.5 h-3.5" />Try again</button>}
          <div className="flex gap-2">
            <input ref={input} className="civr-input flex-1" value={text} onChange={e => setText(e.target.value)} disabled={busy}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={msgs.length ? 'Reply, or ask for a change…' : (examples[0] ? `e.g. “${examples[0]}”` : 'Describe what you want…')} aria-label="Message the setup assistant" data-testid={`${prefix}-input`} />
            <button type="button" onClick={() => send()} className="civr-btn civr-btn-primary !px-3" disabled={busy || !text.trim()} aria-label="Send" data-testid={`${prefix}-send`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
          </div>
        </div>
      )}
    </section>
  );
}
