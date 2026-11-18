import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, CircleStop, Wallet as WalletIcon } from 'lucide-react';
import { enc, money, useApi } from '../api';
import { PageHeader, ErrorNote, SkeletonPage, Empty } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';

const KIND = { plan: 'Plan', extra: 'Extra number', texting: 'Texting', esim: 'eSIM', fax: 'Fax' };
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const monthKey = (d) => dayKey(d).slice(0, 7);
const longDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const monthName = (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

// Wallet against the next 30 days: covered, or how much is missing and from which day.
function Cover({ cal }) {
  const short = cal.shortBy30 > 0 && cal.firstShort;
  return (
    <div className="grid sm:grid-cols-3 gap-4" data-testid="renewal-cover">
      <div className="civr-card p-5"><div className="civr-label">Wallet</div><div className="font-mono text-3xl mt-3" data-testid="renewal-wallet-balance">{money(cal.balance)}</div></div>
      <div className="civr-card p-5"><div className="civr-label">Due in the next 30 days</div><div className="font-mono text-3xl mt-3" data-testid="renewal-due-30">{money(cal.due30)}</div><div className="text-xs text-[var(--c-muted)] mt-1">{`${money(cal.due7)} of it in the next 7 days`}</div></div>
      <div className={`civr-card p-5 ${short ? 'border-[#fbbf24]/50' : ''}`} data-testid="renewal-cover-status">
        {short ? <>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#fbbf24]"><AlertTriangle className="w-4 h-4" />Wallet is short</div>
          <div className="text-sm mt-2">{`Add ${money(cal.shortBy30)} before ${longDay(cal.firstShort.date)} to cover every renewal this month.`}</div>
          <Link to={cp(`/app/wallet?need=${Math.ceil(cal.shortBy30)}`)} className="civr-btn civr-btn-primary civr-btn-sm mt-3" data-testid="renewal-topup-link"><WalletIcon className="w-4 h-4" />Add funds</Link>
        </> : <>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#34d399]"><CheckCircle2 className="w-4 h-4" />All covered</div>
          <div className="text-sm mt-2 text-[var(--c-muted)]">Your wallet covers every renewal in the next 30 days. We only remind you when it doesn’t.</div>
        </>}
      </div>
    </div>
  );
}

function MonthGrid({ month, byDay, picked, onPick }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7, days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = dayKey(new Date());
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  return (
    <div data-testid="renewal-month-grid">
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-[var(--c-muted)] mb-1">{WEEK.map(w => <div key={w} className="text-center py-1">{w}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const k = dayKey(d), list = byDay[k] || [], total = list.filter(e => e.type === 'charge').reduce((t, e) => t + e.amount, 0);
          const short = list.some(e => e.type === 'charge' && !e.covered), ends = list.some(e => e.type === 'ends');
          return (
            <button key={k} type="button" disabled={!list.length} onClick={() => onPick(k === picked ? null : k)} data-testid={`renewal-day-${k}`}
              className={`min-h-[3.75rem] rounded-lg border p-1.5 text-left transition-colors duration-150 ${k === picked ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10' : list.length ? 'border-[var(--c-border)] hover:border-[var(--c-accent)]/60' : 'border-transparent'} ${k === today ? 'ring-1 ring-[#38bdf8]/50' : ''}`}>
              <div className={`text-xs ${list.length ? '' : 'text-[var(--c-muted)]'}`}>{d.getDate()}</div>
              {total > 0 && <div className={`font-mono text-[11px] mt-1 truncate ${short ? 'text-[#fbbf24]' : 'text-[#34d399]'}`}>{money(total)}</div>}
              {!total && ends && <CircleStop className="w-3 h-3 mt-1.5 text-[var(--c-muted)]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Row({ e, i, pv }) {
  const to = e.kind === 'esim' || (e.kind === 'texting' && e.id) ? cp(`/app/esim/${e.id}`) : e.kind === 'fax' ? cp('/app/fax') : e.phone ? cp(`/app/numbers/${enc(e.phone)}?tab=billing`) : null;
  return (
    <div className="py-3 border-t border-[var(--c-border)] first:border-t-0" data-testid={`renewal-entry-${i}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm w-28 shrink-0" data-testid={`renewal-entry-${i}-date`}>{longDay(e.date)}</span>
        <span className="flex-1 min-w-[12rem]">
          <span className="text-sm block">{e.title}{e.projected && <span className="text-xs text-[var(--c-muted)]"> · estimate</span>}</span>
          {e.phone && (to ? <Link to={to} className="font-mono text-xs text-[var(--c-muted)] hover:text-[#818cf8]" data-testid={`renewal-entry-${i}-link`}>{pv.phone(e.phone)}</Link> : <span className="font-mono text-xs text-[var(--c-muted)]">{pv.phone(e.phone)}</span>)}
        </span>
        <span className="civr-pill text-[10px]">{KIND[e.kind] || e.kind}</span>
        {e.type === 'ends' ? <span className="text-xs text-[var(--c-muted)] w-28 text-right" data-testid={`renewal-entry-${i}-amount`}>Not renewed</span>
          : <span className={`font-mono text-sm w-28 text-right ${e.covered ? '' : 'text-[#fbbf24]'}`} data-testid={`renewal-entry-${i}-amount`}>{money(e.amount)}{!e.covered && <span className="block text-[10px] font-sans">wallet short</span>}</span>}
      </div>
      {e.parts?.length > 1 && <div className="mt-1 sm:ml-32 text-xs text-[var(--c-muted)]" data-testid={`renewal-entry-${i}-parts`}>{e.parts.map(p => `${p.label} ${money(p.amount)}`).join(' + ')}</div>}
    </div>
  );
}

export default function RenewalCalendar() {
  const { data, error, reload } = useApi('/renewals/calendar');
  const pv = usePrivacy();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [picked, setPicked] = useState(null);
  const byDay = useMemo(() => (data?.entries || []).reduce((m, e) => { const k = dayKey(e.date); (m[k] = m[k] || []).push(e); return m; }, {}), [data]);
  const header = <PageHeader label="Wallet" title="Renewal calendar" sub="Every upcoming charge by date — plans, extra numbers, Texting Numbers, eSIMs and fax numbers — and what your wallet covers." testid="renewal-calendar-header" />;
  if (error && !data) return <div data-testid="renewal-calendar-page">{header}<ErrorNote error={error} onRetry={reload} /></div>;
  if (!data) return <div data-testid="renewal-calendar-page">{header}<SkeletonPage header={false} /></div>;
  const mk = monthKey(month), inMonth = data.entries.filter(e => monthKey(e.date) === mk);
  const list = picked ? byDay[picked] || [] : inMonth;
  const total = inMonth.filter(e => e.type === 'charge').reduce((t, e) => t + e.amount, 0);
  const now = new Date(), minMonth = new Date(now.getFullYear(), now.getMonth(), 1), maxMonth = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  const step = (n) => { setPicked(null); setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1)); };
  return (
    <div data-testid="renewal-calendar-page">
      {header}
      {!data.entries.length ? <Empty icon={CalendarClock} title="Nothing renews yet" sub="Numbers and lines you pay for monthly show up here with their next charge." testid="renewal-calendar-empty" /> : <>
        <Cover cal={data} />
        <div className="grid lg:grid-cols-5 gap-4 mt-6">
          <div className="civr-card p-5 lg:col-span-2 lg:self-start">
            <div className="flex items-center justify-between mb-4">
              <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={month <= minMonth} onClick={() => step(-1)} data-testid="renewal-month-prev"><ChevronLeft className="w-4 h-4" /></button>
              <div className="text-center"><div className="font-semibold" data-testid="renewal-month-name">{monthName(month)}</div><div className="font-mono text-xs text-[var(--c-muted)]" data-testid="renewal-month-total">{`${money(total)} this month`}</div></div>
              <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={month >= maxMonth} onClick={() => step(1)} data-testid="renewal-month-next"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <MonthGrid month={month} byDay={byDay} picked={picked} onPick={setPicked} />
            <div className="flex flex-wrap gap-4 mt-4 text-[11px] text-[var(--c-muted)]"><span><span className="text-[#34d399]">●</span> wallet covers it</span><span><span className="text-[#fbbf24]">●</span> wallet short</span><span className="flex items-center gap-1"><CircleStop className="w-3 h-3" />ends, not renewed</span></div>
          </div>
          <div className="civr-card p-5 lg:col-span-3" data-testid="renewal-list">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">{picked ? longDay(picked) : monthName(month)}</div>
              {picked && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setPicked(null)} data-testid="renewal-show-month">Show whole month</button>}
            </div>
            {list.length ? list.map((e, i) => <Row key={`${e.date}-${e.phone}-${e.title}-${i}`} e={e} i={i} pv={pv} />) : <p className="text-sm text-[var(--c-muted)] py-6" data-testid="renewal-list-empty">Nothing is due this month.</p>}
            <p className="text-xs text-[var(--c-muted)] mt-4">Charges come from your wallet on the date shown. Later months are estimates from today’s prices. Turn auto-renew on or off under <Link to={cp('/app/wallet#renewals')} className="underline" data-testid="renewal-manage-link">Wallet → Renewals</Link>.</p>
          </div>
        </div>
      </>}
    </div>
  );
}
