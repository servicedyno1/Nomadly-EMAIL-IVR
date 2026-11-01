import React from 'react';
import { Search, PhoneMissed, Voicemail, PhoneOutgoing, PhoneIncoming, Image as ImageIcon } from 'lucide-react';
import { timeOf, dayOf } from './Events';

export const FILTERS = [['all', 'All'], ['unread', 'Unread'], ['texts', 'Texts'], ['voicemail', 'Voicemail'], ['missed', 'Missed calls']];

function Last({ l }) {
  if (l.type === 'text') return <span className="truncate">{l.out ? 'You: ' : ''}{l.body === 'Picture' ? <span className="inline-flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" />Picture</span> : l.body}</span>;
  if (l.type === 'voicemail') return <span className="inline-flex items-center gap-1"><Voicemail className="w-3.5 h-3.5" />Voicemail</span>;
  if (['missed', 'off_hours', 'forward_failed'].includes(l.type)) return <span className="inline-flex items-center gap-1 text-[#f43f5e]"><PhoneMissed className="w-3.5 h-3.5" />Missed call</span>;
  return <span className="inline-flex items-center gap-1">{l.out ? <PhoneOutgoing className="w-3.5 h-3.5" /> : <PhoneIncoming className="w-3.5 h-3.5" />}{l.out ? 'Outgoing call' : 'Answered call'}</span>;
}
const stamp = (d) => (dayOf(d) === 'Today' ? timeOf(d) : dayOf(d));

export function ThreadList({ data, sel, onPick, filter, setFilter, q, setQ, multi }) {
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="thread-list">
      <div className="p-3 space-y-3 border-b border-[var(--c-border)]">
        <label className="relative block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-muted)]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, number or text" aria-label="Search conversations" className="civr-input !pl-9 w-full" data-testid="messages-search" />
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filter conversations">
          {FILTERS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`shrink-0 h-9 px-3 rounded-full text-sm transition-colors ${filter === k ? 'bg-[var(--c-accent-strong)] text-white' : 'border border-[var(--c-border)] text-[var(--c-muted)] hover:text-[var(--c-text)]'}`} data-testid={`messages-filter-${k}`}>{label}</button>)}
        </div>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto" data-testid="thread-list-items">
        {(data?.threads || []).map(t => {
          const on = sel && sel.number === t.number && sel.contact === t.contact;
          return (
            <li key={t.id}>
              <button type="button" onClick={() => onPick(t)} aria-current={on ? 'true' : undefined} className={`w-full text-left flex gap-3 px-4 py-3 border-b border-[var(--c-border)] transition-colors ${on ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-[var(--c-card-hover)]'}`} data-testid={`thread-item-${t.id}`}>
                <span className={`mt-2 w-2.5 h-2.5 shrink-0 rounded-full ${t.unread ? 'bg-[var(--c-accent-strong)]' : 'bg-transparent'}`} aria-label={t.unread ? 'Unread' : undefined} data-testid={t.unread ? `thread-unread-${t.id}` : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`truncate ${t.unread ? 'font-bold' : 'font-semibold'}`}>{t.name || <span className="font-mono" data-no-translate>{t.contact}</span>}</span>
                    <span className="ml-auto shrink-0 text-xs text-[var(--c-muted)]">{stamp(t.at)}</span>
                  </span>
                  <span className={`flex text-sm min-w-0 ${t.unread ? 'text-[var(--c-text)]' : 'text-[var(--c-muted)]'}`}><Last l={t.last} /></span>
                  {(multi || t.old) && <span className="block text-[11px] text-[var(--c-muted)] mt-0.5">to <span className="font-mono" data-no-translate>{t.number}</span>{t.old ? ' · Old number' : ''}{t.blocked ? ' · Blocked' : ''}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
