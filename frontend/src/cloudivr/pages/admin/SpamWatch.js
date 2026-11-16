import React, { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { Load } from './common';

// Spam watch (texts and calls): anything caught always alerts on Telegram; this one switch decides whether it waits for Approve / Reject.
export default function SpamWatch() {
  const [busy, setBusy] = useState(false);
  const flip = async (hold, reload) => {
    setBusy(true);
    try { await api('/admin/msg-watch', { method: 'PUT', body: { hold } }); toast.success(hold ? 'Caught texts and calls now wait for your decision' : 'Caught texts and calls go through, alert only'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Load path="/admin/msg-watch" testid="admin-spam-watch">
      {(s, reload) => (
        <div className="civr-card p-5 space-y-3" data-testid="admin-spam-watch">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-[#a1a1aa]">Spam watch · texts and calls</div>
            <span className={`civr-pill ${s.hold ? 'civr-pill-warn' : 'civr-pill-on'}`} data-testid="admin-spam-watch-mode">{s.hold ? 'Holding' : 'Alert only'}</span>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5" checked={!!s.hold} disabled={busy} onChange={e => flip(e.target.checked, reload)} data-testid="admin-spam-watch-hold-toggle" />
            <span>
              <span className="block text-sm font-medium">Hold everything caught for my decision</span>
              <span className="block text-xs text-[#a1a1aa]" data-testid="admin-spam-watch-help">{s.hold ? 'A caught text, Quick IVR call or call campaign is not sent or dialed until you tap Approve on its Telegram alert. The customer is not told.' : 'Caught texts, Quick IVR calls and call campaigns still go out. You only get the Telegram alert.'} Received texts and live AI agent or receptionist calls are never stopped, only reported.</span>
            </span>
          </label>
          <div className="text-xs text-[#a1a1aa]" data-testid="admin-spam-watch-scope">{s.brands > 1 ? `One switch for all ${s.brands} brands.` : 'This switch covers this brand.'} Checked: texts, BulkSMS, Quick IVR, call campaigns, AI agent and receptionist scripts and calls.</div>
          <div className="text-xs text-[#a1a1aa]" data-testid="admin-spam-watch-stats">{`${s.held} waiting now · ${s.caught7d} caught in 7 days${s.ai ? '' : ' · AI check is off, keyword rules only'}`}</div>
        </div>
      )}
    </Load>
  );
}
