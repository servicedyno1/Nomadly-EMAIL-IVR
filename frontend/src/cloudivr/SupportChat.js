import React, { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion, X, Send, Loader2, LifeBuoy, Trash2 } from 'lucide-react';
import { api } from './api';
import { useLang } from './i18n';

const VKEY = 'civr.visitor';
// Anonymous id for the landing-page chat thread (kept in this browser).
function visitorId() {
  const fresh = () => `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try { let v = localStorage.getItem(VKEY); if (!v) { v = fresh(); localStorage.setItem(VKEY, v); } return v; } catch (_) { return fresh(); }
}

function Bubble({ m, i, link }) {
  return (
    <div className={m.role === 'user' ? 'flex flex-col items-end' : ''} data-testid={`support-chat-msg-${i}`}>
      <div className={`text-sm leading-relaxed whitespace-pre-line rounded-2xl px-3.5 py-2.5 max-w-[85%] ${m.role === 'user' ? 'bg-[#34d399]/15 text-[#e6fff5]' : 'bg-[#1c1c1c] text-[#e4e4e7]'}`} data-no-translate>{m.content}</div>
      {m.escalate && link && <a href={link} target="_blank" rel="noopener noreferrer" className="civr-btn civr-btn-ghost civr-btn-sm mt-2" data-testid={`support-chat-human-link-${i}`}><LifeBuoy className="w-4 h-4" />Message a person on Telegram</a>}
    </div>
  );
}

// AI help assistant (answers in the app language); offers the human support link when it can't help.
// `visitor` = landing page (not signed in): anonymous thread, 10 questions an hour.
export default function SupportChat({ supportLink, visitor = false }) {
  const { lang } = useLang();
  const [vid] = useState(() => (visitor ? visitorId() : null));
  const base = visitor ? '/public/support/chat' : '/support/chat';
  const q = vid ? `?visitorId=${encodeURIComponent(vid)}` : '';
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(supportLink || '');
  const end = useRef(null);
  useEffect(() => { if (supportLink) setLink(supportLink); }, [supportLink]);
  useEffect(() => { if (open && msgs === null) api(`${base}${q}`).then(d => { setMsgs(d.messages); if (d.supportLink) setLink(d.supportLink); }).catch(() => setMsgs([])); }, [open, msgs, base, q]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  const send = async (e) => {
    e.preventDefault();
    const t = text.trim(); if (!t || busy) return;
    setText(''); setBusy(true); setMsgs(m => [...(m || []), { role: 'user', content: t }]);
    try {
      const d = await api(base, { method: 'POST', body: { message: t, lang, ...(vid ? { visitorId: vid } : {}) } });
      if (d.supportLink) setLink(d.supportLink);
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || d.message, escalate: d.escalate }]);
    } catch (err) { setMsgs(m => [...m, { role: 'assistant', content: err.message, escalate: true }]); } finally { setBusy(false); }
  };
  const clear = async () => { await api(`${base}${q}`, { method: 'DELETE' }).catch(() => {}); setMsgs([]); };
  const bottom = visitor ? 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6';
  const panelBottom = visitor ? 'bottom-[calc(6rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(10rem+env(safe-area-inset-bottom))] lg:bottom-24';
  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="Help assistant" data-testid="support-chat-toggle"
        className={`fixed z-40 right-4 ${bottom} w-14 h-14 rounded-full bg-[#34d399] text-[#04130d] shadow-lg shadow-[#34d399]/25 flex items-center justify-center hover:scale-105 transition-transform`}>
        {open ? <X className="w-6 h-6" /> : <MessageCircleQuestion className="w-6 h-6" />}
      </button>
      {open && (
        <div className={`fixed z-50 right-4 left-4 sm:left-auto sm:w-[400px] ${panelBottom} h-[min(560px,65vh)] civr-card !bg-[#0f0f0f] shadow-2xl shadow-black/60 flex flex-col civr-rise text-[#f3f4f6]`} data-testid="support-chat-panel">
          <div className="flex items-center gap-2 px-4 h-14 border-b border-[#262626]">
            <MessageCircleQuestion className="w-5 h-5 text-[#34d399]" /><div className="font-semibold flex-1">Help assistant</div>
            <button type="button" onClick={clear} className="p-2 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5" aria-label="Clear chat" data-testid="support-chat-clear"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="support-chat-messages">
            {msgs === null ? <Loader2 className="w-4 h-4 animate-spin text-[#a1a1aa]" /> : !msgs.length && <div className="text-sm text-[#a1a1aa] leading-relaxed" data-testid="support-chat-empty">{visitor ? 'Ask anything about plans, prices, countries or how CloudIVR works. I answer instantly, and a person can take over if needed.' : 'Ask anything about numbers, IVR, campaigns, billing or SIP. I answer instantly, and a person can take over if needed.'}</div>}
            {(msgs || []).map((m, i) => <Bubble key={i} m={m} i={i} link={link} />)}
            {busy && <div className="text-sm text-[#a1a1aa] flex items-center gap-2" data-testid="support-chat-typing"><Loader2 className="w-4 h-4 animate-spin" />Thinking…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="p-3 border-t border-[#262626] flex gap-2">
            <input className="civr-input !h-11" value={text} onChange={e => setText(e.target.value)} maxLength={1000} placeholder="Type your question…" data-testid="support-chat-input" />
            <button className="civr-btn civr-btn-primary !px-3 shrink-0" disabled={busy || !text.trim()} aria-label="Send" data-testid="support-chat-send"><Send className="w-4 h-4" /></button>
          </form>
        </div>
      )}
    </>
  );
}
