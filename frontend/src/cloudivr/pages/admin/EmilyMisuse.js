import React from 'react';
import { Load } from './common';

const when = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Off-topic or improper requests Emily refused (newest first), so the owner can review misuse.
export default function EmilyMisuse() {
  return (
    <Load path="/admin/emily-misuse?limit=50" testid="admin-emily-misuse">
      {(d) => (
        <div className="civr-card p-5 space-y-3" data-testid="admin-emily-misuse">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-[#a1a1aa]">Emily · refused off-topic requests</div>
            <span className="civr-pill" data-testid="admin-emily-misuse-count">{d.items.length}{d.items.length === 50 ? '+' : ''}</span>
          </div>
          {!d.items.length ? <div className="text-sm text-[#a1a1aa]" data-testid="admin-emily-misuse-empty">Nothing refused yet.</div> : (
            <ul className="divide-y divide-[#222] max-h-80 overflow-auto">
              {d.items.map((x, i) => (
                <li key={`${x.at}-${i}`} className="py-2 text-sm" data-testid={`admin-emily-misuse-row-${i}`}>
                  <div className="flex flex-wrap gap-x-3 text-xs text-[#a1a1aa]"><span>{when(x.at)}</span><span>{x.surface}</span><span>{x.chatId ? `account ${x.chatId}` : x.ip ? `visitor ${x.ip}` : 'visitor'}</span></div>
                  <div className="mt-0.5 break-words">“{x.text}”</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Load>
  );
}
