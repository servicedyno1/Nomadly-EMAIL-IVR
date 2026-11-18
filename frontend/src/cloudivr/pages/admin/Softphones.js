import React, { useState } from 'react';
import { Load, Pill, Search, Stat, dt } from './common';

const WHY = { password: 'Wrong password', locked: 'Paused: too many wrong passwords', old_login: 'Old username' };

// Sign-in state of every number that has a SIP login: problems first, then signed in, then most recent.
export default function Softphones() {
  const [q, setQ] = useState('');
  return (
    <Load path="/admin/softphones" testid="admin-softphones">
      {(d, reload) => {
        const rows = d.items.filter(i => !q || `${i.email || ''} ${i.chatId} ${i.phoneNumber} ${i.login}`.toLowerCase().includes(q.toLowerCase()));
        return (
          <div className="space-y-6" data-testid="admin-softphones">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Stat label="Numbers with a SIP login" value={d.total} testid="admin-softphones-total" />
              <Stat label="Signed in now" value={d.signedIn} testid="admin-softphones-signed-in" />
              <Stat label="Failing to sign in" value={d.failing} sub="Last 24 hours, not fixed since" testid="admin-softphones-failing" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Search value={q} onChange={setQ} placeholder="Search email, number or username" testid="admin-softphones-search" />
              <button type="button" className="civr-btn civr-btn-sm civr-btn-ghost" onClick={reload} data-testid="admin-softphones-refresh">Refresh</button>
            </div>
            <div className="civr-card overflow-x-auto">
              <table className="w-full text-sm" data-testid="admin-softphones-table">
                <thead><tr className="text-left text-xs uppercase tracking-widest text-[#a1a1aa]">{['Customer', 'Number', 'Username', 'Status', 'Last sign-in', 'Last failure'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map(i => (
                    <tr key={`${i.chatId}-${i.phoneNumber}`} className="border-t border-[var(--c-border,#262626)]" data-testid={`admin-softphone-${i.login}`}>
                      <td className="px-4 py-3">{i.email || <span className="text-[#a1a1aa]">Telegram {i.chatId}</span>}</td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">{i.phoneNumber}</td>
                      <td className="px-4 py-3 font-mono">{i.login}{i.logins > 1 && <span className="text-[#a1a1aa]"> +{i.logins - 1}</span>}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><Pill tone={i.state === 'signed_in' ? 'ok' : 'bad'}>{i.state === 'signed_in' ? `Signed in${i.devices > 1 ? ` · ${i.devices}` : ''}` : 'Not signed in'}</Pill></td>
                      <td className="px-4 py-3 whitespace-nowrap">{i.lastSeenAt ? <>{dt(i.lastSeenAt)}<div className="text-xs text-[#a1a1aa]">{i.lastApp || 'Unknown app'}</div></> : <span className="text-[#a1a1aa]">Never</span>}</td>
                      <td className="px-4 py-3" data-testid={`admin-softphone-${i.login}-failure`}>{i.lastFailure ? <><Pill tone="warn">{WHY[i.lastFailure.reason] || i.lastFailure.reason}</Pill><div className="text-xs text-[#a1a1aa] mt-1">{dt(i.lastFailure.at)}{i.lastFailure.app ? ` · ${i.lastFailure.app}` : ''}</div></> : <span className="text-[#a1a1aa]">—</span>}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-[#a1a1aa]" data-testid="admin-softphones-empty">No softphones match.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      }}
    </Load>
  );
}
