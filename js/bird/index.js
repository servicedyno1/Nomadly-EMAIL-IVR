'use strict'
// Bird (bird.com) adapter: phone lines into our own call engine (SIP trunk ↔ Asterisk), number lookup,
// number search/buy/release and caller-ID verification. Region host follows the key prefix (bk_us1_ / bk_eu1_).
const crypto = require('crypto')
const axios = require('axios')

const log = (...a) => console.log('[Bird]', ...a)
const key = () => process.env.BIRD_API_KEY || ''
const enabled = () => !!key() && String(process.env.BIRD_ENABLED || 'true').toLowerCase() !== 'false'
const host = () => `https://${(key().match(/^bk_([a-z]+\d+)_/) || [])[1] || 'us1'}.platform.bird.com`
const makeHttp = () => axios.create({ baseURL: `${host()}/v1`, headers: { Authorization: `Bearer ${key()}` }, timeout: 20000 })
const errOf = (e) => { const x = e.response?.data?.error; return x ? `${x.code || e.response.status} ${x.message}` : e.message }
const isBird = (id) => String(id || '').startsWith('bd:')
const raw = (id) => String(id).slice(3)
const e164 = (n) => { const d = String(n || '').replace(/[^\d]/g, ''); return d ? `+${d}` : '' }
const trunkName = () => process.env.BIRD_TRUNK_NAME || 'cloudivr-callengine'
const sipServerIp = () => process.env.SIP_SERVER_IP || '188.166.34.29'

const req = async (method, url, data, headers) => (await M.http().request({ method, url, data, headers })).data
// Pages via next_cursor; some lists (verified-numbers) take it as `starting_after` and reject `cursor` (E01029).
const all = async (url) => {
  const out = []; let cursor = null, param = 'cursor'
  do {
    const page = (p) => req('get', `${url}${cursor ? `${url.includes('?') ? '&' : '?'}${p}=${encodeURIComponent(cursor)}` : ''}`)
    const d = await page(param).catch(e => { if (cursor && e.response?.data?.error?.code === 'E01029' && param === 'cursor') { param = 'starting_after'; return page(param) } throw e })
    out.push(...(d.data || [])); cursor = d.next_cursor
  } while (cursor && out.length < 5000)
  return out
}

// ── Lookup → { valid, type, carrier, country } | null when unavailable ──
const LINE = { mobile: 'mobile', fixed_line: 'landline', voip: 'voip', toll_free: 'toll_free' }
async function lookup(number) {
  if (!enabled()) return null
  const n = e164(number)
  try {
    const r = await req('post', '/lookup/phone-number', { phone_number: n }, { 'Idempotency-Key': `lk-${n}-${new Date().toISOString().slice(0, 10)}` })
    return { valid: r.line_type !== 'unknown' || !!r.network_info?.carrier_name, country: r.country_code || 'unknown', carrier: r.network_info?.carrier_name || 'unknown', type: LINE[r.line_type] || r.line_type || 'unknown', ported: (r.flags || []).includes('ported'), _provider: 'bird' }
  } catch (e) {
    if (e.response?.data?.error?.code === 'E22000') return { valid: false, country: 'unknown', carrier: 'unknown', type: 'invalid', _provider: 'bird' }
    log('lookup:', errOf(e)); return null
  }
}

// ── Email lookup → { result, valid, confidence, flags } | null when unavailable ──
async function lookupEmail(email) {
  if (!enabled()) return null
  try {
    const r = await req('post', '/lookup/email', { email }, { 'Idempotency-Key': `le-${email}-${new Date().toISOString().slice(0, 10)}` })
    return { result: r.result || 'unknown', valid: !!r.valid, confidence: Number(r.delivery_confidence) || 0, flags: r.flags || [] }
  } catch (e) { log('lookupEmail:', errOf(e)); return null }
}

// ── Numbers ──
const searched = new Map() // e164 → search row
async function searchNumbers(countryCode, numberType, areaCode, limit = 5, { allowPaperwork = false } = {}) {
  if (!enabled()) return []
  try {
    const q = new URLSearchParams({ country_code: String(countryCode || 'US').toUpperCase(), limit: String(Math.min(100, Math.max(limit, 20))) })
    if (numberType) q.set('number_type', numberType === 'tollfree' ? 'toll_free' : numberType)
    if (areaCode) q.set('prefix', String(areaCode))
    q.append('capabilities', 'voice')
    const rows = ((await req('get', `/numbers/available?${q}`)).data || []).filter(r => r.pricing?.recurring_price && (allowPaperwork || !r.ownership_registration_required)).slice(0, limit)
    return rows.map(r => {
      searched.set(r.number, r)
      const caps = r.capabilities || []
      return { record_type: 'available_phone_number', phone_number: r.number, features: caps.map(c => ({ name: c })), region_information: [{ region_type: 'country_code', region_name: r.country_code }],
        cost_information: { currency: r.pricing.recurring_price.currency_code, monthly_cost: String(r.pricing.recurring_price.amount), upfront_cost: String(r.pricing.setup_price?.amount || 0) },
        _capabilities: { voice: caps.includes('voice'), sms: caps.includes('sms'), mms: false, fax: false }, _paperwork: !!r.ownership_registration_required, _provider: 'bird' }
    })
  } catch (e) { log('search:', errOf(e)); return [] }
}
const isBirdSearched = (n) => searched.has(String(n || ''))

async function waitOrder(order) {
  for (let i = 0; i < 20 && !['completed', 'failed'].includes(order.status); i++) { await new Promise(r => setTimeout(r, 3000)); order = await req('get', `/numbers/orders/${order.id}`) }
  return order
}
async function buyNumber(phoneNumber) {
  if (!enabled()) return null
  try {
    let order = await req('post', '/numbers/orders', { number: phoneNumber }, { 'Idempotency-Key': `buy-${phoneNumber}` })
    order = await waitOrder(order)
    if (order.status !== 'completed') { log(`buy ${phoneNumber}: ${order.status} ${order.failure_reason || ''}`); return null }
    searched.delete(phoneNumber)
    await routeToTrunk(phoneNumber).catch(e => log(`route ${phoneNumber}: ${errOf(e)}`))
    const n = await req('get', `/numbers/${order.number_id}`).catch(() => ({}))
    const ready = n.status === 'active'
    log(`Bought ${phoneNumber} (${order.number_id}) status ${n.status || '?'}`)
    return { id: `bd:${order.number_id}`, status: 'success', requirements_met: ready, phone_numbers: [{ id: `bd:${order.number_id}`, phone_number: phoneNumber, status: ready ? 'success' : 'pending', requirements_status: ready ? 'requirements-met' : 'requirements-pending' }], _provider: 'bird' }
  } catch (e) { log(`buy ${phoneNumber}:`, errOf(e)); return null }
}
async function releaseNumber(id) { try { await req('post', `/numbers/${raw(id)}/release`); return true } catch (e) { log('release:', errOf(e)); return false } }
const listNumbers = async () => (enabled() ? all('/numbers').catch(e => { log('list:', errOf(e)); return [] }) : [])
const numberStatus = async (number) => (await listNumbers()).find(n => n.number === e164(number) || n.phone_number === e164(number)) || null

// ── SIP trunk (Bird ↔ Asterisk on the SIP server) ──
let trunkCache = null
async function getTrunk() {
  if (trunkCache) return trunkCache
  trunkCache = (await all('/voice/trunks')).find(t => t.name === trunkName()) || null
  return trunkCache
}
async function ensureTrunk() {
  let t = await getTrunk()
  if (!t) t = await req('post', '/voice/trunks', { name: trunkName(), inbound_enabled: true, outbound_enabled: true, digest_algorithms: ['SHA-256', 'MD5'] })
  const cidr = `${sipServerIp()}/32`
  if (!t.inbound_enabled || !t.outbound_enabled || !(t.ip_acls || []).some(a => a.cidr === cidr)) {
    t = await req('patch', `/voice/trunks/${t.id}`, { inbound_enabled: true, outbound_enabled: true, ip_acls: [{ cidr, description: 'CloudIVR SIP server' }] })
  }
  const gw = `sip:${sipServerIp()}:5080`
  const gws = await all(`/voice/trunks/${t.id}/gateways`)
  if (!gws.some(g => g.sip_uri === gw)) await req('post', `/voice/trunks/${t.id}/gateways`, { sip_uri: gw, priority: 0 })
  await req('patch', '/voice/settings', { inbound_configuration: { route: { type: 'trunk', trunk_id: t.id } } })
  trunkCache = t
  return t
}
async function routeToTrunk(phoneNumber) {
  const t = await ensureTrunk()
  const vn = (await all('/voice/numbers')).find(n => n.phone_number === e164(phoneNumber))
  if (vn) await req('patch', `/voice/numbers/${vn.id}`, { inbound_configuration: { route: { type: 'trunk', trunk_id: t.id } } })
  return !!vn
}
const enableDestinations = (codes) => req('patch', '/voice/destinations', { destinations: codes.map(c => ({ country_code: c, enabled: true })) })
const listDestinations = () => all('/voice/destinations')

// ── Caller IDs (customer's own numbers shown on outbound calls) ──
const listCallerIds = () => all('/voice/verified-numbers')
const deleteCallerId = (id) => req('delete', `/voice/verified-numbers/${id}`).then(() => true, () => false)
async function startCallerIdVerification(number, name) {
  try { const r = await req('post', '/voice/verified-numbers', { phone_number: e164(number), ...(name ? { name } : {}) }, { 'Idempotency-Key': `cid-${e164(number)}-${crypto.randomUUID()}` }); return { id: r.id, status: r.status } }
  catch (e) { return { error: errOf(e), status: e.response?.status } }
}
async function submitCallerIdCode(id, code) {
  try { const r = await req('post', `/voice/verified-numbers/${id}/verify`, code ? { code: String(code) } : {}); return { id: r.id, status: r.status, outbound_enabled: r.outbound_enabled } }
  catch (e) { return { error: errOf(e), status: e.response?.status } }
}
async function canPresent(number) {
  const n = e164(number)
  const [owned, cids] = await Promise.all([listNumbers(), listCallerIds().catch(() => [])])
  return owned.some(x => (x.number || x.phone_number) === n && x.status === 'active') || cids.some(c => c.phone_number === n && c.status === 'verified' && c.outbound_enabled)
}

// Cached readiness for the dialer: caller IDs Bird will present (5 min) and today's spend left (2 min).
const cache = { cids: null, cidsAt: 0, spend: null, spendAt: 0 }
async function presentable(number) {
  if (!cache.cids || Date.now() - cache.cidsAt > 5 * 60000) {
    try {
      const [owned, cids] = await Promise.all([listNumbers(), listCallerIds()])
      cache.cids = new Set([...owned.filter(x => x.status === 'active').map(x => x.number || x.phone_number), ...cids.filter(c => c.outbound_enabled).map(c => c.phone_number)])
      cache.cidsAt = Date.now()
    } catch (e) { log('caller IDs:', errOf(e)); if (!cache.cids) return false }
  }
  return cache.cids.has(e164(number))
}
async function spendLeft() {
  if (cache.spend === null || Date.now() - cache.spendAt > 2 * 60000) {
    try { cache.spend = Number((await req('get', '/voice/settings')).daily_spend_limit?.remaining?.amount ?? 0); cache.spendAt = Date.now() } catch (e) { log('spend:', errOf(e)); return cache.spend ?? 0 }
  }
  return cache.spend
}
const forgetCallerIds = () => { cache.cids = null }

const rawLookup = (n) => req('post', '/lookup/phone-number', { phone_number: e164(n) })
const M = module.exports = {
  rawLookup,
  enabled, isBird, host, http: makeHttp, errOf, trunkName,
  lookup, lookupEmail, searchNumbers, isBirdSearched, buyNumber, releaseNumber, listNumbers, numberStatus,
  getTrunk, ensureTrunk, routeToTrunk, enableDestinations, listDestinations,
  listCallerIds, deleteCallerId, startCallerIdVerification, submitCallerIdCode, canPresent, presentable, spendLeft, forgetCallerIds,
}
