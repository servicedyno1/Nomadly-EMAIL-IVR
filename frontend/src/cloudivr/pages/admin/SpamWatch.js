import React, { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { Load } from './common';

// Spam text watch: caught texts always alert on Telegram; this switch decides whether they wait for Approve / Reject.
export default function SpamWatch() {
  const [busy, setBusy] = useState(false);
  const flip = async (hold, reload) => {
    setBusy(true);
    try { await api('/admin/msg-watch', { method: 'PUT', body: { hold } }); toast.success(hold ? 'Caught texts now wait for your decision' : 'Caught texts are sent, alert only'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Load path="/admin/msg-watch" testid="admin-spam-watch">
      {(s, reload) => (
        <div className="civr-card p-5 space-y-3" data-testid="admin-spam-watch">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-[#a1a1aa]">Spam text watch</div>
            <span className={`civr-pill ${s.hold ? 'civr-pill-warn' : 'civr-pill-on'}`} data-testid="admin-spam-watch-mode">{s.hold ? 'Holding' : 'Alert only'}</span>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5" checked={!!s.hold} disabled={busy} onChange={e => flip(e.target.checked, reload)} data-testid="admin-spam-watch-hold-toggle" />
            <span>
              <span className="block text-sm font-medium">Hold caught texts for my decision</span>
              <span className="block text-xs text-[#a1a1aa]" data-testid="admin-spam-watch-help">{s.hold ? 'A caught outgoing text is not sent until you tap Approve on its Telegram alert. The customer is not told.' : 'A caught text is still sent. You only get the Telegram alert.'} Received texts are always delivered.</span>
            </span>
          </label>
          <div className="text-xs text-[#a1a1aa]" data-testid="admin-spam-watch-stats">{`${s.held} waiting now · ${s.caught7d} caught in 7 days${s.ai ? '' : ' · AI check is off, keyword rules only'}`}</div>
        </div>
      )}
    </Load>
  );
}
