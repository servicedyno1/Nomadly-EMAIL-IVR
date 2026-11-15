'use strict'
// Provider health + backup. Every 5 min: MultiTEL, Infobip, Bird and Spenza are checked (balance where the API has one).
// A provider that fails 2 checks in a row is "down": its stock is hidden (number-catalog) and buys go to the other one.
// Admin gets one Telegram + email alert per change (down / back up) and one low-balance alert per 12h.
// Balance under WARN → alert. Under STOP → that provider's numbers are hidden while the other number provider is healthy.
const axios = require('axios')
const LOW = { multitel: 20, infobip: 20, spenza: 25 }
const STOP = { multitel: 10, infobip: 10 }
const EUR_USD = 1.08
const state = {}
let notify = () => {}
// Alert timestamps survive restarts (file), so a redeploy doesn't repeat the same low-balance alert.
const SEEN_FILE = process.env.PROVIDER_HEALTH_SEEN_FILE || require('path').join(require('os').tmpdir(), 'provider-health-alerts.json')
const seen = (() => { try { return JSON.parse(require('fs').readFileSync(SEEN_FILE, 'utf8')) } catch { return {} } })()
const once = (key, ms) => { if (Date.now() - (seen[key] || 0) < ms) return false; seen[key] = Date.now(); try { require('fs').writeFileSync(SEEN_FILE, JSON.stringify(seen)) } catch {} return true }
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
    const b = Number(r.data?.balance)
    return r.data?.currency === 'EUR' ? Math.round(b * EUR_USD * 100) / 100 : b
  },
  bird: async () => {
    if (!process.env.BIRD_API_KEY) return null
    // Bird has no balance API: an empty wallet shows up as HTTP 402 / E03000 on any request.
    try { await axios.get('https://us1.platform.bird.com/v1/esim/offers?limit=1', { headers: { Authorization: `Bearer ${process.env.BIRD_API_KEY}` }, timeout: 15000 }) } catch (e) {
      if (e.response?.status === 402 || /E03000|InsufficientBalance/i.test(JSON.stringify(e.response?.data || ''))) return 0
      throw e
    }
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
    if (s.down) { s.down = false; alert(`✅ [Providers] ${p} is back up${Number.isFinite(bal) ? ` — balance $${bal.toFixed(2)}` : ''}. Its numbers are on sale again.`) }
    if (p === 'bird' && bal === 0 && once('bird-empty', 12 * 3600000)) { s.lowAlertAt = Date.now(); alert(`🚨 [Providers] Bird wallet is empty (HTTP 402). Calls, lookups and eSIMs will fail — top up Bird now.`) }
    // Separate throttles: "low" (under WARN) and "numbers hidden" (under STOP) each alert at most once per 12h.
    const stop = Number.isFinite(bal) && STOP[p] != null && bal < STOP[p]
    if (Number.isFinite(bal) && LOW[p] != null && bal < LOW[p] && once(`${p}-${stop ? 'stop' : 'low'}`, 12 * 3600000)) {
      s.lowAlertAt = Date.now()
      alert(`⚠️ [Providers] ${p} balance is low: $${bal.toFixed(2)} (alert below $${LOW[p]}).${stop ? ` Under $${STOP[p]}: its numbers are hidden and new orders go to the other provider while that one is healthy.` : ''} Top it up so orders, calls and texts keep working.`)
    }
  } catch (e) {
    s.fails++; s.checkedAt = new Date(); s.reason = e.response?.status ? `HTTP ${e.response.status}` : e.message
    if (!s.down && s.fails >= 2) { s.down = true; alert(`🚨 [Providers] ${p} is DOWN (${s.reason}). Its stock is hidden and new orders go to the backup provider.`) }
  }
}

// Telegram admin + email, for balance and up/down changes.
function alert(text) {
  try { notify(text) } catch (_) {}
  require('./admin-mail').adminMail(`CloudIVR provider alert: ${String(text).replace(/^\W+\[Providers\]\s*/, '').slice(0, 70)}`, `<p>${String(text).replace(/</g, '&lt;')}</p>`)
}

const tick = () => Promise.all(Object.keys(CHECKS).map(check))
const hardDown = (p) => !!state[p]?.down || (p === 'multitel' && require('./multitel').isBlocked())
const isLow = (p) => STOP[p] != null && Number.isFinite(state[p]?.balance) && state[p].balance < STOP[p]
// Low balance hides a number provider only while the other one can still sell (never hide both).
const isDown = (p) => {
  if (hardDown(p)) return true
  if (!isLow(p)) return false
  const other = p === 'multitel' ? 'infobip' : p === 'infobip' ? 'multitel' : null
  return !!other && !hardDown(other) && !isLow(other)
}
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
  if (fresh[0]) { r = await P.buyNumber(fresh[0].phone_number).catch(() => null); if (r) { r._retriedNumber = r._retriedNumber || fresh[0].phone_number; return r } }
  const altName = primary === 'infobip' ? 'multitel' : 'infobip', alt = altName === 'infobip' ? ib : mt
  const opt = require('./number-catalog').options(cc, type).find(o => o.provider === altName && o.level === 0 && !o.request)
  if (!opt || isDown(altName)) { notify(`🚨 [Providers] ${primary} couldn't sell ${phoneNumber} (${cc}/${type}) and no backup provider has it. The customer is refunded.`); return null }
  const other = await alt.searchNumbers(cc, type, retry.areaCode || null, 3).catch(() => [])
  for (const n of other) {
    r = await alt.buyNumber(n.phone_number).catch(() => null)
    if (r) { r._retriedNumber = r._retriedNumber || n.phone_number; r._provider = altName; r._failover = primary; notify(`🔁 [Providers] ${primary} couldn't sell ${phoneNumber}; sold ${n.phone_number} from ${altName} instead (${cc}/${type}).`); return r }
  }
  notify(`🚨 [Providers] ${primary} and ${altName} both failed for ${cc}/${type} (${phoneNumber}). The customer is refunded.`)
  return null
}

module.exports = { start, tick, isDown, isLow, snapshot, buyWithBackup, alert, LOW, STOP }
