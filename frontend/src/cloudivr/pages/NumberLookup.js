import React, { useState } from 'react';
import { ScanSearch, Loader2 } from 'lucide-react';
import { api, money, useApi } from '../api';
import { PageHeader, Spinner, ErrorNote } from '../ui';
import { useShell } from '../Shell';

const TYPE = { mobile: 'Mobile', landline: 'Landline', voip: 'VoIP', toll_free: 'Toll-free', invalid: 'Not a working number' };
const when = (d) => new Date(d).toLocaleString();

function Result({ r, testid }) {
  const cells = [['Line type', TYPE[r.type] || r.type], ['Carrier', r.carrier], ['Country', r.country], ['Ported', r.ported ? 'Yes' : 'No']];
  return (
    <div className="civr-card p-5" data-testid={testid}>
      <div className="flex items-center gap-3 mb-3"><span className="font-mono text-lg" data-no-translate>{r.number}</span><span className={`civr-pill ${r.valid ? 'civr-pill-ok' : 'civr-pill-bad'}`} data-testid={`${testid}-valid`}>{r.valid ? 'Valid' : 'Not valid'}</span></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">{cells.map(([k, v]) => <div key={k}><div className="text-xs text-[var(--c-muted)]">{k}</div><div className="font-semibold" data-testid={`${testid}-${k.toLowerCase().replace(' ', '-')}`}>{v || 'unknown'}</div></div>)}</div>
    </div>
  );
}

export default function NumberLookup() {
  const { data, reload } = useApi('/lookup');
  const { refreshSummary } = useShell();
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [last, setLast] = useState(null);
  if (!data) return <Spinner />;
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setLast(await api('/lookup', { method: 'POST', body: { number } })); refreshSummary(); reload(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-8 max-w-4xl" data-testid="lookup-page">
      <PageHeader label="Phone numbers" title="Number lookup" sub={`Check any number before you call or text it: mobile or landline, carrier, country and whether it was ported. ${money(data.price)} per lookup from your wallet. No charge if the lookup fails.`} testid="lookup-header" />
      <form onSubmit={go} className="flex flex-wrap gap-2">
        <input className="civr-input flex-1 min-w-[240px] font-mono" placeholder="+1 415 555 0100" value={number} onChange={e => setNumber(e.target.value)} data-testid="lookup-number-input" />
        <button className="civr-btn civr-btn-primary" disabled={busy || !number.trim()} data-testid="lookup-submit-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}{`Look up · ${money(data.price)}`}</button>
      </form>
      <ErrorNote error={err} testid="lookup-error" />
      {last && <Result r={last} testid="lookup-result" />}
      {data.history.length > 0 && (
        <div data-testid="lookup-history">
          <div className="civr-label mb-3">Recent lookups</div>
          <div className="civr-card divide-y divide-[var(--c-border,#1f1f1f)]">
            {data.history.map((h, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 p-3 text-sm" data-testid={`lookup-history-${i}`}>
                <span className="font-mono w-44" data-no-translate>{h.number}</span><span className="w-28">{TYPE[h.type] || h.type}</span><span className="flex-1 truncate">{h.carrier}</span><span className="text-xs text-[var(--c-muted)]">{when(h.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
