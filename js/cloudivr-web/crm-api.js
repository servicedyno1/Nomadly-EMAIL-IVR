'use strict'
// CRM calling API (Enterprise plan, or Business + monthly add-on): a CRM starts a call to a lead with one request; the moment
// the lead answers (no key press) the call is connected to the owner's agent line. Status updates go to the account webhook.
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const events = require('./events')
const callerIds = require('./caller-ids')
const { walletOps } = require('./wallet')

const ADDON_PRICE = Number(process.env.API_ADDON_PRICE || 99)
const PERIOD_MS = 30 * 86400000
const E164 = /^\+[1-9]\d{7,14}$/
const MACHINE = ['hangup', 'connect']
const KEY_PREFIX = 'civr_live_'
const MAX_KEYS = 10
const DOCS_URL = 'https://cloudivr.net/api-docs'
const hash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex')
const norm = (p) => { const s = String(p || '').replace(/[^\d+]/g, ''); return s.startsWith('+') ? s : s.length === 10 ? `+1${s}` : s ? `+${s}` : '' }
const bad = (res, status, error, message) => res.status(status).json({ error, message })
let db = null, log = console.log, voice = null, numbersApi = null, notify = null

// Who may use the API: Enterprise plan, or a Business plan with the paid add-on.
async function access(chatId) {
  const nums = ((await db.collection('phoneNumbersOf').findOne({ _id: String(chatId) }))?.val?.numbers || []).filter(n => n.status === 'active')
  const plans = new Set(nums.map(n => n.plan))
  const a = await db.collection('apiAccess').findOne({ _id: String(chatId) })
  const addon = a?.until && new Date(a.until) > new Date() ? { until: a.until, autoRenew: a.autoRenew !== false } : null
  if (plans.has('enterprise')) return { on: true, via: 'enterprise', canBuy: false, addon: null, price: ADDON_PRICE }
  if (plans.has('business') && addon) return { on: true, via: 'addon', canBuy: false, addon, price: ADDON_PRICE }
  return { on: false, via: null, canBuy: plans.has('business'), addon, price: ADDON_PRICE }
}

async function chargeAddon(chatId, renewal = false) {
  if (!(await walletOps(db).debit(chatId, ADDON_PRICE))) return false
  await db.collection('transactions').insertOne({ _id: `api-access-${crypto.randomUUID()}`, chatId: String(chatId), type: 'api-access', amount: ADDON_PRICE, currency: 'USD', status: 'completed', metadata: { renewal, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() })
  return true
}

// Monthly renewal of the Business add-on from the wallet; off when the wallet can't cover it.
async function tick() {
  for (const a of await db.collection('apiAccess').find({ autoRenew: { $ne: false }, until: { $lte: new Date() } }).limit(200).toArray()) {
    const acc = await access(a._id)
    if (!acc.canBuy) { await db.collection('apiAccess').updateOne({ _id: a._id }, { $set: { autoRenew: false } }); continue }
    if (await chargeAddon(a._id, true)) {
      await db.collection('apiAccess').updateOne({ _id: a._id }, { $set: { until: new Date(Date.now() + PERIOD_MS), renewedAt: new Date() } })
      notify?.push(a._id, `🔑 API access renewed for 30 days — $${ADDON_PRICE} from your wallet.`, null, { kind: 'payment' }).catch(() => {})
    } else {
      await db.collection('apiAccess').updateOne({ _id: a._id }, { $set: { autoRenew: false, lapsedAt: new Date() } })
      notify?.push(a._id, `⚠️ API access ended: your wallet couldn't cover the $${ADDON_PRICE} monthly add-on. Top up and turn it back on in Settings → API.`, null, { kind: 'payment' }).catch(() => {})
    }
  }
}

const pubCall = (c) => ({ id: c._id, status: c.status, to: c.to, connectTo: c.connectTo, from: c.from, showAs: c.showAs || null, machine: c.machine, answeredBy: c.answeredBy || null, outcome: c.outcome || null, duration: c.duration ?? null, connectedDuration: c.connectedDuration ?? null, metadata: c.metadata || null, createdAt: c.createdAt, answeredAt: c.answeredAt || null, connectedAt: c.connectedAt || null, endedAt: c.endedAt || null, error: c.error || null })

// Called by the call engine (voice-service) at each step of an API call.
async function onEvent(api, step, data = {}) {
  if (!db || !api?.id) return
  const at = new Date()
  const set = { status: step, updatedAt: at }
  if (step === 'answered') Object.assign(set, { answeredAt: at, answeredBy: data.answeredBy || 'human' })
  if (step === 'connected') set.connectedAt = at
  if (step === 'completed') {
    const cur = data.connectedDuration == null && data.outcome === 'connected' ? await db.collection('apiCalls').findOne({ _id: api.id }, { projection: { connectedAt: 1 } }).catch(() => null) : null
    Object.assign(set, { endedAt: at, outcome: data.outcome, duration: data.duration ?? 0, connectedDuration: data.connectedDuration ?? (cur?.connectedAt ? Math.round((at - new Date(cur.connectedAt)) / 1000) : null) })
  }
  const c = await db.collection('apiCalls').findOneAndUpdate({ _id: api.id }, { $set: set, $push: { steps: { step, at } } }, { returnDocument: 'after' }).catch(() => null)
  const doc = c?.value || c
  if (doc?._id) events.emitApi(doc.chatId, `api_call.${step}`, pubCall(doc))
}

async function startCall(chatId, b) {
  const R = (status, error, message) => ({ status, body: { error, message } })
  const prefs = (await db.collection('webPrefs').findOne({ _id: String(chatId) }, { projection: { crmApi: 1 } }))?.crmApi || {}
  const to = norm(b.to), connectTo = norm(b.connectTo || prefs.connectTo)
  if (!E164.test(to)) return R(400, 'invalid_to', '`to` must be the lead\'s number with country code, e.g. +14155550100.')
  if (!E164.test(connectTo)) return R(400, 'invalid_connect_to', '`connectTo` must be your agent number with country code, e.g. +18005550100.')
  if (to === connectTo) return R(400, 'same_number', '`to` and `connectTo` must be different numbers.')
  for (const n of [to, connectTo]) if (phoneConfig.isBlockedPrefix(n)) return R(400, 'blocked_destination', `${n} is a blocked premium/satellite destination.`)
  const fromIn = norm(b.from || prefs.from)
  const caller = fromIn ? await numbersApi.findMine(chatId, fromIn) : null
  if (!caller || caller.status !== 'active') return R(400, 'invalid_from', '`from` must be one of your active CloudIVR numbers.')
  if (to === caller.phoneNumber) return R(400, 'same_number', 'You cannot call your own number.')
  let showAs = null
  if (b.showAs) { try { showAs = await callerIds.resolve(chatId, b.showAs) } catch (e) { return R(400, e.code || 'invalid_show_as', e.message) } }
  if (await require('../ai-agent').store.onDnc(chatId, to).catch(() => false)) return R(409, 'do_not_call', `${to} is on your do-not-call list.`)
  const machine = MACHINE.includes(b.machine) ? b.machine : MACHINE.includes(prefs.machine) ? prefs.machine : 'hangup'
  const rate = +(Math.max(voice.getIvrCallRate(to), voice.getIvrCallRate(connectTo)) * 2).toFixed(4)
  const bal = await walletOps(db).balance(chatId)
  if (bal < rate) return R(402, 'insufficient_balance', `Your wallet has $${bal.toFixed(2)}; a connected call costs about $${rate.toFixed(2)}/min (both legs). Top up your wallet.`)
  const id = `call_${crypto.randomBytes(12).toString('hex')}`
  const metadata = b.metadata && typeof b.metadata === 'object' && !Array.isArray(b.metadata) ? b.metadata : null
  if (metadata && JSON.stringify(metadata).length > 2000) return R(400, 'metadata_too_large', '`metadata` must be under 2,000 characters of JSON.')
  const doc = { _id: id, chatId: String(chatId), to, connectTo, from: caller.phoneNumber, showAs, machine, metadata, status: 'queued', steps: [{ step: 'queued', at: new Date() }], createdAt: new Date() }
  await db.collection('apiCalls').insertOne(doc)
  const r = await voice.initiateOutboundIvrCall({
    chatId: String(chatId), callerId: caller.phoneNumber, displayCallerId: showAs, transferCallerId: showAs || null, targetNumber: to, ivrNumber: connectTo,
    activeKeys: ['1'], templateName: 'CRM API call', holdMusic: false, provider: showAs ? 'multitel' : 'telnyx', ivrMode: 'transfer',
    connectOnAnswer: true, machinePolicy: machine, api: { id }, _cwOk: false,
  }).catch(e => ({ error: e.message }))
  if (r?.error || r?.waiting) {
    const message = r?.error ? String(r.error).replace(/<[^>]+>/g, '') : 'This call is held for a quick review and has not been placed.'
    await db.collection('apiCalls').updateOne({ _id: id }, { $set: { status: 'failed', error: message, endedAt: new Date() } })
    return R(r?.invalidNumber ? 400 : 424, r?.invalidNumber ? 'invalid_to' : 'call_failed', message)
  }
  log(`[CrmApi] ${chatId} ${caller.phoneNumber} → ${to} ⇒ ${connectTo} (${id}, machine=${machine})`)
  return { status: 201, body: pubCall(doc) }
}

// Public API (API key).
function publicRoutes(r, { h }) {
  const keyAuth = h(async (req, res, next) => {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)
    const k = m && m[1].startsWith(KEY_PREFIX) ? await db.collection('apiKeys').findOne({ hash: hash(m[1]), revokedAt: null }) : null
    if (!k) return bad(res, 401, 'invalid_api_key', 'Send your API key as: Authorization: Bearer civr_live_…')
    const acc = await access(k.chatId)
    if (!acc.on) return bad(res, 403, 'api_not_enabled', acc.canBuy ? `API access is a $${ADDON_PRICE}/month add-on on the Business plan — turn it on in Settings → API.` : 'API access comes with the Enterprise plan (or Business + the API add-on).')
    req.apiChatId = k.chatId
    db.collection('apiKeys').updateOne({ _id: k._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {})
    next()
  })
  r.post('/v1/calls', keyAuth, h(async (req, res) => { const out = await startCall(req.apiChatId, req.body || {}); res.status(out.status).json(out.body) }))
  r.get('/v1/calls/:id', keyAuth, h(async (req, res) => {
    const c = await db.collection('apiCalls').findOne({ _id: String(req.params.id), chatId: req.apiChatId })
    if (!c) return bad(res, 404, 'not_found', 'No call with that id on this account.')
    res.json(pubCall(c))
  }))
  r.get('/v1/numbers', keyAuth, h(async (req, res) => {
    const nums = ((await db.collection('phoneNumbersOf').findOne({ _id: req.apiChatId }))?.val?.numbers || []).filter(n => n.status === 'active').map(n => n.phoneNumber)
    res.json({ numbers: nums })
  }))
}

// Settings → API (signed-in owner).
function routes(r, { h }) {
  const prefs = db.collection('webPrefs'), keys = db.collection('apiKeys')
  const view = async (chatId) => {
    const [acc, list, p] = await Promise.all([access(chatId), keys.find({ chatId, revokedAt: null }).sort({ createdAt: -1 }).toArray(), prefs.findOne({ _id: chatId }, { projection: { crmApi: 1, webhook: 1 } })])
    const numbers = ((await db.collection('phoneNumbersOf').findOne({ _id: chatId }))?.val?.numbers || []).filter(n => n.status === 'active').map(n => n.phoneNumber)
    return { numbers, access: acc, keys: list.map(k => ({ id: k._id, name: k.name, last4: k.last4, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null })), defaults: { machine: p?.crmApi?.machine || 'hangup', from: p?.crmApi?.from || '', connectTo: p?.crmApi?.connectTo || '' }, webhook: { url: p?.webhook?.url || '', enabled: !!p?.webhook?.enabled }, docsUrl: DOCS_URL }
  }
  r.get('/api-access', h(async (req, res) => res.json(await view(req.webChatId))))
  r.post('/api-access/addon', h(async (req, res) => {
    const acc = await access(req.webChatId)
    if (acc.on) return res.json(await view(req.webChatId))
    if (!acc.canBuy) return bad(res, 403, 'plan_upgrade_required', 'API access needs the Enterprise plan, or the Business plan with this add-on.')
    if (!(await chargeAddon(req.webChatId))) { const bal = await walletOps(db).balance(req.webChatId); return res.status(402).json({ error: 'insufficient_balance', message: `API access costs $${ADDON_PRICE}/month from your wallet; your balance is $${bal.toFixed(2)}.`, cost: ADDON_PRICE }) }
    await db.collection('apiAccess').updateOne({ _id: req.webChatId }, { $set: { until: new Date(Date.now() + PERIOD_MS), autoRenew: true, startedAt: new Date() } }, { upsert: true })
    res.json(await view(req.webChatId))
  }))
  r.put('/api-access/addon', h(async (req, res) => {
    await db.collection('apiAccess').updateOne({ _id: req.webChatId }, { $set: { autoRenew: !!req.body?.autoRenew } })
    res.json(await view(req.webChatId))
  }))
  r.put('/api-access/defaults', h(async (req, res) => {
    const b = req.body || {}
    const from = norm(b.from), connectTo = norm(b.connectTo)
    if (from && !(await numbersApi.findMine(req.webChatId, from))) return bad(res, 400, 'invalid_from', 'Pick one of your active CloudIVR numbers to call from.')
    if (connectTo && !E164.test(connectTo)) return bad(res, 400, 'invalid_connect_to', 'Enter the agent number with country code, e.g. +18005550100.')
    const crmApi = { machine: MACHINE.includes(b.machine) ? b.machine : 'hangup', from: from || '', connectTo: connectTo || '' }
    await prefs.updateOne({ _id: req.webChatId }, { $set: { crmApi } }, { upsert: true })
    res.json(await view(req.webChatId))
  }))
  r.post('/api-keys', h(async (req, res) => {
    if (!(await access(req.webChatId)).on) return bad(res, 403, 'api_not_enabled', 'Turn on API access first.')
    if (await keys.countDocuments({ chatId: req.webChatId, revokedAt: null }) >= MAX_KEYS) return bad(res, 400, 'too_many_keys', `Up to ${MAX_KEYS} keys — delete one you no longer use.`)
    const key = `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`
    const doc = { _id: `key_${crypto.randomBytes(8).toString('hex')}`, chatId: req.webChatId, name: String(req.body?.name || 'CRM').trim().slice(0, 40) || 'CRM', hash: hash(key), last4: key.slice(-4), createdAt: new Date(), revokedAt: null }
    await keys.insertOne(doc)
    res.status(201).json({ key, id: doc._id, name: doc.name, last4: doc.last4 })
  }))
  r.delete('/api-keys/:id', h(async (req, res) => {
    await keys.updateOne({ _id: String(req.params.id), chatId: req.webChatId }, { $set: { revokedAt: new Date() } })
    res.json(await view(req.webChatId))
  }))
  r.get('/api-calls', h(async (req, res) => res.json({ calls: (await db.collection('apiCalls').find({ chatId: req.webChatId }).sort({ createdAt: -1 }).limit(20).toArray()).map(pubCall) })))
}

function init(deps) {
  db = deps.db; log = deps.log || console.log; voice = deps.voiceService; numbersApi = deps.numbersApi || numbersApi; notify = deps.notify
  db.collection('apiKeys').createIndex({ hash: 1 }, { unique: true }).catch(() => {})
  db.collection('apiCalls').createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
}

module.exports = { init, publicRoutes, routes, access, startCall, onEvent, tick, ADDON_PRICE, DOCS_URL }
