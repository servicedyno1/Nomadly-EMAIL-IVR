'use strict'
// Zadarma DID provider — search, buy, release numbers and configure SIP forwarding to our SIP server.
// Like telnyx-sip.js: numbers only, inbound only, outbound stays on Bird.
const z = require('./index')
const log = (...a) => console.log('[ZadarmaSIP]', ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const isZd = (id) => String(id || '').startsWith('zd:')

const host = () => process.env.ZADARMA_SIP_HOST || 'sip-tls.cloudivr.net'
const port = () => process.env.ZADARMA_SIP_PORT || '5061'

// ── address for US/CA numbers ──
const US_ADDRESS = {
  first_name: 'Dynotech', last_name: 'Innovations',
  country: 'US', city: 'New York', address: '200 Broadway',
  building_number: 'Suite 300', zip_code: '10038', street: '200 Broadway',
  phone: '+16467958069'
}

// ── number cache ──
let owned = { at: 0, list: [] }

async function refreshOwned(force = false) {
  if (!z.enabled() || (!force && Date.now() - owned.at < 5 * 60000)) return owned.list
  try {
    const r = await z.call('GET', '/v1/direct_numbers/')
    owned = { at: Date.now(), list: (r.info || []).filter(n => n.status === 'active' || n.status === 'checking') }
  } catch (e) { log('list numbers:', e.message) }
  return owned.list
}
const ownsNumber = (e164) => {
  const digits = String(e164 || '').replace(/\D/g, '')
  return owned.list.some(n => n.number === digits)
}
const ownedNumbers = () => owned.list.map(n => `+${n.number}`)

// ── balance ──
async function getBalance() {
  const r = await z.call('GET', '/v1/info/balance/')
  return r.status === 'success' ? { balance: r.balance, currency: r.currency } : null
}

// ── ensure profile address for US numbers ──
async function ensureAddress() {
  await z.call('PUT', '/v1/documents/groups/update/', US_ADDRESS)
}

// ── search available numbers ──
async function searchNumbers(countryCode, numberType, areaCode, limit = 5) {
  if (!z.enabled()) return []
  const cc = String(countryCode || 'US').toUpperCase()
  const tf = /toll/.test(String(numberType || ''))

  // Get directions for the country
  const r = await z.call('GET', '/v1/direct_numbers/country/', { country: cc })
  let dirs = r.info || []
  if (tf) dirs = dirs.filter(d => d.is_toll === 'true')
  else dirs = dirs.filter(d => d.is_toll !== 'true')

  // Filter by area code if given
  if (areaCode) {
    const ac = String(areaCode)
    const exact = dirs.filter(d => d.areaCode === ac)
    if (exact.length) dirs = exact
    // else keep all for the country
  }

  // Take a sample of directions and get available numbers
  const sample = dirs.slice(0, 3)
  const rows = []
  for (const dir of sample) {
    try {
      const avail = await z.call('GET', `/v1/direct_numbers/available/${dir.id}/`)
      for (const n of (avail.info || []).slice(0, limit)) {
        rows.push({
          record_type: 'available_phone_number',
          phone_number: `+${n.number}`,
          features: [{ name: 'voice' }],
          region_information: [{ region_name: dir.name, region_type: 'state' }],
          cost_information: { currency: 'EUR', monthly_cost: String(dir.monthly_fee), upfront_cost: String(dir.connect_fee || 0) },
          _capabilities: { voice: true, sms: dir.receive_sms === 'true', mms: false, fax: false },
          _provider: 'zadarma',
          _zadarmaSip: true,
          _directionId: dir.id,
          _numberId: n.id,
          _areaCode: dir.areaCode,
          _city: dir.name,
          _stateCode: dir.stateCode,
          _channels: dir.channels || 3,
          _monthlyFeeEur: dir.monthly_fee,
        })
      }
      if (rows.length >= limit) break
    } catch (e) { log(`search ${dir.id}:`, e.message) }
  }
  return rows.slice(0, limit)
}

// ── buy a number ──
async function buyNumber(numberId, directionId, opts = {}) {
  try {
    await ensureAddress()
    const params = {
      number_id: String(numberId),
      direction_id: String(directionId),
      period: opts.period || 'month',
      autorenew_period: opts.autorenew || 'month',
    }
    // Request SMS if available
    if (opts.receive_sms !== false) params.receive_sms = '1'

    const r = await z.call('POST', '/v1/direct_numbers/order/', params)
    if (r.status !== 'success') {
      log(`buy failed: ${r.message}`)
      return null
    }
    const e164 = `+${r.number}`
    log(`Ordered ${e164} (direction ${directionId})`)

    // Set SIP forwarding to our server
    await configureSipForwarding(r.number)

    // Wait briefly for activation then refresh
    await sleep(2000)
    await refreshOwned(true)

    const id = `zd:${e164}`
    return {
      id, status: 'success', requirements_met: true,
      phone_numbers: [{ id, phone_number: e164, status: r.is_activated === 'true' ? 'success' : 'pending', requirements_status: 'requirements-met' }],
      _provider: 'zadarma'
    }
  } catch (e) { log(`buy: ${e.message}`); return null }
}

// ── configure SIP URI forwarding ──
async function configureSipForwarding(number) {
  const digits = String(number).replace(/\D/g, '')
  const sipUri = `${digits}@${host()}:${port()}`
  const r = await z.call('PUT', '/v1/direct_numbers/set_sip_id/', {
    type: 'external', number: digits, sip_id: sipUri
  })
  if (r.status === 'success') log(`SIP forwarding: +${digits} → ${sipUri}`)
  else log(`SIP forwarding failed for +${digits}: ${r.message}`)
  return r
}

// ── release a number ──
async function releaseNumber(number) {
  const digits = String(number).replace(/\D/g, '').replace(/^\+/, '')
  try {
    const r = await z.call('DELETE', `/v1/direct_numbers/${digits}/`)
    if (r.status === 'success') {
      owned.list = owned.list.filter(n => n.number !== digits)
      log(`Released +${digits}`)
      return true
    }
    log(`release +${digits}: ${r.message}`)
    return false
  } catch (e) { log(`release +${digits}: ${e.message}`); return false }
}

// ── number status check ──
async function numberStatus(number) {
  const digits = String(number).replace(/\D/g, '')
  await refreshOwned(true)
  const n = owned.list.find(x => x.number === digits)
  return n ? { number: `+${n.number}`, status: n.status, channels: n.channels, sip: n.sip, monthlyFee: n.monthly_fee, expiresAt: n.stop_date } : null
}

module.exports = { isZd, refreshOwned, ownsNumber, ownedNumbers, searchNumbers, buyNumber, releaseNumber, configureSipForwarding, numberStatus, getBalance, ensureAddress }
