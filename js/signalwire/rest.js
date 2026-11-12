'use strict'
// SignalWire REST: numbers, number lookup, SIP endpoints and texts. Shapes mirror telnyx-service so callers need no changes.
const axios = require('axios')

const log = (...a) => console.log('[SignalWire]', ...a)
const host = () => String(process.env.SIGNALWIRE_SPACE_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
const enabled = () => !!(process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN && host()) && String(process.env.SIGNALWIRE_ENABLED || 'true').toLowerCase() !== 'false'
const http = () => axios.create({ baseURL: `https://${host()}`, auth: { username: process.env.SIGNALWIRE_PROJECT_ID, password: process.env.SIGNALWIRE_API_TOKEN }, timeout: 15000 })
const errOf = (e) => {
  const d = e.response?.data
  const x = d?.errors?.[0]
  return String(x?.detail || x?.message || d?.message || (d && typeof d === 'object' ? JSON.stringify(d) : d) || e.message)
}

// One RELAY topic per bot brand; preview gets its own so it never takes production calls.
const brandSlug = () => String(process.env.CHAT_BOT_BRAND || 'nomadly').toLowerCase().replace(/[^a-z0-9]/g, '') || 'nomadly'
const topic = () => process.env.SIGNALWIRE_TOPIC || `${brandSlug()}${process.env.BOT_ENVIRONMENT === 'production' ? '' : '-dev'}`
const selfUrl = () => String(process.env.SELF_URL || '').replace(/\/+$/, '')
const smsWebhook = () => `${selfUrl()}/signalwire/sms-webhook`

let _sipDomain = null
async function sipDomain() {
  if (process.env.SIGNALWIRE_SIP_DOMAIN) return process.env.SIGNALWIRE_SIP_DOMAIN
  if (_sipDomain) return _sipDomain
  try { _sipDomain = (await http().get('/api/relay/rest/sip_profile')).data?.domain || null } catch (e) { log('sip_profile:', errOf(e)) }
  return _sipDomain
}

// ── Numbers ──
const searched = new Set() // numbers last offered from SignalWire search → buyNumber knows which provider to order from
const owned = new Map() // e164 → SignalWire phone number id
let ownedAt = 0

async function refreshOwned(force = false) {
  if (!enabled()) return owned
  if (!force && Date.now() - ownedAt < 5 * 60000 && ownedAt) return owned
  try {
    let url = '/api/relay/rest/phone_numbers?page_size=1000'
    const next = new Map()
    while (url) {
      const r = (await http().get(url)).data
      for (const n of r.data || []) next.set(n.number, n.id)
      url = r.links?.next ? String(r.links.next).replace(/^https?:\/\/[^/]+/, '') : null
    }
    owned.clear(); for (const [k, v] of next) owned.set(k, v)
    ownedAt = Date.now()
  } catch (e) { log('list numbers:', errOf(e)) }
  return owned
}
const ownsNumber = (e164) => owned.has(String(e164 || ''))
const isSwSearched = (e164) => searched.has(String(e164 || ''))

// US area code → state / CA area code → province, so an out-of-stock area code falls back to in-state numbers.
const AREA_REGION = { 212: 'NY', 315: 'NY', 347: 'NY', 516: 'NY', 518: 'NY', 585: 'NY', 607: 'NY', 631: 'NY', 646: 'NY', 716: 'NY', 718: 'NY', 845: 'NY', 914: 'NY', 917: 'NY', 305: 'FL', 321: 'FL', 352: 'FL', 386: 'FL', 407: 'FL', 561: 'FL', 727: 'FL', 754: 'FL', 772: 'FL', 786: 'FL', 813: 'FL', 850: 'FL', 863: 'FL', 904: 'FL', 941: 'FL', 954: 'FL', 310: 'CA', 213: 'CA', 323: 'CA', 408: 'CA', 415: 'CA', 510: 'CA', 530: 'CA', 559: 'CA', 562: 'CA', 619: 'CA', 626: 'CA', 650: 'CA', 657: 'CA', 707: 'CA', 714: 'CA', 760: 'CA', 805: 'CA', 818: 'CA', 858: 'CA', 909: 'CA', 916: 'CA', 925: 'CA', 949: 'CA', 951: 'CA', 312: 'IL', 773: 'IL', 847: 'IL', 630: 'IL', 708: 'IL', 713: 'TX', 214: 'TX', 281: 'TX', 469: 'TX', 512: 'TX', 682: 'TX', 713: 'TX', 737: 'TX', 817: 'TX', 832: 'TX', 972: 'TX', 206: 'WA', 253: 'WA', 360: 'WA', 425: 'WA', 509: 'WA', 202: 'DC', 404: 'GA', 678: 'GA', 770: 'GA', 617: 'MA', 857: 'MA', 781: 'MA', 215: 'PA', 267: 'PA', 412: 'PA', 702: 'NV', 725: 'NV', 303: 'CO', 720: 'CO', 602: 'AZ', 480: 'AZ', 623: 'AZ', 503: 'OR', 971: 'OR', 615: 'TN', 901: 'TN', 313: 'MI', 248: 'MI', 216: 'OH', 614: 'OH', 513: 'OH', 704: 'NC', 919: 'NC', 980: 'NC', 980: 'NC', 201: 'NJ', 551: 'NJ', 609: 'NJ', 732: 'NJ', 862: 'NJ', 973: 'NJ', 416: 'ON', 647: 'ON', 437: 'ON', 613: 'ON', 905: 'ON', 289: 'ON', 604: 'BC', 778: 'BC', 236: 'BC', 514: 'QC', 438: 'QC', 403: 'AB', 587: 'AB', 780: 'AB', 825: 'AB' }

async function searchNumbers(countryCode, numberType, areaCode, limit = 5) {
  const cc = String(countryCode || 'US').toUpperCase()
  if (!enabled() || !['US', 'CA'].includes(cc)) return []
  const type = numberType === 'toll_free' || numberType === 'toll-free' ? 'toll-free' : 'local'
  const run = async (extra) => {
    try {
      const list = (await http().get('/api/relay/rest/phone_numbers/search', { params: { max_results: limit, number_type: type, ...extra } })).data?.data || []
      return list.filter(n => (type === 'toll-free' || n.country_code === cc || !n.country_code) && !owned.has(n.e164)).map(n => {
        const caps = [...new Set([...(n.capabilities || []), 'sms', 'mms'])]
        searched.add(n.e164)
        return { record_type: 'available_phone_number', phone_number: n.e164, features: caps.map(name => ({ name })),
          region_information: [...(n.region ? [{ region_type: 'state', region_name: n.region }] : []), ...(n.rate_center ? [{ region_type: 'rate_center', region_name: n.rate_center }] : []), { region_type: 'country_code', region_name: n.country_code || 'US' }],
          cost_information: { currency: 'USD', monthly_cost: '0', upfront_cost: '0' },
          _capabilities: { voice: caps.includes('voice'), sms: caps.includes('sms'), mms: caps.includes('mms'), fax: caps.includes('fax') }, _provider: 'signalwire', _signalwire: true }
      }).filter(n => n._capabilities.voice)
    } catch (e) { log('search:', errOf(e)); return [] }
  }
  // A plain search returns US numbers only, so Canada is searched province by province.
  const anyIn = async () => {
    if (cc !== 'CA' || type === 'toll-free') return run({})
    for (const region of ['ON', 'QC', 'BC', 'AB']) { const r = await run({ region }); if (r.length) return r }
    return []
  }
  // Exact area code first; if empty, offer other numbers in the same state; finally any available US/CA number.
  if (areaCode) {
    const exact = await run({ areacode: areaCode })
    if (exact.length) return exact
    const region = AREA_REGION[Number(areaCode)]
    const inState = region ? await run({ region }) : []
    const rows = inState.length ? inState : await anyIn()
    rows.forEach(r => { r._areaFallback = true; r._requestedAreaCode = String(areaCode); r._fallbackRegion = inState.length ? region : null })
    return rows
  }
  return anyIn()
}

const handlerBody = () => ({
  call_handler: 'relay_topic', call_relay_topic: topic(),
  message_handler: 'laml_webhooks', message_request_url: smsWebhook(), message_request_method: 'POST',
})

async function configureNumber(id) {
  try { await http().put(`/api/relay/rest/phone_numbers/${id}`, handlerBody()); return true } catch (e) { log('configure number:', errOf(e)); return false }
}

// → Telnyx-shaped number order, or null
async function buyNumber(phoneNumber) {
  try {
    const n = (await http().post('/api/relay/rest/phone_numbers', { number: phoneNumber })).data
    searched.delete(phoneNumber)
    owned.set(n.number || phoneNumber, n.id)
    await configureNumber(n.id)
    log(`Bought ${phoneNumber} (${n.id}) → topic ${topic()}`)
    return { id: 'sw:' + n.id, status: 'success', requirements_met: true, phone_numbers: [{ id: 'sw:' + n.id, phone_number: n.number || phoneNumber, status: 'success', requirements_status: 'requirements-met' }], _provider: 'signalwire' }
  } catch (e) { log(`buy ${phoneNumber}:`, errOf(e)); return null }
}

async function assignNumber(phoneNumber) {
  await refreshOwned()
  const id = owned.get(phoneNumber)
  return id ? configureNumber(id) : false
}

async function releaseById(id) {
  const raw = String(id || '').replace(/^sw:/, '')
  try {
    await http().delete(`/api/relay/rest/phone_numbers/${raw}`)
    for (const [k, v] of owned) if (v === raw) owned.delete(k)
    return true
  } catch (e) { log('release:', errOf(e)); return false }
}

async function releaseByPhoneNumber(phoneNumber) {
  await refreshOwned()
  const id = owned.get(phoneNumber)
  return id ? releaseById(id) : null
}

async function listNumbers() {
  await refreshOwned(true)
  return [...owned].map(([phone_number, id]) => ({ id: 'sw:' + id, phone_number, status: 'active', _provider: 'signalwire' }))
}

// ── Number lookup: { valid, country, carrier, type: 'mobile'|'fixed line'|'voip'|'unknown' } or null when unreachable ──
const LINE = { wireless: 'mobile', mobile: 'mobile', landline: 'fixed line', voip: 'voip', 'non-fixed voip': 'voip', 'fixed voip': 'voip', tollfree: 'toll free', 'toll-free': 'toll free' }
async function lookup(e164) {
  if (!enabled()) return null
  try {
    const d = (await http().get(`/api/relay/rest/lookup/phone_number/${encodeURIComponent(e164)}`, { params: { include: 'carrier' } })).data || {}
    const lt = String(d.carrier?.linetype || d.carrier?.line_type || '').toLowerCase()
    return { valid: d.valid_number !== false, country: d.country_code || 'unknown', carrier: String(d.carrier?.lec || d.carrier?.name || 'unknown').replace(/\s+/g, ' ').trim(), type: LINE[lt] || (lt || 'unknown') }
  } catch (e) {
    if (e.response?.status === 404 || e.response?.status === 422) return { valid: false, reason: 'Number not found or invalid format' }
    log(`lookup ${e164}:`, errOf(e))
    return null
  }
}

// ── SIP endpoints (one per number, like Telnyx credentials) ──
const sipUsers = new Set()
async function loadSipUsers() {
  if (!enabled()) return
  try {
    let url = '/api/relay/rest/endpoints/sip?page_size=1000'
    while (url) {
      const r = (await http().get(url)).data
      for (const s of r.data || []) sipUsers.add(s.username)
      url = r.links?.next ? String(r.links.next).replace(/^https?:\/\/[^/]+/, '') : null
    }
  } catch (e) { log('list sip:', errOf(e)) }
}
const isSipUser = (u) => sipUsers.has(String(u || ''))

async function createSipEndpoint(username, password, phoneNumber) {
  try {
    const s = (await http().post('/api/relay/rest/endpoints/sip', {
      username, password, ...(phoneNumber ? { send_as: phoneNumber, caller_id: phoneNumber } : {}),
      encryption: 'optional', codecs: ['PCMU', 'PCMA', 'OPUS', 'G722'],
      call_handler: 'relay_topic', call_relay_topic: topic(),
    })).data
    sipUsers.add(s.username || username)
    return { id: 'sw:' + s.id, sip_username: s.username || username, sip_password: password, kind: 'signalwire', sip_domain: await sipDomain() }
  } catch (e) { log(`create sip ${username}:`, errOf(e)); return null }
}

async function deleteSipEndpoint(id) {
  try {
    const raw = String(id || '').replace(/^sw:/, '')
    const s = (await http().get(`/api/relay/rest/endpoints/sip/${raw}`).catch(() => ({ data: null }))).data
    await http().delete(`/api/relay/rest/endpoints/sip/${raw}`)
    if (s?.username) sipUsers.delete(s.username)
    return true
  } catch (e) { log('delete sip:', errOf(e)); return false }
}

// ── Texts (compatibility API) → { id } | { error, code } ──
async function sendSms(from, to, text, mediaUrls = []) {
  const form = new URLSearchParams({ From: from, To: to })
  if (text) form.append('Body', text)
  for (const m of mediaUrls) form.append('MediaUrl', m)
  if (selfUrl()) form.append('StatusCallback', `${selfUrl()}/signalwire/sms-status`)
  try {
    const r = (await http().post(`/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Messages.json`, form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).data
    return { id: r.sid || null }
  } catch (e) {
    return { error: errOf(e), code: e.response?.data?.code || null, status: e.response?.status || null }
  }
}

// Inbound text webhook (LaML form) → Telnyx message.received shape for handleInboundSms
function inboundToTelnyx(b = {}) {
  const media = []
  for (let i = 0; i < Number(b.NumMedia || 0); i++) if (b[`MediaUrl${i}`]) media.push({ url: b[`MediaUrl${i}`], content_type: b[`MediaContentType${i}`] || null })
  return { data: { event_type: 'message.received', id: b.MessageSid, payload: { id: b.MessageSid, from: { phone_number: b.From }, to: [{ phone_number: b.To }], text: b.Body || '', media, direction: 'inbound', _provider: 'signalwire' } } }
}

// LaML webhook signature (X-SignalWire-Signature / X-Twilio-Signature: HMAC-SHA1 of url + sorted params, base64)
function validSignature(req) {
  const key = process.env.SIGNALWIRE_SIGNING_KEY
  if (!key) return true
  const sig = req.get('X-SignalWire-Signature') || req.get('X-Twilio-Signature')
  if (!sig) return false
  const crypto = require('crypto')
  const url = `${selfUrl().replace(/\/api$/, '')}${req.originalUrl}`
  const candidates = [url, `${selfUrl()}${req.path}`, `${selfUrl()}${req.originalUrl.replace(/^\/api/, '')}`]
  const params = req.body && typeof req.body === 'object' ? Object.keys(req.body).sort().map(k => k + req.body[k]).join('') : ''
  return candidates.some(u => crypto.createHmac('sha1', key).update(u + params).digest('base64') === sig)
}

module.exports = {
  enabled, host, topic, brandSlug, sipDomain, http, errOf,
  searchNumbers, buyNumber, assignNumber, releaseById, releaseByPhoneNumber, listNumbers, refreshOwned, ownsNumber, isSwSearched, configureNumber,
  lookup, loadSipUsers, isSipUser, createSipEndpoint, deleteSipEndpoint,
  sendSms, inboundToTelnyx, validSignature,
}
