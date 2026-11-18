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
  return bad(res, 503, 'calendar_error', 'Google Calendar did not answer. Try again in a minute.')
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
    // Only lines whose plan has the AI voice agent (Business) — an old Pro line with the switch left on no longer uses it.
    const usedBy = (id) => nums.filter(n => n.features?.aiAgent?.enabled && n.features.aiAgent.agentId === id && phoneConfig.canAccessFeature(n.plan, 'aiAgent')).map(n => n.phoneNumber)
    res.json({
      agents: list.map(a => ({ ...s.publicAgent(a), numbers: usedBy(a.id) })), rate: ai.RATE(), receptionRate: ai.RECEPTION_RATE(), recordRate: ai.RECORD_RATE(), recordingDays: ai.recorder.RETENTION_DAYS(), voices: s.VOICES,
      canUse: nums.some(n => n.status === 'active' && phoneConfig.canAccessFeature(n.plan, 'aiAgent')), testDailyMinutes: 15,
    })
  }))
  router.post('/ai-agents', h(async (req, res) => {
    if ((await s.listAgents(req.webChatId)).length >= MAX_AGENTS) return bad(res, 400, 'too_many_agents', `You can have up to ${MAX_AGENTS} agents.`)
    if (await needCalendar(req, res)) return
    try { res.status(201).json({ agent: s.publicAgent(await s.createAgent(req.webChatId, req.body || {})) }) } catch (e) { bad(res, 400, 'invalid_agent', e.message) }
  }))
  // Smart setup: one sentence → a filled-in agent form (not saved; the owner checks it first).
  router.post('/ai-agents/draft', h(async (req, res) => {
    const text = String(req.body?.description || '').trim().slice(0, 600)
    if (text.length < 8) return bad(res, 400, 'too_short', 'Describe the agent in one sentence, e.g. "A receptionist for a dental clinic that books cleanings."')
    const d = await require('./ai-draft').draftAgent(text, req.body?.role === 'receptionist' ? 'receptionist' : 'agent')
    if (!d) return bad(res, 503, 'draft_failed', 'Could not write the setup right now. Try again in a moment.')
    res.json({ draft: d })
  }))
  // Chat builder: the owner chats, the AI answers and returns the form fields to change (nothing saved here).
  router.post('/ai-agents/builder-chat', h(async (req, res) => {
    const msgs = Array.isArray(req.body?.messages) ? req.body.messages.filter(m => m && typeof m.content === 'string') : []
    if (!msgs.length) return bad(res, 400, 'no_message', 'Type a message.')
    const r = await require('./ai-draft').builderChat(msgs, req.body?.current || {}, req.body?.role === 'receptionist' ? 'receptionist' : 'agent')
    if (!r) return bad(res, 503, 'builder_failed', 'The assistant is busy right now. Try again in a moment.')
    res.json(r)
  }))
  // "Call me to test": rings one US/CA number now (the owner's own phone), a few times a day — not a way around campaign calling hours.
  const callMeLog = new Map()
  router.post('/ai-agents/:id/call-me', withAgent(async (req, res) => {
    const to = String(req.body?.to || '').replace(/[^\d+]/g, '').replace(/^(?!\+)/, '+')
    if (!/^\+1\d{10}$/.test(to)) return bad(res, 400, 'invalid_number', 'Enter your own US or Canada number, e.g. +14155550100.')
    const key = String(req.webChatId), day = new Date().toISOString().slice(0, 10)
    const used = (callMeLog.get(key) || []).filter(d => d === day)
    if (used.length >= 5) return bad(res, 429, 'test_limit', 'You can place 5 test calls a day. Try again tomorrow.')
    const nums = (await numbersApi.myNumbers(req.webChatId)).filter(n => n.status === 'active')
    const from = nums.find(n => n.phoneNumber === req.body?.callerId)?.phoneNumber || nums[0]?.phoneNumber
    if (!from) return bad(res, 400, 'no_number', 'You need an active number to place a test call.')
    const r = await ai.dialLead({ agentId: req.agent.id, chatId: key, callerId: from, id: null, test: true }, { number: to, name: null })
    if (r.error) return bad(res, 503, 'call_failed', r.error)
    callMeLog.set(key, [...used, day])
    res.json({ calling: to, from })
  }))
  // What the agent will say first, for the form preview (unsaved values; {lead_name} = a sample name).
  router.post('/ai-agents/opening-preview', h(async (req, res) => {
    const b = req.body || {}
    const str = (v, n) => String(v ?? '').trim().slice(0, n)
    const a = { name: str(b.name, 40) || 'Ava', businessName: str(b.businessName, 60), language: s.LANGS.includes(b.language) ? b.language : 'en', firstMessage: str(b.firstMessage, 500), greeting: str(b.greeting, 300), discloseAi: b.discloseAi !== false }
    const recorded = b.record !== false
    const sample = ai.opening.SAMPLE_LEAD
    const inbound = ai.opening.openingInfo(a, 'inbound', recorded)
    const outbound = ai.opening.openingInfo(a, 'outbound', recorded, sample)
    const noName = ai.opening.openingInfo(a, 'outbound', recorded, null)
    res.json({ inbound, outbound, outboundNoName: noName.text !== outbound.text ? noName.text : null, sampleLead: sample })
  }))
  router.get('/ai-agents/:id', withAgent(async (req, res) => res.json({ agent: s.publicAgent(req.agent), rate: ai.RATE(), receptionRate: ai.RECEPTION_RATE(), recordRate: ai.RECORD_RATE(), recordingDays: ai.recorder.RETENTION_DAYS(), voices: s.VOICES })))
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
    if (req.agent.disabled) return bad(res, 403, 'agent_stopped', 'This AI agent was stopped by CloudIVR. Contact support.')
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
    calls: await s.listCalls(req.webChatId, { agentId: req.query.agentId, campaignId: req.query.campaignId, direction: req.query.direction, limit: parseInt(req.query.limit, 10) || 30 }),
  })))
  router.get('/ai-receptionist/messages', h(async (req, res) => {
    const [messages, open] = await Promise.all([s.listMessages(req.webChatId, { open: req.query.open === '1', limit: parseInt(req.query.limit, 10) || 50 }), s.countOpenMessages(req.webChatId)])
    res.json({ messages, open })
  }))
  router.put('/ai-receptionist/messages/:id', h(async (req, res) => {
    const r = await s.setHandled(req.webChatId, req.params.id, !!req.body?.handled)
    if (!r.matchedCount) return bad(res, 404, 'not_found', 'Message not found.')
    res.json({ handled: !!req.body?.handled, open: await s.countOpenMessages(req.webChatId) })
  }))
  router.get('/ai-calls/:id', h(async (req, res) => {
    const c = await s.getCall(req.webChatId, req.params.id)
    if (!c) return bad(res, 404, 'not_found', 'Call not found.')
    res.json({ call: c })
  }))

  router.get('/ai-dnc', h(async (req, res) => res.json({ numbers: await s.listDnc(req.webChatId) })))
  // One number, or several separated by commas, spaces or new lines.
  router.post('/ai-dnc', h(async (req, res) => {
    const raw = [].concat(req.body?.numbers ?? req.body?.number ?? []).join(' ')
    const parts = [...new Set(raw.split(/[\s,;]+/).filter(Boolean).map(s.normPhone))].slice(0, 1000)
    const valid = parts.filter(n => /^\+[1-9]\d{7,14}$/.test(n))
    if (!valid.length) return bad(res, 400, 'invalid_number', 'Enter the number with country code, e.g. +14155550100.')
    for (const n of valid) await s.addDnc(req.webChatId, n, 'manual')
    res.status(201).json({ number: valid[0], added: valid.length, invalid: parts.length - valid.length })
  }))
  router.delete('/ai-dnc/:number', h(async (req, res) => {
    const r = await s.removeDnc(req.webChatId, req.params.number)
    if (!r.deletedCount) return bad(res, 404, 'not_found', 'That number is not on your do-not-call list.')
    res.json({ removed: true })
  }))

  router.put('/numbers/:phone/ai-agent', h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    if (!phoneConfig.canAccessFeature(num.plan, 'aiAgent')) return bad(res, 403, 'plan_upgrade_required', 'The AI receptionist isn’t available on this number.')
    const enabled = !!req.body?.enabled
    const agentId = req.body?.agentId ? String(req.body.agentId) : null
    if ((enabled || agentId) && !(await s.getAgent(agentId, req.webChatId))) return bad(res, 400, 'invalid_agent', 'Pick one of your AI agents.')
    const value = { enabled, agentId }
    await numbersApi.setField(req.webChatId, num.phoneNumber, 'features.aiAgent', value)
    // One answers a number: the AI voice agent going on switches the keypad menu off.
    const ivr = num.features?.ivr
    const ivrTurnedOff = !!(enabled && ivr?.enabled)
    if (ivrTurnedOff) await numbersApi.setField(req.webChatId, num.phoneNumber, 'features.ivr', { ...ivr, enabled: false })
    // …and "forward every call" too: only one can answer.
    const cf = num.features?.callForwarding
    const forwardingTurnedOff = !!(enabled && cf?.enabled && cf.mode === 'always')
    if (forwardingTurnedOff) await numbersApi.setField(req.webChatId, num.phoneNumber, 'features.callForwarding', { ...cf, enabled: false, mode: 'disabled', lastMode: 'always' })
    res.json({ aiAgent: value, ivrTurnedOff, forwardingTurnedOff })
  }))
}

module.exports = { routes, publicRoutes, safePath, redirectUri }
