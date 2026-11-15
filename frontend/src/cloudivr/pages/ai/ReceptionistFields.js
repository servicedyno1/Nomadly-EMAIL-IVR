import React from 'react';
import { Clock } from 'lucide-react';
import { Field } from '../../ui';
import { browserZone } from './BookingFields';

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
export const EMPTY_OFFICE = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', timeZone: browserZone() };
const WHEN = [['always', 'Every call, 24/7', 'The receptionist picks up every call to its numbers.'], ['outside_hours', 'Only outside office hours', 'During your hours calls ring you as usual; evenings, weekends and holidays go to the receptionist.']];

// When the receptionist picks up: always, or only outside the business's office hours.
export function ReceptionistFields({ f, set }) {
  const o = { ...EMPTY_OFFICE, ...(f.officeHours || {}) };
  const setO = (patch) => set('officeHours', { ...o, ...patch });
  const toggleDay = (d) => setO({ days: o.days.includes(d) ? o.days.filter(x => x !== d) : [...o.days, d].sort((x, y) => x - y) });
  return (
    <div className="rounded-xl border border-[var(--c-border)] p-5 space-y-4" data-testid="receptionist-fields">
      <div className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-[var(--c-accent)]" />When it answers</div>
      <div className="grid sm:grid-cols-2 gap-3">
        {WHEN.map(([id, label, sub]) => (
          <button type="button" key={id} onClick={() => set('answerWhen', id)} aria-pressed={(f.answerWhen || 'always') === id} data-testid={`receptionist-when-${id}`}
            className={`text-left rounded-xl border p-4 transition-colors ${(f.answerWhen || 'always') === id ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10' : 'border-[var(--c-border)] hover:border-[var(--c-accent)]/50'}`}>
            <span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-[var(--c-muted)] mt-1">{sub}</span>
          </button>
        ))}
      </div>
      {f.answerWhen === 'outside_hours' && (
        <div className="space-y-3" data-testid="receptionist-office-hours">
          <div className="flex flex-wrap gap-2">{DAYS.map(([d, n]) => <button type="button" key={d} onClick={() => toggleDay(d)} aria-pressed={o.days.includes(d)} data-testid={`receptionist-day-${d}`} className={`civr-btn civr-btn-sm ${o.days.includes(d) ? 'civr-btn-primary' : 'civr-btn-ghost'}`}>{n}</button>)}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Opens"><input type="time" className="civr-input" value={o.start} onChange={e => setO({ start: e.target.value })} data-testid="receptionist-office-start" /></Field>
            <Field label="Closes"><input type="time" className="civr-input" value={o.end} onChange={e => setO({ end: e.target.value })} data-testid="receptionist-office-end" /></Field>
            <Field label="Time zone"><input className="civr-input" value={o.timeZone} onChange={e => setO({ timeZone: e.target.value })} data-testid="receptionist-office-zone" /></Field>
          </div>
        </div>
      )}
    </div>
  );
}
