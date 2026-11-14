import React, { useState } from 'react';
import { Load, Stat } from './common';

const NEED = { line: 'Business phone line', texting: 'Text customers', travel: 'Travel eSIM', ai: 'AI receptionist', bulk: 'Bulk calls', fax: 'Fax', other: 'Something else', sales: 'Sales calling (old)', support: 'Support line (old)', bookings: 'Bookings (old)', accessible: 'Type-to-talk (old)' };
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');

function BarList({ title, rows, label = (k) => k, extra, testid, empty = 'Nothing yet.' }) {
  const top = Math.max(1, ...rows.map(r => r.n));
  return (
    <div className="civr-card p-5" data-testid={testid}>
      <div className="text-xs uppercase tracking-widest text-[#a1a1aa] mb-4">{title}</div>
      {rows.length ? <div className="space-y-2">{rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-3 text-sm" data-testid={`${testid}-row-${i}`}>
          <span className="w-44 shrink-0 truncate" title={label(r.key)}>{label(r.key)}</span>
          <div className="flex-1 h-5 rounded bg-[#1f1f1f] overflow-hidden"><div className="h-full bg-[#818cf8]/70 transition-[width] duration-500" style={{ width: `${Math.max(2, (r.n / top) * 100)}%` }} /></div>
          <b className="w-10 text-right tabular-nums">{r.n}</b>{extra && <span className="w-24 text-xs text-[#a1a1aa] text-right">{extra(r)}</span>}
        </div>
      ))}</div> : <p className="text-sm text-[#a1a1aa]">{empty}</p>}
    </div>
  );
}

function Body({ d }) {
  const funnel = d.funnel.map(([key, n]) => ({ key, n }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Sign-ups" value={d.signups} testid="insights-signups" />
        <Stat label="Added money" value={d.paid} sub={`${pct(d.paid, d.signups)} of sign-ups`} testid="insights-paid" />
        <Stat label="Said what they need" value={d.signups - d.unanswered - d.skipped} sub={`${d.skipped} skipped · ${d.unanswered} not asked yet`} testid="insights-answered" />
        <Stat label="Want offer emails" value={d.optIn} sub={`${pct(d.optIn, d.signups)} opted in`} testid="insights-optin" />
      </div>
      <BarList title="Journey · visitors to paying" rows={funnel} testid="insights-funnel" extra={(r) => pct(r.n, funnel[0].n)} />
      <div className="grid lg:grid-cols-2 gap-6">
        <BarList title="Where sign-ups come from" rows={d.bySource} testid="insights-sources" extra={(r) => `${r.paid} paid`} />
        <BarList title="What they need" rows={d.purposes} label={(k) => NEED[k] || k} testid="insights-purposes" />
        <BarList title="Ad campaigns" rows={d.byCampaign} testid="insights-campaigns" empty="No campaign links used yet. Add ?utm_campaign=… to your ad links." />
        <BarList title="Device at sign-up" rows={d.byDevice} testid="insights-devices" />
        <BarList title="Visitors left from (didn’t sign up)" rows={d.visitorExits} testid="insights-visitor-exits" />
        <BarList title="New users stopped at (no money added)" rows={d.userExits} testid="insights-user-exits" />
      </div>
      <p className="text-xs text-[#a1a1aa]">Visit and page tracking started on 14 Nov 2026, so earlier sign-ups count as “Direct / unknown” with no pages.</p>
    </div>
  );
}

export default function Insights() {
  const [days, setDays] = useState(30);
  return (
    <div className="space-y-4" data-testid="admin-insights">
      <div className="flex gap-2" role="group" aria-label="Period">{[7, 30, 90].map(n => (
        <button key={n} type="button" onClick={() => setDays(n)} aria-pressed={days === n} className={`civr-btn civr-btn-sm ${days === n ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`insights-days-${n}`}>{`${n} days`}</button>
      ))}</div>
      <Load path={`/admin/signup-insights?days=${days}`} testid="insights">{(d) => <Body d={d} />}</Load>
    </div>
  );
}
