'use strict'
// Retell US/CA numbers (local + US toll-free). Each one forwards (Retell "fallback", no AI) to its own Infobip
// landing number, which reaches our call engine; voice-service maps landing → customer number. Calls out go via Bird.
const axios = require('axios')

const log = (...a) => console.log('[Retell]', ...a)
const enabled = () => !!process.env.RETELL_API_KEY
const selling = () => enabled() && String(process.env.NUMBER_PROVIDERS || '').toLowerCase().split(',').map(x => x.trim()).includes('retell')
const http = () => axios.create({ baseURL: 'https://api.retellai.com', headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` }, timeout: 30000 })
const errOf = (e) => String(e.response?.data?.message || e.response?.data?.error_message || e.message)
const e164 = (n) => `+${String(n || '').replace(/\D/g, '')}`
const isRt = (id) => String(id || '').startsWith('rt:')
const COST = { local: 2, toll_free: 5 }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// Infobip rate-limits hard (429): wait and retry instead of failing.
const call = async (fn) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (e.response?.status !== 429 || i >= 4) throw e; await sleep(1500 * (i + 1)) } } }
const sellsType = (cc, type) => (cc === 'US' && ['local', 'toll_free'].includes(type)) || (cc === 'CA' && type === 'local')

const searched = new Map() // e164 → { cc, type }
const bought = new Set() // bought by this process (routing needs no Telnyx step)
const owns = (n) => bought.has(e164(n))
// Numbers on the Retell account (current API: POST /v2/list-phone-numbers, paginated) → also fills `bought` after a restart.
async function listOwned() {
  const out = []
  for (let key = null, i = 0; i < 50; i++) {
    const d = (await http().post('/v2/list-phone-numbers', { filter_criteria: {}, ...(key ? { pagination_key: key } : {}) })).data || {}
    out.push(...(d.items || []))
    if (!d.has_more || !d.pagination_key) break
    key = d.pagination_key
  }
  for (const n of out) bought.add(e164(n.phone_number))
  return out
}
async function searchNumbers(countryCode, numberType = 'local', areaCode = null, limit = 5) {
  const cc = String(countryCode || 'US').toUpperCase(), type = numberType || 'local'
  if (!selling() || !sellsType(cc, type)) return []
  const body = { country_code: cc, number_provider: 'twilio', ...(type === 'toll_free' ? { toll_free: true } : {}), ...(/^\d{3}$/.test(String(areaCode || '')) ? { area_code: Number(areaCode) } : {}) }
  try {
    const list = (await http().post('/list-available-phone-numbers', body)).data || []
    return list.slice(0, limit).map(n => {
      const num = e164(n.number); searched.set(num, { cc, type })
      return { record_type: 'available_phone_number', phone_number: num, region_information: [{ region_type: 'location', region_name: [n.locality, n.region].filter(Boolean).join(', ') || (type === 'toll_free' ? 'Toll-free' : cc) }],
        cost_information: { currency: 'USD', monthly_cost: String(COST[type]), upfront_cost: '0' }, _capabilities: { voice: true, sms: false, mms: false, fax: false }, _provider: 'retell' }
    })
  } catch (e) { log('search:', errOf(e)); return [] }
}
const isRtSearched = (n) => searched.has(String(n || ''))
// After a restart the search is forgotten: a US/CA number nobody else searched is retried on Retell.
const searchedMeta = (n) => searched.get(String(n)) || null
const remember = (n, meta) => searched.set(String(n), meta || { cc: String(n).startsWith('+1') ? 'US' : '', type: /^\+18(00|33|44|55|66|77|88)/.test(String(n)) ? 'toll_free' : 'local' })

// Landing number on Infobip (US local): bought outside Infobip's own "selling" switch, routed to our calls config.
async function buyLanding() {
  const ib = require('../infobip')
  const list = (await call(() => ib.http().get('/numbers/1/numbers/available', { params: { country: 'US', capabilities: 'VOICE', limit: 20 } }))).data?.numbers || []
  for (const n of list.filter(x => !x.additionalSetupRequired).slice(0, 5)) {
    try {
      const got = (await call(() => ib.http().post('/numbers/1/numbers', n.numberKey ? { numberKey: n.numberKey } : { number: n.number }))).data
      const key = got.numberKey || n.numberKey
      await call(() => ib.http().post(`/numbers/2/numbers/${key}/voice`, { action: { type: 'FORWARD_TO_SUBSCRIPTION', callsConfigurationId: ib.configId() } }))
      return { number: e164(n.number), key }
    } catch (e) { log(`landing ${n.number}:`, ib.errOf(e)) }
  }
  throw new Error('no Infobip landing number available')
}
async function releaseLanding(number) {
  const ib = require('../infobip')
  const list = (await call(() => ib.http().get('/numbers/1/numbers', { params: { limit: 1000 } }))).data?.numbers || []
  const hit = list.find(n => e164(n.number) === e164(number))
  if (!hit) return false
  await call(() => ib.http().delete(`/numbers/1/numbers/${hit.numberKey}`))
  return true
}

// One unused landing number kept between failed buys; released if nobody needs it for a day.
const spare = {
  n: null, timer: null,
  take() { const n = this.n; this.n = null; clearTimeout(this.timer); return n },
  keep(l) {
    if (this.n) { releaseLanding(l.number).catch(() => {}); return }
    this.n = l; clearTimeout(this.timer)
    this.timer = setTimeout(() => { const x = this.take(); if (x) releaseLanding(x.number).catch(e => log(`landing release ${x.number}:`, errOf(e))) }, 24 * 3600000)
    this.timer.unref?.()
  },
}
// Retell has no balance API: a buy it refuses for money is the only sign the wallet is low → admin alert (once per 6 h).
const LOW_FUNDS = /balance|credit|insufficient|fund|payment|billing|top.?up/i
const noFunds = new Set()
let lowAlertAt = 0
const wasNoFunds = (n) => noFunds.has(n)
function lowFunds(phoneNumber, why) {
  noFunds.add(phoneNumber)
  if (Date.now() - lowAlertAt < 6 * 3600000) return
  lowAlertAt = Date.now()
  require('../provider-health').alert(`🚨 [Providers] Retell wallet too low — it refused to buy ${phoneNumber} (${why.slice(0, 120)}). Paid orders wait and complete on their own after the top-up (Retell dashboard → Billing). US/Canada numbers can't be bought until then.`)
}
// Buy → { id: 'rt:+1…', _provider: 'retell', _landingNumber } | null (nothing is left half-bought).
async function buyNumber(phoneNumber) {
  if (!selling()) return null
  const s = searched.get(phoneNumber); if (!s) return null
  let landing = null
  try {
    landing = spare.take() || await buyLanding()
    const r = (await http().post('/create-phone-number', { phone_number: phoneNumber, number_provider: 'twilio', ...(s.type === 'toll_free' ? { toll_free: true } : {}), nickname: 'CloudIVR', fallback_number: landing.number, inbound_fallback_enabled: true })).data
    const got = e164(r.phone_number)
    if (got !== phoneNumber) log(`asked ${phoneNumber}, Retell gave ${got}`)
    if (r.fallback_number !== landing.number || r.inbound_fallback_enabled !== true) await http().patch(`/update-phone-number/${encodeURIComponent(got)}`, { fallback_number: landing.number, inbound_fallback_enabled: true })
    searched.delete(phoneNumber); bought.add(got); noFunds.delete(phoneNumber); lowAlertAt = 0
    log(`Bought ${got} → forwards to landing ${landing.number}`)
    return { id: `rt:${got}`, status: 'success', requirements_met: true, phone_numbers: [{ id: `rt:${got}`, phone_number: got, status: 'success' }], _provider: 'retell', _landingNumber: landing.number, ...(got !== phoneNumber ? { _retriedNumber: got } : {}) }
  } catch (e) {
    log(`buy ${phoneNumber}:`, errOf(e))
    if (landing && (e.response?.status === 402 || LOW_FUNDS.test(errOf(e)))) lowFunds(phoneNumber, errOf(e))
    else noFunds.delete(phoneNumber)
    // Keep the landing for the next try (a waiting order retries every few minutes) instead of buying a new one each time.
    if (landing) spare.keep(landing)
    return null
  }
}
async function releaseNumber(id) {
  const num = e164(String(id).replace(/^rt:/, ''))
  try {
    const cur = (await http().get(`/get-phone-number/${encodeURIComponent(num)}`).catch(() => ({ data: null }))).data
    await http().delete(`/delete-phone-number/${encodeURIComponent(num)}`)
    if (cur?.fallback_number) await releaseLanding(cur.fallback_number).catch(e => log(`landing release ${cur.fallback_number}:`, errOf(e)))
    return true
  } catch (e) { log(`release ${num}:`, errOf(e)); return false }
}

module.exports = { owns, listOwned, enabled, selling, sellsType, isRt, searchNumbers, isRtSearched, remember, searchedMeta, buyNumber, releaseNumber, wasNoFunds, COST, buyLanding, releaseLanding }
