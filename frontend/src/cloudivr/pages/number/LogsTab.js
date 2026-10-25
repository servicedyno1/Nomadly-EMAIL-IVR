import React, { useEffect, useState } from 'react';
import { enc, useApi } from '../../api';
import { LogTable, labelOf } from '../../LogTable';
import { RING_ENDED } from '../../Incoming';
import { useSearch, SearchBox, NoMatches } from '../../search';

const KINDS = [['all', 'All'], ['calls', 'Calls'], ['sms', 'SMS'], ['voicemail', 'Voicemail'], ['recordings', 'Recordings']];

export default function LogsTab({ num }) {
  const [kind, setKind] = useState('all');
  const { data, loading, reload } = useApi(`/numbers/${enc(num.phoneNumber)}/logs?kind=${kind}`);
  const s = useSearch(data?.logs, l => [labelOf(l.type)[0], l.from, l.to, l.forwardTo, l.body, l.transcript, l.note?.text, l.digit ? `key ${l.digit}` : '']);
  useEffect(() => { window.addEventListener(RING_ENDED, reload); return () => window.removeEventListener(RING_ENDED, reload); }, [reload]);
  return (
    <div className="civr-card p-6">
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
          : <LogTable logs={s.list} testid="number-logs" notePhone={num.phoneNumber} onNotesChange={reload} resetKey={`${kind}|${s.q}`} />}
    </div>
  );
}
