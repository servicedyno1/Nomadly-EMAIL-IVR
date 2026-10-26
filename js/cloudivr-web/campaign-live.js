'use strict'
// Live view of Bulk IVR / AI campaigns: who is ringing or talking now, calls per minute, time left, latest calls and top areas.
const { DateTime } = require('luxon')
const sched = require('../campaign-schedule')
const { areaOf } = require('./areas')

const INFLIGHT = ['calling', 'ringing', 'answered']
const NOT_ANSWERED = ['pending', 'calling', 'ringing', 'skipped', 'no_answer', 'busy', 'failed', 'voicemail']
const RATE_WINDOW_MS = 5 * 60000
const ms = (d) => (d ? new Date(d).getTime() : 0)
// Same rule as the campaign stats: picked up by a person (talked, pressed a key or was connected).
const isAnswered = (l) => !NOT_ANSWERED.includes(l.status) && (l.duration > 0 || l.status === 'answered' || !!l.digitPressed)
const isDone = (l) => l.status !== 'pending' && !INFLIGHT.includes(l.status)

// In-flight lead → { phase: 'ringing' | 'talking', since }. Telnyx legs keep status "calling" until they end, so the live session tells.
function phaseOf(l, voiceService) {
  if (l.status === 'ringing') return { phase: 'ringing' }
  if (l.status === 'answered') return { phase: 'talking', since: l.answeredAt }
  const s = voiceService?.outboundIvrCalls?.[l.callSid]
  if (s?.answerTime) return { phase: 'talking', since: new Date(s.answerTime) }
  let ai = null
  try { ai = l.callSid ? require('../ai-agent/calls').sessions?.get?.(l.callSid) : null } catch (_) { ai = null }
  if (ai?.answeredAt) return { phase: 'talking', since: new Date(ai.answeredAt) }
  return { phase: 'ringing' }
}

function liveView(c, voiceService, now = Date.now()) {
  const leads = c.leads || []
  let waiting = 0, ringing = 0, talking = 0, done = 0, recent = 0
  for (const l of leads) {
    if (l.status === 'pending') waiting++
    else if (INFLIGHT.includes(l.status)) { if (phaseOf(l, voiceService).phase === 'talking') talking++; else ringing++ }
    else { done++; if (l.status !== 'skipped' && now - ms(l.completedAt) <= RATE_WINDOW_MS) recent++ }
  }
  const running = c.status === 'running'
  const ratePerMin = running ? Math.round((recent / (RATE_WINDOW_MS / 60000)) * 10) / 10 : 0
  const remaining = waiting + ringing + talking
  const blocked = c.waitingForHours || c.waitingForDailyLimit
  return {
    pipeline: { waiting, ringing, talking, done },
    ratePerMin,
    etaSec: running && !blocked && ratePerMin > 0 && remaining ? Math.round((remaining / ratePerMin) * 60) : null,
    elapsedSec: c.startedAt ? Math.max(0, Math.round(((c.completedAt ? ms(c.completedAt) : now) - ms(c.startedAt)) / 1000)) : 0,
    linesInUse: ringing + talking,
  }
}

const item = (c, l, voiceService, now) => {
  const live = INFLIGHT.includes(l.status) ? phaseOf(l, voiceService) : null
  return {
    campaignId: c.id, campaignName: c.name || c.audioName || 'Campaign', number: l.number, name: l.name || null, area: areaOf(l.number),
    status: l.status, phase: live?.phase || null, at: live ? (l.startedAt || null) : (l.completedAt || null),
    duration: live?.phase === 'talking' && live.since ? Math.max(0, Math.round((now - ms(live.since)) / 1000)) : (l.duration || 0),
    digitPressed: l.digitPressed || null, transferred: !!l.transferred, voicemailDropped: !!l.voicemailDropped, outcome: l.ai?.outcome || null,
  }
}

// Newest first: calls ringing / talking now, then finished calls by end time.
function feedOf(campaigns, voiceService, limit = 25, now = Date.now()) {
  const rows = []
  for (const c of campaigns) for (const l of c.leads || []) if (l.status !== 'pending' && (INFLIGHT.includes(l.status) || l.completedAt)) rows.push([c, l])
  const key = ([, l]) => (INFLIGHT.includes(l.status) ? 1e15 + ms(l.startedAt) : ms(l.completedAt))
  return rows.sort((a, b) => key(b) - key(a)).slice(0, limit).map(([c, l]) => item(c, l, voiceService, now))
}

// Calls and answers per state / country, busiest first.
function areasOf(c, limit = 8) {
  const by = {}
  for (const l of c.leads || []) {
    if (l.status === 'skipped') continue
    const a = by[areaOf(l.number)] ||= { area: areaOf(l.number), numbers: 0, called: 0, answered: 0, keyPressed: 0, interested: 0 }
    a.numbers++
    if (isDone(l)) a.called++
    if (isDone(l) && isAnswered(l)) a.answered++
    if (l.digitPressed) a.keyPressed++
    if (['interested', 'booked'].includes(l.ai?.outcome)) a.interested++
  }
  return Object.values(by).sort((x, y) => y.numbers - x.numbers || y.answered - x.answered).slice(0, limit)
}

function routes(router, { db, h, voiceService, publicCampaign }) {
  const coll = db.collection('bulkCallCampaigns')
  // Everything calling now, today's totals, the latest calls and what is coming up.
  router.get('/campaigns/live', h(async (req, res) => {
    const now = Date.now()
    const dayStart = DateTime.fromMillis(now).setZone(sched.zoneOf(req.query.tz)).startOf('day').toMillis()
    const docs = await coll.find({ chatId: String(req.webChatId), $or: [{ status: { $in: ['running', 'paused', 'scheduled'] } }, { completedAt: { $gte: new Date(dayStart) } }] })
      .sort({ createdAt: -1 }).limit(60).toArray()
    const active = docs.filter(c => ['running', 'paused'].includes(c.status))
    const campaigns = active.map(c => ({ ...publicCampaign(c), live: liveView(c, voiceService, now) }))
    let callsToday = 0, answeredToday = 0
    for (const c of docs) for (const l of c.leads || []) if (l.status !== 'skipped' && isDone(l) && ms(l.completedAt) >= dayStart) { callsToday++; if (isAnswered(l)) answeredToday++ }
    const running = campaigns.filter(c => c.status === 'running')
    res.json({
      summary: {
        running: running.length, paused: campaigns.length - running.length, callsToday, answeredToday,
        linesInUse: campaigns.reduce((s, c) => s + c.live.linesInUse, 0), lineCapacity: running.reduce((s, c) => s + (c.concurrency || 0), 0),
        ratePerMin: Math.round(running.reduce((s, c) => s + c.live.ratePerMin, 0) * 10) / 10,
      },
      campaigns,
      upcoming: docs.filter(c => c.status === 'scheduled').sort((a, b) => ms(a.scheduledFor) - ms(b.scheduledFor)).slice(0, 10).map(c => publicCampaign(c)),
      feed: feedOf(docs.filter(c => c.status !== 'scheduled'), voiceService, 20, now),
    })
  }))
}

module.exports = { routes, liveView, feedOf, areasOf, isAnswered }
