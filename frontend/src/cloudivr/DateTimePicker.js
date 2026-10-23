import React from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';

const pad = (n) => String(n).padStart(2, '0');
const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// value/onChange use the local 'YYYY-MM-DDTHH:mm' format ('' = not scheduled).
export function DateTimePicker({ value, onChange, testid, maxDays = 30 }) {
  const d = value ? new Date(value) : null;
  const time = d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '09:00';
  const at = (base, t) => { const [h, m] = t.split(':'); const x = new Date(base); x.setHours(+h || 0, +m || 0, 0, 0); return toLocal(x); };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const max = new Date(Date.now() + maxDays * 86400000);
  return (
    <div className="flex gap-2" data-testid={testid}>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="civr-input flex items-center gap-2 text-left" data-testid={`${testid}-trigger`}>
            <CalendarDays className="w-4 h-4 text-[#a1a1aa]" />
            {d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : <span className="text-[#a1a1aa]">Not scheduled</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-[#141414] border-[#2a2a2a] text-[#f3f4f6]" align="start" data-testid={`${testid}-calendar`}>
          <Calendar mode="single" selected={d || undefined} onSelect={(day) => day && onChange(at(day, time))} disabled={[{ before: today }, { after: max }]} initialFocus />
        </PopoverContent>
      </Popover>
      <input type="time" className="civr-input !w-32 font-mono" value={time} disabled={!d} onChange={e => onChange(at(d, e.target.value))} data-testid={`${testid}-time-input`} />
      {d && <button type="button" onClick={() => onChange('')} className="p-2 text-[#a1a1aa] hover:text-white" data-testid={`${testid}-clear`} aria-label="Clear schedule"><X className="w-4 h-4" /></button>}
    </div>
  );
}
