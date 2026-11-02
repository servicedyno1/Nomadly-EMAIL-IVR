import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { X, BookmarkPlus } from 'lucide-react';
import { api } from '../../api';
import { SMS_REPLIES } from '../../QuickReply';

// Composer panel: the account's saved templates (one tap inserts), "save this text", plus a few starter replies.
export function Templates({ text, onPick }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api('/messages/templates').then(d => setItems(d.items)).catch(() => setItems([])); }, []);
  const save = async () => {
    try { const d = await api('/messages/templates', { method: 'POST', body: { text } }); setItems(l => [d.item, ...(l || [])]); toast.success('Saved as a template'); } catch (e) { toast.error(e.message); }
  };
  const del = async (id) => {
    const before = items;
    setItems(l => l.filter(x => x.id !== id));
    try { await api(`/messages/templates/${id}`, { method: 'DELETE' }); } catch (e) { setItems(before); toast.error(e.message); }
  };
  const chip = 'rounded-2xl border border-[var(--c-border)] px-3 py-1.5 text-xs text-left hover:border-[var(--c-accent)] transition-colors max-w-full';
  return (
    <div className="px-1 pb-2 space-y-2" data-testid="composer-templates">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">My templates</span>
        {text.trim() && (items || []).some(x => x.text === text.trim()) ? <span className="ml-auto text-xs text-[var(--c-muted)]" data-testid="composer-template-saved">Saved ✓</span>
          : text.trim() && <button type="button" onClick={save} className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--c-accent)] hover:underline min-h-[32px]" data-testid="composer-template-save"><BookmarkPlus className="w-3.5 h-3.5" />Save this text as a template</button>}
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="composer-template-list">
        {items === null ? <span className="text-xs text-[var(--c-muted)]">Loading…</span>
          : items.length ? items.map((t, i) => (
            <span key={t.id} className={`${chip} inline-flex items-center gap-1 !pr-1`} data-testid={`composer-template-${i}`}>
              <button type="button" onClick={() => onPick(t.text)} className="line-clamp-2 max-w-[18rem] text-left" title={t.text} data-testid={`composer-template-use-${i}`}>{t.text}</button>
              <button type="button" onClick={() => del(t.id)} className="w-6 h-6 grid place-items-center rounded-full text-[var(--c-muted)] hover:text-red-500" aria-label="Delete template" data-testid={`composer-template-delete-${i}`}><X className="w-3 h-3" /></button>
            </span>
          )) : <span className="text-xs text-[var(--c-muted)]" data-testid="composer-template-empty">None yet. Type a text you send often, then tap “Save this text as a template”.</span>}
      </div>
      <div className="text-xs font-semibold pt-1">Starters</div>
      <div className="flex flex-wrap gap-1.5" data-testid="composer-quick-replies">{SMS_REPLIES.map((r, i) => <button key={r} type="button" onClick={() => onPick(r)} className={chip} data-testid={`composer-quick-reply-${i}`}>{r}</button>)}</div>
    </div>
  );
}
