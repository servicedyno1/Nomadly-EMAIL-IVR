import React, { useState } from 'react';
import { enc, useApi } from '../../api';
import { LogTable } from '../../LogTable';

const KINDS = [['all', 'All'], ['calls', 'Calls'], ['sms', 'SMS'], ['voicemail', 'Voicemail'], ['recordings', 'Recordings']];

export default function LogsTab({ num }) {
  const [kind, setKind] = useState('all');
  const { data, loading } = useApi(`/numbers/${enc(num.phoneNumber)}/logs?kind=${kind}`);
  return (
    <div className="civr-card p-5">
      <div className="flex flex-wrap gap-2 mb-4">
        {KINDS.map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} className={`civr-pill cursor-pointer ${kind === k ? 'civr-pill-on' : ''}`} data-testid={`logs-filter-${k}`}>{label}</button>
        ))}
      </div>
      {loading ? <div className="text-sm text-[#666] py-6">Loading…</div> : <LogTable logs={data?.logs} testid="number-logs" />}
    </div>
  );
}
