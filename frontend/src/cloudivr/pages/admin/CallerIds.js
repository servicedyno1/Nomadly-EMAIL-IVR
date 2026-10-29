import React from 'react';
import { enc } from '../../api';
import { Act, Load, Pill, dt, fmt } from './common';

// Customer-requested caller IDs (no code) waiting for approval. Approve = usable; Reject = refund + remove.
export default function CallerIdsAdmin() {
  return (
    <Load path="/admin/caller-ids" testid="admin-caller-ids">
      {(d, reload) => {
        const review = d.items.filter(i => i.status === 'review');
        const live = d.items.filter(i => i.status === 'verified');
        return (
          <div className="space-y-6" data-testid="admin-caller-ids-list">
            <div>
              <h3 className="text-sm uppercase tracking-widest text-[#a1a1aa] mb-2">Waiting for approval</h3>
              {review.length ? <div className="space-y-2">{review.map(c => (
                <div key={c.number} className="civr-card p-4 flex flex-wrap items-center gap-3" data-testid={`admin-caller-id-${enc(c.number)}`}>
                  <b className="tabular-nums">{c.number}</b><Pill tone="warn">review</Pill>
                  <span className="text-xs text-[#a1a1aa]">user {c.chatId} · paid {fmt(c.charged)} · {dt(c.at)}{c.note ? ` · “${c.note}”` : ''}</span>
                  <span className="flex-1" />
                  <Act label="Approve" path={`/admin/caller-ids/${enc(c.number)}/approve`} done={reload} testid={`admin-caller-id-approve-${enc(c.number)}`} />
                  <Act label="Reject & refund" danger path={`/admin/caller-ids/${enc(c.number)}/reject`} done={reload} testid={`admin-caller-id-reject-${enc(c.number)}`} />
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
