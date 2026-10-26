import React, { useState } from 'react';
import { toast } from 'sonner';
import { Ban, Plus, X } from 'lucide-react';
import { api, useApi, day } from '../../api';
import { SkeletonRows, Empty } from '../../ui';
import { usePrivacy } from '../../privacy';
import { undoable } from '../../undo';
import { useSearch, SearchBox, NoMatches } from '../../search';

// Numbers no campaign ever calls. People who ask the AI agent to stop calling are added automatically.
export function DncList() {
  const { data, loading, reload, setData } = useApi('/ai-dnc');
  const [num, setNum] = useState('');
  const pv = usePrivacy();
  const add = async (e) => {
    e.preventDefault();
    try {
      const d = await api('/ai-dnc', { method: 'POST', body: { numbers: num } });
      setNum('');
      toast.success(d.added > 1 ? `${d.added} numbers added to do-not-call` : 'Added to do-not-call');
      if (d.invalid) toast.message(d.invalid === 1 ? '1 entry skipped — not a valid number' : `${d.invalid} entries skipped — not valid numbers`);
      reload();
    } catch (err) { toast.error(err.message); }
  };
  const remove = (n) => undoable('Removed from the do-not-call list', {
    hide: () => setData(d => ({ ...d, numbers: (d?.numbers || []).filter(x => x.number !== n) })),
    restore: reload,
    run: async () => { await api(`/ai-dnc/${encodeURIComponent(n)}`, { method: 'DELETE' }); reload(); },
  });
  const list = data?.numbers || [];
  const s = useSearch(list, d => [d.number, d.reason === 'manual' ? 'added by you' : d.reason]);
  return (
    <div className="flex flex-col gap-4" data-testid="ai-dnc-page">
      <form onSubmit={add} className="civr-card p-6 flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="civr-input font-mono flex-1" value={num} onChange={e => setNum(e.target.value)} placeholder="+14155550100, +14155550101" aria-label="Numbers to add" data-testid="ai-dnc-number-input" />
          <button className="civr-btn civr-btn-primary" disabled={!num.trim()} data-testid="ai-dnc-add-button"><Plus className="w-4 h-4" />Add</button>
        </div>
        <span className="text-xs text-[#a1a1aa]">With country code. Add several at once by separating them with commas or spaces.</span>
      </form>
      {loading && !data ? <SkeletonRows rows={2} /> : !list.length ? (
        <Empty icon={Ban} title="Nobody on the list" sub="Every campaign skips these numbers — Bulk IVR and AI voice agent. Anyone who asks the agent not to call again is added here automatically." testid="ai-dnc-empty">
          <button type="button" className="civr-btn civr-btn-ghost" onClick={() => { const el = document.querySelector('[data-testid="ai-dnc-number-input"]'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }} data-testid="ai-dnc-empty-add-button"><Plus className="w-4 h-4" />Add a number</button>
        </Empty>
      ) : (
        <>
        <SearchBox s={s} placeholder="Search the list" testid="ai-dnc-search" className="max-w-md" />
        <NoMatches s={s} testid="ai-dnc-no-matches" />
        {!!s.list.length && <div className="civr-card divide-y divide-[#1f1f1f]">
          {s.list.map((d, i) => (
            <div key={d.number} className="flex items-center gap-3 px-6 py-3" data-testid={`ai-dnc-row-${i}`}>
              <span className="font-mono flex-1">{pv.phone(d.number)}</span>
              <span className="text-xs text-[#a1a1aa]">{d.reason === 'manual' ? 'added by you' : d.reason} · {day(d.createdAt)}</span>
              <button className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => remove(d.number)} aria-label="Remove" data-testid={`ai-dnc-row-${i}-remove-button`}><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>}
        </>
      )}
    </div>
  );
}
