import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi } from '../../api';
import { Spinner, ErrorNote } from '../../ui';

export const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dt = (d) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function Stat({ label, value, sub, testid }) {
  return (
    <div className="civr-card p-5" data-testid={testid}>
      <div className="text-xs uppercase tracking-widest text-[#a1a1aa]">{label}</div>
      <div className="text-2xl font-semibold mt-2 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[#a1a1aa] mt-1">{sub}</div>}
    </div>
  );
}

// Loads `path` and renders children(data, reload) with loading + error states.
export function Load({ path, children, testid }) {
  const { data, error, loading, reload } = useApi(path);
  if (loading && !data) return <Spinner testid={`${testid}-loading`} />;
  if (error) return <ErrorNote error={error} onRetry={reload} testid={`${testid}-error`} />;
  return children(data, reload);
}

// A change that needs a reason (goes in the admin log): button → inline reason box → confirm.
export function Act({ label, path, body = {}, done, danger, testid, extra }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await api(path, { method: 'POST', body: { ...body, ...(extra ? extra() : {}), reason } }); toast.success(`${label} — done`); setOpen(false); setReason(''); done?.(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" className={`civr-btn civr-btn-sm ${danger ? 'civr-btn-danger' : 'civr-btn-ghost'}`} onClick={() => setOpen(true)} data-testid={testid}>{label}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid={`${testid}-confirm-box`}>
      <input className="civr-input !py-1.5 text-sm w-56" placeholder="Reason (saved in the log)" value={reason} onChange={e => setReason(e.target.value)} autoFocus data-testid={`${testid}-reason`} />
      <button type="button" className={`civr-btn civr-btn-sm ${danger ? 'civr-btn-danger' : 'civr-btn-primary'}`} disabled={busy || reason.trim().length < 3} onClick={run} data-testid={`${testid}-confirm`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm</button>
      <button type="button" className="text-xs text-[#a1a1aa] hover:underline" onClick={() => setOpen(false)} data-testid={`${testid}-cancel`}>Cancel</button>
    </span>
  );
}

export function Pill({ children, tone = '' }) {
  const t = { ok: 'civr-pill-ok', bad: 'civr-pill-bad', warn: 'civr-pill-warn', on: 'civr-pill-on' }[tone] || '';
  return <span className={`civr-pill ${t}`}>{children}</span>;
}

export function Search({ value, onChange, placeholder, testid }) {
  return <input className="civr-input max-w-md" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} data-testid={testid} />;
}
