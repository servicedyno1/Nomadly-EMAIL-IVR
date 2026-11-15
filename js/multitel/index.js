'use strict'
// MultiTEL numbers: search, buy (routed by SIP URI to our Asterisk → [from-multitel] → call engine), release, registration.
// Basic auth; never retried on 401/403 — MultiTEL blocks an address after repeated failed logins.
const axios = require('axios')
const qs = require('querystring')
const crypto = require('crypto')
// MultiTEL's firewall allow-lists our IPv4 addresses only: always connect over IPv4.
const ipv4 = new (require('https').Agent)({ family: 4, keepAlive: true })

const log = (...a) => console.log('[Multitel]', ...a)
const enabled = () => !!(process.env.MULTITEL_USERNAME && process.env.MULTITEL_PASSWORD)
// NUMBER_PROVIDERS (comma list: multitel, infobip) picks who sells NEW numbers; owned numbers keep working.
const selling = () => enabled() && String(process.env.NUMBER_PROVIDERS || 'multitel,infobip').toLowerCase().split(',').map(x => x.trim()).includes('multitel')
const sipTarget = () => `${process.env.SIP_SERVER_IP || '188.166.34.29'}:5080`
const digits = (n) => String(n || '').replace(/\D/g, '')
const e164 = (n) => `+${digits(n)}`
const isMt = (id) => String(id || '').startsWith('mt:')
const TYPES = { local: /^(local|geographic)$/i, toll_free: /^(toll-free|tollfree)$/i, mobile: /^mobile$/i, national: /^national$/i }

// The pause survives restarts (file), so a bad login or IP is tried at most once every 6 hours.
const BLOCK_FILE = require('path').join(require('os').tmpdir(), 'multitel-auth-block-v4')
const BLOCK_MS = 6 * 3600000
const isBlocked = () => { try { return Date.now() < Number(require('fs').readFileSync(BLOCK_FILE, 'utf8')) } catch { return false } }
// A 403 is usually MultiTEL's firewall having a moment (logins work again minutes later): pause 10 min, not 6 h.
const SHORT_BLOCK_MS = 10 * 60000
const block = (ms = BLOCK_MS) => { try { require('fs').writeFileSync(BLOCK_FILE, String(Date.now() + ms)) } catch {} }
async function api(method, path, form) {
  if (isBlocked()) throw new Error('MultiTEL login was rejected — check the API username/password and IP allow-list')
  const r = await axios({ method, url: `https://api.multitel.net/v3/${path}`, auth: { username: process.env.MULTITEL_USERNAME, password: process.env.MULTITEL_PASSWORD },
    httpsAgent: ipv4, headers: { Accept: 'application/json', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, data: form ? qs.stringify(form) : undefined, timeout: 60000, validateStatus: () => true })
  // A 403 about a product not being enabled (e.g. Messaging API) is not a bad login — don't pause everything.
  if (r.status === 403 && /NOT_APPROVED|not been approved/i.test(JSON.stringify(r.data || ''))) return r.data
  if (r.status === 401 || r.status === 403) { block(r.status === 401 ? BLOCK_MS : SHORT_BLOCK_MS); throw new Error(`MultiTEL auth refused (${r.status})`) }
  return r.data || {}
}
const ok = (d) => String(d?.status?.code) === '200'

// info.state arrives as an object or as text like '{state: NY, rate_center: ADAMS}' → 'NY'.
const stateOf = (v) => { if (v && typeof v === 'object') return String(v.state || ''); const t = String(v || ''); return t.startsWith('{') ? ((t.match(/state:\s*([^,}]+)/) || [])[1] || '').trim() : t }
const areaCache = new Map() // cc → { at, list }
async function areas(cc) {
  const c = areaCache.get(cc)
  if (c && Date.now() - c.at < 3600000) return c.list
  const d = await api('get', `getareas/${cc}`)
  const list = Array.isArray(d.response) ? d.response : []
  areaCache.set(cc, { at: Date.now(), list })
  return list
}

const searched = new Map() // e164 → { priceId, features, needsReg, monthly }
// Waiting orders keep the search details so the buy can run after a restart.
const searchedMeta = (n) => searched.get(n) || null
const remember = (n, meta) => { if (meta) searched.set(n, meta) }
const cheapest = (prices) => [...(prices || [])].sort((a, b) => (+a.channels - +b.channels) || (+a.monthly_price - +b.monthly_price))[0]
async function searchNumbers(countryCode, numberType = 'local', areaCode = null, limit = 5) {
  if (!selling()) return []
  if (!enabled()) return []
  const cc = String(countryCode || 'US').toUpperCase()
  // US/CA area code: search the cities in that area code's state and prefer prefixes that start with it.
  const state = areaCode && ['US', 'CA'].includes(cc) ? require('../signalwire/rest').AREA_REGION?.[Number(areaCode)] : null
  if (areaCode && ['US', 'CA'].includes(cc) && !state) return []
  const re = TYPES[numberType] || TYPES.local
  try {
    const pool = (await areas(cc)).filter(a => re.test(a.number_type || a.area_type || '') && +a.available > 0 && (!state || a.state_iso === state)).sort((a, b) => +b.available - +a.available).slice(0, 8)
    const out = []
    for (const a of pool.sort(() => Math.random() - 0.5).slice(0, 6)) {
      if (out.length >= limit) break
      const pre = (await api('get', `getprefixes/${a.uuid}`)).response
      const p = Array.isArray(pre) ? (state && pre.find(x => +x.available > 0 && String(x.prefix || x.name || '').replace(/\D/g, '').replace(/^1/, '').startsWith(String(areaCode)))) || pre.find(x => +x.available > 0) || pre[0] : null
      if (!p) continue
      // Order-only prefix (e.g. most of Germany): MultiTEL assigns the exact number at checkout — offer the city.
      if (String(p.returns_numbers) === '0') { if (!out.some(x => x.phone_number === e164(p.prefix))) { const hit = await assignedHit(p, a); if (hit) out.push(hit) } continue }
      const nums = (await api('get', `getnumbers/${p.uuid}/${Math.min(limit - out.length, 6)}`)).response
      for (const n of Array.isArray(nums) ? nums : []) {
        const price = cheapest(n.price); if (!price) continue
        const num = e164(n.number), f = [].concat(n.features || []).map(String)
        const sms = f.some(x => /sms/i.test(x)) || !!+a.sms_coverage
        searched.set(num, { priceId: price.uuid, features: f, needsReg: String(n.restrictions?.needs_registration) === '1', monthly: +price.monthly_price })
        out.push({ record_type: 'available_phone_number', phone_number: num, region_information: [{ region_type: 'location', region_name: [a.name, stateOf(n.info?.state)].filter(x => x && x !== a.name).join(', ') }],
          cost_information: { currency: 'USD', monthly_cost: String(price.monthly_price), upfront_cost: String(price.setup_price || 0) },
          _capabilities: { voice: true, sms, mms: false, fax: false }, _provider: 'multitel', _needsRegistration: String(n.restrictions?.needs_registration) === '1' })
      }
    }
    return out.filter(n => !require('../pending-orders').isHeld(n.phone_number)).slice(0, limit)
  } catch (e) { log(`search ${cc} ${numberType}: ${e.message}`); return [] }
}
// Placeholder result for an order-only prefix: phone_number is the bare prefix (e.g. +49241); buyNumber orders from it.
async function assignedHit(p, a) {
  const info = (await api('get', `getprefix/${p.uuid}`)).response
  const price = cheapest((info?.prices || []).map(x => ({ uuid: x.price_id, channels: x.channels, monthly_price: x.monthly_price, setup_price: x.setup_price })))
  if (!price) return null
  const num = e164(p.prefix), f = [].concat(info.features || []).map(String), needsReg = String(p.needs_registration) === '1'
  searched.set(num, { orderPrefix: p.uuid, priceId: price.uuid, channels: price.channels, features: f, needsReg, monthly: +price.monthly_price })
  return { record_type: 'available_phone_number', phone_number: num, _assigned: true, region_information: [{ region_type: 'location', region_name: p.name || a.name }],
    cost_information: { currency: 'USD', monthly_cost: String(price.monthly_price), upfront_cost: String(price.setup_price || 0) },
    _capabilities: { voice: true, sms: f.some(x => /sms/i.test(x)), mms: false, fax: false }, _provider: 'multitel', _needsRegistration: needsReg }
}
const isMtSearched = (n) => searched.has(String(n || ''))
const isAssigned = (n) => !!searched.get(String(n || ''))?.orderPrefix

// Inbound texts come back to /multitel/sms-webhook/<key>; the key is derived from our MultiTEL password.
const smsHookKey = () => crypto.createHash('sha256').update(`mt-sms:${process.env.MULTITEL_PASSWORD || ''}`).digest('hex').slice(0, 24)
const smsUri = () => (process.env.SELF_URL ? `${String(process.env.SELF_URL).replace(/\/+$/, '')}/multitel/sms-webhook/${smsHookKey()}` : '')

// Points the number at our SIP server (the called number is the request-URI user) and its texts at our webhook.
async function route(num) {
  const d = await api('post', `modifynumber/${digits(num)}`, { uri: `${digits(num)}@${sipTarget()}`, ringtype: '1', autorenew: '1', description: 'CloudIVR', ...(smsUri() ? { smsuri: smsUri() } : {}) })
  if (!ok(d)) throw new Error(d?.status?.msg || 'route failed')
}
async function buyNumber(phoneNumber) {
  if (!selling()) return null
  const s = searched.get(phoneNumber); if (!s) return null
  if (s.orderPrefix) return orderFromPrefix(phoneNumber, s)
  try {
    const d = await api('get', `rentnumber/${digits(phoneNumber)}/${s.priceId}`)
    if (!ok(d)) { log(`buy ${phoneNumber}: ${d?.status?.msg}`); return null }
    searched.delete(phoneNumber)
    await route(phoneNumber).catch(e => log(`route ${phoneNumber}: ${e.message}`))
    require('../callengine').setDidApps([phoneNumber]).catch(() => {})
    owned = [...new Set([...owned, phoneNumber])]
    log(`Bought ${phoneNumber} → sip ${sipTarget()}${s.needsReg ? ' (registration needed)' : ''}`)
    const id = `mt:${digits(phoneNumber)}`
    return { id, status: 'success', requirements_met: !s.needsReg, phone_numbers: [{ id, phone_number: phoneNumber, status: 'success' }], _provider: 'multitel', _needsRegistration: s.needsReg }
  } catch (e) { log(`buy ${phoneNumber}: ${e.message}`); return null }
}
// One number from an order-only prefix; MultiTEL picks it. Never retried here (a repeat can buy a second number).
async function orderFromPrefix(prefix, s) {
  try {
    const d = await api('post', `order/${s.orderPrefix}`, { quantity: '1', price_id: s.priceId, channels: String(s.channels ?? ''), reference: 'CloudIVR', uri: `${digits(prefix)}@${sipTarget()}` })
    const got = [].concat(d?.response?.numbers || [])[0]
    if (!ok(d) || !got) { log(`order ${prefix}: ${d?.status?.msg || 'no number returned'}${d?.response?.id ? ` (order ${d.response.id})` : ''}`); return null }
    searched.delete(prefix)
    const phoneNumber = e164(got)
    await route(phoneNumber).catch(e => log(`route ${phoneNumber}: ${e.message}`))
    require('../callengine').setDidApps([phoneNumber]).catch(() => {})
    owned = [...new Set([...owned, phoneNumber])]
    const needsReg = s.needsReg || String(d.response.needs_registration) === '1'
    log(`Ordered ${phoneNumber} from prefix ${prefix} → sip ${sipTarget()}${needsReg ? ' (registration needed)' : ''}`)
    const id = `mt:${digits(phoneNumber)}`
    return { id, status: 'success', requirements_met: !needsReg, phone_numbers: [{ id, phone_number: phoneNumber, status: 'success' }], _provider: 'multitel', _needsRegistration: needsReg, _retriedNumber: phoneNumber, _assigned: true }
  } catch (e) { log(`order ${prefix}: ${e.message}`); return null }
}
async function releaseNumber(id) {
  try { const d = await api('get', `release/${digits(String(id).replace(/^mt:/, ''))}`); return ok(d) } catch (e) { log(`release ${id}: ${e.message}`); return false }
}

let owned = []
async function refreshOwned() {
  if (!enabled()) return owned
  try { const d = await api('get', 'inventory'); owned = Array.isArray(d.response) ? d.response.map(n => e164(n.number)) : (String(d?.status?.code) === '404' ? [] : owned) } catch (e) { log(`inventory: ${e.message}`) }
  return owned
}
const ownedNumbers = () => owned

// 'active' | 'rejected' | 'pending' (raw text kept for the log)
async function registrationStatus(num) {
  const d = await api('get', `registration_status/${digits(num)}`)
  const txt = JSON.stringify(d.response || d.status || '').toLowerCase()
  if (/reject|denied|declin|fail/.test(txt)) return { state: 'rejected', raw: txt.slice(0, 200) }
  if (/approv|active|verified|complete|registered/.test(txt) && !/pending|review|await/.test(txt)) return { state: 'active', raw: txt.slice(0, 200) }
  return { state: 'pending', raw: txt.slice(0, 200) }
}

// Texts → { id } | { error }
async function sendSms(from, to, text) {
  try {
    const d = await api('post', 'sendsms', { from: digits(from), to: digits(to), text })
    return ok(d) ? { id: d.response?.uuid || d.response?.id || null } : { error: d?.status?.msg || 'MultiTEL refused the text' }
  } catch (e) { return { error: e.message } }
}
const ownsNumber = (n) => owned.includes(n)

module.exports = { ipv4, isBlocked, api, enabled, selling, searchedMeta, remember, sendSms, ownsNumber, smsHookKey, isMt, searchNumbers, isMtSearched, isAssigned, buyNumber, releaseNumber, refreshOwned, ownedNumbers, registrationStatus, route }
