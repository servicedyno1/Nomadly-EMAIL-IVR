import React, { useEffect, useState } from 'react';
import { UserRound, Loader2 } from 'lucide-react';
import { api } from '../../api';

// Single US/Canada number → owner name (CNAM) after typing stops; $0.015, charged once per number.
export function OwnerName({ targets, onUse }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const one = String(targets || '').split(/[\s,;]+/).filter(Boolean);
  const d = one.length === 1 ? one[0].replace(/[^\d]/g, '') : '';
  const phone = d.length === 11 && d.startsWith('1') ? `+${d}` : d.length === 10 ? `+1${d}` : '';
  useEffect(() => {
    setR(null);
    if (!phone) return undefined;
    let live = true;
    const t = setTimeout(() => { setBusy(true); api('/cnam', { method: 'POST', body: { phone } }).then(x => live && setR(x)).catch(e => live && setR({ error: e.message })).finally(() => live && setBusy(false)); }, 1200);
    return () => { live = false; clearTimeout(t); };
  }, [phone]);
  if (!phone) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="quick-owner-name" role="status">
      {busy ? <span className="inline-flex items-center gap-1.5 text-[#a1a1aa]"><Loader2 className="w-3.5 h-3.5 animate-spin" />Looking up the owner name…</span>
        : r?.error ? <span className="text-[#fbbf24]" data-testid="quick-owner-name-error">{r.error}</span>
        : r?.name ? <>
            <span className="civr-pill civr-pill-on"><UserRound className="w-3.5 h-3.5" />Owner: <b data-testid="quick-owner-name-value">{r.name}</b></span>
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => onUse(r.name)} data-testid="quick-owner-name-use">Use as [Name]</button>
          </>
        : r ? <span className="text-[#a1a1aa]" data-testid="quick-owner-name-none">No owner name listed for this number.</span> : null}
      <span className="text-xs text-[#a1a1aa]">Owner-name lookup $0.015 · charged once per number</span>
    </div>
  );
}
