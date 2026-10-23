'use strict'
// On/off hours for a number: a weekly schedule in the owner's time zone. Outside the hours the number is "off" —
// it doesn't ring or forward; callers get voicemail (plans with voicemail) or a short closed message.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const OFF_ACTIONS = ['voicemail', 'message']

const validZone = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch (_) { return false } }

function defaultHours(timezone = 'UTC') {
  const days = {}
  for (const d of DAYS) days[d] = { on: !['sat', 'sun'].includes(d), start: '09:00', end: '17:00' }
  return { enabled: false, timezone, days, offAction: 'voicemail', offMessage: '' }
}

// Normalizes a client payload; throws Error(message) on bad input.
function validateHours(body = {}) {
  const tz = String(body.timezone || 'UTC')
  if (!validZone(tz)) throw new Error('Pick a valid time zone.')
  const days = {}
  for (const d of DAYS) {
    const x = (body.days || {})[d] || {}
    const on = !!x.on
    const start = String(x.start || '09:00'), end = String(x.end || '17:00')
    if (on && (!HHMM.test(start) || !HHMM.test(end))) throw new Error('Use 24-hour times like 09:00 and 17:30.')
    if (on && start === end) throw new Error('Start and end time must differ (use 00:00–23:59 for all day).')
    days[d] = { on, start: HHMM.test(start) ? start : '09:00', end: HHMM.test(end) ? end : '17:00' }
  }
  const enabled = !!body.enabled
  if (enabled && !DAYS.some(d => days[d].on)) throw new Error('Turn on at least one day, or switch the schedule off.')
  const offAction = OFF_ACTIONS.includes(body.offAction) ? body.offAction : 'voicemail'
  return { enabled, timezone: tz, days, offAction, offMessage: String(body.offMessage || '').trim().slice(0, 500) }
}

// Weekday index (0=Sun) + minutes since midnight at `date` in `tz`.
function localNow(tz, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return { wd, mins: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10) }
}
const toMins = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }

// True when the number should ring (always true while the schedule is off). Overnight ranges (22:00–06:00) work.
function isOpen(hours, date = new Date()) {
  if (!hours || !hours.enabled) return true
  const tz = validZone(hours.timezone) ? hours.timezone : 'UTC'
  const { wd, mins } = localNow(tz, date)
  const today = hours.days?.[DAYS[wd]], prev = hours.days?.[DAYS[(wd + 6) % 7]]
  if (today?.on) {
    const s = toMins(today.start), e = toMins(today.end)
    if (s < e ? mins >= s && mins < e : mins >= s) return true
  }
  if (prev?.on) {
    const s = toMins(prev.start), e = toMins(prev.end)
    if (s > e && mins < e) return true // yesterday's overnight window spills into today
  }
  return false
}

module.exports = { DAYS, defaultHours, validateHours, isOpen, localNow, validZone }
