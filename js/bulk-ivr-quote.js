'use strict'
// Bulk IVR cost quote for AI support: live rates + real average billed minutes → likely range and maximum.
const { getCountryCallingCode, getCountries, parsePhoneNumberFromString } = require('libphonenumber-js')

let _stats = null, _statsAt = 0
const names = (() => {
  const m = new Map(), dn = new Intl.DisplayNames(['en'], { type: 'region' })
  for (const iso of getCountries()) { const n = dn.of(iso); if (n) m.set(n.toLowerCase(), iso) }
  for (const [a, iso] of [['usa', 'US'], ['us', 'US'], ['u.s.', 'US'], ['america', 'US'], ['united states of america', 'US'], ['uk', 'GB'], ['england', 'GB'], ['britain', 'GB'], ['great britain', 'GB'], ['uae', 'AE'], ['canada', 'CA']]) m.set(a, iso)
  return m
})()

function parseCount(text) {
  const m = String(text).toLowerCase().replace(/(\d),(\d{3})/g, '$1$2').match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million)?\s*(?:leads?|numbers?|contacts?|calls?|phones?|people|batch)?/g) || []
  let best = 0
  for (const x of m) {
    const g = x.match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million)?/); let n = parseFloat(g[1])
    if (g[2] === 'k' || g[2] === 'thousand') n *= 1e3; if (g[2] === 'm' || g[2] === 'million') n *= 1e6
    if (n >= 10 && n <= 5e6 && n > best) best = Math.round(n)
  }
  return best || null
}
function parseCountry(text) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z.\s]/g, ' ')} `
  let hit = null
  for (const [n, iso] of names) if (t.includes(` ${n} `) && (!hit || n.length > hit.n.length)) hit = { n, iso }
  return hit?.iso || null
}
const asksIvrCost = (text) => /\b(ivr|bulk ?call|campaign|dial|dialing|calls?|sip|leads?)\b/i.test(text) && /\b(cost|price|how much|total|credit|budget|charge|pay|fund)\b/i.test(text)

function rateFor(iso) {
  const vs = require('./voice-service')
  let sample = null
  try { sample = require('libphonenumber-js/examples.mobile.json')[iso] } catch (_) {}
  const num = sample ? parsePhoneNumberFromString(sample, iso)?.number : `+${getCountryCallingCode(iso)}2025550100`
  return typeof vs.getIvrCallRate === 'function' ? vs.getIvrCallRate(num) : parseFloat(process.env.BULK_CALL_RATE_PER_MIN || '0.15')
}

async function avgBilledMinutes(db) {
  if (_stats && Date.now() - _statsAt < 3600e3) return _stats
  let r = null
  try {
    r = (await db.collection('phoneLogs').aggregate([
      { $match: { type: 'BulkIVR', createdAt: { $gte: new Date(Date.now() - 30 * 864e5) }, minutesBilled: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$minutesBilled' }, n: { $sum: 1 } } },
    ]).toArray())[0]
  } catch (_) {}
  _stats = r && r.n >= 200 ? { avg: Math.max(1, r.avg), n: r.n } : { avg: 1.2, n: 0 }
  _statsAt = Date.now()
  return _stats
}

const usd = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
async function quote(count, iso, db, fullMessageMin = 2) {
  const rate = rateFor(iso), { avg, n } = await avgBilledMinutes(db)
  const low = count * rate * 0.9, likely = count * rate * avg, max = count * rate * fullMessageMin
  const dn = new Intl.DisplayNames(['en'], { type: 'region' }).of(iso)
  return { count, iso, country: dn, rate, avg, sample: n, low, likely, max, perExtraMin: count * rate }
}

// Prompt block. Always gives the billing rules; adds a computed quote when the message names a count (+ country).
async function bulkIvrKnowledge(db, userMessage) {
  const us = rateFor('US'), intl = Number(require('./phone-config.js').CALL_FORWARDING_RATE_MIN) || 0.5, { avg } = await avgBilledMinutes(db)
  let out = `\n\n## BULK IVR PRICING (live — use these numbers, never invent others)
- Billed per call minute, rounded up, minimum 1 minute for every number dialed — answered, voicemail, no-answer and busy calls are billed. Invalid / never-connected numbers are NOT charged.
- Rate: USA & Canada ${usd(us)}/min. Most other countries ${usd(intl)}/min; some destinations (e.g. certain mobile ranges, premium/satellite prefixes) cost more — always use the COMPUTED QUOTE rate when given.
- Typical: about ${avg.toFixed(1)} billed minutes per number (real campaigns, last 30 days).
- When asked for a campaign total, give BOTH: the likely range (count × rate × 0.9 … count × rate × ${avg.toFixed(1)}) and the maximum (every call plays the full message, e.g. 2 minutes). Show the short math. Say the wallet is charged per call as the campaign runs; if it runs low the campaign pauses and resumes automatically after a top-up. Lists over 500 run as linked 500-number parts. If the country is missing, quote USA/Canada and ask which country.`
  if (userMessage && asksIvrCost(userMessage)) {
    const count = parseCount(userMessage)
    if (count) {
      const iso = parseCountry(userMessage) || 'US', q = await quote(count, iso, db)
      out += `\n- COMPUTED QUOTE for this message: ${count.toLocaleString('en-US')} numbers to ${q.country}${parseCountry(userMessage) ? '' : ' (country not stated — assumed USA)'} at ${usd(q.rate)}/min (${iso === 'US' || iso === 'CA' ? 'standard' : q.rate > intl ? `mobile rate — ${q.country} mobiles are a high-cost destination; landlines are usually ${usd(intl)}/min` : 'mobile rate'}) → likely ${usd(q.low)} – ${usd(q.likely)}; maximum ${usd(q.max)} if every call plays a full 2-minute message (each extra minute of audio adds up to ${usd(q.perExtraMin)}).`
    }
  }
  return out
}

module.exports = { bulkIvrKnowledge, quote, parseCount, parseCountry, asksIvrCost, rateFor }
