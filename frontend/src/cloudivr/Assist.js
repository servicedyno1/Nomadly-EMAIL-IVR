import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, Send, Sparkles, Undo2, Check, MessageSquare, SlidersHorizontal, Wand2 } from 'lucide-react';
import { api } from './api';

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k]]));
const modeKey = (screen) => `civr-assist-mode-${screen}`;
const YES = /^\s*(yes|yep|yeah|yup|sure|ok(ay)?|do it|go ahead|apply( it)?|fill( it)? in|looks good|perfect|great|confirm(ed)?|please do|sounds good)\b[\s.!]*$/i;
const DONE = (action) => `Done — I’ve filled in the form below. Check it, then press ${action}. Want to change anything?`;
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

function Proposal({ m, i, prefix, labels, onApply, onEdit }) {
  return (
    <div className="mt-2.5 rounded-xl border border-[var(--c-border)] bg-[var(--c-card)] p-3 space-y-2" data-testid={`${prefix}-proposal-${i}`}>
      <div className="text-[11px] uppercase tracking-wider font-semibold civr-assist-sub">Suggested setup</div>
      {m.missing?.length > 0 && <div className="rounded-lg border border-[#fbbf24]/40 bg-[#fbbf24]/10 px-2.5 py-2 text-[12px] space-y-0.5" data-testid={`${prefix}-proposal-${i}-missing`}><div className="font-semibold">Still needed before it works</div>{m.missing.map((x, j) => <div key={j}>• {x}</div>)}</div>}
      {m.summary?.length > 0 && <ul className="space-y-1 text-[13px]" data-testid={`${prefix}-proposal-${i}-summary`}>{m.summary.map((l, j) => <li key={j} className="flex gap-2"><span className="civr-assist-link">•</span><span>{l}</span></li>)}</ul>}
      <div className="flex flex-wrap gap-1.5">{m.changed.map(k => <span key={k} className="rounded-full civr-assist-tag text-[11px] px-2 py-0.5">{labels[k] || k}</span>)}</div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onApply} className="civr-btn civr-btn-primary civr-btn-sm" data-testid={`${prefix}-apply`}><Wand2 className="w-3.5 h-3.5" />{m.missing?.length ? 'Fill in what we have' : 'Fill in the form'}</button>
        <button type="button" onClick={onEdit} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${prefix}-edit`}>Change something</button>
      </div>
    </div>
  );
}

function Bubble({ m, i, prefix, labels, pending, canUndo, onApply, onEdit, onUndo }) {
  const user = m.role === 'user';
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'} civr-assist-in`} data-testid={`${prefix}-msg-${i}`}>
      <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${user ? 'civr-assist-me rounded-br-md' : m.error ? 'civr-assist-err rounded-bl-md' : 'civr-assist-bot rounded-bl-md'}`}>
        {m.content}
        {pending && <Proposal m={m} i={i} prefix={prefix} labels={labels} onApply={onApply} onEdit={onEdit} />}
        {m.applied && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2" data-testid={`${prefix}-msg-${i}-changes`}>
            {m.undone ? <span className="text-[11px] civr-assist-sub" data-testid={`${prefix}-msg-${i}-undone`}>Changes undone</span>
              : m.changed.map(k => <span key={k} className="inline-flex items-center gap-1 rounded-full civr-assist-tag text-[11px] px-2 py-0.5"><Check className="w-3 h-3" />{labels[k] || k}</span>)}
            {canUndo && !m.undone && <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 text-[11px] civr-assist-link hover:underline ml-1 min-h-[28px]" data-testid={`${prefix}-undo`}><Undo2 className="w-3 h-3" />Undo</button>}
          </div>
        )}
        {m.stale && <div className="text-[11px] civr-assist-sub mt-1.5">Replaced by a newer suggestion</div>}
      </div>
    </div>
  );
}

function ModeSwitch({ mode, setMode, prefix }) {
  const opt = (id, Icon, label) => (
    <button type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={`civr-seg-btn inline-flex items-center gap-1.5 rounded-lg px-3 min-h-[34px] text-xs font-medium border border-transparent ${mode === id ? 'civr-seg-on' : 'civr-assist-sub'}`} data-testid={`${prefix}-mode-${id}`}><Icon className="w-3.5 h-3.5" />{label}</button>
  );
  return <div className="inline-flex gap-1 rounded-xl border border-[var(--c-border)] bg-[var(--c-card)] p-1" role="radiogroup" aria-label="How to set this up" data-testid={`${prefix}-mode`}>{opt('chat', MessageSquare, 'Chat')}{opt('manual', SlidersHorizontal, 'Manual')}</div>;
}

// Guided chat that suggests a setup, asks to confirm, then fills in the settings form below. Nothing is saved here.
// screen: backend schema id · current: form values · context: facts about the account · onApply(patch): merge into the form.
export function Assist({ screen, title, hello, examples = [], current, context, onApply, labels = {}, testid, saveLabel = 'Save' }) {
  const prefix = testid || `assist-${screen}`;
  const [mode, setModeState] = useState(() => localStorage.getItem(modeKey(screen)) || 'chat');
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null);
  const box = useRef(null);
  const input = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, busy]);
  const setMode = (m) => { localStorage.setItem(modeKey(screen), m); setModeState(m); };
  const pendingAt = msgs.findIndex(m => m.proposal && !m.applied && !m.stale);

  const apply = (i, extra = []) => {
    const m = msgs[i];
    setUndo({ at: i, before: pick(current, Object.keys(m.proposal)) });
    onApply(m.proposal);
    setMsgs([...msgs.map((x, j) => (j === i ? { ...x, applied: true } : x)), ...extra, { role: 'assistant', content: DONE(saveLabel) }]);
  };
  const send = async (raw) => {
    const t = String(raw ?? text).trim();
    if (!t || busy) return;
    setText('');
    if (pendingAt >= 0 && YES.test(t)) { apply(pendingAt, [{ role: 'user', content: t }]); return; }
    const next = [...msgs.filter(m => !m.error).map(m => (m.proposal && !m.applied ? { ...m, stale: true } : m)), { role: 'user', content: t }];
    setMsgs(next); setBusy(true);
    try {
      const d = await api(`/assist/${screen}`, { method: 'POST', body: { messages: next.map(({ role, content }) => ({ role, content })), current, context } });
      const keys = Object.keys(d.patch || {}).filter(k => !same(d.patch[k], current?.[k]));
      setMsgs(m => [...m, { role: 'assistant', content: d.reply, ...(keys.length ? { proposal: pick(d.patch, keys), summary: d.summary, missing: d.missing, changed: keys } : {}) }]);
    } catch (err) {
      setMsgs(m => [...m, { role: 'assistant', content: err.message || 'Something went wrong. Try again.', error: true, retry: t }]);
    } finally { setBusy(false); setTimeout(() => input.current?.focus(), 0); }
  };
  const doUndo = () => { if (!undo) return; onApply(undo.before); setMsgs(m => m.map((x, i) => (i === undo.at ? { ...x, undone: true } : x))); setUndo(null); };
  const restart = () => { setMsgs([]); setUndo(null); setText(''); };
  const last = msgs[msgs.length - 1];

  return (
    <section className="civr-assist" data-testid={prefix}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="shrink-0 w-8 h-8 rounded-xl civr-assist-icon grid place-items-center"><Sparkles className="w-4 h-4" /></span>
        <div className="flex-1 min-w-[12rem]">
          <div className="text-sm font-semibold">{title || 'Set this up by chatting'}</div>
          <div className="text-xs civr-assist-sub" data-testid={`${prefix}-mode-note`}>{mode === 'chat' ? 'I ask a few questions, suggest a setup and fill in the form once you agree. Nothing is saved until you press Save.' : 'You’re setting this up by hand below. Switch to Chat any time — your entries are kept.'}</div>
        </div>
        {mode === 'chat' && msgs.length > 0 && <button type="button" onClick={restart} className="civr-btn civr-btn-ghost civr-btn-sm !px-2" aria-label="Start over" title="Start over" data-testid={`${prefix}-restart`}><RotateCcw className="w-4 h-4" /></button>}
        <ModeSwitch mode={mode} setMode={setMode} prefix={prefix} />
      </div>
      {mode === 'chat' && (
        <div className="px-4 pb-4 space-y-3" data-testid={`${prefix}-panel`}>
          {msgs.length === 0 ? (
            <div className="space-y-2.5" data-testid={`${prefix}-intro`}>
              {hello && <p className="text-sm">{hello}</p>}
              <div className="flex flex-wrap gap-1.5">
                {examples.map((e, i) => <button key={e} type="button" onClick={() => send(e)} className="civr-assist-chip text-left text-xs rounded-full px-3 py-1.5 min-h-[32px]" data-testid={`${prefix}-example-${i}`}>{e}</button>)}
              </div>
            </div>
          ) : (
            <div ref={box} className="max-h-[380px] overflow-y-auto space-y-2 pr-1 overscroll-contain" aria-live="polite" data-testid={`${prefix}-messages`}>
              {msgs.map((m, i) => <Bubble key={i} m={m} i={i} prefix={prefix} labels={labels} pending={i === pendingAt} canUndo={undo?.at === i} onApply={() => apply(i)} onEdit={() => input.current?.focus()} onUndo={doUndo} />)}
              {busy && <div className="flex items-center gap-2 text-xs civr-assist-sub px-1" data-testid={`${prefix}-typing`}><Loader2 className="w-3.5 h-3.5 animate-spin" />Thinking…</div>}
            </div>
          )}
          {last?.error && last.retry && !busy && <button type="button" onClick={() => send(last.retry)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${prefix}-retry`}><RotateCcw className="w-3.5 h-3.5" />Try again</button>}
          <div className="flex gap-2">
            <input ref={input} className="civr-input flex-1" value={text} onChange={e => setText(e.target.value)} disabled={busy}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={pendingAt >= 0 ? 'Say “yes” to fill it in, or tell me what to change…' : msgs.length ? 'Type your answer…' : (examples[0] ? `e.g. “${examples[0]}”` : 'Describe what you want…')} aria-label="Message the setup assistant" data-testid={`${prefix}-input`} />
            <button type="button" onClick={() => send()} className="civr-btn civr-btn-primary !px-3" disabled={busy || !text.trim()} aria-label="Send" data-testid={`${prefix}-send`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
          </div>
        </div>
      )}
    </section>
  );
}
