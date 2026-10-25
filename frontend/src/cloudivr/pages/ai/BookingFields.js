import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CalendarCheck, CalendarDays, Loader2, Search, Unlink } from 'lucide-react';
import { api, useApi } from '../../api';
import { ask } from '../../i18n';
import { Field, Toggle } from '../../ui';

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const LENGTHS = [15, 20, 30, 45, 60, 90, 120];
const COMMON_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin',
  'Europe/Lisbon', 'Africa/Lagos', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
const CONNECT_ERRORS = {
  denied: 'Google Calendar was not connected — access was not allowed.',
  scope: 'Tick the calendar permission on the Google screen so the agent can book appointments.',
  expired: 'The connection took too long. Please try again.',
  no_refresh: 'Google did not give lasting access. Please try again.',
  failed: 'Google Calendar could not be connected. Please try again.',
};

export const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch (_) { return 'America/New_York'; } };
const allZones = (current) => {
  let list = COMMON_ZONES;
  try { list = Intl.supportedValuesOf('timeZone'); } catch (_) { /* older browser */ }
  return current && !list.includes(current) ? [current, ...list] : list;
};
const tomorrow = () => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Back from Google: ?calendar=connected | <error> → one toast, then the param is removed.
function useReturnNotice(reload) {
  const [params, setParams] = useSearchParams();
  const result = params.get('calendar');
  useEffect(() => {
    if (!result) return;
    if (result === 'connected') toast.success('Google Calendar connected'); else toast.error(CONNECT_ERRORS[result] || CONNECT_ERRORS.failed);
    const next = new URLSearchParams(params); next.delete('calendar');
    setParams(next, { replace: true });
    reload();
  }, [result]);
}

function Connection({ cal, reload }) {
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      const d = await api('/calendar/google/connect', { method: 'POST', body: { returnTo: window.location.pathname } });
      window.location.assign(d.url);
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  const disconnect = async () => {
    if (!(await ask('Disconnect Google Calendar? Your agents stop booking appointments until you connect it again.', { danger: true, ok: 'Disconnect' }))) return;
    try { await api('/calendar', { method: 'DELETE' }); toast.success('Google Calendar disconnected'); reload(); } catch (e) { toast.error(e.message); }
  };
  if (!cal) return null;
  if (!cal.configured) {
    return <div className="text-sm text-[#a1a1aa] rounded-xl border border-[#262626] px-4 py-3" data-testid="ai-agent-calendar-unavailable">Google Calendar booking is not switched on yet. It will appear here as soon as it is available.</div>;
  }
  if (cal.connected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#34d399]/30 bg-[#34d399]/5 px-4 py-3" data-testid="ai-agent-calendar-connected">
        <CalendarCheck className="w-4 h-4 text-[#34d399] shrink-0" />
        <span className="text-sm flex-1 min-w-0 truncate">Connected to Google Calendar · <span className="font-mono" data-no-translate data-testid="ai-agent-calendar-email">{cal.email}</span></span>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={disconnect} data-testid="ai-agent-calendar-disconnect-button"><Unlink className="w-4 h-4" />Disconnect</button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#262626] px-4 py-4 space-y-3" data-testid="ai-agent-calendar-connect">
      {cal.status === 'revoked' && <div className="flex items-center gap-2 text-sm text-[#fbbf24]" data-testid="ai-agent-calendar-revoked"><AlertTriangle className="w-4 h-4 shrink-0" />Google access was removed. Connect the calendar again.</div>}
      <p className="text-sm text-[#a1a1aa]">Connect your own Google Calendar. The agent only looks at when you are busy and adds the appointments it books. Save your changes first — Google brings you back here.</p>
      <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" onClick={connect} disabled={busy} data-testid="ai-agent-calendar-connect-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}Connect Google Calendar</button>
    </div>
  );
}

// "What would the agent offer on this day?" — uses the SAVED agent settings and the real calendar.
function SlotPreview({ agentId }) {
  const [date, setDate] = useState(tomorrow);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setRes(null);
    try { setRes(await api(`/ai-agents/${agentId}/slots?date=${date}`)); } catch (e) { setRes({ ok: false, error: e.message }); } finally { setBusy(false); }
  };
  const next = res?.nextAvailable;
  return (
    <div className="rounded-xl border border-[#262626] px-4 py-4 space-y-3 sm:col-span-2" data-testid="ai-agent-booking-preview">
      <div className="text-sm font-medium">Check the free times the agent would offer</div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="civr-input !w-auto" value={date} onChange={e => setDate(e.target.value)} data-testid="ai-agent-booking-preview-date" />
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={run} disabled={busy || !date} data-testid="ai-agent-booking-preview-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Check free times</button>
      </div>
      {res && !res.ok && <div className="text-sm text-[#fb7185]" data-testid="ai-agent-booking-preview-error">{res.error}</div>}
      {res?.ok && (
        <div className="space-y-2" data-testid="ai-agent-booking-preview-result">
          {res.slots.length ? (
            <div className="flex flex-wrap gap-2" data-testid="ai-agent-booking-preview-slots">{res.slots.map(s => <span key={s.start} className="civr-pill civr-pill-on" data-no-translate>{s.time}</span>)}{res.moreFreeTimes > 0 && <span className="civr-pill">{`+${res.moreFreeTimes} more`}</span>}</div>
          ) : <div className="text-sm text-[#a1a1aa]" data-testid="ai-agent-booking-preview-none">{res.note || 'No free times that day.'}{next ? ` Next free day: ${next.day}.` : ''}</div>}
          <div className="text-xs text-[#a1a1aa]">{`Times in ${res.timeZone} · ${res.minutes}-minute appointments · uses the saved settings`}</div>
        </div>
      )}
    </div>
  );
}

// Agent setting: book appointments into the owner's own Google Calendar during calls.
export function BookingFields({ f, set }) {
  const b = f.booking;
  const { data: cal, reload } = useApi('/calendar');
  const connected = !!cal?.connected;
  const { data: list } = useApi(connected ? '/calendar/calendars' : null);
  useReturnNotice(reload);
  const setB = (patch) => set('booking', { ...b, ...patch });
  const toggleDay = (d) => setB({ days: b.days.includes(d) ? b.days.filter(x => x !== d) : [...b.days, d].sort((x, y) => x - y) });
  const calendars = list?.calendars?.length ? list.calendars : [{ id: 'primary', name: 'Main calendar', primary: true }];
  return (
    <div className="space-y-4 border-t border-[#1f1f1f] pt-6" data-testid="ai-agent-booking">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-semibold">Book appointments</div>
          <div className="text-xs text-[#a1a1aa] mt-0.5">During the call the agent checks your free times, books the caller in and repeats the date and time back.</div>
        </div>
        <Toggle checked={!!b.enabled && connected} disabled={!connected} onChange={v => setB({ enabled: v })} testid="ai-agent-booking-toggle" />
      </div>
      <Connection cal={cal} reload={reload} />
      {connected && b.enabled && (
        <div className="grid sm:grid-cols-2 gap-4 civr-rise" data-testid="ai-agent-booking-settings">
          <Field label="Calendar">
            <select className="civr-input" value={b.calendarId} onChange={e => { const c = calendars.find(x => (x.primary ? 'primary' : x.id) === e.target.value); setB({ calendarId: e.target.value, calendarName: c?.name || null }); }} data-testid="ai-agent-booking-calendar-select">
              {calendars.map(c => <option key={c.id} value={c.primary ? 'primary' : c.id}>{c.primary ? `${c.name} (main)` : c.name}</option>)}
            </select>
          </Field>
          <Field label="Appointment length">
            <select className="civr-input" value={b.slotMinutes} onChange={e => setB({ slotMinutes: Number(e.target.value) })} data-testid="ai-agent-booking-length-select">
              {LENGTHS.map(m => <option key={m} value={m}>{`${m} minutes`}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <span className="block text-[13px] font-medium text-[#d4d4d8] mb-1.5">Days callers can book</span>
            <div className="flex flex-wrap gap-2" role="group">
              {DAYS.map(([d, label]) => <button key={d} type="button" aria-pressed={b.days.includes(d)} onClick={() => toggleDay(d)} data-testid={`ai-agent-booking-day-${d}`} className={`min-w-[52px] h-11 px-3 rounded-xl border text-sm font-medium transition-colors ${b.days.includes(d) ? 'border-[#34d399] bg-[#34d399]/10 text-[#34d399]' : 'border-[#2a2a2a] text-[#a1a1aa] hover:border-[#3a3a3a]'}`}>{label}</button>)}
            </div>
          </div>
          <Field label="From"><input type="time" step={900} className="civr-input" value={b.start} onChange={e => setB({ start: e.target.value })} data-testid="ai-agent-booking-start-input" /></Field>
          <Field label="Until"><input type="time" step={900} className="civr-input" value={b.end} onChange={e => setB({ end: e.target.value })} data-testid="ai-agent-booking-end-input" /></Field>
          <Field label="Business time zone" hint="Booking hours are in this time zone. Callers in other zones also hear their own local time.">
            <select className="civr-input" value={b.timeZone} onChange={e => setB({ timeZone: e.target.value })} data-testid="ai-agent-booking-tz-select" data-no-translate>
              {allZones(b.timeZone).map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          {f.id ? <SlotPreview agentId={f.id} /> : <div className="text-xs text-[#a1a1aa] sm:col-span-2 self-end">Save the agent to check which free times it would offer.</div>}
        </div>
      )}
    </div>
  );
}
