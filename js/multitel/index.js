'use strict'
// MultiTEL numbers: search, buy (routed by SIP URI to our Asterisk → [from-multitel] → call engine), release, registration.
// Basic auth; never retried on 401/403 — MultiTEL blocks an address after repeated failed logins.
const axios = require('axios')
const qs = require('querystring')
const crypto = require('crypto')

const log = (...a) => console.log('[Multitel]', ...a)
const enabled = () => !!(process.env.MULTITEL_USERNAME && process.env.MULTITEL_PASSWORD)
const sipTarget = () => `${process.env.SIP_SERVER_IP || '188.166.34.29'}:5080`
const digits = (n) => String(n || '').replace(/\D/g, '')
const e164 = (n) => `+${digits(n)}`
const isMt = (id) => String(id || '').startsWith('mt:')
const TYPES = { local: /^(local|geographic)$/i, toll_free: /^(toll-free|tollfree)$/i, mobile: /^mobile$/i, national: /^national$/i }

let blocked = false
async function api(method, path, form) {
  if (blocked) throw new Error('MultiTEL login was rejected — check the API username/password and IP allow-list')
  const r = await axios({ method, url: `https://api.multitel.net/v3/${path}`, auth: { username: process.env.MULTITEL_USERNAME, password: process.env.MULTITEL_PASSWORD },
    headers: { Accept: 'application/json', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, data: form ? qs.stringify(form) : undefined, timeout: 60000, validateStatus: () => true })
  if (r.status === 401 || r.status === 403) { blocked = true; setTimeout(() => { blocked = false }, 30 * 60000).unref?.(); throw new Error(`MultiTEL auth refused (${r.status})`) }
  return r.data || {}
}
const ok = (d) => String(d?.status?.code) === '200'

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
const cheapest = (prices) => [...(prices || [])].sort((a, b) => (+a.channels - +b.channels) || (+a.monthly_price - +b.monthly_price))[0]
async function searchNumbers(countryCode, numberType = 'local', areaCode = null, limit = 5) {
  if (!enabled()) return []
  const cc = String(countryCode || 'US').toUpperCase()
  if (areaCode && ['US', 'CA'].includes(cc)) return [] // area codes are searched on the other providers
  const re = TYPES[numberType] || TYPES.local
  try {
    const pool = (await areas(cc)).filter(a => re.test(a.number_type || a.area_type || '') && +a.available > 0).sort((a, b) => +b.available - +a.available).slice(0, 8)
    const out = []
    for (const a of pool.sort(() => Math.random() - 0.5).slice(0, 3)) {
      if (out.length >= limit) break
      const pre = (await api('get', `getprefixes/${a.uuid}`)).response
      const p = Array.isArray(pre) ? pre.find(x => +x.available > 0) || pre[0] : null
      if (!p) continue
      const nums = (await api('get', `getnumbers/${p.uuid}/${Math.min(limit - out.length, 6)}`)).response
      for (const n of Array.isArray(nums) ? nums : []) {
        const price = cheapest(n.price); if (!price) continue
        const num = e164(n.number), f = [].concat(n.features || []).map(String)
        const sms = f.some(x => /sms/i.test(x)) || !!+a.sms_coverage
        searched.set(num, { priceId: price.uuid, features: f, needsReg: String(n.restrictions?.needs_registration) === '1', monthly: +price.monthly_price })
        out.push({ record_type: 'available_phone_number', phone_number: num, region_information: [{ region_type: 'location', region_name: [a.name, n.info?.state].filter(Boolean).join(', ') }],
          cost_information: { currency: 'USD', monthly_cost: String(price.monthly_price), upfront_cost: String(price.setup_price || 0) },
          _capabilities: { voice: true, sms, mms: false, fax: false }, _provider: 'multitel', _needsRegistration: String(n.restrictions?.needs_registration) === '1' })
      }
    }
    return out.slice(0, limit)
  } catch (e) { log(`search ${cc} ${numberType}: ${e.message}`); return [] }
}
const isMtSearched = (n) => searched.has(String(n || ''))

// Inbound texts come back to /multitel/sms-webhook/<key>; the key is derived from our MultiTEL password.
const smsHookKey = () => crypto.createHash('sha256').update(`mt-sms:${process.env.MULTITEL_PASSWORD || ''}`).digest('hex').slice(0, 24)
const smsUri = () => (process.env.SELF_URL ? `${String(process.env.SELF_URL).replace(/\/+$/, '')}/multitel/sms-webhook/${smsHookKey()}` : '')

// Points the number at our SIP server (the called number is the request-URI user) and its texts at our webhook.
async function route(num) {
  const d = await api('post', `modifynumber/${digits(num)}`, { uri: `${digits(num)}@${sipTarget()}`, ringtype: '1', autorenew: '1', description: 'CloudIVR', ...(smsUri() ? { smsuri: smsUri() } : {}) })
  if (!ok(d)) throw new Error(d?.status?.msg || 'route failed')
}
async function buyNumber(phoneNumber) {
  const s = searched.get(phoneNumber); if (!s) return null
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

module.exports = { enabled, sendSms, ownsNumber, smsHookKey, isMt, searchNumbers, isMtSearched, buyNumber, releaseNumber, refreshOwned, ownedNumbers, registrationStatus, route }
