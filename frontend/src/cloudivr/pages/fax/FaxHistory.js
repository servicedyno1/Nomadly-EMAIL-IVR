import React from 'react';
import { toast } from 'sonner';
import { Download, ArrowDownLeft, ArrowUpRight, RotateCcw } from 'lucide-react';
import { downloadFile, when, money } from '../../api';
import { statusPill } from '../../ui';

const LABEL = { queued: 'Queued', 'media.processed': 'Preparing', 'sending.started': 'Sending', delivered: 'Delivered', failed: 'Failed', received: 'Received', received_no_media: 'Downloading', media_failed: 'Download failed', held: 'Top up to open' };
const pill = (s) => statusPill(s === 'delivered' || s === 'received' ? 'completed' : s === 'failed' ? 'failed' : 'waiting');

function Row({ f }) {
  const other = f.direction === 'inbound' ? f.from : f.to;
  const save = () => downloadFile(`/fax/${encodeURIComponent(f.id)}/pdf`, `fax_${String(other).replace(/\D/g, '')}.pdf`).catch(e => toast.error(e.message));
  const Icon = f.direction === 'inbound' ? ArrowDownLeft : ArrowUpRight;
  return (
    <tr data-testid={`fax-row-${f.id}`}>
      <td className="whitespace-nowrap">{when(f.createdAt)}</td>
      <td><span className="inline-flex items-center gap-1.5"><Icon className="w-4 h-4 text-[#a1a1aa]" />{f.direction === 'inbound' ? 'From' : 'To'} <span className="tabular-nums">{other}</span></span><div className="text-xs text-[#a1a1aa]">on {f.phoneNumber}</div></td>
      <td>{f.pages}</td>
      <td><span className={pill(f.status)} data-testid={`fax-status-${f.id}`}>{LABEL[f.status] || f.status}</span>{(f.reason || f.failureReason) && <div className="text-xs text-[#fb7185] mt-1 max-w-[16rem]" data-testid={`fax-reason-${f.id}`}>{f.reason || f.failureReason.replace(/_/g, ' ')}</div>}</td>
      <td>{f.cost > 0 ? money(f.cost) : (f.status === 'delivered' || f.status === 'received') ? 'Free' : '—'}</td>
      <td className="text-right">{f.hasFile && f.status !== 'held' && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={save} data-testid={`fax-download-${f.id}`}><Download className="w-4 h-4" />PDF</button>}</td>
    </tr>
  );
}

export function FaxHistory({ faxes, reload }) {
  return (
    <div className="civr-card p-6" data-testid="fax-history-card">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="font-semibold">Fax history</div>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={reload} data-testid="fax-refresh-button"><RotateCcw className="w-4 h-4" />Refresh</button>
      </div>
      {!faxes.length ? <p className="text-sm text-[#a1a1aa]" data-testid="fax-history-empty">No faxes yet. Sent and received faxes show up here.</p> : (
        <div className="overflow-x-auto">
          <table className="civr-table w-full" data-testid="fax-history-table">
            <thead><tr><th>When</th><th>Fax</th><th>Pages</th><th>Status</th><th>Cost</th><th /></tr></thead>
            <tbody>{faxes.map(f => <Row key={f.id} f={f} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
