'use strict'
// Provider health + backup. Every 5 min: MultiTEL, Infobip, Bird and Spenza are checked (balance where the API has one).
// A provider that fails 2 checks in a row is "down": its stock is hidden (number-catalog) and buys go to the other one.
// Admin gets one Telegram alert per change (down / back up) and one low-balance alert per 12h.
const axios = require('axios')
const LOW = { multitel: 10, infobip: 10, spenza: 25 }
const state = {}
let notify = () => {}
const st = (p) => (state[p] = state[p] || { down: false, fails: 0, balance: null, lowAlertAt: 0, checkedAt: null, reason: null })

const CHECKS = {
  multitel: async () => {
    const mt = require('./multitel')
    if (!mt.enabled()) return null
    if (mt.isBlocked()) throw new Error('login refused (paused for 6h)')
    const r = await mt.api('get', 'getbalance')
    if (String(r?.status?.code) !== '200') throw new Error(r?.status?.msg || 'no answer')
    return Number(r.response?.balance)
  },
  infobip: async () => {
    const ib = require('./infobip')
    if (!ib.enabled()) return null
    const r = await ib.http().get('/account/1/balance')
    return Number(r.data?.balance)
  },
  bird: async () => {
    if (!process.env.BIRD_API_KEY) return null
    await axios.get('https://us1.platform.bird.com/v1/esim/offers?limit=1', { headers: { Authorization: `Bearer ${process.env.BIRD_API_KEY}` }, timeout: 15000 })
    return NaN
  },
  spenza: async () => {
    const sp = require('./spenza')
    if (typeof sp.creditBalance !== 'function') return null
    return Number(await sp.creditBalance())
  },
}

async function check(p) {
  const s = st(p)
  try {
    const bal = await CHECKS[p]()
    if (bal === null) return
    s.fails = 0; s.checkedAt = new Date(); s.reason = null
    if (Number.isFinite(bal)) s.balance = bal
    if (s.down) { s.down = false; notify(`✅ [Providers] ${p} is back up${Number.isFinite(bal) ? ` — balance $${bal.toFixed(2)}` : ''}. Its numbers are on sale again.`) }
    if (Number.isFinite(bal) && LOW[p] != null && bal < LOW[p] && Date.now() - s.lowAlertAt > 12 * 3600000) {
      s.lowAlertAt = Date.now()
      notify(`⚠️ [Providers] ${p} balance is low: $${bal.toFixed(2)} (alert below $${LOW[p]}). Top it up so orders, calls and texts keep working.`)
    }
  } catch (e) {
    s.fails++; s.checkedAt = new Date(); s.reason = e.response?.status ? `HTTP ${e.response.status}` : e.message
    if (!s.down && s.fails >= 2) { s.down = true; notify(`🚨 [Providers] ${p} is DOWN (${s.reason}). Its stock is hidden and new orders go to the backup provider.`) }
  }
}

const tick = () => Promise.all(Object.keys(CHECKS).map(check))
const isDown = (p) => !!state[p]?.down || (p === 'multitel' && require('./multitel').isBlocked())
const snapshot = () => Object.fromEntries(Object.keys(CHECKS).map(p => [p, { ...st(p) }]))
function start(notifyAdmin) {
  if (notifyAdmin) notify = notifyAdmin
  tick().catch(() => {})
  require('./active-slot').singletonInterval('provider-health', () => tick().catch(() => {}), 5 * 60000)
}

// Buy a searched number on its provider; if that fails, another number from the same provider, then the same
// country/type from the other provider (no paperwork, not down). The customer pays the same price either way.
async function buyWithBackup(primary, phoneNumber, retry) {
  const ib = require('./infobip'), mt = require('./multitel')
  const P = primary === 'infobip' ? ib : mt
  let r = await P.buyNumber(phoneNumber).catch(() => null)
  if (r || !retry) return r
  const cc = String(retry.countryCode || 'US').toUpperCase(), type = retry.numberType || 'local'
  const fresh = (await P.searchNumbers(cc, type, retry.areaCode || null, 3).catch(() => [])).filter(n => n.phone_number !== phoneNumber)
  if (fresh[0]) { r = await P.buyNumber(fresh[0].phone_number).catch(() => null); if (r) { r._retriedNumber = fresh[0].phone_number; return r } }
  const altName = primary === 'infobip' ? 'multitel' : 'infobip', alt = altName === 'infobip' ? ib : mt
  const opt = require('./number-catalog').options(cc, type).find(o => o.provider === altName && o.level === 0 && !o.request)
  if (!opt || isDown(altName)) { notify(`🚨 [Providers] ${primary} couldn't sell ${phoneNumber} (${cc}/${type}) and no backup provider has it. The customer is refunded.`); return null }
  const other = await alt.searchNumbers(cc, type, retry.areaCode || null, 3).catch(() => [])
  for (const n of other) {
    r = await alt.buyNumber(n.phone_number).catch(() => null)
    if (r) { r._retriedNumber = n.phone_number; r._provider = altName; r._failover = primary; notify(`🔁 [Providers] ${primary} couldn't sell ${phoneNumber}; sold ${n.phone_number} from ${altName} instead (${cc}/${type}).`); return r }
  }
  notify(`🚨 [Providers] ${primary} and ${altName} both failed for ${cc}/${type} (${phoneNumber}). The customer is refunded.`)
  return null
}

module.exports = { start, tick, isDown, snapshot, buyWithBackup, LOW }
