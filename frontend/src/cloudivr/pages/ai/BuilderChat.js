import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Check } from 'lucide-react';
import { api } from '../../api';
import { EmilyFace, emilyEvent } from '../../Emily';

const HELLO = (rec) => (rec
  ? 'Hi, I’m Emily. Tell me about your business and how calls should be answered — I’ll write the greeting, the answers and the hours for you.'
  : 'Hi, I’m Emily. Tell me who the agent calls and why — I’ll write the opening line and the script for you.');
const EXAMPLES = (rec) => (rec
  ? ['A receptionist for a dental clinic that books cleanings', 'Answer for my plumbing business, take messages after 6pm', 'Greet callers in Spanish and English']
  : ['Call new leads to book a free consultation', 'Remind customers about tomorrow’s appointment', 'Follow up on quotes we sent last week']);
const LABELS = { name: 'Name', businessName: 'Business', language: 'Language', voice: 'Voice', goal: 'Script', firstMessage: 'Opening line', knowledge: 'FAQs', transferTo: 'Transfer', takeMessages: 'Messages', hours: 'Hours', booking: 'Booking', keys: 'Keys', speed: 'Speed', maxMinutes: 'Call length', record: 'Recording', discloseAi: 'AI notice', waitForHello: 'Wait for hello', holdMusic: 'Hold music' };
export const AGENT_SCREEN = 'agent';

// Emily builds the agent: each answer updates the form under her (saved only with Save).
export function BuilderChat({ rec, f, onPatch }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, busy]);
  const send = async (raw) => {
    const t = String(raw ?? text).trim();
    if (!t || busy) return;
    const next = [...msgs, { role: 'user', content: t }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const { keys, ...cur } = f;
      const d = await api('/ai-agents/builder-chat', { method: 'POST', body: { messages: next.map(({ role, content }) => ({ role, content })), current: { ...cur, keys }, role: rec ? 'receptionist' : 'agent' } });
      const changed = Object.keys(d.patch || {});
      if (changed.length) { onPatch(d.patch); emilyEvent('applied', AGENT_SCREEN); }
      setMsgs(m => [...m, { role: 'assistant', content: d.reply, changed }]);
    } catch (err) { setMsgs(m => [...m, { role: 'assistant', content: err.message, error: true }]); } finally { setBusy(false); }
  };
  return (
    <section className="civr-assist" data-testid="ai-builder-chat">
      <div className="flex items-center gap-3 px-4 sm:px-6 pt-4 sm:pt-5">
        <EmilyFace className="w-11 h-11" />
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-tight" data-testid="ai-builder-title">{rec ? 'Emily sets up your receptionist' : 'Emily sets up your agent'}</div>
          <div className="text-xs civr-assist-sub">Chat in plain words. She fills in the details below — nothing is saved until you press Save.</div>
        </div>
      </div>
      <div className="px-4 sm:px-6 pb-4 sm:pb-5 pt-4 space-y-3">
        <div ref={box} className="max-h-[360px] overflow-y-auto space-y-2 pr-1 overscroll-contain" aria-live="polite" data-testid="ai-builder-messages">
          <div className="flex justify-start"><div className="max-w-[90%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed civr-assist-bot" data-testid="ai-builder-msg-hello">{HELLO(rec)}</div></div>
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} civr-assist-in`}>
              <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${m.role === 'user' ? 'civr-assist-me rounded-br-md' : m.error ? 'civr-assist-err rounded-bl-md' : 'civr-assist-bot rounded-bl-md'}`} data-testid={`ai-builder-msg-${i}`}>
                {m.content}
                {m.changed?.length > 0 && <span className="flex flex-wrap gap-1.5 mt-2" data-testid={`ai-builder-msg-${i}-changes`}>{m.changed.map(k => <span key={k} className="inline-flex items-center gap-1 rounded-full civr-assist-tag text-[11px] px-2 py-0.5"><Check className="w-3 h-3" />{LABELS[k] || k}</span>)}</span>}
              </div>
            </div>
          ))}
          {busy && <div className="text-xs civr-assist-sub flex items-center gap-2 px-1" data-testid="ai-builder-typing"><Loader2 className="w-3.5 h-3.5 animate-spin" />Emily is writing…</div>}
        </div>
        {!msgs.length && <div className="flex flex-wrap gap-1.5" data-testid="ai-builder-examples">{EXAMPLES(rec).map((e, i) => <button key={e} type="button" onClick={() => send(e)} className="civr-assist-chip text-left text-xs rounded-full px-3 py-1.5 min-h-[32px]" data-testid={`ai-builder-example-${i}`}>{e}</button>)}</div>}
        <div className="flex gap-2">
          <input className="civr-input flex-1" value={text} onChange={e => setText(e.target.value)} disabled={busy} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} placeholder={msgs.length ? 'e.g. “speak a bit slower” or “add press 0 for a message”' : 'Describe your business or what the call is for…'} aria-label="Message Emily" data-testid="ai-builder-input" />
          <button type="button" onClick={() => send()} className="civr-btn civr-btn-primary !px-3" disabled={busy || !text.trim()} aria-label="Send" data-testid="ai-builder-send">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
        </div>
      </div>
    </section>
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
