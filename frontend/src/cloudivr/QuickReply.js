import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquareReply, Send } from 'lucide-react';
import { api } from './api';
import { usePrivacy } from './privacy';

export const REPLIES = [
  'Sorry I missed your call. I’ll call you back soon.',
  'Can’t talk right now — please text me.',
  'In a meeting. I’ll call you back later.',
  'I’m deaf or hard of hearing — please text me instead.',
];
const CHIP = 'rounded-full border border-white/15 px-3 py-1.5 text-xs text-left text-[#e4e4e7] hover:border-[#34d399] hover:text-white transition-colors disabled:opacity-40';

// Ready-made replies (one tap sends) + a short custom text (one SMS).
export function QuickReply({ onSend, busy, max = 160, testid, sendLabel = 'Send text' }) {
  const [text, setText] = useState('');
  const go = () => { if (text.trim()) onSend(text.trim()); };
  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="flex flex-wrap gap-1.5">{REPLIES.map((r, i) => <button key={r} type="button" disabled={busy} onClick={() => onSend(r)} className={CHIP} data-testid={`${testid}-preset-${i}`}>{r}</button>)}</div>
      <div className="flex gap-2">
        <input className="civr-input !h-9 text-sm" maxLength={max} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Or type your own reply" aria-label="Your reply" data-testid={`${testid}-input`} />
        <button type="button" disabled={busy || !text.trim()} onClick={go} className="civr-btn civr-btn-primary civr-btn-sm shrink-0" data-testid={`${testid}-send-button`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{sendLabel}</button>
      </div>
      <div className="text-[11px] text-[#a1a1aa]" data-testid={`${testid}-count`}>{`${text.length}/${max} · uses 1 text from your plan`}</div>
    </div>
  );
}

// "Text back" for one missed call (Inbox + number logs). Shows the sent reply once done.
export function TextBack({ id, reply, canReply, onDone, testid }) {
  const pv = usePrivacy();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(reply);
  if (done) return <p className="mt-1.5 text-xs text-[#34d399] break-words" data-testid={`${testid}-done`}>{`Texted back: “${pv.text(done.text, 'Message hidden')}”${done.status === 'preview' ? ' (preview — not sent)' : ''}`}</p>;
  if (!canReply) return null;
  const send = async (text) => {
    setBusy(true);
    try {
      const d = await api(`/missed-calls/${id}/reply`, { method: 'POST', body: { text } });
      setDone(d.reply);
      toast.success(d.reply.status === 'preview' ? 'Reply saved (preview — not sent)' : 'Text sent');
      onDone?.();
    } catch (e) { toast.error(e.message); if (e.code === 'already_replied') onDone?.(); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="civr-btn civr-btn-ghost civr-btn-sm mt-2" data-testid={`${testid}-button`}><MessageSquareReply className="w-4 h-4" />Text back</button>;
  return <div className="mt-2 max-w-xl"><QuickReply onSend={send} busy={busy} testid={testid} /></div>;
}
