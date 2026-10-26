'use strict'
// Bulk campaigns: repeat runs (daily / weekly) and the per-day call limit, in the owner's time zone.
const { DateTime } = require('luxon')

const REPEATS = ['daily', 'weekly']
const zoneOf = (tz) => (tz && DateTime.local().setZone(tz).isValid ? tz : 'UTC')
const dayKey = (tz, now = new Date()) => DateTime.fromJSDate(now).setZone(zoneOf(tz)).toISODate()
const msToNextDay = (tz, now = new Date()) => {
  const t = DateTime.fromJSDate(now).setZone(zoneOf(tz))
  return t.startOf('day').plus({ days: 1 }).toMillis() - t.toMillis()
}

// Next start of a repeating campaign: same local time one day / week on, at least a minute from now.
function nextRunAt(c, now = new Date()) {
  const step = c.repeat === 'weekly' ? { weeks: 1 } : { days: 1 }
  let t = DateTime.fromJSDate(new Date(c.scheduledFor || c.startedAt || now)).setZone(zoneOf(c.tz))
  do { t = t.plus(step) } while (t.toMillis() <= now.getTime() + 60000)
  return t.toJSDate()
}

const COPY = ['chatId', 'callerId', 'audioUrl', 'audioName', 'name', 'mode', 'agentId', 'agentName', 'transferNumber', 'transferBackups', 'menu', 'activeKeys',
  'concurrency', 'holdMusic', 'provider', 'voicemailAudioUrl', 'voicemailAudioName', 'twilioSubAccountSid', 'twilioSubAccountToken', 'aiRecord', 'dryRun',
  'repeat', 'dailyLimit', 'tz']
const freshLead = (l, i) => ({ index: i, number: l.number, name: l.name, status: 'pending', digitPressed: null, transferred: false, transferConnected: false, duration: 0, callSid: null, startedAt: null, answeredAt: null, completedAt: null, hangupCause: null })
const ZERO = { completed: 0, answered: 0, keyPressed: 0, transferred: 0, noAnswer: 0, busy: 0, failed: 0, hungUp: 0, voicemail: 0, voicemailLeft: 0 }

// The same campaign (same numbers, message and settings), scheduled for its next run.
function nextRunDoc(c, id, at) {
  const doc = Object.fromEntries(COPY.filter(k => c[k] !== undefined).map(k => [k, c[k]]))
  const leads = (c.leads || []).map(freshLead)
  return {
    ...doc, id, leads, status: 'scheduled', stats: { total: leads.length, ...ZERO }, scheduledFor: at, startedAt: null, completedAt: null,
    createdAt: new Date(), seriesId: c.seriesId || c.id, runNumber: (c.runNumber || 1) + 1, autoRun: true,
  }
}

// Takes one of today's calls (false = today's limit is used up). Safe when several batches dial at once.
async function reserveDailySlot(coll, c, now = new Date()) {
  const day = dayKey(c.tz, now)
  const inc = () => coll.updateOne({ id: c.id, 'dailyCount.day': day, 'dailyCount.n': { $lt: c.dailyLimit } }, { $inc: { 'dailyCount.n': 1 } })
  if ((await inc()).modifiedCount === 1) return true
  if ((await coll.updateOne({ id: c.id, 'dailyCount.day': { $ne: day } }, { $set: { dailyCount: { day, n: 1 } } })).modifiedCount === 1) return true
  return (await inc()).modifiedCount === 1
}

// Gives the call back when the lead went back to the queue without being dialed.
const refundDailySlot = (coll, campaignId) => coll.updateOne({ id: campaignId, dailyLimit: { $gt: 0 }, 'dailyCount.n': { $gt: 0 } }, { $inc: { 'dailyCount.n': -1 } })

const callsToday = (c, now = new Date()) => (c.dailyCount?.day === dayKey(c.tz, now) ? c.dailyCount.n : 0)

module.exports = { REPEATS, zoneOf, dayKey, msToNextDay, nextRunAt, nextRunDoc, reserveDailySlot, refundDailySlot, callsToday }
