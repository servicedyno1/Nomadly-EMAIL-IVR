import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, SendHorizontal, X, Lock } from 'lucide-react';
import { api, money } from '../../api';
import { shrink } from './shrink';
import { mediaSrc } from './Events';
import { SMS_REPLIES } from '../../QuickReply';

const BUDGET = 600 * 1024;
const MAX_PICS = 5;

async function upload(file) {
  const form = new FormData();
  form.append('file', file);
  return api('/messages/media', { method: 'POST', form });
}

function Pics({ pics, remove }) {
  if (!pics.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2" data-testid="composer-pictures">
      {pics.map((p, i) => (
        <div key={p.id || i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-[var(--c-border)]">
          {p.id ? <img src={mediaSrc(p.id)} alt="Attached picture" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center"><Loader2 className="w-4 h-4 animate-spin" /></div>}
          {p.id && <button type="button" onClick={() => remove(i)} className="absolute top-0.5 right-0.5 w-6 h-6 grid place-items-center rounded-full bg-black/60 text-white" aria-label="Remove picture" data-testid={`composer-picture-remove-${i}`}><X className="w-3.5 h-3.5" /></button>}
        </div>
      ))}
    </div>
  );
}

export function ReceiveOnly({ text }) {
  return <div className="flex items-center justify-center gap-2 text-sm text-[var(--c-muted)] py-4 px-4 text-center" data-testid="composer-receive-only"><Lock className="w-4 h-4 shrink-0" />{text}</div>;
}

export function Composer({ t, onSent }) {
  const [text, setText] = useState('');
  const [pics, setPics] = useState([]);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState(false);
  const fileRef = useRef(null);
  const canPics = !!t.number.caps.pictures && t.replyFrom === t.number.phone;
  const used = pics.reduce((a, p) => a + (p.size || 0), 0);
  const attach = async (files) => {
    const list = [...files].slice(0, MAX_PICS - pics.length);
    for (const f of list) {
      if (!f.type.startsWith('image/')) { toast.error('Only pictures can be attached.'); continue; }
      const slot = { tmp: Math.random() };
      setPics(p => [...p, slot]);
      try {
        const small = await shrink(f, Math.max(60 * 1024, (BUDGET - used) / list.length));
        const r = await upload(small);
        setPics(p => p.map(x => (x === slot ? r : x)));
      } catch (e) { setPics(p => p.filter(x => x !== slot)); toast.error(e.message); }
    }
  };
  const send = async () => {
    if (busy || (!text.trim() && !pics.length)) return;
    setBusy(true);
    const draft = { id: `tmp-${Date.now()}`, kind: 'text', out: true, at: new Date().toISOString(), body: text.trim(), media: pics.filter(p => p.id).map(p => ({ id: p.id })), status: 'sending' };
    onSent(draft, true);
    try {
      const r = await api('/messages/send', { method: 'POST', body: { number: t.number.phone, contact: t.contact, text: text.trim(), media: pics.filter(p => p.id).map(p => p.id) } });
      setText(''); setPics([]); onSent({ ...r.event, replaces: draft.id });
    } catch (e) { onSent({ ...draft, replaces: draft.id, status: 'failed', reason: e.message }); toast.error(e.message); } finally { setBusy(false); }
  };
  const max = t.maxLength;
  const segs = Math.max(1, Math.ceil(text.length / 160));
  const cost = t.number.kind === 'esim' ? `${money(t.cost.each)} from your wallet` : `Uses a plan text, then ${money(t.cost.each)} from your wallet`;
  return (
    <div className="border-t border-[var(--c-border)] p-3" data-testid="composer">
      {t.replyFrom && t.replyFrom !== t.number.phone && <p className="text-xs text-[var(--c-muted)] px-1 pb-2" data-testid="composer-reply-from">Your reply comes from <span className="font-mono" data-no-translate>{t.replyFrom}</span></p>}
      {quick && <div className="flex flex-wrap gap-1.5 px-1 pb-2" data-testid="composer-quick-replies">{SMS_REPLIES.map((r, i) => <button key={r} type="button" onClick={() => { setText(r.slice(0, t.maxLength)); setQuick(false); }} className="rounded-full border border-[var(--c-border)] px-3 py-1.5 text-xs text-left hover:border-[var(--c-accent)] transition-colors" data-testid={`composer-quick-reply-${i}`}>{r}</button>)}</div>}
      <Pics pics={pics} remove={(i) => setPics(p => p.filter((_, j) => j !== i))} />
      <div className="flex items-end gap-2">
        {canPics && <>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { attach(e.target.files); e.target.value = ''; }} data-testid="composer-file-input" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={pics.length >= MAX_PICS} className="w-11 h-11 shrink-0 grid place-items-center rounded-full text-[var(--c-muted)] hover:text-[var(--c-accent)] hover:bg-[var(--c-accent-soft)] transition-colors" aria-label="Attach a picture" data-testid="composer-attach"><ImagePlus className="w-5 h-5" /></button>
        </>}
        <textarea value={text} onChange={e => setText(e.target.value.slice(0, max))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} rows={1} placeholder="Text message" aria-label="Text message" className="civr-input flex-1 min-h-[44px] max-h-40 !rounded-[22px] resize-none py-2.5" data-testid="composer-input" />
        <button type="button" onClick={send} disabled={busy || (!text.trim() && !pics.some(p => p.id))} className="w-11 h-11 shrink-0 grid place-items-center rounded-full bg-[var(--c-accent-strong)] text-white disabled:opacity-40 transition-opacity" aria-label="Send" data-testid="composer-send">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-5 h-5" />}</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-xs text-[var(--c-muted)]">
        <span data-testid="composer-cost">{cost}</span>
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => setQuick(q => !q)} className="underline underline-offset-2 hover:text-[var(--c-accent)]" aria-expanded={quick} data-testid="composer-quick-toggle">Quick replies</button>
          <span data-testid="composer-count">{text.length}/{max}{t.number.kind === 'esim' && segs > 1 ? ` · ${segs} parts` : ''}</span>
        </span>
      </div>
    </div>
  );
}
