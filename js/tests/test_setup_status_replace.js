'use strict'
// Setting-up status + bot Replace number flow (stubs, no live services).
const path = require('path')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`✅ ${name}`) } else { fail++; console.log(`❌ ${name} ${extra}`) } }

const docs = { pendingNumberOrders: [], birdCallerIdVerify: [], phoneNumbersOf: [], faxNumbers: [] }
const match = (d, q) => Object.entries(q).every(([k, v]) => (v && typeof v === 'object' && v.$in ? v.$in.includes(d[k]) : d[k] === v))
const db = { collection: (c) => ({ findOne: async (q) => docs[c].find(d => match(d, q)) || null, find: (q) => ({ toArray: async () => docs[c].filter(d => match(d, q)) }) }) }

const birdPath = path.join(__dirname, '..', 'bird', 'index.js')
let linked = new Set()
require.cache[require.resolve(birdPath)] = { exports: { enabled: () => true, presentable: async (n) => linked.has(n) } }
const S = require('../setup-status')
const V = require('../bird-callerid-verify')

;(async () => {
  ok('Bird retry is 3 min × 30 (~90 min)', V.LINK_RETRY_MS === 180000 && V.LINK_ROUNDS === 30)
  const n = { phoneNumber: '+19045550001', status: 'active', provider: 'retell', capabilities: { voice: true } }
  let s = await S.of(db, n)
  ok('new Retell number not yet linked → link stage', s?.stage === 'link' && s.callsIn === true && /about 5 min/.test(s.eta), JSON.stringify(s))
  docs.birdCallerIdVerify.push({ _id: '+19045550001', status: 'calling', expiresAt: new Date(Date.now() + 120000), armedAt: new Date() })
  s = await S.of(db, n)
  ok('verification call in progress → ready in ~2 min', s?.stage === 'link' && /about 2 min/.test(s.eta), JSON.stringify(s))
  docs.birdCallerIdVerify[0] = { _id: '+19045550001', status: 'failed', armedAt: new Date(Date.now() - 60000), rounds: 2 }
  s = await S.of(db, n)
  ok('failed try → next try in ~2 min', /next try in about 2 min/.test(s?.eta), JSON.stringify(s))
  docs.birdCallerIdVerify[0] = { _id: '+19045550001', status: 'failed', armedAt: new Date(), rounds: 30, gaveUpAt: new Date() }
  s = await S.of(db, n)
  ok('gave up → team stage', s?.stage === 'team', JSON.stringify(s))
  linked.add('+19045550001')
  ok('linked on Bird → ready (null)', (await S.of(db, n)) === null)
  ok('Telnyx number → never setting up', (await S.of(db, { ...n, phoneNumber: '+1999', provider: 'telnyx' })) === null)
  const p = { phoneNumber: '+19045550002', status: 'provisioning', provider: 'retell' }
  docs.pendingNumberOrders.push({ phoneNumber: '+19045550002', status: 'waiting', createdAt: new Date(), nextTryAt: new Date(Date.now() + 7 * 60000), tries: 1 })
  s = await S.of(db, p)
  ok('waiting supplier order → order stage, next try ~7 min, refund note', s?.stage === 'order' && /7 min/.test(s.eta) && /refunded/.test(s.note) && s.callsIn === false, JSON.stringify(s))
  docs.phoneNumbersOf.push({ _id: '42', val: { numbers: [n, p] } })
  docs.faxNumbers.push({ _id: '+12675550003', phoneNumber: '+12675550003', chatId: '42', status: 'active', provider: 'infobip_fax' })
  const b = await S.botBlock(db, '42', 'en')
  ok('bot block lists pending number + fax, not the ready one', b.includes('+19045550002') && b.includes('+12675550003') && !b.includes('+19045550001') && /sending faxes/.test(b), b)
  ok('bot block in French', /configuration/.test(await S.botBlock(db, '42', 'fr')))

  // Bot Replace number flow with a stubbed numbersApi.
  const calls = []
  const web = require.resolve('../cloudivr-web')
  require.cache[web] = { exports: { numbersApi: {
    REPLACE_PRICE: 25, OVERLAP_DAYS: 7,
    searchForReplace: async (chatId, old, ac) => { calls.push(['search', ac]); return [{ phoneNumber: '+19045559999', region: 'Jacksonville' }, { phoneNumber: '+19045558888' }] },
    pickFromSearch: async (chatId, phone) => ({ hit: { phoneNumber: phone }, country: 'US', type: 'local' }),
    replaceNumber: async (chatId, old, picked, o) => { calls.push(['replace', picked.hit.phoneNumber, o.channel]); return { status: 201, body: { number: { phoneNumber: picked.hit.phoneNumber }, releaseAt: '2026-12-01T00:00:00Z' } } },
  } } }
  const R = require('../bot-replace-number')
  const info = {}, sent = []
  let action = 'cpManageNumber', opened = null
  const old = { phoneNumber: '+19045550001', status: 'active', country: 'US', type: 'local' }
  const ctx = (message) => ({ chatId: '42', message, action, info, lang: 'en', num: old, db, setAction: async (v) => { action = v }, save: async (k, v) => { info[k] = v }, send: async (t, o) => { sent.push({ t, o }) }, kb: (rows) => rows, back: async () => { action = 'cpManageNumber' }, open: async (p) => { opened = p }, wallet: async () => 40 })
  ok('Replace offered for active number', R.offered(old) && !R.offered({ ...old, replacedBy: '+1' }))
  ok('menu button recognised (all languages)', ['en', 'fr', 'zh', 'hi'].every(l => R.isMenu(R.T(l).btn)))
  await R.start(ctx(R.T('en').btn), old)
  ok('start → intro with $25 + 7 days, asks area code', action === 'rpnArea' && /\$25/.test(sent[0].t) && /7 days/.test(sent[0].t))
  await R.handle(ctx(R.T('en').same('904')))
  ok('same area code → search 904, number buttons', calls[0][1] === '904' && action === 'rpnPick' && JSON.stringify(sent.at(-1).o).includes('+19045559999'))
  await R.handle(ctx('+10000000000'))
  ok('unknown pick → ask again', action === 'rpnPick')
  await R.handle(ctx('+19045559999'))
  ok('pick → review with wallet + pay button', action === 'rpnConfirm' && /balance \$40\.00/.test(sent.at(-1).t) && JSON.stringify(sent.at(-1).o).includes('Pay $25'))
  await R.handle(ctx(R.T('en').pay(25)))
  ok('pay → replaceNumber via bot channel, opens new number', calls.at(-1)[0] === 'replace' && calls.at(-1)[2] === 'bot' && opened === '+19045559999', JSON.stringify(calls))
  info.rpnFor = old.phoneNumber; action = 'rpnConfirm'
  await R.handle(ctx(R.T('fr').pay(25)))
  ok('French pay button recognised', calls.filter(c => c[0] === 'replace').length === 2)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
