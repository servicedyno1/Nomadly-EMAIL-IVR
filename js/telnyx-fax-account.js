'use strict'
// The new Telnyx account (TELNYX_FAX_API_KEY): fax numbers, fax send/receive, number lookup and Landline to Texting. Never used for calls.
const axios = require('axios')

const BASE = 'https://api.telnyx.com/v2'
const enabled = () => !!process.env.TELNYX_FAX_API_KEY
const headers = () => ({ Authorization: `Bearer ${process.env.TELNYX_FAX_API_KEY}` })
const api = (method, path, { data, params, extra = {} } = {}) => axios({ method, url: BASE + path, data, params, headers: { ...headers(), ...extra }, timeout: 30000 }).then(r => r.data)

// Carrier lookup → { type, carrier, valid } | null
async function lookup(e164) {
  if (!enabled()) return null
  try {
    const d = (await api('get', `/number_lookup/${encodeURIComponent(e164)}`, { params: { type: 'carrier' } }))?.data || {}
    return { valid: d.valid_number !== false, type: d.valid_number === false ? 'invalid' : String(d.carrier?.type || 'unknown').toLowerCase(), carrier: d.carrier?.normalized_carrier || d.carrier?.name || null, _provider: 'telnyx' }
  } catch (_) { return null }
}

const hasFax = (n) => (n.features || []).some(f => f.name === 'fax')
// Fax-capable local numbers in the USA or Canada.
async function searchFax(country, areaCode, limit = 12) {
  const found = await searchOnce(country, areaCode, limit)
  // An area code with no fax numbers → numbers elsewhere in the same country (flagged nearby).
  return found.length || !areaCode ? found : (await searchOnce(country, null, limit)).map(n => ({ ...n, nearby: true }))
}
async function searchOnce(country, areaCode, limit) {
  const params = { 'filter[country_code]': country, 'filter[phone_number_type]': 'local', 'filter[features][]': 'fax', 'filter[limit]': limit, 'filter[best_effort]': true }
  if (areaCode) params['filter[national_destination_code]'] = areaCode
  let list
  try { list = (await api('get', '/available_phone_numbers', { params }))?.data || [] } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) throw e
    delete params['filter[features][]']
    list = (await api('get', '/available_phone_numbers', { params }))?.data || []
  }
  return list.filter(hasFax).map(n => ({
    phoneNumber: n.phone_number,
    nearby: !!areaCode && String(n.phone_number).slice(2, 5) !== areaCode,
    region: (n.region_information || []).map(r => r.region_name).filter(Boolean).join(', '),
    monthlyCost: parseFloat(n.cost_information?.monthly_cost) || 0,
  }))
}

// Orders the number straight onto the Fax Application, so it can only send and receive faxes.
async function orderFax(phoneNumber, faxAppId) {
  const r = await api('post', '/number_orders', { data: { phone_numbers: [{ phone_number: phoneNumber }], connection_id: faxAppId } })
  return r?.data || null
}

async function releaseFax(phoneNumber) {
  const found = (await api('get', '/phone_numbers', { params: { 'filter[phone_number]': phoneNumber, 'page[size]': 1 } }))?.data?.[0]
  if (found) await api('delete', `/phone_numbers/${found.id}`)
  return !!found
}

// Messaging profile for Landline to Texting on this account (found by name or created once, cached in faxConfig).
async function messagingProfile(db, brand = 'CloudIVR') {
  const name = `${brand} Texting`, key = `${name}|fax-account`
  const saved = await db.collection('faxConfig').findOne({ _id: key })
  if (saved?.profileId) return saved.profileId
  const hook = process.env.SELF_URL ? `${process.env.SELF_URL}/telnyx/sms-webhook` : undefined
  let p = ((await api('get', '/messaging_profiles', { params: { 'filter[name]': name, 'page[size]': 5 } }))?.data || []).find(x => x.name === name)
  if (!p) p = (await api('post', '/messaging_profiles', { data: { name, enabled: true, webhook_url: hook, whitelisted_destinations: ['US', 'CA'] } }))?.data
  if (!p?.id) throw new Error('messaging profile unavailable')
  await db.collection('faxConfig').updateOne({ _id: key }, { $set: { profileId: p.id, at: new Date() } }, { upsert: true })
  return p.id
}

module.exports = { BASE, enabled, headers, lookup, searchFax, orderFax, releaseFax, messagingProfile }
