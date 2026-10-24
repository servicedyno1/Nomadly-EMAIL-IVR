'use strict'
// AI phone agents in the web app: agents, free browser test talks, AI call history, do-not-call list, number assignment.
const phoneConfig = require('../phone-config')
const ai = require('../ai-agent')

const MAX_AGENTS = 20
const CALLBACK = '/api/cloudivr-web/calendar/google/callback'
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const first = (v) => String(v || '').split(',')[0].trim()
// Only same-site paths (no scheme, no //host) can be returned to after Google.
const safePath = (p) => (typeof p === 'string' && p.length < 300 && /^\/(?![/\\])[\w\-./?=&%]*$/.test(p) ? p : null)
// Must match an "Authorized redirect URI" of the Google OAuth client (preview host or cloudivr.net).
function redirectUri(req) {
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) return process.env.GOOGLE_CALENDAR_REDIRECT_URI
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host)
  const proto = /^(localhost|127\.)/.test(host) ? (first(req.headers['x-forwarded-proto']) || 'http') : 'https'
  return `${proto}://${host}${CALLBACK}`
}
function calBad(res, e) {
  if (['not_connected', 'revoked', 'bad_token'].includes(e.code)) return bad(res, 400, 'calendar_not_connected', 'Connect your Google Calendar again.')
  if (e.code === 'calendar_not_found') return bad(res, 400, 'calendar_not_found', 'That calendar was not found. Pick another one.')
  if (e.code === 'forbidden') return bad(res, 400, 'calendar_forbidden', 'CloudIVR is not allowed to use that calendar. Pick one you can edit.')
  return bad(res, 502, 'calendar_error', 'Google Calendar did not answer. Try again in a minute.')
}

// Google sends the browser back here after consent (no session needed: the single-use state names the account).
function publicRoutes(router, { h }) {
  router.get('/calendar/google/callback', h(async (req, res) => {
    const r = await ai.gcal.finishConnect({ state: req.query.state, code: req.query.code, error: req.query.error })
    const back = safePath(r.returnTo) || '/cloudivr/app/ai-agents'
    res.redirect(302, `${back}${back.includes('?') ? '&' : '?'}calendar=${r.ok ? 'connected' : encodeURIComponent(r.error || 'failed')}`)
  }))
}

function routes(router, { h, numbersApi }) {
  const s = ai.store
  const gcal = ai.gcal
  // Turning bookings ON needs a connected calendar. An agent that already had bookings on stays saveable after a
  // disconnect/revoke (calls simply skip booking until the calendar is connected again).
  const needCalendar = async (req, res) => {
    if (!req.body?.booking?.enabled || req.agent?.booking?.enabled || await gcal.isConnected(req.webChatId)) return false
    bad(res, 400, 'calendar_not_connected', 'Connect your Google Calendar before turning on bookings.')
    return true
  }
  const withAgent = (fn) => h(async (req, res) => {
    const a = await s.getAgent(req.params.id, req.webChatId)
    if (!a) return bad(res, 404, 'not_found', 'Agent not found.')
    req.agent = a
    return fn(req, res)
  })

  router.get('/ai-agents', h(async (req, res) => {
    const [list, nums] = await Promise.all([s.listAgents(req.webChatId), numbersApi.myNumbers(req.webChatId)])
    const usedBy = (id) => nums.filter(n => n.features?.aiAgent?.enabled && n.features.aiAgent.agentId === id).map(n => n.phoneNumber)
    res.json({
      agents: list.map(a => ({ ...s.publicAgent(a), numbers: usedBy(a.id) })), rate: ai.RATE(), recordRate: ai.RECORD_RATE(), recordingDays: ai.recorder.RETENTION_DAYS(), voices: s.VOICES,
      canUse: nums.some(n => n.status === 'active' && phoneConfig.canAccessFeature(n.plan, 'aiAgent')), testDailyMinutes: 15,
    })
  }))
  router.post('/ai-agents', h(async (req, res) => {
    if ((await s.listAgents(req.webChatId)).length >= MAX_AGENTS) return bad(res, 400, 'too_many_agents', `You can have up to ${MAX_AGENTS} agents.`)
    if (await needCalendar(req, res)) return
    try { res.status(201).json({ agent: s.publicAgent(await s.createAgent(req.webChatId, req.body || {})) }) } catch (e) { bad(res, 400, 'invalid_agent', e.message) }
  }))
  router.get('/ai-agents/:id', withAgent(async (req, res) => res.json({ agent: s.publicAgent(req.agent), rate: ai.RATE(), recordRate: ai.RECORD_RATE(), recordingDays: ai.recorder.RETENTION_DAYS(), voices: s.VOICES })))
  router.put('/ai-agents/:id', withAgent(async (req, res) => {
    if (await needCalendar(req, res)) return
    try { res.json({ agent: s.publicAgent(await s.updateAgent(req.webChatId, req.agent.id, req.body || {})) }) } catch (e) { bad(res, 400, 'invalid_agent', e.message) }
  }))
  router.delete('/ai-agents/:id', withAgent(async (req, res) => {
    for (const n of await numbersApi.myNumbers(req.webChatId)) {
      if (n.features?.aiAgent?.agentId === req.agent.id) await numbersApi.setField(req.webChatId, n.phoneNumber, 'features.aiAgent', { enabled: false, agentId: null })
    }
    await s.deleteAgent(req.webChatId, req.agent.id)
    res.json({ deleted: true })
  }))
  router.post('/ai-agents/:id/test', withAgent(async (req, res) => {
    const r = await ai.createTest(req.webChatId, req.agent.id, req.body?.as)
    if (r.error) return bad(res, ...r.error)
    res.json({ path: `/api/cloudivr-web/ai-agents/test/${r.token}`, maxSeconds: r.maxSeconds })
  }))

  // Free times the agent would offer on a day (owner's check that the calendar + booking hours are right).
  router.get('/ai-agents/:id/slots', withAgent(async (req, res) => {
    if (!(await gcal.isConnected(req.webChatId))) return bad(res, 400, 'calendar_not_connected', 'Connect your Google Calendar first.')
    const ctx = ai.booking.createContext({ chatId: req.webChatId, agent: req.agent, booking: ai.booking.cleanBooking(req.agent.booking), callerNumber: null })
    try { res.json(await ctx.check({ date: req.query.date })) } catch (e) { calBad(res, e) }
  }))

  // ── Google Calendar connection (one per account) ──
  router.get('/calendar', h(async (req, res) => res.json(await gcal.status(req.webChatId))))
  router.post('/calendar/google/connect', h(async (req, res) => {
    if (!gcal.configured()) return bad(res, 503, 'calendar_unavailable', 'Google Calendar connection is not available yet.')
    res.json({ url: await gcal.startConnect(req.webChatId, { redirectUri: redirectUri(req), returnTo: safePath(req.body?.returnTo) }) })
  }))
  router.get('/calendar/calendars', h(async (req, res) => {
    try { res.json({ calendars: await gcal.listCalendars(req.webChatId) }) } catch (e) { calBad(res, e) }
  }))
  router.delete('/calendar', h(async (req, res) => res.json({ disconnected: await gcal.disconnect(req.webChatId) })))

  router.get('/ai-calls', h(async (req, res) => res.json({
    calls: await s.listCalls(req.webChatId, { agentId: req.query.agentId, campaignId: req.query.campaignId, limit: parseInt(req.query.limit, 10) || 30 }),
  })))
  router.get('/ai-calls/:id', h(async (req, res) => {
    const c = await s.getCall(req.webChatId, req.params.id)
    if (!c) return bad(res, 404, 'not_found', 'Call not found.')
    res.json({ call: c })
  }))

  router.get('/ai-dnc', h(async (req, res) => res.json({ numbers: await s.listDnc(req.webChatId) })))
  router.post('/ai-dnc', h(async (req, res) => {
    const n = s.normPhone(req.body?.number)
    if (!/^\+[1-9]\d{7,14}$/.test(n)) return bad(res, 400, 'invalid_number', 'Enter the number with country code, e.g. +14155550100.')
    await s.addDnc(req.webChatId, n, 'manual')
    res.status(201).json({ number: n })
  }))
  router.delete('/ai-dnc/:number', h(async (req, res) => {
    const r = await s.removeDnc(req.webChatId, req.params.number)
    if (!r.deletedCount) return bad(res, 404, 'not_found', 'That number is not on your do-not-call list.')
    res.json({ removed: true })
  }))

  router.put('/numbers/:phone/ai-agent', h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    if (!phoneConfig.canAccessFeature(num.plan, 'aiAgent')) return bad(res, 403, 'plan_upgrade_required', 'The AI agent needs the Pro plan or higher on this number.')
    const enabled = !!req.body?.enabled
    const agentId = req.body?.agentId ? String(req.body.agentId) : null
    if ((enabled || agentId) && !(await s.getAgent(agentId, req.webChatId))) return bad(res, 400, 'invalid_agent', 'Pick one of your AI agents.')
    const value = { enabled, agentId }
    await numbersApi.setField(req.webChatId, num.phoneNumber, 'features.aiAgent', value)
    res.json({ aiAgent: value })
  }))
}

module.exports = { routes, publicRoutes, safePath, redirectUri }
