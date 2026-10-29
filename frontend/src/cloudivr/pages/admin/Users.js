import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useApi, enc } from '../../api';
import { Spinner, ErrorNote } from '../../ui';
import { Act, Load, Pill, Search, fmt, dt } from './common';

function Wallet({ u, reload }) {
  const [amt, setAmt] = useState('');
  return (
    <div className="civr-card p-4 space-y-3" data-testid="admin-user-wallet">
      <div className="flex flex-wrap gap-6 text-sm"><span>Balance <b className="text-lg tabular-nums" data-testid="admin-user-balance">{fmt(u.balance)}</b></span><span className="text-[#a1a1aa]">In {fmt(u.totalIn)} · Out {fmt(u.totalOut)}</span></div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="civr-input w-36" type="number" step="0.01" placeholder="+10 or -5" value={amt} onChange={e => setAmt(e.target.value)} data-testid="admin-user-amount" />
        <Act label={Number(amt) < 0 ? 'Take from wallet' : 'Add to wallet'} path={`/admin/users/${u.chatId}/wallet`} extra={() => ({ amount: Number(amt) })} done={() => { setAmt(''); reload(); }} testid="admin-user-wallet-adjust" />
      </div>
    </div>
  );
}

function Detail({ id, onClose }) {
  const { data: u, error, loading, reload } = useApi(`/admin/users/${enc(id)}`);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={onClose} data-testid="admin-user-detail">
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-[var(--c-bg,#0a0a0a)] border-l border-[#262626] p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-lg font-semibold" data-testid="admin-user-name">{u?.name || u?.email || id}</div><div className="text-xs text-[#a1a1aa]">{u?.kind === 'web' ? 'Web account' : 'Bot user'} · {id}{u?.email ? ` · ${u.email}` : ''}</div></div>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onClose} data-testid="admin-user-close"><X className="w-4 h-4" /></button>
        </div>
        {loading && !u ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {u.suspended ? <Pill tone="bad">Suspended</Pill> : <Pill tone="ok">Active</Pill>}
              <Act label={u.suspended ? 'Unsuspend' : 'Suspend'} danger={!u.suspended} path={`/admin/users/${id}/suspend`} body={{ suspended: !u.suspended }} done={reload} testid="admin-user-suspend" />
              <span className="text-xs text-[#a1a1aa]">Joined {dt(u.createdAt)} · last sign-in {dt(u.lastLoginAt)}</span>
            </div>
            <Wallet u={u} reload={reload} />
            {u.numbers.length > 0 && <div className="text-sm"><div className="civr-label mb-2">Numbers</div>{u.numbers.map(n => <div key={n.phoneNumber} className="flex gap-3"><span className="tabular-nums">{n.phoneNumber}</span><span className="text-[#a1a1aa]">{n.plan} · {n.status} · until {String(n.expiresAt || '').slice(0, 10)}</span></div>)}</div>}
            {u.agents.length > 0 && <div className="text-sm"><div className="civr-label mb-2">AI agents</div>{u.agents.map(a => <div key={a.id} className="flex flex-wrap gap-2 items-center">{a.name}{a.disabled && <Pill tone="bad">stopped</Pill>}{a.flag && <Pill tone="warn">{a.flag}</Pill>}</div>)}</div>}
            {u.hosted.length > 0 && <div className="text-sm"><div className="civr-label mb-2">Landline to Texting</div>{u.hosted.map(x => <div key={x.id}>{x.phoneNumber} · {x.status} · paid {fmt(x.paid)}</div>)}</div>}
            <div><div className="civr-label mb-2">Wallet history</div>
              <div className="civr-scroll-x"><table className="civr-table w-full text-sm" data-testid="admin-user-transactions"><tbody>{u.transactions.map(t => <tr key={t.id}><td className="whitespace-nowrap text-[#a1a1aa]">{dt(t.at)}</td><td>{t.type}{t.meta?.reason ? ` — ${t.meta.reason}` : ''}</td><td className="text-right tabular-nums">{fmt(t.amount)}</td></tr>)}</tbody></table></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Users() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-4" data-testid="admin-users">
      <Search value={q} onChange={setQ} placeholder="Search by chat id, email or name" testid="admin-users-search" />
      <Load path={`/admin/users?q=${enc(q.trim())}`} testid="admin-users-list">
        {(d) => (
          <div className="civr-card civr-scroll-x">
            <table className="civr-table w-full text-sm"><thead><tr><th className="text-left">User</th><th className="text-left">Type</th><th className="text-right">Balance</th><th className="text-left">Status</th></tr></thead>
              <tbody>{d.items.map(u => (
                <tr key={`${u.kind}-${u.chatId}`} className="cursor-pointer hover:bg-white/5" onClick={() => setOpen(u.chatId)} data-testid={`admin-user-row-${u.chatId}`}>
                  <td><div>{u.name || u.email || u.chatId}</div><div className="text-xs text-[#a1a1aa]">{u.email || u.chatId}</div></td>
                  <td>{u.kind}</td><td className="text-right tabular-nums">{fmt(u.balance)}</td><td>{u.suspended ? <Pill tone="bad">Suspended</Pill> : <Pill tone="ok">Active</Pill>}</td>
                </tr>
              ))}</tbody></table>
            {!d.items.length && <p className="p-5 text-sm text-[#a1a1aa]">No users found.</p>}
          </div>
        )}
      </Load>
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
