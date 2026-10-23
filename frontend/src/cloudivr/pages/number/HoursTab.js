import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, enc } from '../../api';
import { Field, Toggle } from '../../ui';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } };
const ALL_ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (_) { return []; } })();

// A schedule that was never switched on starts in the browser's time zone.
const initial = (h) => ({ ...h, timezone: !h.enabled && h.timezone === 'UTC' ? browserZone() : h.timezone, days: { ...h.days }, offMessage: h.offMessage || '' });

function DayRow({ id, label, d, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 border-b border-[#1a1a1a] last:border-0" data-testid={`hours-day-${id}`}>
      <span className="w-10 text-sm font-medium">{label}</span>
      <Toggle checked={d.on} onChange={v => onChange({ ...d, on: v })} testid={`hours-day-${id}-toggle`} />
      {d.on ? (
        <div className="flex items-center gap-2">
          <input type="time" className="civr-input !w-[7.5rem] font-mono" value={d.start} onChange={e => onChange({ ...d, start: e.target.value })} aria-label={`${label} opens at`} data-testid={`hours-day-${id}-start-input`} />
          <span className="text-[#8a8a8a]">–</span>
          <input type="time" className="civr-input !w-[7.5rem] font-mono" value={d.end} onChange={e => onChange({ ...d, end: e.target.value })} aria-label={`${label} closes at`} data-testid={`hours-day-${id}-end-input`} />
        </div>
      ) : <span className="text-sm text-[#8a8a8a]" data-testid={`hours-day-${id}-closed`}>Closed all day</span>}
    </div>
  );
}

export default function HoursTab({ num, reload }) {
  const saved = num.features.hours;
  const [f, setF] = useState(() => initial(saved));
  const [openNow, setOpenNow] = useState(null);
  const [busy, setBusy] = useState(false);
  const path = `/numbers/${enc(num.phoneNumber)}/hours`;
  useEffect(() => { api(path).then(d => setOpenNow(d.openNow)).catch(() => {}); }, [path]);
  const zones = useMemo(() => [...new Set(['UTC', f.timezone, ...ALL_ZONES])], [f.timezone]);
  const hasVm = !!num.access?.voicemail;
  const offAction = hasVm ? f.offAction : 'message';
  const setDay = (id, d) => setF(x => ({ ...x, days: { ...x.days, [id]: d } }));
  const copyMonday = () => setF(x => ({ ...x, days: Object.fromEntries(Object.entries(x.days).map(([k, d]) => [k, d.on ? { ...d, start: x.days.mon.start, end: x.days.mon.end } : d])) }));
  const save = async () => {
    setBusy(true);
    try { const d = await api(path, { method: 'PUT', body: { ...f, offAction } }); setOpenNow(d.openNow); toast.success('Hours saved'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const status = !saved.enabled ? ['Schedule off — always rings', 'civr-pill'] : openNow ? ['Open now', 'civr-pill civr-pill-on'] : ['Closed now', 'civr-pill civr-pill-warn'];

  return (
    <div className="civr-card p-6 max-w-2xl" data-testid="hours-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-display text-2xl font-bold">On/off hours</div>
        {openNow !== null && <span className={status[1]} data-testid="hours-status-pill">{status[0]}</span>}
      </div>
      <p className="text-sm text-[#888] mt-1 mb-6">Outside these hours your number doesn’t ring or forward. Callers go to voicemail or hear a short closed message.</p>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4"><span className="text-sm">Use a weekly schedule</span><Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} testid="hours-enabled-toggle" /></div>
        <Field label="Time zone">
          <select className="civr-input" value={f.timezone} onChange={e => setF({ ...f, timezone: e.target.value })} data-testid="hours-timezone-select">
            {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs font-medium text-[#aaa]">Opening hours</span>
            <button type="button" className="text-xs text-[#34d399] hover:underline py-2" disabled={!f.days.mon?.on} onClick={copyMonday} data-testid="hours-copy-monday-button">Copy Monday to all open days</button>
          </div>
          {DAYS.map(([id, label]) => <DayRow key={id} id={id} label={label} d={f.days[id]} onChange={d => setDay(id, d)} />)}
        </div>
        <Field label="Outside these hours">
          <select className="civr-input" value={offAction} onChange={e => setF({ ...f, offAction: e.target.value })} data-testid="hours-off-action-select">
            <option value="voicemail" disabled={!hasVm}>Send callers to voicemail{hasVm ? '' : ' (Pro plan and up)'}</option>
            <option value="message">Play a closed message, then hang up</option>
          </select>
        </Field>
        <Field label="Closed message (optional)" hint={`${f.offMessage.length}/500 · Leave empty for the standard message in your voicemail language (Voicemail tab).`}>
          <textarea rows={3} maxLength={500} className="civr-input" value={f.offMessage} onChange={e => setF({ ...f, offMessage: e.target.value })} placeholder="Thanks for calling. We’re closed right now — please call back between 9am and 5pm." data-testid="hours-off-message-input" />
        </Field>
        <button className="civr-btn civr-btn-primary" disabled={busy} onClick={save} data-testid="hours-save-button">Save hours</button>
      </div>
    </div>
  );
}
