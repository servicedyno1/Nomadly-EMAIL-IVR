import React, { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion, X, Send, Loader2, LifeBuoy, Trash2 } from 'lucide-react';
import { api } from './api';
import { useLang } from './i18n';

// AI help assistant (answers in the app language); offers the human support link when it can't help.
export default function SupportChat({ supportLink }) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(supportLink || '');
  const end = useRef(null);
  useEffect(() => { if (open && msgs === null) api('/support/chat').then(d => { setMsgs(d.messages); if (d.supportLink) setLink(d.supportLink); }).catch(() => setMsgs([])); }, [open, msgs]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  const send = async (e) => {
    e.preventDefault();
    const q = text.trim(); if (!q || busy) return;
    setText(''); setBusy(true); setMsgs(m => [...(m || []), { role: 'user', content: q }]);
    try {
      const d = await api('/support/chat', { method: 'POST', body: { message: q, lang } });
      if (d.supportLink) setLink(d.supportLink);
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || d.message, escalate: d.escalate }]);
    } catch (err) { setMsgs(m => [...m, { role: 'assistant', content: err.message, escalate: true }]); } finally { setBusy(false); }
  };
  const clear = async () => { await api('/support/chat', { method: 'DELETE' }).catch(() => {}); setMsgs([]); };
  return (
    <>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="Help assistant" data-testid="support-chat-toggle"
        className="fixed z-40 right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6 w-14 h-14 rounded-full bg-[#34d399] text-[#04130d] shadow-lg shadow-[#34d399]/20 flex items-center justify-center hover:scale-105 transition-transform">
        {open ? <X className="w-6 h-6" /> : <MessageCircleQuestion className="w-6 h-6" />}
      </button>
      {open && (
        <div className="fixed z-50 right-4 left-4 sm:left-auto sm:w-[400px] bottom-[calc(10rem+env(safe-area-inset-bottom))] lg:bottom-24 h-[min(560px,65vh)] civr-card !bg-[#0d0d0d] flex flex-col civr-rise" data-testid="support-chat-panel">
          <div className="flex items-center gap-2 px-4 h-14 border-b border-[#1c1c1c]">
            <MessageCircleQuestion className="w-5 h-5 text-[#34d399]" /><div className="font-semibold flex-1">Help assistant</div>
            <button type="button" onClick={clear} className="p-2 text-[#888] hover:text-white" aria-label="Clear chat" data-testid="support-chat-clear"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="support-chat-messages">
            {msgs === null ? <Loader2 className="w-4 h-4 animate-spin text-[#888]" /> : !msgs.length && <div className="text-sm text-[#9a9a9a]" data-testid="support-chat-empty">Ask anything about numbers, IVR, campaigns, billing or SIP. I answer instantly, and a person can take over if needed.</div>}
            {(msgs || []).map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''} data-testid={`support-chat-msg-${i}`}>
                <div className={`text-sm whitespace-pre-line rounded-2xl px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'bg-[#34d399]/15 text-[#e6fff5]' : 'bg-[#161616] text-[#ddd]'}`} data-no-translate>{m.content}</div>
                {m.escalate && link && <a href={link} target="_blank" rel="noopener noreferrer" className="civr-btn civr-btn-ghost civr-btn-sm mt-2" data-testid={`support-chat-human-link-${i}`}><LifeBuoy className="w-4 h-4" />Message a person on Telegram</a>}
              </div>
            ))}
            {busy && <div className="text-sm text-[#888] flex items-center gap-2" data-testid="support-chat-typing"><Loader2 className="w-4 h-4 animate-spin" />Thinking…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="p-3 border-t border-[#1c1c1c] flex gap-2">
            <input className="civr-input !h-11" value={text} onChange={e => setText(e.target.value)} maxLength={1000} placeholder="Type your question…" data-testid="support-chat-input" />
            <button className="civr-btn civr-btn-primary !px-3" disabled={busy || !text.trim()} aria-label="Send" data-testid="support-chat-send"><Send className="w-4 h-4" /></button>
          </form>
        </div>
      )}
    </>
  );
}
