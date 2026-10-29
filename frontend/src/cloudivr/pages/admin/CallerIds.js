import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, enc } from '../../api';
import { Act, Load, Pill, dt, fmt } from './common';

// Bulk approve/reject with one shared reason (goes in the admin log).
function BulkBar({ numbers, onDone }) {
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const d = await api('/admin/caller-ids/bulk', { method: 'POST', body: { action, numbers, reason } }); toast.success(`${action === 'approve' ? 'Approved' : 'Rejected'} ${d.done}`); setAction(null); setReason(''); onDone(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="admin-caller-ids-bulk">
      <span className="text-sm text-[#a1a1aa]">{numbers.length} selected</span>
      {!action ? <>
        <button type="button" className="civr-btn civr-btn-sm civr-btn-primary" onClick={() => setAction('approve')} data-testid="admin-caller-ids-bulk-approve">Approve selected</button>
        <button type="button" className="civr-btn civr-btn-sm civr-btn-danger" onClick={() => setAction('reject')} data-testid="admin-caller-ids-bulk-reject">Reject selected</button>
      </> : <>
        <input className="civr-input !py-1.5 text-sm w-56" placeholder="Reason (saved in the log)" value={reason} onChange={e => setReason(e.target.value)} autoFocus data-testid="admin-caller-ids-bulk-reason" />
        <button type="button" className={`civr-btn civr-btn-sm ${action === 'reject' ? 'civr-btn-danger' : 'civr-btn-primary'}`} disabled={busy || reason.trim().length < 3} onClick={run} data-testid="admin-caller-ids-bulk-confirm">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Confirm {action} ({numbers.length})</button>
        <button type="button" className="text-xs text-[#a1a1aa] hover:underline" onClick={() => setAction(null)} data-testid="admin-caller-ids-bulk-cancel">Cancel</button>
      </>}
    </div>
  );
}

export default function CallerIdsAdmin() {
  const [sel, setSel] = useState([]);
  const toggle = (n) => setSel(s => (s.includes(n) ? s.filter(x => x !== n) : [...s, n]));
  return (
    <Load path="/admin/caller-ids" testid="admin-caller-ids">
      {(d, reload) => {
        const review = d.items.filter(i => i.status === 'review');
        const live = d.items.filter(i => i.status === 'verified');
        const selected = sel.filter(n => review.some(r => r.number === n));
        const after = () => { setSel([]); reload(); };
        const allOn = review.length > 0 && selected.length === review.length;
        return (
          <div className="space-y-6" data-testid="admin-caller-ids-list">
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h3 className="text-sm uppercase tracking-widest text-[#a1a1aa]">Waiting for approval</h3>
                {review.length > 0 && <label className="flex items-center gap-2 text-xs text-[#a1a1aa]"><input type="checkbox" checked={allOn} onChange={e => setSel(e.target.checked ? review.map(r => r.number) : [])} data-testid="admin-caller-ids-select-all" />Select all</label>}
                {selected.length > 0 && <BulkBar numbers={selected} onDone={after} />}
              </div>
              {review.length ? <div className="space-y-2">{review.map(c => (
                <div key={c.number} className="civr-card p-4 flex flex-wrap items-center gap-3" data-testid={`admin-caller-id-${enc(c.number)}`}>
                  <input type="checkbox" checked={sel.includes(c.number)} onChange={() => toggle(c.number)} data-testid={`admin-caller-id-check-${enc(c.number)}`} />
                  <b className="tabular-nums">{c.number}</b><Pill tone="warn">review</Pill>
                  <span className="text-xs text-[#a1a1aa]">user {c.chatId} · paid {fmt(c.charged)} · {dt(c.at)}{c.note ? ` · “${c.note}”` : ''}</span>
                  <span className="flex-1" />
                  <Act label="Approve" path={`/admin/caller-ids/${enc(c.number)}/approve`} done={after} testid={`admin-caller-id-approve-${enc(c.number)}`} />
                  <Act label="Reject & refund" danger path={`/admin/caller-ids/${enc(c.number)}/reject`} done={after} testid={`admin-caller-id-reject-${enc(c.number)}`} />
                </div>
              ))}</div> : <p className="text-sm text-[#a1a1aa]" data-testid="admin-caller-ids-empty">Nothing waiting for review.</p>}
            </div>
            <div>
              <h3 className="text-sm uppercase tracking-widest text-[#a1a1aa] mb-2">Active caller IDs</h3>
              {live.length ? <div className="civr-card civr-scroll-x"><table className="civr-table w-full text-sm" data-testid="admin-caller-ids-active-table"><thead><tr><th className="text-left">Number</th><th className="text-left">User</th><th className="text-left">How</th></tr></thead>
                <tbody>{live.map(c => <tr key={c.number}><td className="tabular-nums">{c.number}</td><td className="text-[#a1a1aa]">{c.chatId}</td><td>{c.adminApproved ? 'admin approved' : 'code verified'}</td></tr>)}</tbody></table></div>
                : <p className="text-sm text-[#a1a1aa]">No active caller IDs.</p>}
            </div>
          </div>
        );
      }}
    </Load>
  );
}
