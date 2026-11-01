import React, { useEffect, useState } from 'react';
import { X, PenSquare } from 'lucide-react';
import { api } from '../../api';

const E164 = /^\+[1-9]\d{7,14}$/;
const norm = (s) => { const d = String(s || '').replace(/[^\d+]/g, ''); if (!d) return ''; if (d.startsWith('+')) return d; return d.length === 10 ? `+1${d}` : `+${d}`; };

// Start a conversation: pick the business number to send from, then type a number or pick a contact.
export function NewMessage({ numbers, onStart }) {
  const senders = (numbers || []).filter(n => n.caps.send && !n.old);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hits, setHits] = useState([]);
  useEffect(() => { if (open && !from && senders[0]) setFrom(senders[0].phone); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const term = to.trim();
    if (!open || term.length < 2) { setHits([]); return undefined; }
    const t = setTimeout(() => api(`/contacts?q=${encodeURIComponent(term)}&limit=6`).then(d => setHits((d.contacts || d.items || []).filter(c => c.phone).slice(0, 6))).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [to, open]);
  const dest = norm(to);
  const ok = E164.test(dest) && !!from;
  const go = (phone) => { setOpen(false); setTo(''); onStart({ number: from, contact: phone }); };
  if (!senders.length) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="civr-btn civr-btn-primary civr-btn-sm w-full justify-center" data-testid="messages-new"><PenSquare className="w-4 h-4" />New message</button>
      {open && (
        <div className="fixed inset-0 z-[70] bg-black/50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="New message" onClick={() => setOpen(false)} data-testid="new-message-dialog">
          <div className="civr-card w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><span className="font-display text-xl font-bold">New message</span><button type="button" onClick={() => setOpen(false)} className="w-10 h-10 grid place-items-center rounded-full" aria-label="Close" data-testid="new-message-close"><X className="w-4 h-4" /></button></div>
            <label className="block text-sm"><span className="block text-xs text-[var(--c-muted)] mb-1">From</span>
              <select value={from} onChange={e => setFrom(e.target.value)} className="civr-input w-full font-mono" data-testid="new-message-from">{senders.map(n => <option key={n.phone} value={n.phone}>{n.phone} · {n.kind === 'esim' ? (n.mobile ? 'Mobile number' : 'CloudIVR eSIM') : 'Calling number'}</option>)}</select>
            </label>
            <label className="block text-sm"><span className="block text-xs text-[var(--c-muted)] mb-1">To</span>
              <input autoFocus value={to} onChange={e => setTo(e.target.value)} onKeyDown={e => e.key === 'Enter' && ok && go(dest)} placeholder="+1 415 555 0123 or a contact name" className="civr-input w-full" data-testid="new-message-to" />
            </label>
            {hits.length > 0 && <ul className="rounded-xl border border-[var(--c-border)] divide-y divide-[var(--c-border)]" data-testid="new-message-contacts">
              {hits.map(c => <li key={c.id || c.phone}><button type="button" onClick={() => go(c.phone)} className="w-full text-left px-3 py-2 hover:bg-[var(--c-card-hover)]" data-testid={`new-message-contact-${c.phone}`}><span className="font-semibold" data-no-translate>{c.name || c.phone}</span> <span className="font-mono text-xs text-[var(--c-muted)]" data-no-translate>{c.phone}</span></button></li>)}
            </ul>}
            {to.trim() && !E164.test(dest) && !hits.length && <p className="text-xs text-[var(--c-muted)]" data-testid="new-message-hint">Type the full number with country code, like +14155550123.</p>}
            {from && senders.find(n => n.phone === from)?.kind === 'calling' && dest.startsWith('+1') && <p className="text-xs text-[var(--c-muted)]" data-testid="new-message-10dlc">US carriers may block business texts to US mobiles until your number is registered for business texting.</p>}
            <button type="button" disabled={!ok} onClick={() => go(dest)} className="civr-btn civr-btn-primary w-full justify-center" data-testid="new-message-start">Start conversation</button>
          </div>
        </div>
      )}
    </>
  );
}
