import React from 'react';
import { Link } from 'react-router-dom';
import { PhoneIncoming, MessageSquareText, CalendarCheck, PhoneForwarded, Wallet, Moon, Sun } from 'lucide-react';
import { money } from '../../api';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';
import { Inbox, Upcoming } from './Inbox';

const STATS = [['calls', 'Calls answered', PhoneIncoming], ['messages', 'Messages taken', MessageSquareText], ['booked', 'Appointments booked', CalendarCheck], ['transferred', 'Passed to you', PhoneForwarded]];

function Duty({ d }) {
  const pv = usePrivacy();
  const live = d.receptionists.filter(a => a.numbers.length);
  if (!live.length) return (
    <div className="civr-card p-6 flex flex-col sm:flex-row sm:items-center gap-4 border-l-4 !border-l-[#f59e0b]" data-testid="receptionist-duty-off">
      <div className="flex-1"><div className="font-semibold">Your receptionist isn’t answering any number yet</div><p className="text-sm text-[var(--c-muted)] mt-1">Set it up, test it in your browser, then pick which numbers it answers.</p></div>
      <Link to={cp(d.receptionists.length ? '/app/receptionist?tab=numbers' : '/app/receptionist/new')} className="civr-btn civr-btn-primary" data-testid="receptionist-duty-cta">{d.receptionists.length ? 'Choose numbers' : 'Set up receptionist'}</Link>
    </div>
  );
  return (
    <div className="grid sm:grid-cols-2 gap-4" data-testid="receptionist-duty">
      {live.map((a, i) => (
        <Link key={a.id} to={cp(`/app/receptionist/${a.id}`)} className="civr-card civr-card-link p-5 flex items-center gap-4" data-testid={`receptionist-duty-${i}`}>
          <span className={`w-10 h-10 rounded-full grid place-items-center ${a.onDutyNow ? 'bg-[#10b981]/15 text-[#059669]' : 'bg-[var(--c-border)] text-[var(--c-muted)]'}`}>{a.onDutyNow ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}</span>
          <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{a.name}{a.businessName ? ` · ${a.businessName}` : ''}</span><span className="block text-xs text-[var(--c-muted)] truncate">{`Answers ${a.numbers.map(n => pv.phone(n)).join(', ')}`}</span></span>
          <span className={`civr-pill ${a.onDutyNow ? 'civr-pill-ok' : ''}`} data-testid={`receptionist-duty-${i}-state`}>{a.onDutyNow ? 'On duty now' : 'Office hours: calls ring you'}</span>
        </Link>
      ))}
    </div>
  );
}

export function Overview({ d, reload }) {
  return (
    <div className="space-y-6" data-testid="receptionist-overview">
      <Duty d={d} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="receptionist-stats">
        {STATS.map(([k, label, Icon]) => <div key={k} className="civr-card p-4" data-testid={`receptionist-stat-${k}`}><Icon className="w-4 h-4 text-[var(--c-accent)]" /><div className="text-2xl font-bold tabular-nums mt-2">{d.stats[k] || 0}</div><div className="text-xs text-[var(--c-muted)]">{label}</div></div>)}
        <div className="civr-card p-4" data-testid="receptionist-stat-spend"><Wallet className="w-4 h-4 text-[var(--c-accent)]" /><div className="text-2xl font-bold tabular-nums mt-2">{money(d.stats.spend || 0)}</div><div className="text-xs text-[var(--c-muted)]">{`${Math.round((d.stats.seconds || 0) / 60)} min · last 30 days`}</div></div>
      </div>
      <div className="grid lg:grid-cols-5 gap-4 items-start">
        <section className="civr-card p-5 lg:col-span-3"><div className="font-semibold mb-1">Inbox</div><p className="text-xs text-[var(--c-muted)] mb-2">Messages and call-back requests from callers.</p><Inbox items={d.inbox} reload={reload} /></section>
        <section className="civr-card p-5 lg:col-span-2"><div className="font-semibold mb-3">Upcoming appointments</div><Upcoming items={d.upcoming} /></section>
      </div>
    </div>
  );
}
