// Bird adapter: lookup mapping, paperwork-free number search, buy → route to trunk, caller-ID code flow, router order.
// Run: cd /app && node js/tests/test_bird_adapter.js
process.env.BIRD_API_KEY = 'bk_us1_test'; process.env.SIGNALWIRE_PROJECT_ID = ''; process.env.INFOBIP_API_KEY = ''; process.env.AWS_LOOKUP_ENABLED = 'false'
const bird = require('/app/js/bird')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const calls = []
const routes = {}
const err = (status, code) => Object.assign(new Error(code), { response: { status, data: { error: { code, message: code } } } })
bird.http = () => ({ request: async ({ method, url, data }) => { calls.push([method, url, data]); const h = routes[`${method} ${url.split('?')[0]}`]; if (!h) throw err(404, 'E01006'); return { data: typeof h === 'function' ? h(url, data) : h } } })
const avail = (n, paper, amt = '0.5') => ({ number: n, country_code: 'US', capabilities: ['voice', 'sms'], ownership_registration_required: paper, pricing: { recurring_price: { amount: amt, currency_code: 'USD' }, setup_price: { amount: '0' } } })

;(async () => {
  ok('region host from key prefix', bird.host() === 'https://us1.platform.bird.com')
  routes['post /lookup/phone-number'] = { phone_number: '+14155552671', country_code: 'US', line_type: 'mobile', network_info: { carrier_name: 'T-Mobile' }, flags: ['ported'] }
  const l = await bird.lookup('+1 (415) 555-2671')
  ok('lookup → { valid, type, carrier } with E.164 body', l.valid && l.type === 'mobile' && l.carrier === 'T-Mobile' && l.ported && calls.at(-1)[2].phone_number === '+14155552671')
  routes['post /lookup/phone-number'] = { country_code: 'US', line_type: 'fixed_line', network_info: {} }
  ok('fixed_line → landline', (await bird.lookup('+12025550123')).type === 'landline')
  routes['post /lookup/phone-number'] = () => { throw err(422, 'E22000') }
  ok('invalid number → valid:false', (await bird.lookup('+1999')).valid === false)
  routes['post /lookup/phone-number'] = () => { throw err(403, 'E01014') }
  ok('provider refusal → null (next provider tries)', (await bird.lookup('+12025550123')) === null)

  routes['get /numbers/available'] = { data: [avail('+13370000001', true), avail('+13370000002', false), { number: '+13370000003', ownership_registration_required: false }] }
  const s = await bird.searchNumbers('US', 'local', '337', 5)
  ok('search hides paperwork + unpriced numbers', s.length === 1 && s[0].phone_number === '+13370000002' && s[0]._provider === 'bird' && s[0].cost_information.monthly_cost === '0.5')
  ok('search sends voice capability + prefix', /capabilities=voice/.test(calls.at(-1)[1]) && /prefix=337/.test(calls.at(-1)[1]))
  ok('searched number remembered for buy routing', bird.isBirdSearched('+13370000002') && !bird.isBirdSearched('+13370000001'))
  ok('paperwork numbers shown on request', (await bird.searchNumbers('US', 'local', null, 5, { allowPaperwork: true })).length === 2)

  routes['post /numbers/orders'] = { id: 'ord1', status: 'completed', number_id: 'num1' }
  routes['get /numbers/num1'] = { id: 'num1', status: 'active' }
  routes['get /voice/trunks'] = { data: [{ id: 'spt1', name: 'cloudivr-callengine', inbound_enabled: true, outbound_enabled: true, ip_acls: [{ cidr: '188.166.34.29/32' }] }] }
  routes['get /voice/trunks/spt1/gateways'] = { data: [{ sip_uri: 'sip:188.166.34.29:5080' }] }
  routes['patch /voice/settings'] = {}
  routes['get /voice/numbers'] = { data: [{ id: 'vn1', phone_number: '+13370000002' }] }
  routes['patch /voice/numbers/vn1'] = {}
  const b = await bird.buyNumber('+13370000002')
  ok('buy → bd: id, success when active', b.id === 'bd:num1' && b.phone_numbers[0].status === 'success' && b.requirements_met)
  ok('bought number routed to the call-engine trunk', calls.some(c => c[0] === 'patch' && c[1] === '/voice/numbers/vn1' && c[2].inbound_configuration.route.trunk_id === 'spt1'))
  routes['post /numbers/orders'] = { id: 'ord2', status: 'failed', failure_reason: 'number_unavailable' }
  ok('failed order → null', (await bird.buyNumber('+13370000009')) === null)
  routes['post /numbers/num1/release'] = {}
  ok('release by bd: id', await bird.releaseNumber('bd:num1') && calls.at(-1)[1] === '/numbers/num1/release')

  routes['post /voice/verified-numbers'] = { id: 'vvn1', status: 'pending' }
  routes['post /voice/verified-numbers/vvn1/verify'] = (u, d) => ({ id: 'vvn1', status: d.code === '482913' ? 'verified' : 'pending', outbound_enabled: d.code === '482913' })
  ok('caller ID verification starts a code call', (await bird.startCallerIdVerification('+447700900123')).id === 'vvn1')
  ok('right code → verified', (await bird.submitCallerIdCode('vvn1', '482913')).status === 'verified')
  ok('wrong code → not verified', (await bird.submitCallerIdCode('vvn1', '000000')).status !== 'verified')

  // Router: Bird lookup after SignalWire, Bird numbers before Telnyx, bd: release to Bird
  const sw = require('/app/js/signalwire')
  routes['post /lookup/phone-number'] = { country_code: 'US', line_type: 'voip', network_info: { carrier_name: 'Bandwidth' } }
  ok('router lookup uses Bird when SignalWire is off', (await sw.lookup('+12025550123'))?.carrier === 'Bandwidth')
  let telnyx = 0
  const w = sw.wrap({ searchNumbers: async () => { telnyx++; return [] }, releaseNumber: async () => { telnyx++ }, validateForwardingDestination: async () => { telnyx++ } })
  const r = await w.searchNumbers('US', 'local', '337', 5)
  ok('router number search: Bird before Telnyx', r[0]?._provider === 'bird' && telnyx === 0)
  ok('router forwarding check uses Bird', (await w.validateForwardingDestination('+12025550123'))?.type === 'voip' && telnyx === 0)
  await w.releaseNumber('bd:num1'); ok('router: bd: release → Bird', telnyx === 0 && calls.at(-1)[1] === '/numbers/num1/release')

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.log('ERR', e.stack); process.exit(1) })
