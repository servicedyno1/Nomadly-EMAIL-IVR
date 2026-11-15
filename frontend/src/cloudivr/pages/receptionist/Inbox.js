import React, { useState } from 'react';
import { toast } from 'sonner';
import { Check, Inbox as InboxIcon, CalendarCheck, PhoneCall } from 'lucide-react';
import { api, when } from '../../api';
import { Empty } from '../../ui';
import { usePrivacy } from '../../privacy';

// Messages and call-back requests the receptionist took, until the owner marks them done.
export function Inbox({ items, reload }) {
  const pv = usePrivacy();
  const [busy, setBusy] = useState('');
  const done = async (id) => {
    setBusy(id);
    try { await api(`/ai-calls/${id}/handled`, { method: 'POST', body: { handled: true } }); toast.success('Marked as done'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  if (!items.length) return <Empty icon={InboxIcon} title="Inbox is clear" sub="Messages and call-back requests your receptionist takes land here." testid="receptionist-inbox-empty" bare />;
  return (
    <div className="divide-y divide-[var(--c-border)]" data-testid="receptionist-inbox">
      {items.map((c, i) => (
        <div key={c.id} className="py-4 flex gap-4 items-start" data-testid={`receptionist-inbox-row-${i}`}>
          <div className="w-9 h-9 rounded-full bg-[#fbbf24]/15 grid place-items-center shrink-0"><PhoneCall className="w-4 h-4 text-[#d97706]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{c.message?.name || pv.phone(c.other)}<span className="font-normal text-[var(--c-muted)]">{` · ${when(c.startedAt)}`}</span></div>
            <p className="text-sm mt-1" data-testid={`receptionist-inbox-row-${i}-text`}>{pv.text(c.message?.text || c.summary || 'Asked for a call back.', 'Message hidden')}</p>
            {(c.message?.callback || c.other) && <a href={`tel:${c.message?.callback || c.other}`} className="text-xs text-[var(--c-accent)] underline underline-offset-2" data-testid={`receptionist-inbox-row-${i}-call`}>{`Call back ${pv.phone(c.message?.callback || c.other)}`}</a>}
          </div>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm shrink-0" disabled={busy === c.id} onClick={() => done(c.id)} data-testid={`receptionist-inbox-row-${i}-done`}><Check className="w-4 h-4" />Done</button>
        </div>
      ))}
    </div>
  );
}

export function Upcoming({ items }) {
  const pv = usePrivacy();
  if (!items.length) return <p className="text-sm text-[var(--c-muted)]" data-testid="receptionist-upcoming-empty">No upcoming bookings. Turn on bookings in the receptionist’s setup to let callers pick a time.</p>;
  return (
    <div className="space-y-3" data-testid="receptionist-upcoming">
      {items.map((c, i) => (
        <div key={c.id} className="flex items-center gap-3 text-sm" data-testid={`receptionist-upcoming-row-${i}`}>
          <CalendarCheck className="w-4 h-4 text-[var(--c-accent)] shrink-0" />
          <span className="flex-1 min-w-0"><span className="font-semibold">{`${c.booking.day} · ${c.booking.time}`}</span><span className="block text-xs text-[var(--c-muted)] truncate" data-no-translate>{pv.text(c.booking.name || '', '•••')}{c.booking.phone ? ` · ${pv.phone(c.booking.phone)}` : ''}</span></span>
          {c.booking.link && <a href={c.booking.link} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--c-accent)] underline" data-testid={`receptionist-upcoming-row-${i}-link`}>Calendar</a>}
        </div>
      ))}
    </div>
  );
}
