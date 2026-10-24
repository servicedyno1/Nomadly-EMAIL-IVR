'use strict'
// Text calls (deaf / hard-of-hearing relay) in the web app: start, live view, type to speak, keypad, hang up, history.
const phoneConfig = require('../phone-config')
const relay = require('../relay-call')
const { normPhone, E164 } = require('./numbers')

const bad = (res, status, error, message) => res.status(status).json({ error, message })
const fail = (res, r) => bad(res, ...r.error)

function routes(router, { h, numbersApi, voiceService }) {
  router.get('/relay/info', h(async (req, res) => {
    const live = relay.liveFor(req.webChatId)
    res.json({ relayRate: relay.RELAY_RATE(), usRate: voiceService.getIvrCallRate('+14155550100'), intlRate: voiceService.getIvrCallRate('+442071234567'), live: live ? live._id : null, maxText: relay.MAX_TEXT })
  }))

  router.post('/relay/calls', h(async (req, res) => {
    const chatId = req.webChatId, b = req.body
    const n = await numbersApi.findMine(chatId, b.callerId)
    if (!n || n.status !== 'active' || n.provider !== 'telnyx') return bad(res, 400, 'invalid_caller', 'Pick one of your active numbers to call from.')
    if (!phoneConfig.canAccessFeature(n.plan, 'textRelay')) return bad(res, 403, 'plan_upgrade_required', 'Text calls need the Pro plan or higher on the number you call from.')
    const to = normPhone(b.to)
    if (!E164.test(to)) return bad(res, 400, 'invalid_number', 'Enter the number to call with country code, e.g. +14155550100.')
    if (phoneConfig.isBlockedPrefix(to)) return bad(res, 400, 'blocked_destination', `${to} is a blocked premium/satellite destination.`)
    if (to === n.phoneNumber) return bad(res, 400, 'same_number', 'You cannot call your own number.')
    const r = await relay.start({ chatId, callerId: n.phoneNumber, to, name: b.name, lang: b.lang, voice: b.voice, announce: b.announce, callRate: voiceService.getIvrCallRate(to) })
    if (r.error) return fail(res, r)
    res.status(201).json({ call: relay.view(await relay.find(r.id, chatId)) })
  }))

  router.get('/relay/calls', h(async (req, res) => {
    const calls = await relay.list(req.webChatId)
    res.json({ calls: calls.map(c => ({ ...relay.view(c), lines: undefined, last: c.lines?.[0] || null })) })
  }))

  const withCall = (fn) => h(async (req, res) => {
    const c = await relay.find(req.params.id, req.webChatId)
    if (!c) return bad(res, 404, 'not_found', 'Call not found.')
    req.relayCall = c
    return fn(req, res)
  })
  router.get('/relay/calls/:id', withCall(async (req, res) => res.json({ call: relay.view(req.relayCall) })))
  router.post('/relay/calls/:id/say', withCall(async (req, res) => {
    const r = await relay.say(req.params.id, req.webChatId, req.body.text)
    r.error ? fail(res, r) : res.json(r)
  }))
  router.post('/relay/calls/:id/keys', withCall(async (req, res) => {
    const r = await relay.dtmf(req.params.id, req.webChatId, req.body.digits)
    r.error ? fail(res, r) : res.json(r)
  }))
  router.post('/relay/calls/:id/hangup', withCall(async (req, res) => {
    await relay.hangup(req.params.id, req.webChatId)
    res.json({ call: relay.view(await relay.find(req.params.id, req.webChatId)) })
  }))
  router.delete('/relay/calls/:id', withCall(async (req, res) => {
    const r = await relay.remove(req.params.id, req.webChatId)
    r.error ? fail(res, r) : res.json(r)
  }))
}

module.exports = { routes }
