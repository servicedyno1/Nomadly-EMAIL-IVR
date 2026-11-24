'use strict'
// Country expansion (23 Nov 2026): Retell keeps US/CA, Infobip wins ties, 2Chat fills the rest, and Infobip
// "assigned after order" numbers run on the pending-order queue with company details typed in after payment.
const { MongoClient } = require('mongodb')
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
Object.assign(process.env, { NUMBER_PROVIDERS: 'retell,infobip,2chat', INFOBIP_API_KEY: 'x', TWOCHAT_API_KEY: 'x', RETELL_API_KEY: 'x',
  INFOBIP_SELL_COUNTRIES: 'AR,AT,CL,FR,HR,LT,MX,MY,PL,PR,RO,UA,ES,DO,PE,CR,EC,PY,AU,DK,SE,DE' })
const axios = require('axios')
const groups = {
  'IL|mobile': [{ id: 'g-il', prefix: '+972 (55)', location: 'Mobile', price: { monthly_price: '6.00', setup_price: '0.00' }, requirements: [], features: ['voice', 'sms_in'] }],
  'CO|local': [{ id: 'g-bog', prefix: '+57 (601)', location: 'Bogota', price: { monthly_price: '14.00' }, requirements: [], features: ['voice'] },
    { id: 'g-med', prefix: '+57 (604)', location: 'Medellin', price: { monthly_price: '14.00' }, requirements: [], features: ['voice'] },
    { id: 'g-id', prefix: '+57 (602)', location: 'Cali', price: { monthly_price: '14.00' }, requirements: [{ field_name: 'personal_id' }], features: ['voice'] }],
}
const realCreate = axios.create
axios.create = (cfg) => (String(cfg?.baseURL || '').includes('2chat') ? { get: async (p, o) => ({ data: { data: { groups: groups[`${o.params.country}|${o.params.did_type}`] || [] } } }) } : realCreate(cfg))

const cat = require('../number-catalog'), tc = require('../twochat'), ib = require('../infobip'), ir = require('../infobip/requests'), po = require('../pending-orders')
const tx = require('../texting-countries')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

// Infobip stand-in: resource requests + the account's number list.
const ibState = { posts: [], status: 'IN_PROGRESS', owned: [] }
ib.http = () => ({
  post: async (p, body) => { ibState.posts.push({ p, body }); if (p === '/resources/1/requests') { if (body.countryCode === 'SE') { const e = new Error('bad'); e.response = { status: 400, data: { description: 'Company name not accepted' } }; throw e } return { data: { id: `R-${body.countryCode}` } } } return { data: {} } },
  get: async (p) => (p.startsWith('/resources/1/requests/') ? { data: { status: ibState.status, note: 'country not served' } } : p === '/numbers/1/numbers' ? { data: { numbers: ibState.owned } } : { data: {} }),
  delete: async () => ({ data: {} }), put: async () => ({ data: {} }),
})

;(async () => {
  console.log('Catalog')
  ok(cat.best('US', 'local')?.provider === 'retell' && cat.best('US', 'toll_free')?.provider === 'retell' && cat.best('CA', 'local')?.provider === 'retell', 'USA + Canada stay with Retell')
  ok(!cat.best('CA', 'toll_free') && !cat.sold().CA?.includes('toll_free') && !cat.sold().US?.includes('mobile'), 'nobody else sells other types in USA / Canada')
  ok(cat.best('MX', 'local')?.provider === 'infobip' && cat.best('MX', 'toll_free')?.provider === '2chat', 'Mexico: local from Infobip, toll-free from 2Chat')
  ok(cat.best('DO', 'local')?.provider === 'ibreq' && cat.best('DO', 'toll_free')?.provider === '2chat' && cat.best('PE', 'local')?.provider === 'ibreq' && cat.best('PE', 'mobile')?.provider === '2chat', 'DR / Peru: local assigned by Infobip, other types from 2Chat')
  ok(['AU', 'DK', 'SE', 'DE', 'CR', 'EC', 'PY'].every(cc => cat.best(cc, 'local')?.provider === 'ibreq') && !cat.best('CY', 'local'), 'Infobip on-request countries listed, Cyprus left out')
  ok(cat.best('AU', 'local').sms && cat.best('AT', 'local').sms && !cat.best('DO', 'local').sms, 'texting flags: Australia + Austria yes, Dominican Republic no')
  const s = cat.sold()
  ok(s.IL?.join() === 'local,mobile,national,toll_free' && s.GB?.length === 3 && s.NZ?.join() === 'toll_free' && s.ES?.includes('local'), 'Israel 4 types, UK 3, New Zealand toll-free, Spain listed')
  ok(Object.keys(tc.COUNTRIES).length === 27 && !tc.sellsType('MX', 'local') && !tc.sellsType('US', 'toll_free'), '2Chat: 27 countries, never where Infobip / Retell sell the type')
  ok(tx.list().some(o => o.iso === 'AT') || process.env.TEXTING_PROVIDERS === 'multitel', 'Austria in the calls + texting list (when Infobip texting is on)')

  console.log('2Chat search')
  const il = await tc.searchNumbers('IL', 'mobile')
  ok(il.length === 1 && il[0].phone_number === '+97255' && /Mobile \+972 \(55\)/.test(il[0].region_information[0].region_name) && il[0].cost_information.monthly_cost === '6.00', 'Israel mobile: one location, its price')
  const co = await tc.searchNumbers('CO', 'local', '604')
  ok(co.length === 1 && co[0].phone_number === '+57604', 'Colombia area-code filter uses the country code (604 → Medellín)')
  ok((await tc.searchNumbers('CO', 'local')).every(n => n.phone_number !== '+57602'), 'locations that need ID are hidden')

  console.log('Infobip on request')
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(`test_numexp_${Date.now()}`)
  const admin = [], told = [], activated = [], credited = []
  ir.init({ db })
  await po.init({ db, notifyAdmin: (t) => admin.push(t), adminEmail: () => {}, send: (id, t) => told.push(t), email: () => {}, credit: async (id, a) => credited.push(a),
    removeNumber: async () => {}, activateNumber: async (id, phone, r) => activated.push({ id, phone, ...r }) })
  const [au] = ir.searchNumbers('AU', 'local'), [au2] = ir.searchNumbers('AU', 'local')
  ok(/^\+61000\d{6}$/.test(au.phone_number) && au.phone_number !== au2.phone_number && au._onRequest && au._capabilities.sms, 'Australia: a per-order placeholder (two buyers never clash), texts on')
  ok(ir.isSearched(au.phone_number) && ir.metaOf(au.phone_number).cc === 'AU' && !ir.isSearched('+61212345678'), 'placeholder recognised after a restart, real numbers are not')
  const order = await ir.buyNumber(au.phone_number)
  ok(order._pending && order._provider === 'infobip' && order._queue === 'ibreq' && !ibState.posts.length, 'paid order waits for company details — nothing sent to Infobip yet')
  ok(/Setting up your Australia number/.test(po.pendingMsg(au.phone_number)), 'customer sees "setting up your Australia number"')
  await po.enqueue({ chatId: 5001, phoneNumber: au.phone_number, order, amount: 70 })
  await wait(1700)
  ok(admin.some(t => /Infobip number request/.test(t) && /company name/.test(t)) && told.some(t => /company name and company address/.test(t) && /\/companydetails/.test(t)), 'admin told; bot customer asked for company name + address')
  await po.tick()
  ok(!ibState.posts.length, 'queue does not submit without the details')
  let err = null; try { await po.setDetails(5001, au.phone_number, { companyName: 'Acme Pty', companyAddress: 'x' }) } catch (e) { err = e.message }
  ok(/company address/.test(err || ''), 'too-short address refused')
  await po.setDetails(5001, au.phone_number, { companyName: 'Acme Pty Ltd', companyAddress: '1 George St, Sydney NSW 2000' }); await wait(300); await po.tick()
  const sub = ibState.posts.find(x => x.p === '/resources/1/requests')
  ok(sub?.body.countryCode === 'AU' && sub.body.capabilities.includes('SMS') && sub.body.requirements.find(r => r.key === 'companyAddress')?.value === '1 George St, Sydney NSW 2000', 'request sent to Infobip with the typed details and texting')
  let [w] = await po.waiting('ibreq')
  ok(w?.meta?.requestId === 'R-AU', 'request id kept on the order (survives restarts)')
  await db.collection('pendingNumberOrders').updateOne({ _id: w._id }, { $set: { nextTryAt: new Date(0) } }); await po.tick()
  ok((await po.waiting('ibreq')).length === 1 && !activated.length, 'still in review → keeps waiting')
  ibState.status = 'COMPLETED'; ibState.owned = [{ number: '61280001111', numberKey: 'K1', country: 'AU', capabilities: ['VOICE', 'SMS'] }]
  await db.collection('pendingNumberOrders').updateOne({ _id: w._id }, { $set: { nextTryAt: new Date(0) } }); await po.tick()
  ok(activated[0]?.phone === au.phone_number && activated[0].phoneNumber === '+61280001111' && activated[0].telnyxOrderId === 'ib:K1', 'assigned number replaces the placeholder')
  ok(ibState.posts.some(x => x.p === '/numbers/2/numbers/K1/voice') && ibState.posts.some(x => x.p === '/numbers/2/numbers/K1/sms'), 'calls and texts routed to CloudIVR')
  ok(told.some(t => /Your number \+61280001111 is ready/.test(t) && !/similar number/.test(t)), 'customer told it is ready')

  console.log('No details needed / declined')
  ibState.status = 'IN_PROGRESS'; ibState.posts.length = 0
  const [dr] = ir.searchNumbers('DO', 'local'), dro = await ir.buyNumber(dr.phone_number)
  ok(dro._pending && dro._meta.requestId === 'R-DO' && ibState.posts[0]?.body.countryCode === 'DO' && !ibState.posts[0].body.requirements.length, 'Dominican Republic: submitted straight away, no details')
  await po.enqueue({ chatId: 5002, phoneNumber: dr.phone_number, order: dro, amount: 50 })
  ibState.status = 'REJECTED'
  ;[w] = (await po.waiting('ibreq')).filter(o => o.chatId === 5002)
  await db.collection('pendingNumberOrders').updateOne({ _id: w._id }, { $set: { nextTryAt: new Date(0) } }); await po.tick()
  ok(credited.includes(50) && told.some(t => /couldn't set up your Dominican Republic number/.test(t)), 'declined by Infobip → refunded and told')
  const [se] = ir.searchNumbers('SE', 'local'), seo = await ir.buyNumber(se.phone_number)
  await po.enqueue({ chatId: 5003, phoneNumber: se.phone_number, order: seo, amount: 60 })
  await po.setDetails(5003, se.phone_number, { companyName: 'Nordic AB' }); await wait(300); await po.tick()
  ok(credited.includes(60), 'Infobip refusing the request itself → refunded')
  ok(!ir.searchNumbers('AU', 'mobile').length && !ir.searchNumbers('CY', 'local').length, 'only local, only listed countries')

  await db.dropDatabase(); await c.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
