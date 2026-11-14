'use strict'
// Voice numbers on the new Telnyx account (TELNYX_FAX_API_KEY). Telnyx only sells the number and delivers its inbound
// calls by SIP trunk (FQDN connection, TLS + SRTP) to our own SIP server, where the call engine runs them.
// No Telnyx call control, no Telnyx SIP logins, no outbound calls (those stay on Bird).
const axios = require('axios')
const fa = require('./telnyx-fax-account')

const log = (...a) => console.log('[TelnyxSIP]', ...a)
const CONN_NAME = 'CloudIVR SIP server'
const host = () => process.env.TELNYX_SIP_TRUNK_HOST || 'sip-tls.cloudivr.net'
// Same Telnyx account as fax; brands without fax carry it as TELNYX_SIP_API_KEY.
const key = () => process.env.TELNYX_SIP_API_KEY || process.env.TELNYX_FAX_API_KEY
const enabled = () => !!key() && String(process.env.TELNYX_SIP_NUMBERS || 'true').toLowerCase() !== 'false'
const api = (method, path, { data, params } = {}) => axios({ method, url: fa.BASE + path, data, params, headers: { Authorization: `Bearer ${key()}` }, timeout: 30000 }).then(r => r.data)
const errOf = (e) => e.response?.data?.errors?.[0]?.detail || e.message
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const isTx = (id) => String(id || '').startsWith('tx:')
const searched = new Set()
const isTxSearched = (n) => searched.has(String(n || ''))

// The one SIP trunk every brand's numbers point at (found by name; created once by js/ops/telnyx_sip_setup_2026-11.js).
let connId = null
async function connection({ create = false } = {}) {
  if (connId) return connId
  const list = (await api('get', '/fqdn_connections', { params: { 'page[size]': 250 } }))?.data || []
  let c = list.find(x => x.connection_name === CONN_NAME)
  if (!c && create) {
    c = (await api('post', '/fqdn_connections', { data: { connection_name: CONN_NAME, active: true, transport_protocol: 'TLS', encrypted_media: 'SRTP', inbound: { ani_number_format: '+E.164', dnis_number_format: '+e164', codecs: ['G711U', 'G711A'], sip_region: 'US' } } })).data
    await api('post', '/fqdns', { data: { connection_id: c.id, fqdn: host(), port: 5061, dns_record_type: 'a' } })
    log(`created SIP trunk ${c.id} → ${host()}:5061 (TLS + SRTP)`)
  }
  if (!c) throw new Error(`Telnyx SIP trunk "${CONN_NAME}" not set up`)
  return (connId = c.id)
}

// Numbers on our trunk (5 min cache): e164 → Telnyx number id.
let owned = { at: 0, map: new Map() }
async function refreshOwned(force = false) {
  if (!enabled() || (!force && Date.now() - owned.at < 5 * 60000)) return owned.map
  try {
    const conn = await connection()
    const map = new Map()
    for (let page = 1; page < 20; page++) {
      const r = await api('get', '/phone_numbers', { params: { 'filter[connection_id]': conn, 'page[size]': 250, 'page[number]': page } })
      for (const n of r?.data || []) map.set(n.phone_number, n.id)
      if (!r?.meta || page >= (r.meta.total_pages || 1)) break
    }
    owned = { at: Date.now(), map }
  } catch (e) { log('list numbers:', errOf(e)) }
  return owned.map
}
const ownsNumber = (e164) => owned.map.has(String(e164 || ''))
const ownedNumbers = () => [...owned.map.keys()]

// Telnyx-shaped search rows. Local: area code, else the same state (region), else anywhere in the country.
async function searchNumbers(countryCode, numberType, areaCode, limit = 5, region = null) {
  const cc = String(countryCode || 'US').toUpperCase()
  if (!enabled() || !['US', 'CA'].includes(cc)) return []
  const tf = /toll/.test(String(numberType || ''))
  const run = async (extra) => {
    const params = { 'filter[country_code]': cc, 'filter[phone_number_type]': tf ? 'toll_free' : 'local', 'filter[features][]': 'voice', 'filter[limit]': limit, ...(tf ? { 'filter[quickship]': true } : {}), ...extra }
    try { return (await api('get', '/available_phone_numbers', { params }))?.data || [] } catch (e) { log('search:', errOf(e)); return [] }
  }
  let rows = await run(areaCode && !tf ? { 'filter[national_destination_code]': areaCode } : {})
  let fallback = null
  if (!rows.length && areaCode && !tf) {
    rows = region ? await run({ 'filter[administrative_area]': region }) : []
    fallback = rows.length ? region : ''
    if (!rows.length) rows = await run({})
  }
  return rows.map(n => {
    searched.add(n.phone_number)
    return {
      record_type: 'available_phone_number', phone_number: n.phone_number, features: [{ name: 'voice' }], region_information: n.region_information || [],
      cost_information: { currency: 'USD', monthly_cost: '0', upfront_cost: '0' }, _capabilities: { voice: true, sms: false, mms: false, fax: false }, _provider: 'telnyx', _telnyxSip: true,
      ...(fallback !== null ? { _areaFallback: true, _requestedAreaCode: String(areaCode), _fallbackRegion: fallback || null } : {}),
    }
  })
}

// → Telnyx-shaped order { id: 'tx:+1…', phone_numbers: [...] } once the number is live on our trunk, else null.
async function buyNumber(phoneNumber) {
  try {
    const conn = await connection({ create: true })
    let o = (await api('post', '/number_orders', { data: { phone_numbers: [{ phone_number: phoneNumber }], connection_id: conn, customer_reference: String(process.env.CHAT_BOT_BRAND || 'cloudivr').toLowerCase() } }))?.data
    searched.delete(phoneNumber)
    for (let i = 0; i < 15 && o?.status === 'pending'; i++) { await sleep(2000); o = (await api('get', `/number_orders/${o.id}`))?.data || o }
    if (o?.status !== 'success') { log(`buy ${phoneNumber}: order ${o?.id} is ${o?.status} (${o?.phone_numbers?.[0]?.requirements_status || ''})`); return null }
    await refreshOwned(true)
    log(`Bought ${phoneNumber} → SIP trunk ${conn}`)
    const id = `tx:${phoneNumber}`
    return { id, status: 'success', requirements_met: true, phone_numbers: [{ id, phone_number: phoneNumber, status: 'success', requirements_status: 'requirements-met' }], _provider: 'telnyx-sip' }
  } catch (e) { log(`buy ${phoneNumber}:`, errOf(e)); return null }
}

// true = released, false = not on our trunk. Never touches fax numbers (they sit on the Fax Application).
async function releaseByPhoneNumber(phoneNumber) {
  if (!enabled()) return false
  const conn = await connection()
  const n = (await api('get', '/phone_numbers', { params: { 'filter[phone_number]': phoneNumber, 'page[size]': 1 } }))?.data?.[0]
  if (!n || n.connection_id !== conn) return false
  await api('delete', `/phone_numbers/${n.id}`)
  owned.map.delete(phoneNumber)
  log(`Released ${phoneNumber}`)
  return true
}
const releaseNumber = (id) => releaseByPhoneNumber(String(id).slice(3))

module.exports = { enabled, isTx, isTxSearched, connection, refreshOwned, ownsNumber, ownedNumbers, searchNumbers, buyNumber, releaseNumber, releaseByPhoneNumber, CONN_NAME }
