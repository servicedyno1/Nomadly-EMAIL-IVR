import React, { useState } from 'react';
import { ask } from './i18n';
import { toast } from 'sonner';
import { StickyNote, Pencil, Trash2 } from 'lucide-react';
import { api, enc } from './api';
import { usePrivacy } from './privacy';

const MAX = 2000;
const NO_NOTES = ['sms', 'fax', 'BulkIVR'];
export const canNote = (l) => !NO_NOTES.includes(l.type);

// The note on one call-log row: shows it, and adds / edits / deletes it inline.
export function NoteCell({ log: l, phone, onSaved, testid }) {
  const pv = usePrivacy();
  const note = l.note;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const start = () => { setText(note?.text || ''); setOpen(true); };
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setOpen(false); onSaved(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const save = () => run(() => (note
    ? api(`/notes/${enc(note.id)}`, { method: 'PATCH', body: { text } })
    : api(`/numbers/${enc(phone)}/notes`, { method: 'POST', body: { text, logId: l.id, peer: l.direction === 'outbound' ? l.to : l.from, direction: l.direction, callAt: l.timestamp } })), 'Note saved');
  const remove = () => { if (ask('Delete this note?')) run(() => api(`/notes/${enc(note.id)}`, { method: 'DELETE' }), 'Note deleted'); };

  if (open) {
    return (
      <div className="mt-2 space-y-2 min-w-[14rem]" data-testid={`${testid}-editor`}>
        <textarea rows={3} maxLength={MAX} autoFocus className="civr-input text-xs" value={text} onChange={e => setText(e.target.value)} placeholder="What was this call about?" data-testid={`${testid}-input`} />
        <div className="flex flex-wrap gap-2">
          <button className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !text.trim()} onClick={save} data-testid={`${testid}-save-button`}>Save note</button>
          <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={() => setOpen(false)} data-testid={`${testid}-cancel-button`}>Cancel</button>
          {note && <button className="civr-btn civr-btn-ghost civr-btn-sm !text-[#fb7185]" disabled={busy} onClick={remove} aria-label="Delete note" data-testid={`${testid}-delete-button`}><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      </div>
    );
  }
  return note ? (
    <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#fbbf24]/5 border border-[#fbbf24]/20 px-2.5 py-2" data-testid={testid}>
      <StickyNote className="w-3.5 h-3.5 text-[#fbbf24] shrink-0 mt-0.5" />
      <span className="flex-1 whitespace-pre-line break-words text-[#ddd]" data-testid={`${testid}-text`}>{pv.text(note.text, 'Note hidden')}</span>
      <button onClick={start} className="text-[#888] hover:text-white shrink-0" aria-label="Edit note" data-testid={`${testid}-edit-button`}><Pencil className="w-3.5 h-3.5" /></button>
    </div>
  ) : (
    <button onClick={start} className="mt-1 inline-flex items-center gap-1 text-[#8a8a8a] hover:text-[#34d399] py-1" data-testid={`${testid}-add-button`}><StickyNote className="w-3.5 h-3.5" />Add note</button>
  );
}
