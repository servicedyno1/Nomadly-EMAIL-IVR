import React from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';

const pad = (n) => String(n).padStart(2, '0');
const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// value/onChange use the local 'YYYY-MM-DDTHH:mm' format ('' = not scheduled). Picking today starts 10 minutes from now.
const soon = () => { const x = new Date(Date.now() + 10 * 60000); x.setMinutes(Math.ceil(x.getMinutes() / 5) * 5, 0, 0); return x; };
function problem(d, minMinutes, maxDays) {
  if (!d) return '';
  if (d.getTime() < Date.now()) return 'That time has passed. Pick a later time.';
  if (d.getTime() < Date.now() + minMinutes * 60000) return `That time is too soon. Pick at least ${minMinutes} minutes from now.`;
  if (d.getTime() > Date.now() + maxDays * 86400000) return maxDays === 1 ? 'Pick a time within the next 24 hours.' : `Pick a time within the next ${maxDays} days.`;
  return '';
}

export function DateTimePicker({ value, onChange, testid, maxDays = 30, minMinutes = 5 }) {
  const d = value ? new Date(value) : null;
  const time = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '09:00';
  const at = (base, t) => { const [h, m] = t.split(':'); const x = new Date(base); x.setHours(+h || 0, +m || 0, 0, 0); return x; };
  const pickDay = (day) => { const x = at(day, time); onChange(toLocal(x.getTime() < Date.now() + minMinutes * 60000 && x.toDateString() === new Date().toDateString() ? soon() : x)); };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const max = new Date(Date.now() + maxDays * 86400000);
  const warn = problem(d, minMinutes, maxDays);
  return (
    <div className="space-y-1.5">
    <div className="flex gap-2" data-testid={testid}>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="civr-input flex items-center gap-2 text-left" data-testid={`${testid}-trigger`}>
            <CalendarDays className="w-4 h-4 text-[#a1a1aa]" />
            {d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : <span className="text-[#a1a1aa]">Not scheduled</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-[#141414] border-[#2a2a2a] text-[#f3f4f6]" align="start" data-testid={`${testid}-calendar`}>
          <Calendar mode="single" selected={d || undefined} onSelect={(day) => day && pickDay(day)} disabled={[{ before: today }, { after: max }]} initialFocus />
        </PopoverContent>
      </Popover>
      <input type="time" className="civr-input !w-32 font-mono" value={d ? time : ''} aria-label="Time" disabled={!d} onChange={e => onChange(toLocal(at(d, e.target.value)))} data-testid={`${testid}-time-input`} />
      {d && <button type="button" onClick={() => onChange('')} className="p-2 text-[#a1a1aa] hover:text-white" data-testid={`${testid}-clear`} aria-label="Clear schedule"><X className="w-4 h-4" /></button>}
    </div>
    {warn && <p role="alert" className="text-xs text-[#fb7185]" data-testid={`${testid}-warning`}>{warn}</p>}
    </div>
  );
}
