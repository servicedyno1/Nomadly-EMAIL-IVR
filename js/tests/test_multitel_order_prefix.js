'use strict'
// Order-only MultiTEL prefixes (Germany/France): search shows the city, buying orders from the prefix and keeps the assigned number.
process.env.MULTITEL_USERNAME = 'u'; process.env.MULTITEL_PASSWORD = 'p'
const Module = require('module')
const origLoad = Module._load
Module._load = function (req, ...a) { if (req === '../callengine') return { setDidApps: async () => {} }; return origLoad.call(this, req, ...a) }
const calls = []
const routes = {
  'get getareas/DE': { status: { code: 200 }, response: [{ uuid: 'A1', name: 'Berlin', number_type: 'Local', available: 9, returns_numbers: 0 }] },
  'get getprefixes/A1': { status: { code: 200 }, response: [{ uuid: 'P1', prefix: '+4930', name: 'Berlin', available: 9, returns_numbers: 0, needs_registration: '1' }] },
  'get getprefix/P1': { status: { code: '200' }, response: { prices: [{ price_id: 'PR2', channels: 2, monthly_price: '1.00', setup_price: '0.00' }, { price_id: 'PR0', channels: 0, monthly_price: '0.70', setup_price: '0.00' }], features: ['voice_in'] } },
  'post order/P1': { status: { code: '200' }, response: { id: 'o1', numbers: ['4930123456'], needs_registration: 1 } },
  'post modifynumber/4930123456': { status: { code: '200' } },
}
const fakeAxios = async (cfg) => { calls.push(cfg); const k = `${cfg.method} ${cfg.url.split('/v3/')[1]}`; return { status: 200, data: routes[k] || { status: { code: 404 } } } }
const prevLoad = Module._load
Module._load = function (req, ...a) { return req === 'axios' ? fakeAxios : prevLoad.call(this, req, ...a) }
try { require('fs').unlinkSync(require('path').join(require('os').tmpdir(), 'multitel-auth-block-v4')) } catch {}
const mt = require('../multitel')
let pass = 0, fail = 0
const it = (n, ok) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${n}`) }
;(async () => {
  const r = await mt.searchNumbers('DE', 'local', null, 5)
  it('search lists the city for an order-only prefix', r.length === 1 && r[0].phone_number === '+4930' && r[0]._assigned && r[0].region_information[0].region_name === 'Berlin')
  it('cheapest plan price is shown', r[0].cost_information.monthly_cost === '0.70')
  it('it is buyable through the MultiTEL path', mt.isMtSearched('+4930') && mt.isAssigned('+4930'))
  const o = await mt.buyNumber('+4930')
  const order = calls.find(c => c.method === 'post' && c.url.endsWith('order/P1'))
  it('buy posts one order to the prefix with its price plan', !!order && /quantity=1/.test(order.data) && /price_id=PR0/.test(order.data) && /channels=0/.test(order.data))
  it('the assigned number is returned as the bought number', o && o._retriedNumber === '+4930123456' && o.id === 'mt:4930123456' && o._needsRegistration === true)
  it('the assigned number is routed to our SIP server', calls.some(c => c.url.endsWith('modifynumber/4930123456')))
  it('the placeholder is no longer buyable twice', !mt.isMtSearched('+4930'))
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
