import React, { useState } from 'react';
import { toast } from 'sonner';
import { X, Loader2, Sparkles, Clock, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { timeOf, dayOf } from './Events';

// Notes + free-form tags for this contact (earlier tags are offered again).
export function ContactPanel({ t, onSaved, onClose }) {
  const [notes, setNotes] = useState(t.notes || '');
  const [tags, setTags] = useState(t.tags || []);
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const add = (v) => { const x = String(v || tag).replace(/\s+/g, ' ').trim().slice(0, 24); if (x && !tags.includes(x) && tags.length < 10) setTags([...tags, x]); setTag(''); };
  const save = async () => {
    setBusy(true);
    try { await api('/messages/contact', { method: 'PUT', body: { contact: t.contact, notes, tags } }); toast.success('Notes saved'); onSaved(); onClose(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const offer = (t.allTags || []).filter(x => !tags.includes(x)).slice(0, 8);
  return (
    <div className="border-b border-[var(--c-border)] px-3 sm:px-5 py-4 space-y-3 bg-[var(--c-card-hover)]" data-testid="contact-panel">
      <div className="flex items-center justify-between"><span className="font-semibold text-sm">Notes and tags</span><button type="button" onClick={onClose} className="w-9 h-9 grid place-items-center rounded-full" aria-label="Close notes" data-testid="contact-panel-close"><X className="w-4 h-4" /></button></div>
      <textarea value={notes} onChange={e => setNotes(e.target.value.slice(0, 2000))} rows={3} placeholder="What should you remember about this person?" aria-label="Notes" className="civr-input w-full" data-testid="contact-notes-input" />
      <div className="flex flex-wrap items-center gap-1.5" data-testid="contact-tags">
        {tags.map(x => <span key={x} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[var(--c-accent-soft)] text-[var(--c-accent)]" data-no-translate>{x}<button type="button" onClick={() => setTags(tags.filter(y => y !== x))} aria-label={`Remove tag ${x}`} data-testid={`contact-tag-remove-${x}`}><X className="w-3 h-3" /></button></span>)}
        <input value={tag} onChange={e => setTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} placeholder="Add a tag" aria-label="Add a tag" className="civr-input !h-8 w-32 text-sm" data-testid="contact-tag-input" />
      </div>
      {offer.length > 0 && <div className="flex flex-wrap gap-1.5 text-xs"><span className="text-[var(--c-muted)]">Your tags:</span>{offer.map(x => <button key={x} type="button" onClick={() => add(x)} className="px-2 py-0.5 rounded-full border border-[var(--c-border)] hover:border-[var(--c-accent)]" data-no-translate data-testid={`contact-tag-suggest-${x}`}>{x}</button>)}</div>}
      <button type="button" onClick={save} disabled={busy} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="contact-panel-save">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save</button>
    </div>
  );
}

export function AiCard({ ai, onPick }) {
  if (!ai) return null;
  return (
    <div className="rounded-2xl border border-[var(--c-border)] bg-[var(--c-accent-soft)] p-4 mb-3 space-y-2" data-testid="thread-ai-summary">
      <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="w-4 h-4 text-[var(--c-accent)]" />AI summary{ai.updating && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--c-muted)]" aria-label="Updating" />}</div>
      {ai.summary ? <p className="text-sm" data-no-translate data-testid="thread-ai-summary-text">{ai.summary}</p> : <p className="text-sm text-[var(--c-muted)]">Summarizing this conversation…</p>}
      {ai.replies?.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1" data-testid="thread-ai-replies">
        <span className="text-xs text-[var(--c-muted)] w-full">Suggested replies</span>
        {ai.replies.map((r, i) => <button key={r} type="button" onClick={() => onPick(r)} className="text-left text-xs px-3 py-1.5 rounded-full border border-[var(--c-border)] bg-[var(--c-card)] hover:border-[var(--c-accent)] transition-colors" data-no-translate data-testid={`thread-ai-reply-${i}`}>{r}</button>)}
      </div>}
    </div>
  );
}

export function ScheduledList({ items, reload }) {
  if (!items?.length) return null;
  const cancel = async (id) => { try { await api(`/messages/schedule/${id}`, { method: 'DELETE' }); toast.success('Scheduled text cancelled'); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="border-t border-[var(--c-border)] px-3 pt-2 space-y-1.5" data-testid="scheduled-list">
      {items.map(s => (
        <div key={s.id} className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2 ${s.status === 'failed' ? 'bg-[#fb7185]/10 text-[#e11d48]' : 'bg-[var(--c-card-hover)]'}`} data-testid={`scheduled-${s.id}`}>
          <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1 min-w-0"><span className="font-semibold">{s.status === 'failed' ? 'Not sent' : `Scheduled · ${dayOf(s.sendAt)} ${timeOf(s.sendAt)}`}</span> <span className="text-[var(--c-muted)]" data-no-translate>{s.text}{s.media?.length ? ` (+${s.media.length} picture)` : ''}</span>{s.error && <span className="block">{s.error}</span>}</span>
          {s.status === 'scheduled' && <button type="button" onClick={() => cancel(s.id)} className="w-8 h-8 -my-1 grid place-items-center rounded-full hover:bg-[var(--c-accent-soft)]" aria-label="Cancel scheduled text" data-testid={`scheduled-cancel-${s.id}`}><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      ))}
    </div>
  );
}
