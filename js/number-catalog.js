'use strict'
// Which provider sells each country + number type: least paperwork first (0 none, 1 name + address, 2 documents),
// then the cheaper monthly cost. Infobip local numbers (instant or request-based) vs MultiTEL (any type).
const ibc = require('./infobip/countries')
const mtc = require('./multitel/countries')
const health = () => require('./provider-health')
const ibOn = () => require('./infobip').selling() && !health().isDown('infobip')
const rtOn = () => require('./retell').selling()
const tcOn = () => require('./twochat').selling() && !health().isDown('2chat')
const mtOn = () => require('./multitel').selling() && !health().isDown('multitel')

// Retell's countries: nobody else sells any type there.
const RETELL_ONLY = ['US', 'CA']
// Same paperwork level: our own direct carriers before 2Chat (which needs a landing number + forward).
const RANK = { infobip: 0, ibreq: 0, retell: 0, multitel: 1, '2chat': 2 }
const ibr = () => require('./infobip/requests')

function options(cc, type) {
  const out = []
  if (RETELL_ONLY.includes(cc)) return rtOn() && require('./retell').sellsType(cc, type) ? [{ provider: 'retell', level: 0, cost: require('./retell').COST[type], sms: false }] : []
  const ibCost = mtc.INFOBIP_COST[cc] ?? 99
  if (ibOn() && type === 'local' && require('./infobip').sellsIn(cc)) {
    if (ibc.isInstant(cc)) out.push({ provider: 'infobip', level: 0, cost: ibCost, sms: ['US', 'CA', 'LT', 'PL', 'PR', 'ES', 'AT'].includes(cc) })
  }
  // Infobip assigns the number after the order (company details, if any, typed in after payment — no uploads).
  if (ibOn() && type === 'local' && !ibc.isInstant(cc) && ibr().sellsIn(cc)) out.push({ provider: 'ibreq', level: 0, cost: 9.83, sms: !!ibc.requestOf(cc).sms, onRequest: true })
  if (rtOn() && require('./retell').sellsType(cc, type)) out.push({ provider: 'retell', level: 0, cost: require('./retell').COST[type], sms: false })
  if (tcOn() && require('./twochat').sellsType(cc, type)) out.push({ provider: '2chat', level: 0, cost: require('./twochat').COST[type], sms: false })
  const m = mtOn() ? mtc.offer(cc, type) : null
  if (m) out.push({ provider: 'multitel', level: m.level, cost: m.monthly, businessOnly: m.businessOnly, address: m.address, sms: m.sms })
  // "On request" countries are ordered from MultiTEL after payment, only where MultiTEL has no pick-a-number offer.
  else if (mtOn() && type === 'local' && ibc.requestOf(cc)) out.push({ provider: 'multitel', level: 0, cost: 99, request: { details: 'none', localOnly: false } })
  return out.sort((a, b) => a.level - b.level || (RANK[a.provider] ?? 1) - (RANK[b.provider] ?? 1) || a.cost - b.cost)
}
const best = (cc, type) => options(cc, type)[0] || null

// Every country + type either provider sells: { cc: [types] }
function sold() {
  const all = {}
  const add = (cc, t) => { (all[cc] = all[cc] || new Set()).add(t) }
  if (rtOn()) { add('US', 'local'); add('US', 'toll_free'); add('CA', 'local') }
  if (tcOn()) for (const [cc, types] of Object.entries(require('./twochat').COUNTRIES)) for (const t of types) add(cc, t)
  if (ibOn()) for (const cc of Object.keys(ibc.REQUEST)) if (ibr().sellsIn(cc)) add(cc, 'local')
  if (ibOn()) for (const cc of Object.keys(ibc.INSTANT)) if (require('./infobip').sellsIn(cc)) add(cc, 'local')
  if (mtOn()) for (const cc of Object.keys(ibc.REQUEST)) add(cc, 'local')
  if (mtOn()) for (const [cc, types] of Object.entries(mtc.OFFERS)) for (const t of Object.keys(types)) add(cc, t)
  for (const cc of RETELL_ONLY) if (all[cc]) all[cc] = new Set([...all[cc]].filter(t => options(cc, t).length))
  return Object.fromEntries(Object.entries(all).map(([cc, s]) => [cc, ['local', 'mobile', 'national', 'toll_free'].filter(t => s.has(t))]))
}
// The US/CA provider chain beyond MultiTEL/Infobip; when nobody in it sells, US/CA show only the types the catalog sells.
const chainSells = () => String(process.env.TELNYX_FALLBACK || '').toLowerCase() === 'true' || String(process.env.NUMBER_PROVIDERS || 'multitel,infobip').toLowerCase().split(',').some(p => ['telnyx', 'signalwire', 'twilio'].includes(p.trim()))
const usCaTypes = (cc) => (chainSells() ? ['local', 'toll_free'] : sold()[cc] || [])
const nameOf = (cc) => ibc.INSTANT[cc] || ibc.REQUEST[cc]?.name || mtc.NAMES[cc] || (cc === 'GB' ? 'United Kingdom' : cc)

module.exports = { options, best, sold, nameOf, chainSells, usCaTypes }
