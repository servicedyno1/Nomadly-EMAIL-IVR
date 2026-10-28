import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquareReply, Send, Check, CheckCheck, AlertTriangle } from 'lucide-react';
import { api } from './api';
import { usePrivacy } from './privacy';
import { useDestCheck, DestNote } from './SmsReach';

export const REPLIES = [
  'Sorry I missed your call. I’ll call you back soon.',
  'Can’t talk right now — please text me.',
  'In a meeting. I’ll call you back later.',
  'I’m deaf or hard of hearing — please text me instead.',
];
export const SMS_REPLIES = [
  'Thanks, got your message.',
  'I’ll get back to you shortly.',
  'Please call me when you can.',
  'I’m deaf or hard of hearing — texting works best for me.',
];
const CHIP = 'rounded-full border border-white/15 px-3 py-1.5 text-xs text-left text-[#e4e4e7] hover:border-[#818cf8] hover:text-white transition-colors disabled:opacity-40';

// Ready-made replies (one tap sends) + a short custom text (one SMS).
export function QuickReply({ onSend, busy, max = 160, testid, sendLabel = 'Send text', presets = REPLIES, autoFocus = false, costNote = 'uses 1 text from your plan', blocked = false, note = null }) {
  const [text, setText] = useState('');
  const go = () => { if (text.trim() && !blocked) onSend(text.trim()); };
  return (
    <div className="space-y-2" data-testid={testid}>
      {note}
      <div className="flex flex-wrap gap-1.5">{presets.map((r, i) => <button key={r} type="button" disabled={busy || blocked} onClick={() => onSend(r)} className={CHIP} data-testid={`${testid}-preset-${i}`}>{r}</button>)}</div>
      <div className="flex gap-2">
        <input className="civr-input !h-9 text-sm" maxLength={max} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Or type your own reply" aria-label="Your reply" autoFocus={autoFocus} data-testid={`${testid}-input`} />
        <button type="button" disabled={busy || blocked || !text.trim()} onClick={go} className="civr-btn civr-btn-primary civr-btn-sm shrink-0" data-testid={`${testid}-send-button`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{sendLabel}</button>
      </div>
      <div className="text-[11px] text-[#a1a1aa]" data-testid={`${testid}-count`}>{`${text.length}/${max} · ${costNote}`}</div>
    </div>
  );
}

// Sends the "Text back" SMS for one missed call; `done` = the reply once sent. A second reload ~6 s later picks up the delivery result.
export function useTextBack(id, reply, onDone) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(reply);
  const send = async (text) => {
    setBusy(true);
    try {
      const d = await api(`/missed-calls/${id}/reply`, { method: 'POST', body: { text } });
      setDone(d.reply);
      toast.success(d.reply.status === 'preview' ? 'Reply saved (preview — not sent)' : 'Text sent');
      onDone?.();
      if (d.reply.status === 'sent' && onDone) setTimeout(onDone, 6000);
    } catch (e) { toast.error(e.message); if (e.code === 'already_replied') onDone?.(); } finally { setBusy(false); }
  };
  return { busy, done, send };
}

// What happened to a text we sent (from the carrier's delivery report): Sent → Delivered, or Not delivered + why.
export function SmsStatus({ status, reason, testid }) {
  const row = 'flex items-start gap-1 mt-1 text-[11px]';
  if (status === 'delivered') return <span className={`${row} text-[#34d399]`} data-testid={testid}><CheckCheck className="w-3.5 h-3.5 shrink-0" />Delivered</span>;
  if (status === 'failed') return <span className={`${row} text-[#fbbf24]`} data-testid={testid}><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{`Not delivered: ${reason || 'The carrier didn’t deliver this text.'}`}</span></span>;
  if (status === 'sent' || status === 'unconfirmed') return <span className={`${row} text-[#a1a1aa]`} data-testid={testid}><Check className="w-3.5 h-3.5 shrink-0" />Sent</span>;
  return null;
}

export function TextBackDone({ reply, testid }) {
  const pv = usePrivacy();
  return (
    <>
      <p className="mt-1.5 text-xs text-[#818cf8] break-words" data-testid={testid}>{`Texted back: “${pv.text(reply.text, 'Message hidden')}”`}{reply.status === 'preview' ? ' (preview — not sent)' : null}</p>
      <SmsStatus status={reply.status} reason={reply.reason} testid={`${testid}-status`} />
    </>
  );
}

export const TextBackButton = ({ onClick, open, testid }) => (
  <button type="button" onClick={onClick} aria-expanded={open} className="civr-btn civr-btn-ghost civr-btn-sm mt-2" data-testid={testid}><MessageSquareReply className="w-4 h-4" />Text back</button>
);

// Inbox: "Text back" for one missed call, reply box right under it.
export function TextBack({ id, reply, canReply, onDone, testid, phone, to }) {
  const [open, setOpen] = useState(false);
  const { busy, done, send } = useTextBack(id, reply, onDone);
  if (reply || done) return <TextBackDone reply={reply || done} testid={`${testid}-done`} />;
  if (!canReply) return null;
  if (!open) return <TextBackButton onClick={() => setOpen(true)} open={false} testid={`${testid}-button`} />;
  return <div className="mt-2 max-w-xl"><CheckedReply phone={phone} to={to} onSend={send} busy={busy} testid={testid} /></div>;
}

// QuickReply that first checks the destination (country, price, sender name) and blocks texts that can't go.
export function CheckedReply({ phone, to, testid, costNote, ...rest }) {
  const c = useDestCheck(phone, to);
  const home = c?.ok && (c.iso === 'US' || c.iso === 'CA');
  return <QuickReply {...rest} testid={testid} blocked={c ? !c.ok : false} note={<DestNote check={c} testid={`${testid}-dest`} />} costNote={c && !c.ok ? 'can’t be sent to this number' : c?.ok && !home ? `$${c.price.toFixed(2)} from your wallet` : costNote} />;
}
