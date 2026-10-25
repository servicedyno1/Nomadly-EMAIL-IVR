import React, { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, PhoneIncoming, Trash2 } from 'lucide-react';
import { api, useApi, money, secs, when } from '../../api';
import { usePrivacy } from '../../privacy';
import { undoable } from '../../undo';
import { Transcript } from './Transcript';

const OUTCOME = { completed: ['Completed', 'civr-pill-on'], no_answer: ['No answer', 'civr-pill-warn'], busy: ['Busy', 'civr-pill-warn'], cancelled: ['Cancelled', ''], out_of_funds: ['Balance ran out', 'civr-pill-bad'], ended: ['Ended', ''] };

function Row({ c, onDelete, onOpenLive }) {
  const pv = usePrivacy();
  const [open, setOpen] = useState(null);
  const live = c.status !== 'ended';
  const toggle = async () => {
    if (live) return onOpenLive(c.id);
    if (open) return setOpen(null);
    try { setOpen((await api(`/relay/calls/${c.id}`)).call); } catch (err) { toast.error(err.message); }
  };
  const del = () => onDelete(c);
  const [label, tone] = live ? ['Live', 'civr-pill-on'] : OUTCOME[c.outcome] || OUTCOME.ended;
  return (
    <li className="py-3" data-testid={`relay-history-${c.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={toggle} className="flex-1 min-w-0 min-h-[44px] text-left flex items-center gap-3" aria-expanded={!!open} data-testid={`relay-history-open-${c.id}`}>
          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          <span className="font-mono truncate">{pv.phone(c.to)}</span><span className="text-xs text-[#a1a1aa] hidden sm:inline">{when(c.createdAt)}</span>
        </button>
        {c.direction === 'inbound' && <span className="civr-pill" data-testid={`relay-history-incoming-${c.id}`}><PhoneIncoming className="w-3 h-3" />Incoming</span>}
        <span className={`civr-pill ${tone}`}>{label}</span>
        <span className="text-xs text-[#a1a1aa] font-mono w-24 text-right">{secs(c.duration)} · {c.dryRun ? '$0' : money(c.charge)}</span>
        {!live && <button type="button" onClick={del} className="w-10 h-10 -my-2 flex items-center justify-center rounded-md text-[#a1a1aa] hover:text-[#fb7185] hover:bg-white/5" aria-label="Delete call" data-testid={`relay-history-delete-${c.id}`}><Trash2 className="w-4 h-4" /></button>}
      </div>
      {open && <div className="mt-3"><Transcript call={open} sizeIdx={0} flash={false} /></div>}
    </li>
  );
}

export function History({ onOpenLive }) {
  const { data, reload, setData } = useApi('/relay/calls');
  const remove = (c) => undoable('Text call deleted', {
    hide: () => setData(d => ({ ...d, calls: (d?.calls || []).filter(x => x.id !== c.id) })),
    restore: reload,
    run: async () => { await api(`/relay/calls/${c.id}`, { method: 'DELETE' }); reload(); },
  });
  if (!data?.calls?.length) return null;
  return (
    <section className="civr-card p-6 mt-6" data-testid="relay-history">
      <div className="flex items-baseline justify-between"><div className="font-display text-2xl font-bold">Recent text calls</div><div className="text-xs text-[#a1a1aa]">Kept 90 days</div></div>
      <ul className="divide-y divide-white/10 mt-2">{data.calls.map(c => <Row key={c.id} c={c} onDelete={remove} onOpenLive={onOpenLive} />)}</ul>
    </section>
  );
}
