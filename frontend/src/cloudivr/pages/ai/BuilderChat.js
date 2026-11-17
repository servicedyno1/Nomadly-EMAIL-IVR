import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { api } from '../../api';

const HELLO = (rec) => (rec
  ? 'Hi! Tell me about your business and how calls should be answered, e.g. "a receptionist for a dental clinic that books cleanings". I’ll fill in the form as we go.'
  : 'Hi! Tell me who the agent calls and why, e.g. "call new leads to book a free consultation". I’ll fill in the form as we go.');

// Chat with our AI to set up the agent; each answer updates the form next to it (saved only with Save).
export function BuilderChat({ rec, f, onPatch }) {
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: HELLO(rec) }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs, busy]);
  const send = async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    const next = [...msgs, { role: 'user', content: t }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const { keys, ...cur } = f;
      const d = await api('/ai-agents/builder-chat', { method: 'POST', body: { messages: next.slice(1), current: { ...cur, keys }, role: rec ? 'receptionist' : 'agent' } });
      if (d.patch && Object.keys(d.patch).length) onPatch(d.patch);
      setMsgs(m => [...m, { role: 'assistant', content: d.reply, changed: Object.keys(d.patch || {}) }]);
    } catch (err) { setMsgs(m => [...m, { role: 'assistant', content: err.message, error: true }]); } finally { setBusy(false); }
  };
  return (
    <aside className="civr-card p-4 flex flex-col h-[560px] lg:sticky lg:top-24" data-testid="ai-builder-chat">
      <div className="flex items-center gap-2 text-sm font-semibold mb-3"><Sparkles className="w-4 h-4 text-[#818cf8]" />Set up by chatting</div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1" data-testid="ai-builder-messages">
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-[#6366f1] text-white' : m.error ? 'bg-[#2a1215] text-[#fda4af]' : 'bg-[#15151f] text-[#e4e4e7]'}`} data-testid={`ai-builder-msg-${i}`}>
            {m.content}
            {m.changed?.length > 0 && <span className="block text-[11px] text-[#a5b4fc] mt-1">Updated: {m.changed.join(', ')}</span>}
          </div>
        ))}
        {busy && <div className="text-xs text-[#a1a1aa] flex items-center gap-2" data-testid="ai-builder-typing"><Loader2 className="w-3 h-3 animate-spin" />Writing…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 mt-3">
        <input className="civr-input flex-1" value={text} onChange={e => setText(e.target.value)} placeholder='e.g. "speak a bit slower" or "add press 0 for a message"' data-testid="ai-builder-input" />
        <button className="civr-btn civr-btn-primary" disabled={busy || !text.trim()} aria-label="Send" data-testid="ai-builder-send"><Send className="w-4 h-4" /></button>
      </form>
    </aside>
  );
}

// Talking speed: 0.75 (slow) – 1.3 (fast).
export function SpeedField({ f, set }) {
  const v = Number(f.speed) || 1;
  return (
    <div data-testid="ai-speed-field">
      <div className="flex justify-between text-sm"><span>Talking speed</span><span className="font-mono text-[#a5b4fc]" data-testid="ai-speed-value">{`${v.toFixed(2)}×`}</span></div>
      <input type="range" min={0.75} max={1.3} step={0.05} value={v} onChange={e => set('speed', Number(e.target.value))} className="w-full accent-[#818cf8]" aria-label="Talking speed" data-testid="ai-speed-slider" />
      <div className="flex justify-between text-[11px] text-[#a1a1aa]"><span>Slower</span><span>Normal</span><span>Faster</span></div>
    </div>
  );
}
