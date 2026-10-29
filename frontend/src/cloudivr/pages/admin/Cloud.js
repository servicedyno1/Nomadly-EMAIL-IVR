import React, { useState } from 'react';
import { enc } from '../../api';
import { Act, Load, Pill, Search, fmt, dt } from './common';

function Numbers() {
  const [q, setQ] = useState('');
  return (
    <div className="space-y-3">
      <Search value={q} onChange={setQ} placeholder="Search a number" testid="admin-numbers-search" />
      <Load path={`/admin/numbers?q=${enc(q)}`} testid="admin-numbers">
        {(d) => <div className="civr-card civr-scroll-x"><table className="civr-table w-full text-sm" data-testid="admin-numbers-table"><thead><tr><th className="text-left">Number</th><th className="text-left">Owner</th><th className="text-left">Plan</th><th className="text-left">Status</th><th className="text-left">Renews</th></tr></thead>
          <tbody>{d.items.map(n => <tr key={n.phoneNumber}><td className="tabular-nums">{n.phoneNumber}</td><td className="text-[#a1a1aa]">{n.chatId}</td><td>{n.plan}</td><td>{n.status}</td><td>{String(n.expiresAt || '').slice(0, 10)}{n.autoRenew ? '' : ' (off)'}</td></tr>)}</tbody></table></div>}
      </Load>
    </div>
  );
}

function Campaigns() {
  const [st, setSt] = useState('running');
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">{[['running', 'Running'], ['paused', 'Paused'], ['', 'All']].map(([k, l]) => <button key={k || 'all'} type="button" className={`civr-btn civr-btn-sm ${st === k ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setSt(k)} data-testid={`admin-campaigns-filter-${k || 'all'}`}>{l}</button>)}</div>
      <Load path={`/admin/campaigns?status=${st}`} testid="admin-campaigns">
        {(d, reload) => d.items.length ? <div className="space-y-2">{d.items.map(c => (
          <div key={c.id} className="civr-card p-4 flex flex-wrap items-center gap-3" data-testid={`admin-campaign-${c.id}`}>
            <b>{c.name || 'Campaign'}</b><Pill tone={c.status === 'running' ? 'on' : ''}>{c.status}</Pill><span className="text-xs text-[#a1a1aa]">{c.mode === 'ai' ? `AI · ${c.agentName}` : c.mode || 'IVR'} · {c.callerId} · user {c.chatId} · {dt(c.createdAt)}</span>
            <span className="flex-1" />
            {c.status === 'running' && <Act label="Pause" path={`/admin/campaigns/${c.id}/pause`} done={reload} testid={`admin-campaign-pause-${c.id}`} />}
            {c.status === 'paused' && <Act label="Resume" path={`/admin/campaigns/${c.id}/resume`} done={reload} testid={`admin-campaign-resume-${c.id}`} />}
            {['running', 'paused', 'scheduled'].includes(c.status) && <Act label="Stop" danger path={`/admin/campaigns/${c.id}/cancel`} done={reload} testid={`admin-campaign-cancel-${c.id}`} />}
          </div>
        ))}</div> : <p className="text-sm text-[#a1a1aa]">No campaigns.</p>}
      </Load>
    </div>
  );
}

function Agents() {
  const [flagged, setFlagged] = useState(true);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} data-testid="admin-agents-flagged" />Only flagged scripts</label>
      <Load path={`/admin/ai-agents?flagged=${flagged ? 1 : 0}`} testid="admin-agents">
        {(d, reload) => d.items.length ? <div className="space-y-2">{d.items.map(a => (
          <div key={a.id} className="civr-card p-4 space-y-2" data-testid={`admin-agent-${a.id}`}>
            <div className="flex flex-wrap items-center gap-2"><b>{a.name}</b>{a.businessName && <span className="text-[#a1a1aa]">for {a.businessName}</span>}{a.disabled && <Pill tone="bad">Stopped</Pill>}{a.flag && <Pill tone="warn">{a.flag}</Pill>}<span className="text-xs text-[#a1a1aa]">user {a.chatId} · {dt(a.updatedAt)}</span>
              <span className="flex-1" /><Act label={a.disabled ? 'Allow again' : 'Stop agent'} danger={!a.disabled} path={`/admin/ai-agents/${a.id}/disable`} body={{ disabled: !a.disabled }} done={reload} testid={`admin-agent-toggle-${a.id}`} /></div>
            <p className="text-xs text-[#a1a1aa] whitespace-pre-wrap line-clamp-4">{a.goal}</p>
          </div>
        ))}</div> : <p className="text-sm text-[#a1a1aa]">No agents{flagged ? ' with flagged scripts' : ''}.</p>}
      </Load>
    </div>
  );
}

const SUB = [['numbers', 'Numbers', Numbers], ['campaigns', 'Campaigns', Campaigns], ['agents', 'AI agents', Agents]];
export default function Cloud() {
  const [t, setT] = useState('campaigns');
  const Cmp = SUB.find(s => s[0] === t)[2];
  return (
    <div className="space-y-4" data-testid="admin-cloudivr">
      <div className="flex gap-2">{SUB.map(([k, l]) => <button key={k} type="button" className={`civr-btn civr-btn-sm ${t === k ? 'civr-btn-primary' : 'civr-btn-ghost'}`} onClick={() => setT(k)} data-testid={`admin-cloudivr-tab-${k}`}>{l}</button>)}</div>
      <Cmp />
    </div>
  );
}

export function Resellers() {
  return (
    <Load path="/admin/resellers" testid="admin-resellers">
      {(d) => !d.configured ? <p className="text-sm text-[#a1a1aa]" data-testid="admin-resellers-empty">No reseller databases are connected yet.</p> : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="admin-resellers">
          {d.items.map(r => (
            <div key={r.key} className="civr-card p-5 space-y-2" data-testid={`admin-reseller-${r.key}`}>
              <div className="flex items-center gap-2"><b>{r.name}</b>{r.ok ? <Pill tone="ok">connected</Pill> : <Pill tone="bad">unreachable</Pill>}</div>
              {r.ok ? <>
                <div className="grid grid-cols-2 gap-2 text-sm"><span className="text-[#a1a1aa]">Users</span><b>{r.users}</b><span className="text-[#a1a1aa]">Numbers</span><b>{r.numbers}</b><span className="text-[#a1a1aa]">Deposits 30d</span><b>{fmt(r.deposits30)}</b><span className="text-[#a1a1aa]">Sales 30d</span><b>{fmt(r.sales30)}</b><span className="text-[#a1a1aa]">Held in wallets</span><b>{fmt(r.walletHeld)}</b></div>
              </> : <p className="text-xs text-[#f87171]">{r.error}</p>}
            </div>
          ))}
        </div>
      )}
    </Load>
  );
}

export function Audit() {
  return (
    <Load path="/admin/audit" testid="admin-audit">
      {(d) => <div className="civr-card civr-scroll-x"><table className="civr-table w-full text-sm" data-testid="admin-audit-table"><thead><tr><th className="text-left">When</th><th className="text-left">Action</th><th className="text-left">Target</th><th className="text-left">Reason</th></tr></thead>
        <tbody>{d.items.map(a => <tr key={a._id}><td className="whitespace-nowrap text-[#a1a1aa]">{dt(a.at)}</td><td>{a.action}{a.details?.amount ? ` ${fmt(a.details.amount)}` : ''}</td><td className="tabular-nums">{a.target}</td><td>{a.reason || ''}</td></tr>)}</tbody></table></div>}
    </Load>
  );
}
