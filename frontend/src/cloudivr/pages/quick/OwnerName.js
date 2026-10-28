import React, { useEffect, useState } from 'react';
import { UserRound, Loader2, Search } from 'lucide-react';
import { api, money } from '../../api';
import { useShell } from '../../Shell';

const RATE = 0.015;
// "+1…" needs all 11 digits; without "+", 10 digits means a US/Canada number.
const usPhone = (raw) => {
  const t = String(raw || '').trim();
  const d = t.replace(/\D/g, '');
  if (t.startsWith('+')) return d.length === 11 && d.startsWith('1') ? `+${d}` : '';
  return d.length === 11 && d.startsWith('1') ? `+${d}` : d.length === 10 ? `+1${d}` : '';
};

// Single US/Canada number → owner name (CNAM) when the user taps "Look up"; $0.015, free again for 30 days.
export function OwnerName({ targets, onUse }) {
  const { refreshSummary } = useShell() || {};
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const one = String(targets || '').split(/[\s,;]+/).filter(Boolean);
  const phone = one.length === 1 ? usPhone(one[0]) : '';
  useEffect(() => { setR(null); }, [phone]);
  if (!phone) return null;
  const look = async () => {
    setBusy(true);
    try { const x = await api('/cnam', { method: 'POST', body: { phone } }); setR(x); if (x.charged) refreshSummary?.(); } catch (e) { setR({ error: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="quick-owner-name" role="status">
      {!r ? (
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={look} data-testid="quick-owner-name-lookup">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{busy ? 'Looking up…' : `Look up owner name · ${money(RATE)}`}
        </button>
      ) : r.error ? (
        <><span className="text-[#fbbf24]" data-testid="quick-owner-name-error">{r.error}</span><button type="button" className="text-xs text-[#a1a1aa] hover:underline min-h-[44px]" onClick={look} data-testid="quick-owner-name-retry">Try again</button></>
      ) : r.name ? (
        <>
          <span className="civr-pill civr-pill-on"><UserRound className="w-3.5 h-3.5" />Owner: <b data-testid="quick-owner-name-value">{r.name}</b></span>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => onUse(r.name)} data-testid="quick-owner-name-use">Use as [Name]</button>
        </>
      ) : <span className="text-[#a1a1aa]" data-testid="quick-owner-name-none">No owner name listed for this number.</span>}
      {r && !r.error && <span className="text-xs text-[#a1a1aa]" data-testid="quick-owner-name-charge">{r.charged ? `Charged ${money(r.charged)}` : 'Looked up recently · free'}</span>}
      {!r && <span className="text-xs text-[#a1a1aa]">Free to look up the same number again for 30 days</span>}
    </div>
  );
}
