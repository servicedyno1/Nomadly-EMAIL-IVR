import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { enc, useApi } from '../../api';
import { Toggle } from '../../ui';
import { useShell } from '../../Shell';
import { useSave } from './SettingsTabs';
import { LogTable, labelOf } from '../../LogTable';
import { RING_ENDED } from '../../Incoming';
import { useSearch, SearchBox, NoMatches } from '../../search';

const KINDS = [['all', 'All'], ['calls', 'Calls'], ['sms', 'SMS'], ['voicemail', 'Voicemail'], ['recordings', 'Recordings']];

// Auto summaries for new voicemails / recorded calls (Pro and up).
function AiSummaryBar({ num, reload }) {
  const { catalog } = useShell() || {};
  const [save, busy] = useSave(num, 'ai-summary', reload);
  const rate = Number(catalog?.rates?.aiSummaryPerMin ?? 0.1).toFixed(2);
  if (!num.access?.aiSummary) return <div className="text-xs text-[#a1a1aa] mb-4" data-testid="ai-summary-locked">AI summaries and caller mood for voicemails and recorded calls are on the Pro plan and up.</div>;
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-[#a78bfa]/25 bg-[#a78bfa]/5 p-4 mb-4" data-testid="ai-summary-bar">
      <div>
        <div className="text-sm font-medium flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#a78bfa]" />AI summaries & caller mood</div>
        <div className="text-xs text-[#a1a1aa] mt-1">{`Summarise new voicemails and recorded calls automatically — $${rate}/min from your wallet (per started minute). Or tap Summarize on any one below.`}</div>
      </div>
      <Toggle checked={!!num.features.aiSummary?.enabled} disabled={busy} onChange={v => save({ enabled: v }, 'PATCH', v ? 'Auto summaries on' : 'Auto summaries off')} testid="ai-summary-auto-toggle" />
    </div>
  );
}

export default function LogsTab({ num, reload: reloadNum }) {
  const [kind, setKind] = useState('all');
  const { data, loading, reload } = useApi(`/numbers/${enc(num.phoneNumber)}/logs?kind=${kind}`);
  const s = useSearch(data?.logs, l => [labelOf(l.type)[0], l.from, l.to, l.forwardTo, l.body, l.transcript, l.aiSummary?.summary, l.aiSummary?.mood, l.note?.text, l.digit ? `key ${l.digit}` : '']);
  useEffect(() => { window.addEventListener(RING_ENDED, reload); return () => window.removeEventListener(RING_ENDED, reload); }, [reload]);
  return (
    <div className="civr-card p-6">
      <AiSummaryBar num={num} reload={reloadNum} />
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {KINDS.map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)} className={`civr-pill cursor-pointer ${kind === k ? 'civr-pill-on' : ''}`} data-testid={`logs-filter-${k}`}>{label}</button>
          ))}
        </div>
        <SearchBox s={s} placeholder="Search this log" testid="logs-search" className="lg:w-72" />
      </div>
      {loading && !data ? <div className="text-sm text-[#a1a1aa] py-6">Loading…</div>
        : s.active && !s.list.length ? <NoMatches s={s} testid="logs-no-matches" />
          : <LogTable logs={s.list} testid="number-logs" notePhone={num.phoneNumber} onNotesChange={reload} resetKey={`${kind}|${s.q}`} summarize={!!num.access?.aiSummary} />}
    </div>
  );
}
