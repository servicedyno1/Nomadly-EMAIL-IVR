import React, { useRef, useState } from 'react';
import { Download, Loader2, Upload, ListChecks } from 'lucide-react';
import { api } from '../../api';
import { ErrorNote } from '../../ui';

export const price = (p) => `$${Number(p).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
const itemsOf = (text) => [...new Set(String(text || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
const toCsv = (cols, rows) => [cols.map(c => c[0]).join(','), ...rows.map(r => cols.map(([, f]) => `"${String(f(r) ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// Bulk run: paste a list or pick a CSV, see the total, run it, download the results.
export function BulkRun({ kind, unit, max, path, field, cols, Row, onDone, testid }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [out, setOut] = useState(null);
  const file = useRef(null);
  const list = itemsOf(text);
  const pick = async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; };
  const run = async () => {
    setBusy(true); setErr(null); setOut(null);
    try { setOut(await api(path, { method: 'POST', body: { [field]: list } })); onDone(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const ok = out?.results?.filter(r => !r.failed) || [];
  return (
    <div className="civr-card p-6 space-y-4" data-testid={testid}>
      <div className="flex items-center gap-2 font-semibold"><ListChecks className="w-4 h-4" />Check a list of {kind}s</div>
      <p className="text-sm text-[var(--c-muted)]">Paste up to {max.toLocaleString()} {kind}s (one per line or separated by commas), or upload a CSV file. {price(unit)} each; you’re only charged for the ones we could check.</p>
      <textarea className="civr-input font-mono !h-36 py-2" value={text} onChange={e => setText(e.target.value)} placeholder={kind === 'email' ? 'ana@example.com\nsales@example.org' : '+14155550100\n+447700900123'} data-testid={`${testid}-input`} />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={pick} data-testid={`${testid}-file`} />
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => file.current?.click()} data-testid={`${testid}-upload`}><Upload className="w-4 h-4" />Upload CSV</button>
        <span className="text-sm text-[var(--c-muted)] flex-1" data-testid={`${testid}-count`}>{list.length > max ? `${list.length} items — the limit is ${max}` : `${list.length} item${list.length === 1 ? '' : 's'} · up to ${price(list.length * unit)}`}</span>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy || !list.length || list.length > max} onClick={run} data-testid={`${testid}-run`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? 'Checking…' : `Check ${list.length || ''}`}</button>
      </div>
      <ErrorNote error={err} testid={`${testid}-error`} />
      {out && (
        <div className="space-y-3" data-testid={`${testid}-result`}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span data-testid={`${testid}-summary`}>{`${ok.length} checked · ${price(out.charged)} charged${out.refunded ? ` · ${price(out.refunded)} refunded` : ''}${out.skipped ? ` · ${out.skipped} skipped (not a valid ${kind})` : ''}`}</span>
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm ml-auto" onClick={() => download(`${kind}-check-${out.batchId}.csv`, toCsv(cols, out.results))} data-testid={`${testid}-download`}><Download className="w-4 h-4" />Download CSV</button>
          </div>
          <div className="civr-card divide-y divide-[var(--c-border)] max-h-96 overflow-y-auto">{out.results.slice(0, 200).map((r, i) => <Row key={i} r={r} i={i} />)}</div>
          {out.results.length > 200 && <p className="text-xs text-[var(--c-muted)]">Showing the first 200 — download the CSV for all {out.results.length}.</p>}
        </div>
      )}
    </div>
  );
}
