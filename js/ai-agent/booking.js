'use strict'
// Appointment booking for AI agents: free slots from the owner's Google Calendar inside the agent's booking hours
// (days, start/end time, slot length, business time zone), and the two realtime tools check_availability / book_appointment.
const { DateTime, Interval } = require('luxon')
const gcal = require('./gcal')
const { zonesOf } = require('./hours')

const DAYS = [1, 2, 3, 4, 5, 6, 7] // ISO weekdays, 1 = Monday
const SLOT_MINUTES = [15, 20, 30, 45, 60, 90, 120]
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const LEAD_MINUTES = 30 // no bookings sooner than this
const MAX_DAYS_AHEAD = 60
const LOOK_AHEAD_DAYS = 14 // when a day is full, suggest the next open day within this window
const MAX_OFFER = 8
const LOCALE = { en: 'en-US', fr: 'fr-FR', es: 'es-ES' }

const validZone = (z) => typeof z === 'string' && z.length < 64 && DateTime.now().setZone(z).isValid
const DEFAULT = { enabled: false, calendarId: 'primary', calendarName: null, slotMinutes: 30, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', timeZone: 'America/New_York' }

function cleanBooking(b) {
  if (!b || typeof b !== 'object') return { ...DEFAULT }
  const start = HHMM.test(b.start) ? b.start : DEFAULT.start, end = HHMM.test(b.end) ? b.end : DEFAULT.end
  const days = [...new Set((Array.isArray(b.days) ? b.days : DEFAULT.days).map(Number).filter(d => DAYS.includes(d)))].sort()
  const enabled = !!b.enabled
  if (enabled && start >= end) throw new Error('Booking hours: the end time must be after the start time.')
  if (enabled && !days.length) throw new Error('Pick at least one day callers can book.')
  return {
    enabled, calendarId: String(b.calendarId || '').trim().slice(0, 200) || 'primary', calendarName: String(b.calendarName || '').trim().slice(0, 100) || null,
    slotMinutes: SLOT_MINUTES.includes(Number(b.slotMinutes)) ? Number(b.slotMinutes) : DEFAULT.slotMinutes, days, start, end,
    timeZone: validZone(b.timeZone) ? b.timeZone : DEFAULT.timeZone,
  }
}

const hm = (s) => s.split(':').map(Number)
function hoursOn(day, booking) {
  const [sh, sm] = hm(booking.start), [eh, em] = hm(booking.end)
  return [day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 }), day.set({ hour: eh, minute: em, second: 0, millisecond: 0 })]
}

// Free slot starts (DateTime in the booking zone) on `date` (YYYY-MM-DD, booking zone).
function freeSlots({ date, booking, busy = [], now = DateTime.now() }) {
  const day = DateTime.fromISO(date, { zone: booking.timeZone })
  if (!day.isValid || !booking.days.includes(day.weekday)) return []
  const [open, close] = hoursOn(day, booking)
  const len = booking.slotMinutes, earliest = now.plus({ minutes: LEAD_MINUTES })
  const blocks = busy.map(b => Interval.fromDateTimes(DateTime.fromISO(b.start), DateTime.fromISO(b.end))).filter(i => i.isValid)
  const out = []
  for (let t = open; t.plus({ minutes: len }) <= close; t = t.plus({ minutes: len })) {
    if (t < earliest) continue
    const slot = Interval.fromDateTimes(t, t.plus({ minutes: len }))
    if (!blocks.some(b => b.overlaps(slot))) out.push(t)
  }
  return out
}

// Everything the bridge needs for one call, or null when booking is off / the calendar isn't connected.
async function forCall(chatId, agent, callerNumber) {
  const booking = agent?.booking
  if (!booking?.enabled || !(await gcal.isConnected(chatId).catch(() => false))) return null
  return createContext({ chatId: String(chatId), agent, booking: cleanBooking(booking), callerNumber })
}

function createContext({ chatId, agent, booking, callerNumber, now = () => DateTime.now(), cal = gcal }) {
  const tz = booking.timeZone, locale = LOCALE[agent.language] || 'en-US'
  const callerZone = (zonesOf(callerNumber)[0]) || null
  const dayLabel = (t) => t.setLocale(locale).toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = (t) => t.setLocale(locale).toLocaleString(DateTime.TIME_SIMPLE)
  const slotOut = (t) => {
    const o = { start: t.toISO({ suppressMilliseconds: true }), time: timeLabel(t) }
    if (callerZone) { const c = t.setZone(callerZone); if (c.offset !== t.offset) o.callerTime = `${timeLabel(c)} ${c.toFormat('ZZZZ')}` }
    return o
  }
  const today = () => now().setZone(tz)

  async function check({ date } = {}) {
    const d = String(date || '').trim()
    if (!DATE.test(d) || !DateTime.fromISO(d, { zone: tz }).isValid) return { ok: false, error: 'Give the date as YYYY-MM-DD.', today: today().toISODate() }
    const day = DateTime.fromISO(d, { zone: tz })
    if (day < today().startOf('day')) return { ok: false, error: `That date has passed. Today is ${dayLabel(today())}.` }
    if (day > today().plus({ days: MAX_DAYS_AHEAD })) return { ok: false, error: `Bookings open up to ${MAX_DAYS_AHEAD} days ahead.` }
    const until = day.plus({ days: LOOK_AHEAD_DAYS + 1 })
    const busy = await cal.busy(chatId, booking.calendarId, day.startOf('day').toUTC().toISO(), until.toUTC().toISO())
    const slots = freeSlots({ date: d, booking, busy, now: now() })
    const res = { ok: true, date: d, day: dayLabel(day), timeZone: tz, minutes: booking.slotMinutes, slots: slots.slice(0, MAX_OFFER).map(slotOut), moreFreeTimes: Math.max(0, slots.length - MAX_OFFER) }
    if (!slots.length) {
      res.note = booking.days.includes(day.weekday) ? 'No free times that day.' : 'The business does not take appointments that day.'
      for (let i = 1; i <= LOOK_AHEAD_DAYS; i++) {
        const next = day.plus({ days: i }), s = freeSlots({ date: next.toISODate(), booking, busy, now: now() })
        if (s.length) { res.nextAvailable = { date: next.toISODate(), day: dayLabel(next), slots: s.slice(0, 4).map(slotOut) }; break }
      }
    }
    return res
  }

  // `already` = the booking made earlier on this call (one appointment per call).
  async function book({ start, name, phone, note } = {}, already = null) {
    if (already) return { ok: false, error: `An appointment is already booked on this call (${already.day} at ${already.time}). The business will follow up about any change.` }
    const who = String(name || '').trim().slice(0, 80)
    if (!who) return { ok: false, error: 'Ask for the caller\'s name first, then book.' }
    const t = DateTime.fromISO(String(start || ''), { zone: tz }) // no offset given = business time
    if (!t.isValid) return { ok: false, error: 'Use the exact start value of one of the free times from check_availability.' }
    const local = t.setZone(tz), date = local.toISODate()
    const day = local.startOf('day')
    const busy = await cal.busy(chatId, booking.calendarId, day.toUTC().toISO(), day.plus({ days: 1 }).toUTC().toISO())
    const free = freeSlots({ date, booking, busy, now: now() })
    if (!free.some(s => s.toMillis() === local.toMillis())) {
      return { ok: false, error: 'That time is not free. Offer one of these instead.', slots: free.slice(0, 4).map(slotOut) }
    }
    const end = local.plus({ minutes: booking.slotMinutes })
    const tel = String(phone || '').replace(/[^\d+]/g, '').slice(0, 20) || callerNumber || null
    const details = [`Booked by ${agent.name} (CloudIVR AI agent) during a phone call.`, `Name: ${who}`, tel ? `Phone: ${tel}` : null, note ? `Note: ${String(note).slice(0, 500)}` : null].filter(Boolean).join('\n')
    const ev = await cal.createEvent(chatId, booking.calendarId, {
      summary: `${agent.businessName ? `${agent.businessName}: ` : ''}${who}`,
      description: details,
      start: { dateTime: local.toISO({ suppressMilliseconds: true }), timeZone: tz },
      end: { dateTime: end.toISO({ suppressMilliseconds: true }), timeZone: tz },
      reminders: { useDefault: true },
      extendedProperties: { private: { cloudivr: '1', agentId: String(agent.id || '') } },
    })
    const s = slotOut(local)
    const saved = { start: s.start, end: end.toISO({ suppressMilliseconds: true }), timeZone: tz, day: dayLabel(local), time: s.time, callerTime: s.callerTime || null, name: who, phone: tel, note: note ? String(note).slice(0, 300) : null, eventId: ev.id, link: ev.link, calendarId: booking.calendarId }
    return { ok: true, booking: saved, reply: { ok: true, booked: true, day: saved.day, time: saved.time, callerTime: saved.callerTime || undefined, timeZone: tz, minutes: booking.slotMinutes, next: 'Repeat the day, date and time back to the caller to confirm.' } }
  }

  return {
    timeZone: tz, minutes: booking.slotMinutes, check, book,
    today: () => `${today().setLocale('en-US').toLocaleString({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${today().toISODate()})`,
    hours: () => `${booking.days.map(d => DateTime.fromObject({ weekday: d }).setLocale('en-US').toFormat('ccc')).join(', ')} ${booking.start}–${booking.end}`,
  }
}

module.exports = { cleanBooking, freeSlots, forCall, createContext, DEFAULT, SLOT_MINUTES, validZone, LEAD_MINUTES }
