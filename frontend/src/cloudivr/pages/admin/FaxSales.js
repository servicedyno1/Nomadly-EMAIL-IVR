import React from 'react';
import { Flag } from '../../Pickers';
import { Load, Stat, fmt, dt } from './common';

const chips = (xs, kind, date) => xs.length ? xs.map(x => <span key={x.id} className="civr-pill mr-1.5 mb-1 inline-block" data-testid={`admin-fax-daily-${date}-${kind}-${x.id}`}>{`${x.name} ${x.n}`}</span>) : <span className="text-[#71717a]">—</span>;

// One row per day since the launch (UTC), newest first. The same summary is emailed to the admin each morning.
function DailySummary({ days }) {
  return (
    <div className="civr-card overflow-x-auto" data-testid="admin-fax-daily">
      <div className="p-4 border-b border-[#1f1f1f]">
        <div className="font-semibold">Daily summary</div>
        <div className="text-xs text-[#a1a1aa] mt-1" data-testid="admin-fax-daily-email-note">Days are in UTC. Each morning after 08:00 UTC the previous day’s summary is emailed to the admin inbox.</div>
      </div>
      <table className="w-full text-sm" data-testid="admin-fax-daily-table">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-[#a1a1aa] border-b border-[#1f1f1f]"><th className="p-4">Day</th><th className="p-4 text-right">Sold</th><th className="p-4">By country</th><th className="p-4">By brand</th></tr></thead>
        <tbody>
          {days.map(day => (
            <tr key={day.date} className="border-b last:border-0 border-[#1f1f1f] align-top" data-testid={`admin-fax-daily-row-${day.date}`}>
              <td className="p-4 whitespace-nowrap tabular-nums">{day.date}</td>
              <td className="p-4 text-right font-semibold tabular-nums" data-testid={`admin-fax-daily-total-${day.date}`}>{day.total}</td>
              <td className="p-4">{chips(day.countries, 'country', day.date)}</td>
              <td className="p-4">{chips(day.brands, 'brand', day.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Fax numbers sold per country since the launch announcement, across every brand.
export default function FaxSales() {
  return (
    <Load path="/admin/fax-sales" testid="admin-fax-sales">
      {(d) => (
        <div className="space-y-6" data-testid="admin-fax-sales">
          <p className="text-sm text-[#a1a1aa]" data-testid="admin-fax-sales-since">{d.announced ? `Counting from the launch announcement on ${dt(d.since)}.` : `No announcement record found here, so this counts the last 30 days (from ${dt(d.since)}).`} Test purchases are left out.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Sold since launch" value={d.totals.soldSince} sub={`${d.totals.buyers} customer${d.totals.buyers === 1 ? '' : 's'} · ${d.totals.sold} sold all time`} testid="admin-fax-sales-since-count" />
            <Stat label="Live now" value={d.totals.active} sub={`${d.totals.pending} waiting for carrier approval`} testid="admin-fax-sales-active" />
            <Stat label="Monthly fees" value={fmt(d.totals.monthly)} sub="From live fax numbers, before page charges" testid="admin-fax-sales-monthly" />
            <Stat label="Released" value={d.totals.released} sub="Cancelled, unpaid or rejected by the carrier" testid="admin-fax-sales-released" />
          </div>
          {d.brands?.length > 1 && (
            <div className="flex flex-wrap gap-2" data-testid="admin-fax-sales-brands">
              {d.brands.map(b => <span key={b.name} className="civr-pill" data-testid={`admin-fax-sales-brand-${b.name}`}>{b.error ? `${b.name}: couldn’t load` : `${b.name}: ${b.soldSince} since launch · ${b.active} live`}</span>)}
            </div>
          )}
          <DailySummary days={d.days || []} />
          {!d.countries.length ? <div className="civr-card p-6 text-sm text-[#a1a1aa]" data-testid="admin-fax-sales-empty">No fax numbers sold yet. This table fills in as customers buy them.</div> : (
            <div className="civr-card overflow-x-auto">
              <table className="w-full text-sm" data-testid="admin-fax-sales-table">
                <thead><tr className="text-left text-xs uppercase tracking-wider text-[#a1a1aa] border-b border-[#1f1f1f]"><th className="p-4">Country</th><th className="p-4 text-right">Since launch</th><th className="p-4 text-right">All time</th><th className="p-4 text-right">Live</th><th className="p-4 text-right">Waiting</th><th className="p-4 text-right">Released</th><th className="p-4 text-right">Monthly fees</th></tr></thead>
                <tbody>
                  {d.countries.map(c => (
                    <tr key={c.country} className="border-b last:border-0 border-[#1f1f1f]" data-testid={`admin-fax-sales-row-${c.country}`}>
                      <td className="p-4"><span className="inline-flex items-center gap-2"><Flag code={c.country} />{c.name}</span></td>
                      <td className="p-4 text-right font-semibold tabular-nums">{c.soldSince}</td>
                      <td className="p-4 text-right tabular-nums">{c.sold}</td>
                      <td className="p-4 text-right tabular-nums">{c.active}</td>
                      <td className="p-4 text-right tabular-nums">{c.pending}</td>
                      <td className="p-4 text-right tabular-nums">{c.released}</td>
                      <td className="p-4 text-right tabular-nums">{fmt(c.monthly)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Load>
  );
}
