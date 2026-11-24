'use strict'
// Infobip "on request" countries (no stock list): after payment we submit a Resource Request — with the buyer's company
// details where the country needs them — and Infobip assigns a number. Runs on the pending-order queue ('ibreq').
const ibc = require('./countries')
const log = (...a) => console.log('[InfobipRequest]', ...a)
const ib = () => require('./index')
const OK = /COMPLET|FULFIL|APPROV|DONE|SUCCESS/i
const NO = /REJECT|EXPIR|CANCEL|FAIL|DECLIN/i
const digits = (x) => String(x || '').replace(/\D/g, '')
const LABELS = { companyName: 'company name', companyAddress: 'company address (street, number, city, postcode)' }

const sellsIn = (cc) => !!ibc.REQUEST[cc] && ib().selling() && ib().sellsIn(cc)
// Placeholder per order: calling code + 000 + 6 random digits, so two buyers never share one while Infobip works on it.
const ccOf = (placeholder) => Object.keys(ibc.REQUEST).find(cc => digits(placeholder).startsWith(`${ibc.REQUEST[cc].dial}000`) && digits(placeholder).length === ibc.REQUEST[cc].dial.length + 9) || null
const isSearched = (n) => !!ccOf(n)
const metaOf = (placeholder) => { const cc = ccOf(placeholder), c = ibc.REQUEST[cc]; return cc ? { cc, type: 'local', countryName: c.name, keys: c.keys, clientType: c.clientType || null, sms: !!c.sms } : null }

function searchNumbers(countryCode, numberType = 'local') {
  const cc = String(countryCode || '').toUpperCase()
  if ((numberType || 'local') !== 'local' || !sellsIn(cc)) return []
  const c = ibc.REQUEST[cc], num = `+${c.dial}000${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`
  return [{ record_type: 'available_phone_number', phone_number: num, _assigned: true, _onRequest: true,
    region_information: [{ region_type: 'location', region_name: `${c.name} — the carrier assigns your number after the order${c.keys.length ? ' (asks your company details after payment)' : ''}` }],
    cost_information: { currency: 'EUR', monthly_cost: '9.10', upfront_cost: '9.10' }, _capabilities: { voice: true, sms: !!c.sms, mms: false, fax: false }, _provider: 'infobip' }]
}

const pending = (placeholder, meta) => require('../pending-orders').pendingResult('ibreq', placeholder, meta, 'infobip')
const missing = (meta) => (meta.keys || []).filter(k => !String(meta.details?.[k] || '').trim())

async function submit(meta) {
  const body = { type: 'NUMBER_PURCHASE', quantity: 1, numberType: 'VIRTUAL_LONG_NUMBER', capabilities: meta.sms ? ['VOICE', 'SMS'] : ['VOICE'], countryCode: meta.cc,
    requirements: (meta.keys || []).map(k => ({ key: k, value: String(meta.details[k]).trim().slice(0, 300) })), ...(meta.clientType ? { clientType: meta.clientType } : {}) }
  const d = (await ib().http().post('/resources/1/requests', body)).data
  if (!d?.id) throw new Error(`no request id (${JSON.stringify(d).slice(0, 160)})`)
  log(`submitted ${meta.cc} request ${d.id}`)
  return d.id
}

// A newly owned Infobip number in that country that nobody holds yet (Infobip adds it to the account when it fills the request).
async function assigned(meta, db, given = []) {
  const held = new Set()
  for (const d of await db.collection('phoneNumbersOf').find({}, { projection: { 'val.numbers.phoneNumber': 1, 'val.numbers.landingNumber': 1 } }).toArray()) for (const n of d.val?.numbers || []) { held.add(n.phoneNumber); if (n.landingNumber) held.add(n.landingNumber) }
  const list = (await ib().http().get('/numbers/1/numbers', { params: { limit: 1000 } })).data?.numbers || []
  const mine = new Set(given.map(x => digits(x?.number || x?.phoneNumber || x)).filter(Boolean))
  const n = mine.size ? list.find(x => mine.has(digits(x.number))) : list.find(x => x.country === meta.cc && !held.has(`+${digits(x.number)}`))
  if (!n) return null
  await ib().http().post(`/numbers/2/numbers/${n.numberKey}/voice`, { action: { type: 'FORWARD_TO_SUBSCRIPTION', callsConfigurationId: ib().configId() } })
  if ((n.capabilities || []).includes('SMS')) await ib().routeSms(n.numberKey)
  return { phone: `+${digits(n.number)}`, key: n.numberKey }
}

// pending-orders calls this every pass: submit once details are in, then poll until Infobip fills or declines it.
let D = null
async function buyNumber(placeholder) {
  const meta = { ...(metaOf(placeholder) || {}), ...(remembered.get(placeholder) || {}) }
  if (!meta.cc || !ib().selling()) return null
  try {
    if (!meta.requestId) {
      if (missing(meta).length) return pending(placeholder, meta)
      meta.requestId = await submit(meta)
      return pending(placeholder, meta)
    }
    const d = (await ib().http().get(`/resources/1/requests/${meta.requestId}`)).data || {}
    const st = String(d.status || '')
    if (NO.test(st)) return { _declined: String(d.note || d.statusReason || st).slice(0, 160) }
    if (!OK.test(st)) return pending(placeholder, { ...meta, ibStatus: st })
    const got = D && await assigned(meta, D.db, d.numbers || [])
    if (!got) { log(`${meta.requestId} ${st} but no new ${meta.cc} number on the account yet`); return pending(placeholder, { ...meta, ibStatus: st }) }
    remembered.delete(placeholder)
    log(`${meta.requestId} → ${got.phone}`)
    return { id: `ib:${got.key}`, status: 'success', requirements_met: true, phone_numbers: [{ id: `ib:${got.key}`, phone_number: got.phone, status: 'success' }], _provider: 'infobip', _retriedNumber: got.phone, _assigned: true }
  } catch (e) {
    const why = ib().errOf(e)
    log(`${placeholder}: ${why}`)
    // Infobip refused the request itself (bad details, not available): a retry would fail the same way.
    if (!meta.requestId && [400, 404, 422].includes(e.response?.status)) return { _declined: why.slice(0, 160) }
    return pending(placeholder, { ...meta, why: why.slice(0, 200) })
  }
}
const remembered = new Map()
const remember = (n, meta) => { if (meta) remembered.set(String(n), meta) }
const searchedMeta = (n) => metaOf(n)
const init = (deps) => { D = deps }

module.exports = { sellsIn, isSearched, searchNumbers, buyNumber, remember, searchedMeta, metaOf, missing, init, LABELS }
