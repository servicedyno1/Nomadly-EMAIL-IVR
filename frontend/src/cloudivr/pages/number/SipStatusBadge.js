import React, { useEffect, useState } from 'react';
import { api, enc } from '../../api';

const ago = (d) => { const m = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000)); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const LOOK = {
  signed_in: { dot: 'bg-[#34d399]', ring: 'civr-pill-ok border-transparent', label: 'Signed in' },
  signed_out: { dot: 'bg-[#f87171]', ring: 'civr-pill-bad border-transparent', label: 'Not signed in' },
  unknown: { dot: 'bg-[#a1a1aa]', ring: 'border-transparent bg-[var(--c-surface-2)] text-[var(--c-muted)]', label: 'Checking…' },
};

// Live "is a phone app signed in to this login" pill; refreshes every 30 s.
export function SipStatusBadge({ num, prefix = 'sip' }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api(`/numbers/${enc(num.phoneNumber)}/sip/status`).then(d => alive && setS(d)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [num.phoneNumber]);
  if (!s || s.state === 'none') return null;
  const l = LOOK[s.state] || LOOK.unknown;
  const sub = s.state === 'signed_in' ? `${s.devices > 1 ? `${s.devices} apps` : s.lastApp || 'App'} · checked in ${ago(s.lastSeenAt)}` : s.lastSeenAt ? `Last seen ${ago(s.lastSeenAt)}` : s.state === 'signed_out' ? 'No app has signed in yet' : '';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${l.ring}`} title={sub} data-testid={`${prefix}-status-badge`} data-state={s.state}>
      <span className="relative flex w-2 h-2">
        {s.state === 'signed_in' && <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${l.dot}`} />}
        <span className={`relative inline-flex w-2 h-2 rounded-full ${l.dot}`} />
      </span>
      <span className="font-semibold" data-testid={`${prefix}-status-label`}>{l.label}</span>
      {sub && <span className="text-[11px] opacity-80 hidden sm:inline" data-testid={`${prefix}-status-detail`}>{sub}</span>}
    </span>
  );
}
