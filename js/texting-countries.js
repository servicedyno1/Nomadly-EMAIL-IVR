'use strict'
// Instant, no-ID two-way texting countries (outside the USA, where Spenza covers texting). Costs from the 14 Nov 2026
// MultiTEL SMS rate file + scan and Infobip's published SMS prices + offer scan (memory/TEXTING_PRICING_2026-06.md).
// Customer prices: 3x our cost. Sent text never below $0.05, extra number on a plan never below $25. Receiving is free.
const TEXT_MIN = 0.05
const EXTRA_MIN = 25
const MARKUP = 3

// [iso, name, provider, provider's number type, USD/month, USD setup, dial prefixes, takes calls]
const OFFERS = [
  ['BR', 'Brazil', 'multitel', 'mobile', 9.81, 0, ['55'], true],
  ['CA', 'Canada', 'multitel', 'local', 0.60, 0, [], true],
  ['CO', 'Colombia', 'multitel', 'mobile', 15.91, 0, ['57'], true],
  ['DK', 'Denmark', 'multitel', 'mobile', 9.81, 0, ['45'], true],
  ['LT', 'Lithuania', 'infobip', 'local', 9.76, 9.76, ['370'], false],
  ['NL', 'Netherlands', 'multitel', 'mobile', 1.11, 0, ['31'], true],
  ['PE', 'Peru', 'multitel', 'mobile', 24.98, 0, ['51'], true],
  ['PL', 'Poland', 'infobip', 'local', 19.52, 19.52, ['48'], false],
  ['PR', 'Puerto Rico', 'infobip', 'local', 0.98, 0.98, ['1787', '1939'], true],
  ['ES', 'Spain', 'infobip', 'local', 39.03, 9.76, ['34'], false],
  ['GB', 'United Kingdom', 'multitel', 'mobile', 0.70, 0, ['44'], true],
]
// Our cost per sent text segment, by sending provider and destination country.
const SMS_COST = {
  multitel: { BR: 0.08924, CA: 0.0164, CO: 0.06785, DK: 0.088895, LT: 0.064745, NL: 0.07935, PE: 0.4807, PL: 0.05405, PR: 0.13225, ES: 0.1426, GB: 0.05865, US: 0.0164 },
  infobip: { BR: 0.0294, CA: 0.0093, CO: 0.0052, DK: 0.044, LT: 0.047, NL: 0.093, PE: 0.268, PL: 0.036, PR: 0.037, ES: 0.071, GB: 0.044, US: 0.0083 },
}
const FLAG = (cc) => String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
const up = (x) => Math.ceil(Math.round(x * 10000) / 100) / 100
const round2 = (x) => Math.round(x * 100) / 100
const textPrice = (cost) => Math.max(TEXT_MIN, up(cost * MARKUP))
const extraPrice = (monthly) => Math.max(EXTRA_MIN, round2(monthly * MARKUP))

// TEXTING_PROVIDERS=multitel sells only providers whose two-way texting is live (unset = all).
const providerOn = (p) => { const on = String(process.env.TEXTING_PROVIDERS || '').split(',').map(x => x.trim()).filter(Boolean); return !on.length || on.includes(p) }
const list = () => OFFERS.filter(o => providerOn(o[2])).map(([iso, name, provider, type, monthly, setup, , voice]) => ({
  iso, name, flag: FLAG(iso), provider, type, monthly, setup, voice,
  smsCost: SMS_COST[provider][iso], textPrice: textPrice(SMS_COST[provider][iso]), extraPrice: extraPrice(monthly),
}))
const offerOf = (iso, type) => list().find(o => o.iso === iso && (!type || o.type === type)) || null

// Destination country of a phone number among the texting countries (+1 → only Puerto Rico here).
function destOf(phone) {
  const p = String(phone || '').replace(/^\+/, '')
  let best = null
  for (const [iso, , , , , , prefixes] of OFFERS) for (const pre of prefixes) if (p.startsWith(pre) && (!best || pre.length > best.pre.length)) best = { iso, pre }
  return best?.iso || null
}

// Sending from a MultiTEL / Infobip number to a texting country: two-way, priced 3x that route's cost.
function rateFor(num, to) {
  const provider = num?.provider
  if (!SMS_COST[provider]) return null
  const iso = destOf(to)
  if (!iso) return null
  const o = OFFERS.find(x => x[0] === iso)
  return { ok: true, mode: 'number', iso, country: o[1], price: textPrice(SMS_COST[provider][iso]) }
}
// Price per sent text for messages shown on a number's thread (its own country).
const localTextPrice = (num) => { const iso = destOf(num?.phone || num?.phoneNumber); return iso && SMS_COST[num?.provider] ? textPrice(SMS_COST[num.provider][iso]) : null }

module.exports = { list, offerOf, destOf, rateFor, localTextPrice, textPrice, extraPrice, TEXT_MIN, EXTRA_MIN, MARKUP }
