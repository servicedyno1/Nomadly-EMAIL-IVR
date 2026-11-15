import React, { useState } from 'react';
import { Load, Act, fmt, dt } from './common';

// Bird has no balance API: estimated spend since the last top-up, with a reset when the admin tops up.
export default function BirdSpend() {
  const [amount, setAmount] = useState('50');
  return (
    <Load path="/admin/bird-spend" testid="admin-bird-spend">
      {(s, reload) => (
        <div className="civr-card p-5 space-y-3" data-testid="admin-bird-spend">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-xs uppercase tracking-widest text-[#a1a1aa]">Bird balance · estimate</div>
            <span className={`civr-pill ${s.pct >= 80 ? 'civr-pill-warn' : 'civr-pill-on'}`} data-testid="admin-bird-spend-pct">{s.pct}% used</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums" data-testid="admin-bird-spend-left">~{fmt(s.left)} left</div>
          <div className="h-2 rounded bg-[#1f1f1f] overflow-hidden"><div className={`h-full ${s.pct >= 80 ? 'bg-[#fbbf24]' : 'bg-[#818cf8]'}`} style={{ width: `${Math.min(100, s.pct)}%` }} /></div>
          <div className="text-xs text-[#a1a1aa]" data-testid="admin-bird-spend-detail">{`${fmt(s.spent)} of ${fmt(s.budget)} since ${s.since ? dt(s.since) : 'tracking started'} · calls ${fmt(s.by.calls)} · lookups ${fmt(s.by.lookups)} · eSIMs ${fmt(s.by.esims)} · today ${fmt(s.today)}. Calls counted at ${fmt(s.callCostPerMin)}/min. Alert to Telegram + email at 80%.`}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" min="1" step="1" className="civr-input !py-1.5 text-sm !w-28" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Amount added to Bird (USD)" data-testid="admin-bird-topup-amount" />
            <Act label="I topped up Bird" path="/admin/bird-spend/topup" extra={() => ({ amount: Number(amount) })} done={reload} testid="admin-bird-topup" />
          </div>
        </div>
      )}
    </Load>
  );
}
