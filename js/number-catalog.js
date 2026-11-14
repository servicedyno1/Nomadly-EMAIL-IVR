'use strict'
// Which provider sells each country + number type: least paperwork first (0 none, 1 name + address, 2 documents),
// then the cheaper monthly cost. Infobip local numbers (instant or request-based) vs MultiTEL (any type).
const ibc = require('./infobip/countries')
const mtc = require('./multitel/countries')
const ibOn = () => require('./infobip').enabled()
const mtOn = () => require('./multitel').enabled()

function options(cc, type) {
  const out = []
  const ibCost = mtc.INFOBIP_COST[cc] ?? 99
  if (ibOn() && type === 'local') {
    if (ibc.isInstant(cc)) out.push({ provider: 'infobip', level: 0, cost: ibCost, sms: ['US', 'CA', 'LT', 'PL', 'PR', 'ES'].includes(cc) })
    const r = ibc.requestOf(cc)
    if (r) out.push({ provider: 'infobip', level: r.keys.length ? 1 : 0, cost: ibCost + 0.01, request: { details: r.keys.length ? (r.keys.includes('companyAddress') ? 'name_address' : 'name') : 'none', localOnly: r.clientType === 'LOCAL' } })
  }
  const m = mtOn() ? mtc.offer(cc, type) : null
  if (m) out.push({ provider: 'multitel', level: m.level, cost: m.monthly, businessOnly: m.businessOnly, address: m.address, sms: m.sms })
  return out.sort((a, b) => a.level - b.level || a.cost - b.cost)
}
const best = (cc, type) => options(cc, type)[0] || null

// Every country + type either provider sells: { cc: [types] }
function sold() {
  const all = {}
  const add = (cc, t) => { (all[cc] = all[cc] || new Set()).add(t) }
  if (ibOn()) for (const cc of [...Object.keys(ibc.INSTANT), ...Object.keys(ibc.REQUEST)]) add(cc, 'local')
  if (mtOn()) for (const [cc, types] of Object.entries(mtc.OFFERS)) for (const t of Object.keys(types)) add(cc, t)
  return Object.fromEntries(Object.entries(all).map(([cc, s]) => [cc, ['local', 'mobile', 'national', 'toll_free'].filter(t => s.has(t))]))
}
const nameOf = (cc) => ibc.INSTANT[cc] || ibc.REQUEST[cc]?.name || mtc.NAMES[cc] || cc

module.exports = { options, best, sold, nameOf }
