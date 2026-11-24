import React, { useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, XCircle } from 'lucide-react';
import { api, money } from '../../api';
import { Empty } from '../../ui';

const TONE = { done: 'civr-pill-ok', completed: 'civr-pill-ok', running: 'civr-pill-on', sending: 'civr-pill-on', cancelled: 'civr-pill-bad', blocked: 'civr-pill-bad', failed: 'civr-pill-bad' };

// Campaigns with live progress (sent / failed / waiting / replies) and cancel before they start.
export function CampaignList({ campaigns, onNew, onChange }) {
  const [busy, setBusy] = useState(null);
  if (!campaigns?.length) return (
    <Empty icon={Megaphone} title="No campaigns yet" sub="Paste your numbers, write one text, and we send it from real mobile numbers." testid="bulksms-campaigns-empty">
      <button type="button" className="civr-btn civr-btn-primary" onClick={onNew} data-testid="bulksms-campaigns-new">Create your first campaign</button>
    </Empty>
  );
  const cancel = async (b) => { if (!window.confirm('Cancel this campaign? Unsent texts are refunded to your wallet.')) return; setBusy(b.id); try { await api(`/bulksms/bookings/${b.id}/cancel`, { method: 'POST' }); toast.success('Cancelled — refund on its way to your wallet'); onChange(); } catch (e) { toast.error(e.message); } finally { setBusy(null); } };
  return (
    <div className="space-y-3" data-testid="bulksms-campaigns">
      {campaigns.map(c => {
        const r = c.report || {}, total = c.parts || c.volume || 1, sent = r.sent || 0, pct = Math.min(100, Math.round((sent / total) * 100)), status = c.booking?.status || c.status;
        return (
          <div key={c.id} className="civr-card p-5" data-testid={`bulksms-campaign-${c.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><div className="font-semibold truncate">{c.name}</div><div className="text-xs text-[var(--c-muted)] mt-0.5">{c.volume.toLocaleString()} numbers{c.booking ? ` · #${c.booking.code} · ${c.booking.date} ${String(c.booking.hour).padStart(2, '0')}:00 UTC · ${money(c.booking.price)}` : ''}</div></div>
              <span className={`civr-pill ${TONE[status] || ''}`} data-testid={`bulksms-campaign-status-${c.id}`}>{String(status).replace(/_/g, ' ')}</span>
            </div>
            <div className="h-2 rounded-full bg-[#1f1f1f] mt-4 overflow-hidden"><div className="h-full bg-[#818cf8] transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm mt-3" data-testid={`bulksms-campaign-report-${c.id}`}>
              <span><b>{sent.toLocaleString()}</b> sent</span><span><b>{(r.failed || 0).toLocaleString()}</b> failed</span><span><b>{Math.max(0, total - sent - (r.failed || 0)).toLocaleString()}</b> waiting</span>{c.replies && <span><b>{(r.replies || 0).toLocaleString()}</b> replies</span>}
            </div>
            {c.booking && ['pending', 'confirmed', 'awaiting_payment'].includes(c.booking.status) && <button type="button" className="civr-btn civr-btn-sm civr-btn-ghost mt-3" disabled={busy === c.booking.id} onClick={() => cancel(c.booking)} data-testid={`bulksms-campaign-cancel-${c.id}`}><XCircle className="w-4 h-4" />Cancel</button>}
          </div>
        );
      })}
    </div>
  );
}
