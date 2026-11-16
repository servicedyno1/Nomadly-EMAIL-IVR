'use strict'
// Provider health + backup. Every 5 min: MultiTEL, Infobip, Bird and Spenza are checked (balance where the API has one).
// A provider that fails 2 checks in a row is "down": its stock is hidden (number-catalog) and buys go to the other one.
// Admin gets one Telegram + email alert per change (down / back up) and one low-balance alert per 12h.
// Balance under WARN → alert. Under STOP → that provider's numbers are hidden while the other number provider is healthy.
const axios = require('axios')
const LOW = { multitel: 20, infobip: 20, spenza: 25 }
const STOP = { multitel: 10, infobip: 10, spenza: 10 }
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
      alert(`⚠️ [Providers] ${p} balance is low: $${bal.toFixed(2)} (alert below $${LOW[p]}). Orders keep going — if the provider refuses one for low balance it waits and completes automatically after the top-up. Top it up so orders, calls and texts keep working.`)
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

// Bird extras: spend estimate vs the last top-up (80% alert, once a day) and Bird's own daily calling limit.
const BIRD_DAILY_WARN = 5
async function birdExtras() {
  if (!process.env.BIRD_API_KEY) return
  const t = await require('./bird-spend').check().catch(() => null)
  if (t) alert(t)
  try {
    const r = await require('./bird').http().get('/voice/settings')
    const left = Number(r.data?.daily_spend_limit?.remaining?.amount)
    if (!Number.isFinite(left)) return
    st('bird').dailyLeft = left
    if (left < BIRD_DAILY_WARN && once('bird-daily', 6 * 3600000)) alert(`⚠️ [Providers] Bird daily calling limit almost used: $${left.toFixed(2)} left today. Bird refuses calls at $0 — raise the daily limit in Bird.`)
  } catch (_) { /* no voice settings → nothing to report */ }
}

const tick = () => Promise.all([...Object.keys(CHECKS).map(check), birdExtras()])
const hardDown = (p) => !!state[p]?.down || (p === 'multitel' && require('./multitel').isBlocked())
const isLow = (p) => STOP[p] != null && Number.isFinite(state[p]?.balance) && state[p].balance < STOP[p]
// Low balance hides a number provider only while the other one can still sell (never hide both).
// Low balance never hides numbers: paid orders wait in pending-orders until the top-up.
const isDown = (p) => hardDown(p)
const snapshot = () => Object.fromEntries(Object.keys(CHECKS).map(p => [p, { ...st(p) }]))
function start(notifyAdmin) {
  if (notifyAdmin) notify = notifyAdmin
  tick().catch(() => {})
  require('./active-slot').singletonInterval('provider-health', () => tick().catch(() => {}), 5 * 60000)
}

// Buy a searched number on its provider. Never paused ahead of time: we try, and only if the provider says our balance
// is too low does the paid order wait in pending-orders (bought in order as soon as the balance is back).
// If the number itself is gone, another one from the same provider. No cross-provider fallback (Infobip not in use).
async function buyWithBackup(primary, phoneNumber, retry) {
  const P = primary === 'infobip' ? require('./infobip') : require('./multitel')
  const noFunds = (n) => primary === 'multitel' && P.wasNoFunds?.(n)
  let r = await P.buyNumber(phoneNumber).catch(() => null)
  if (r) return r
  if (noFunds(phoneNumber)) { notify(`⏳ [Providers] ${primary} balance too low to buy ${phoneNumber} — the order waits and goes through as soon as you top up.`); return require('./pending-orders').pendingResult(primary, phoneNumber) }
  if (!retry) return null
  const cc = String(retry.countryCode || 'US').toUpperCase(), type = retry.numberType || 'local'
  const fresh = (await P.searchNumbers(cc, type, retry.areaCode || null, 3).catch(() => [])).filter(n => n.phone_number !== phoneNumber)
  if (fresh[0]) {
    r = await P.buyNumber(fresh[0].phone_number).catch(() => null)
    if (r) { r._retriedNumber = r._retriedNumber || fresh[0].phone_number; return r }
    if (noFunds(fresh[0].phone_number)) return require('./pending-orders').pendingResult(primary, fresh[0].phone_number)
  }
  notify(`🚨 [Providers] ${primary} couldn't sell ${phoneNumber} (${cc}/${type}) or a similar number. The customer is refunded.`)
  return null
}

module.exports = { start, tick, isDown, isLow, snapshot, buyWithBackup, alert, LOW, STOP }
