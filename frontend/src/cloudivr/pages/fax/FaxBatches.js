import React, { useState } from 'react';
import { toast } from 'sonner';
import { Square, Download } from 'lucide-react';
import { api, when, downloadFile } from '../../api';
import { ask } from '../../confirm';
import { statusPill } from '../../ui';

const LABEL = { running: 'Sending', done: 'Finished', cancelled: 'Stopped' };

function Batch({ b, reload }) {
  const [busy, setBusy] = useState(false);
  const done = b.delivered + b.failed + b.startFailed;
  const stop = async () => {
    if (!(await ask(`Stop this bulk fax? Numbers not sent yet will be skipped (no charge).`, { ok: 'Stop sending', danger: true, title: 'Bulk fax' }))) return;
    setBusy(true);
    try { await api(`/fax/bulk/${encodeURIComponent(b.id)}/cancel`, { method: 'POST' }); toast.success('Bulk fax stopped'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="py-4 border-b border-white/5 last:border-0" data-testid={`fax-batch-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm"><b>{b.total}</b> numbers × {b.pages} page{b.pages === 1 ? '' : 's'} <span className="text-[#a1a1aa]">from {b.phoneNumber} · {when(b.createdAt)}</span></div>
        <div className="flex items-center gap-2">
          <span className={statusPill(b.status === 'running' ? 'running' : b.status === 'done' ? 'completed' : 'cancelled')} data-testid={`fax-batch-status-${b.id}`}>{LABEL[b.status] || b.status}</span>
          {b.status === 'running' && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={stop} disabled={busy} data-testid={`fax-batch-stop-${b.id}`}><Square className="w-4 h-4" />Stop</button>}
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => downloadFile(`/fax/bulk/${encodeURIComponent(b.id)}/report.csv`, `bulk_fax_${b.id.slice(0, 8)}.csv`).catch(e => toast.error(e.message))} data-testid={`fax-batch-report-${b.id}`}><Download className="w-4 h-4" />Report</button>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-3"><div className="h-full bg-[#818cf8] transition-[width] duration-500" style={{ width: `${(done / Math.max(1, b.total)) * 100}%` }} /></div>
      <div className="text-xs text-[#a1a1aa] mt-1.5" data-testid={`fax-batch-progress-${b.id}`}>{b.sent} sent · {b.delivered} delivered · {b.failed + b.startFailed} failed · {Math.max(0, b.total - b.sent - b.startFailed)} {b.status === 'cancelled' ? 'not sent' : 'waiting'}</div>
    </div>
  );
}

export function FaxBatches({ batches, reload }) {
  if (!batches.length) return null;
  return (
    <div className="civr-card p-6 mb-4" data-testid="fax-batches-card">
      <div className="font-semibold">Bulk faxes</div>
      <div className="mt-1">{batches.map(b => <Batch key={b.id} b={b} reload={reload} />)}</div>
    </div>
  );
}
