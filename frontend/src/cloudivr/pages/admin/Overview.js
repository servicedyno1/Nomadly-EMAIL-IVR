import React from 'react';
import { Load, Stat, fmt } from './common';

const TYPE = { 'wallet-topup': 'Deposits', 'phone-number': 'Phone numbers', 'hosted-sms-setup': 'Texting setup', 'hosted-sms-nobill': 'Texting bill collection', 'hosted-sms-renewal': 'Texting monthly', 'hosted-sms-text': 'Texts sent', 'hosted-sms-inbound': 'Texts received', 'lead-check': 'Lead checks', 'cnam-lookup': 'Owner-name lookups', domain: 'Domains', hosting: 'Hosting', 'hosting-renewal': 'Hosting renewals', vps: 'VPS', 'admin-credit': 'Admin credits', 'admin-debit': 'Admin debits', 'hosted-sms-refund': 'Texting refunds', 'lead-check-refund': 'Lead check refunds', 'topup-bonus': 'Deposit bonuses', 'welcome-bonus': 'Welcome bonuses', refund: 'Refunds', ai_summary: 'AI summaries', 'cloudphone-subscription': 'Cloud phone plans' };
const label = (t) => TYPE[t] || t.replace(/[-_]/g, ' ');

function Bars({ series }) {
  const max = Math.max(1, ...series.map(s => s.usd));
  return (
    <div className="civr-card p-5" data-testid="admin-deposits-chart">
      <div className="text-xs uppercase tracking-widest text-[#a1a1aa] mb-4">Deposits · last 14 days</div>
      {series.length ? (
        <div className="flex items-end gap-2 h-32">
          {series.map(s => <div key={s.day} className="flex-1 flex flex-col items-center gap-1" title={`${s.day}: ${fmt(s.usd)} (${s.n})`}><div className="w-full rounded-t bg-[#818cf8]/80" style={{ height: `${(s.usd / max) * 100}%`, minHeight: 2 }} /><span className="text-[10px] text-[#a1a1aa]">{s.day.slice(5)}</span></div>)}
        </div>
      ) : <p className="text-sm text-[#a1a1aa]">No deposits in the last 14 days.</p>}
    </div>
  );
}

export default function Overview() {
  return (
    <Load path="/admin/overview" testid="admin-overview">
      {(d) => (
        <div className="space-y-6" data-testid="admin-overview">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Deposits · 30 days" value={fmt(d.deposits30)} sub={`${d.depositCount30} deposits · ${fmt(d.depositsToday)} today`} testid="admin-stat-deposits" />
            <Stat label="Net sales · 30 days" value={fmt(d.netSales30)} sub={`${fmt(d.sales30)} sales − ${fmt(d.refunds30)} refunds`} testid="admin-stat-sales" />
            <Stat label="Users" value={(d.botUsers + d.webUsers).toLocaleString()} sub={`${d.botUsers} bot · ${d.webUsers} web (${d.newWeb7} new this week)`} testid="admin-stat-users" />
            <Stat label="Phone numbers" value={d.numbers} sub={`${d.runningCampaigns} campaigns running`} testid="admin-stat-numbers" />
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2"><Bars series={d.series} /></div>
            <div className="civr-card p-5 space-y-2 text-sm" data-testid="admin-attention">
              <div className="text-xs uppercase tracking-widest text-[#a1a1aa] mb-2">Needs attention</div>
              <div className="flex justify-between"><span>Texting — bill to collect</span><b data-testid="admin-attn-admin-docs">{d.hosted.admin_docs || 0}</b></div>
              <div className="flex justify-between"><span>Texting — waiting for customer</span><b>{(d.hosted.documents || 0) + (d.hosted.verify || 0)}</b></div>
              <div className="flex justify-between"><span>Texting — with the carrier</span><b>{d.hosted.review || 0}</b></div>
              <div className="flex justify-between"><span>Flagged AI agent scripts</span><b className={d.flaggedAgents ? 'text-[#f87171]' : ''} data-testid="admin-attn-flagged">{d.flaggedAgents}</b></div>
            </div>
          </div>
          <div className="civr-card p-5" data-testid="admin-revenue-types">
            <div className="text-xs uppercase tracking-widest text-[#a1a1aa] mb-3">Money in & out by type · 30 days</div>
            <div className="civr-scroll-x"><table className="civr-table w-full text-sm"><thead><tr><th className="text-left">Type</th><th className="text-right">Count</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{d.byType.map(t => <tr key={t.type}><td>{label(t.type)}</td><td className="text-right tabular-nums">{t.n}</td><td className="text-right tabular-nums">{fmt(t.usd)}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      )}
    </Load>
  );
}
