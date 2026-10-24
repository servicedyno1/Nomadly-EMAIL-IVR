'use strict'
// AI phone agents in the web app: agents, free browser test talks, AI call history, do-not-call list, number assignment.
const phoneConfig = require('../phone-config')
const ai = require('../ai-agent')

const MAX_AGENTS = 20

function routes(router, { h, numbersApi }) {
  const s = ai.store
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
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
      agents: list.map(a => ({ ...s.publicAgent(a), numbers: usedBy(a.id) })), rate: ai.RATE(), voices: s.VOICES,
      canUse: nums.some(n => n.status === 'active' && phoneConfig.canAccessFeature(n.plan, 'aiAgent')), testDailyMinutes: 15,
    })
  }))
  router.post('/ai-agents', h(async (req, res) => {
    if ((await s.listAgents(req.webChatId)).length >= MAX_AGENTS) return bad(res, 400, 'too_many_agents', `You can have up to ${MAX_AGENTS} agents.`)
    try { res.status(201).json({ agent: s.publicAgent(await s.createAgent(req.webChatId, req.body || {})) }) } catch (e) { bad(res, 400, 'invalid_agent', e.message) }
  }))
  router.get('/ai-agents/:id', withAgent(async (req, res) => res.json({ agent: s.publicAgent(req.agent), rate: ai.RATE(), voices: s.VOICES })))
  router.put('/ai-agents/:id', withAgent(async (req, res) => {
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
  router.delete('/ai-dnc/:number', h(async (req, res) => { await s.removeDnc(req.webChatId, req.params.number); res.json({ removed: true }) }))

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

module.exports = { routes }
