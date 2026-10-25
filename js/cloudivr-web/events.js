'use strict'
// Call-event feed for CRMs, Zapier ("Webhooks by Zapier" → Catch Hook) or any https endpoint. One URL per account; each
// event is POSTed as JSON and signed: X-CloudIVR-Signature = hex HMAC-SHA256(secret, raw body).
const crypto = require('crypto')
const axios = require('axios')
const notify = require('./notify')

const EVENTS = {
  'call.started': 'Call started',
  'call.ended': 'Call ended (with duration)',
  'voicemail.left': 'Voicemail left',
  'sms.received': 'Text received',
  'ai_summary.ready': 'AI summary ready',
}
const TIMEOUT_MS = 6000
const CACHE_MS = 30000
const URL_RE = /^https:\/\/[^\s/$.?#][^\s]{3,500}$/i
const bad = (res, status, error, message) => res.status(status).json({ error, message })
let db = null
let log = console.log
const cache = new Map() // chatId → { at, hook }
const owners = new Map() // phone → { at, chatId }

const newSecret = () => `whsec_${crypto.randomBytes(18).toString('base64url')}`
const sign = (secret, raw) => crypto.createHmac('sha256', secret).update(raw).digest('hex')

// Blocks private / loopback / metadata hosts (the URL is typed by the user).
function publicHost(u) {
  try {
    const host = new URL(u).hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '[::1]' || /^\[?(fc|fd|fe80)/.test(host)) return false
    return true
  } catch (_) { return false }
}

async function hookOf(chatId) {
  const c = cache.get(chatId)
  if (c && Date.now() - c.at < CACHE_MS) return c.hook
  const hook = (await db.collection('webPrefs').findOne({ _id: chatId }, { projection: { webhook: 1 } }))?.webhook || null
  cache.set(chatId, { at: Date.now(), hook })
  return hook
}

async function deliver(chatId, hook, type, data, { test = false } = {}) {
  const event = { id: `evt_${crypto.randomUUID().replace(/-/g, '')}`, type, created: new Date().toISOString(), test, data }
  const raw = JSON.stringify(event)
  const started = Date.now()
  let status = 0, error = null
  try {
    const r = await axios.post(hook.url, raw, {
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'CloudIVR-Webhooks/1', 'X-CloudIVR-Event': type, 'X-CloudIVR-Signature': sign(hook.secret, raw) },
      timeout: TIMEOUT_MS, maxRedirects: 0, validateStatus: () => true,
    })
    status = r.status
    if (status >= 300) error = `HTTP ${status}`
  } catch (e) { error = String(e.code || e.message).slice(0, 120) }
  const ok = status >= 200 && status < 300
  await db.collection('webhookDeliveries').insertOne({ chatId, eventId: event.id, type, test, ok, status, error, ms: Date.now() - started, at: new Date() }).catch(() => {})
  if (!ok) log(`[Webhooks] ${type} → ${hook.url} failed for ${chatId}: ${error}`)
  return { ok, status, error, event }
}

// Fire-and-forget: sends `type` when the account has a webhook that wants it. Never throws.
function emit(chatId, type, data) {
  if (!db || !EVENTS[type] || !notify.isWebChatId(chatId)) return
  const id = String(chatId)
  hookOf(id).then(hook => {
    if (hook?.enabled && hook.url && (hook.events || []).includes(type)) return deliver(id, hook, type, data)
    return null
  }).catch(e => log(`[Webhooks] emit ${type} error: ${e.message}`))
}

// Same, when only the number is known (call engine logs); the owner lookup is cached.
function emitForNumber(phone, type, data) {
  if (!db || !phone) return
  const p = String(phone)
  const o = owners.get(p)
  const go = (chatId) => chatId && emit(chatId, type, { number: p, ...data })
  if (o && Date.now() - o.at < CACHE_MS * 10) return go(o.chatId)
  db.collection('phoneNumbersOf').findOne({ 'val.numbers': { $elemMatch: { phoneNumber: p, status: { $ne: 'released' } } } }, { projection: { _id: 1 } })
    .then(d => { owners.set(p, { at: Date.now(), chatId: d?._id ?? null }); go(d?._id) })
    .catch(() => {})
}

const SAMPLE = {
  'call.started': { number: '+14155550100', from: '+14155550123', direction: 'inbound', callId: 'test' },
  'call.ended': { number: '+14155550100', from: '+14155550123', direction: 'inbound', duration: 42, outcome: 'answered', callId: 'test' },
  'voicemail.left': { number: '+14155550100', from: '+14155550123', duration: 18, transcript: 'Hi, please call me back about my order.', recordingUrl: null },
  'sms.received': { number: '+14155550100', from: '+14155550123', text: 'Are you open today?' },
  'ai_summary.ready': { number: '+14155550100', from: '+14155550123', kind: 'voicemail', summary: 'Caller wants a call back about an order.', sentiment: 'neutral', mood: 'calm' },
}

const publicHook = (h) => (h ? { enabled: !!h.enabled, url: h.url, events: h.events || [], secret: h.secret, updatedAt: h.updatedAt || null } : { enabled: false, url: '', events: Object.keys(EVENTS), secret: null, updatedAt: null })

function routes(router, deps) {
  db = deps.db
  log = deps.log || console.log
  const { h } = deps
  const prefs = db.collection('webPrefs')
  const deliveries = db.collection('webhookDeliveries')
  deliveries.createIndex({ chatId: 1, at: -1 }).catch(() => {})
  deliveries.createIndex({ at: 1 }, { expireAfterSeconds: 14 * 86400 }).catch(() => {})
  const load = async (chatId) => (await prefs.findOne({ _id: chatId }, { projection: { webhook: 1 } }))?.webhook || null

  router.get('/webhooks', h(async (req, res) => {
    const recent = await deliveries.find({ chatId: req.webChatId }, { projection: { _id: 0, chatId: 0 } }).sort({ at: -1 }).limit(20).toArray()
    res.json({ webhook: publicHook(await load(req.webChatId)), events: Object.entries(EVENTS).map(([key, label]) => ({ key, label })), deliveries: recent })
  }))

  router.put('/webhooks', h(async (req, res) => {
    const url = String(req.body.url || '').trim()
    const events = [...new Set((Array.isArray(req.body.events) ? req.body.events : []).map(String))].filter(e => EVENTS[e])
    const enabled = !!req.body.enabled
    if (url && (!URL_RE.test(url) || !publicHost(url))) return bad(res, 400, 'invalid_url', 'Use a public web address that starts with https://')
    if (enabled && !url) return bad(res, 400, 'invalid_url', 'Paste the URL that should receive events, or switch the feed off.')
    if (enabled && !events.length) return bad(res, 400, 'no_events', 'Pick at least one event to send.')
    const cur = await load(req.webChatId)
    const webhook = { enabled, url, events, secret: cur?.secret || newSecret(), updatedAt: new Date() }
    await prefs.updateOne({ _id: req.webChatId }, { $set: { webhook } }, { upsert: true })
    cache.delete(req.webChatId)
    res.json({ webhook: publicHook(webhook) })
  }))

  router.post('/webhooks/secret', h(async (req, res) => {
    const cur = await load(req.webChatId)
    if (!cur) return bad(res, 400, 'no_webhook', 'Save a webhook URL first.')
    const webhook = { ...cur, secret: newSecret(), updatedAt: new Date() }
    await prefs.updateOne({ _id: req.webChatId }, { $set: { webhook } })
    cache.delete(req.webChatId)
    res.json({ webhook: publicHook(webhook) })
  }))

  router.post('/webhooks/test', h(async (req, res) => {
    const cur = await load(req.webChatId)
    if (!cur?.url) return bad(res, 400, 'no_webhook', 'Save a webhook URL first.')
    const type = EVENTS[req.body.type] ? String(req.body.type) : 'call.ended'
    const r = await deliver(req.webChatId, cur, type, SAMPLE[type], { test: true })
    res.json({ ok: r.ok, status: r.status, error: r.error, event: r.event })
  }))
}

module.exports = { routes, emit, emitForNumber, EVENTS, sign, publicHost }
