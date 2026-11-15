import React, { useMemo } from 'react';
import { MessageSquareText, Voicemail } from 'lucide-react';
import { Field, Toggle } from '../../ui';
import { DayRow, DAYS, ALL_ZONES } from '../number/HoursTab';
import { browserZone } from './BookingFields';

export const defaultHours = () => ({
  enabled: false, timezone: browserZone(), afterHours: 'message',
  days: Object.fromEntries(DAYS.map(([id]) => [id, { on: !['sat', 'sun'].includes(id), start: '09:00', end: '17:00' }])),
});

const AFTER = [
  ['message', MessageSquareText, 'Take a message', 'The receptionist still answers, says you’re closed and takes the caller’s name, number and message. You get it by email and in Messages.'],
  ['voicemail', Voicemail, 'Send to voicemail', 'The receptionist doesn’t pick up. Callers hear your voicemail greeting and can leave a recording (plans with voicemail; others hear a short closed message).'],
];

function AfterHours({ value, onChange }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="When you’re closed" data-testid="rec-after-hours">
      {AFTER.map(([id, Icon, title, sub]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} data-testid={`rec-after-hours-${id}`}
          className={`text-left rounded-xl border p-4 transition-colors ${value === id ? 'border-[#818cf8] bg-[#818cf8]/10' : 'border-[var(--c-border,#262626)] hover:border-[#818cf8]/50'}`}>
          <span className="flex items-center gap-2 font-semibold text-sm"><Icon className="w-4 h-4 text-[#818cf8]" />{title}</span>
          <span className="block text-xs text-[#a1a1aa] mt-1.5">{sub}</span>
        </button>
      ))}
    </div>
  );
}

// Receptionist business hours + what happens when closed.
export function HoursFields({ f, set }) {
  const h = f.hours || defaultHours();
  const put = (k, v) => set('hours', { ...h, [k]: v });
  const zones = useMemo(() => [...new Set(['UTC', h.timezone, ...ALL_ZONES])], [h.timezone]);
  return (
    <div className="space-y-4 border-t border-[var(--c-border,#1f1f1f)] pt-6" data-testid="rec-hours">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">Business hours<span className="block text-xs text-[#a1a1aa] mt-0.5">Off: the receptionist answers the same way day and night.</span></span>
        <Toggle checked={!!h.enabled} onChange={v => put('enabled', v)} testid="rec-hours-toggle" label="Use business hours" />
      </div>
      {h.enabled && <>
        <Field label="Time zone">
          <select className="civr-input" value={h.timezone} onChange={e => put('timezone', e.target.value)} data-testid="rec-hours-timezone-select">{zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>
        </Field>
        <div>{DAYS.map(([id, label]) => <DayRow key={id} id={id} label={label} d={h.days[id]} onChange={d => put('days', { ...h.days, [id]: d })} />)}</div>
        <Field label="When you’re closed"><AfterHours value={h.afterHours || 'message'} onChange={v => put('afterHours', v)} /></Field>
      </>}
    </div>
  );
}
