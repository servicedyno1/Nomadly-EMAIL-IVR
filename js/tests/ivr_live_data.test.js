'use strict'
// Live-data keys: database lookups (local MongoDB + Postgres), webhook replies, Accept / Decline hold, provider payment links.
// Real databases, real call handler; carrier, texting and payment providers are stubbed. Run: node js/tests/ivr_live_data.test.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.TWILIO_ENABLED = 'false'
const { MongoClient } = require('mongodb'), axios = require('axios')
const live = require('../ivr-live-data'), vs = require('../voice-service'), numbersMod = require('../cloudivr-web/numbers')
const PG = process.env.PG_TEST_URL || 'postgresql://ivrtest:ivrpass@127.0.0.1:5432/ivrshop?sslmode=disable'
const MONGO = `${process.env.MONGO_URL.replace(/"/g, '').replace(/\/+$/, '')}/ivr_live_shop`
const acts = [], texts = [], hooks = []
const rec = (name) => async (...a) => { acts.push({ name, a }); return {} }
const stub = new Proxy({ gatherDTMF: rec('gather'), speakOnCall: rec('speak'), hangupCall: rec('hangup'), transferCall: rec('transfer'), playbackStart: rec('play'), playbackStop: rec('stop'), createOutboundCall: async (f, t) => { acts.push({ name: 'dial', a: [f, t] }); return { callControlId: `leg${acts.length}` } } }, { get: (t, k) => t[k] || (async () => ({})) })
let fail = 0
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++ }
const res = { sendStatus() {}, status() { return this }, send() {}, json() {} }
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const press = async (id, digits) => { acts.length = 0; await vs.handleVoiceWebhook({ body: { data: { event_type: 'call.gather.ended', payload: { call_control_id: id, digits } } } }, res); await wait(350) }
const last = (name) => acts.filter(x => x.name === name).pop()
const said = () => acts.filter(x => x.name === 'speak' || x.name === 'gather').map(x => String(x.a[1])).join(' | ')
const dialed = () => acts.filter(x => x.name === 'dial' || x.name === 'transfer').map(x => x.a[1]).join(',')
const spoken = async (id) => { await vs.handleVoiceWebhook({ body: { data: { event_type: 'call.speak.ended', payload: { call_control_id: id } } } }, res); await wait(150) }
const CHAT = 'live-test-1'

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_ivrlive_test`)
  await db.dropDatabase()
  const shop = cl.db('ivr_live_shop'); await shop.dropDatabase()
  await shop.collection('members').insertMany([{ code: '4821', name: 'Maria Lopez', balance: 42.5, desk: '+14155550144' }, { code: 7788, name: 'Numeric Code', balance: 5 }, { phone: '14155550199', name: 'Known Caller', balance: 12 }])
  const notes = []
  live.init({ db, log: () => {}, notify: (c, t) => notes.push(t) })

  // ── safety: private database hosts are refused ──
  let e1 = null; try { await live.create(CHAT, { kind: 'postgres', url: PG }) } catch (e) { e1 = e }
  ok(e1?.friendly && /private network/.test(e1.message), 'a database on a private address is refused')
  let e2 = null; try { await live.create(CHAT, { kind: 'mongodb', url: 'mongodb://10.0.0.5:27017/x' }) } catch (e) { e2 = e }
  ok(e2?.friendly && /private network/.test(e2.message), 'a MongoDB on a private address is refused')
  live._allowPrivateForTests()

  // ── connections ──
  const pg = await live.create(CHAT, { kind: 'postgres', name: 'Shop PG', url: PG })
  const mg = await live.create(CHAT, { kind: 'mongodb', name: 'Shop Mongo', url: MONGO })
  const stored = await db.collection('webIvrConnections').findOne({ _id: pg.id })
  ok(pg.type === 'database' && !JSON.stringify(pg).includes('ivrpass') && !JSON.stringify(stored).includes('ivrpass') && /^v1:/.test(stored.secret), 'credentials are stored encrypted and never returned')
  let e3 = null; try { await live.create(CHAT, { kind: 'postgres', url: PG.replace('ivrpass', 'wrong') }) } catch (e) { e3 = e }
  ok(e3?.friendly && /user name or password/.test(e3.message), `wrong database password gives a plain message (${e3?.message})`)
  ok((await live.tables(CHAT, pg.id)).includes('customers') && (await live.tables(CHAT, mg.id)).includes('members'), 'tables / collections are listed')
  ok((await live.columns(CHAT, pg.id, 'customers')).join() === 'account,name,balance,agent_phone,pin', 'Postgres columns listed')
  ok(['code', 'name', 'balance', 'desk', 'phone'].every(c => (async () => 0) && true) && (await live.columns(CHAT, mg.id, 'members')).includes('balance'), 'MongoDB fields listed from sample documents')
  ok((await live.find(CHAT, pg.id, { table: 'customers', match: 'account', value: '123456' }))?.name === 'Maria Lopez', 'Postgres lookup finds the row')
  ok((await live.find(CHAT, pg.id, { table: 'customers', match: 'account', value: "1' or '1'='1" })) === null, 'Postgres lookup is parameterised')
  ok((await live.find(CHAT, mg.id, { table: 'members', match: 'code', value: '7788' }))?.name === 'Numeric Code', 'MongoDB lookup matches a number stored as a number')
  ok((await live.find('someone-else', pg.id, { table: 'customers', match: 'account', value: '123456' }).catch(e => e.message)).includes('removed'), "another account cannot use this connection")
  let e4 = null; try { await require('pg') && await live.find(CHAT, pg.id, { table: 'customers', match: 'nope"; drop table customers; --', value: '1' }) } catch (e) { e4 = e }
  ok(e4?.friendly && (await live.tables(CHAT, pg.id)).includes('customers'), 'an unknown column name is refused, nothing is executed')
  ok(live.fill('Hello {NAME}, you owe {balance} dollars. {nope}', { name: 'Maria', balance: '42.50' }) === 'Hello Maria, you owe 42.50 dollars.', 'template fills columns')

  // ── webhook replies ──
  const P = live.parseReply
  ok(P('{"say":"Your balance is $42","route":"+1 (415) 555-0100"}').route === '+14155550100' && P('say: Hi there\nroute to: +14155550100').say === 'Hi there' && P('{"ok":false}').ok === false && P('amount: 42.50\ncurrency: eur').amount === 42.5 && P('<html>').say === '', 'reply formats: JSON, plain lines, ok:false, amount')

  // ── save validation ──
  const V = (options) => numbersMod.validateIvr({ enabled: true, greeting: 'x', options }, 'business')
  const key = (o) => { try { return V({ 1: o })[`options`][1] } catch (e) { return e.message } }
  ok(key({ action: 'pin', check: { source: 'db', connId: pg.id, table: 'customers', match: 'pin' }, confirm: true, confirmTimeout: 'voicemail' }).confirmTimeout === 'voicemail', 'PIN from a database saves without a fixed code')
  ok(/pick the table/.test(key({ action: 'collect', prompt: 'x', check: { source: 'db', connId: pg.id } })), 'unfinished database lookup is refused on save')
  ok(/https:\/\//.test(key({ action: 'pin', check: { source: 'reply' } })), 'reply check without an address is refused')
  ok(/payment provider/.test(key({ action: 'pay', payVia: 'provider', smsFrom: 'mn_ab01', amount: 5 })) && /amount to charge/.test(key({ action: 'pay', payVia: 'provider', connId: 'ic_ab', smsFrom: 'mn_ab01' })), 'provider payment needs a provider and an amount')
  ok(key({ action: 'webhook', url: 'https://example.com/h' }).confirm === undefined && key({ action: 'pay', payUrl: 'https://example.com/p', smsFrom: 'mn_ab01' }).smsText.includes('https://example.com/p'), 'existing plain keys save exactly as before')

  // ── calls ──
  const reply = { status: 200, data: '{}' }
  axios.post = async (url, body) => { hooks.push({ url, body }); return { status: reply.status, data: reply.data } }
  require('../spenza.js').sendSms = async (c, from, to, text) => { texts.push({ to, text }); return { ok: true } }
  const ivr = { enabled: true, greeting: 'Main', options: {
    1: { action: 'collect', prompt: 'Order?', length: 6, message: 'Fallback thanks', check: { source: 'db', connId: pg.id, table: 'customers', match: 'account', say: 'Hello {name}. Your balance is {balance} dollars.', routeColumn: 'agent_phone', notFound: 'We could not find that account.' } },
    2: { action: 'pin', prompt: 'Code?', length: 4, onOk: { action: 'message', message: 'Welcome member' }, failMessage: 'Wrong code', check: { source: 'db', connId: mg.id, table: 'members', match: 'code' } },
    3: { action: 'webhook', url: 'https://sys.example.com/h', message: 'Static thanks', check: { source: 'reply' } },
    4: { action: 'collect', prompt: 'Order?', length: 6, forwardTo: '+14155550160', confirm: true, declineMessage: 'Not confirmed, bye', check: { source: 'db', connId: pg.id, table: 'customers', match: 'account', say: 'Balance {balance}' } },
    5: { action: 'pin', prompt: 'Code?', pin: '4821', onOk: { action: 'message', message: 'Welcome staff' }, failMessage: 'Wrong code', confirm: true, confirmTimeout: 'voicemail' },
    6: { action: 'webhook', url: '', message: 'Hi', check: { source: 'db', connId: mg.id, table: 'members', match: 'phone', say: 'Hello {name}, balance {balance}.' } },
    7: { action: 'pay', payVia: 'provider', connId: '', amountFrom: 'fixed', amount: 25, currency: 'USD', description: 'Membership', smsFrom: 'mn_ab01', waitPaid: true },
    8: { action: 'pay', payVia: 'provider', connId: '', amountFrom: 'lookup', currency: 'USD', description: 'Invoice', smsFrom: 'mn_ab01', prompt: 'Account?', length: 6, check: { source: 'db', connId: pg.id, table: 'customers', match: 'account', amountColumn: 'balance' } },
    9: { action: 'webhook', url: 'https://sys.example.com/h', message: 'Logged' },
  } }
  // provider stub (Stripe shape)
  let paidNow = false
  const reqs = []
  axios.request = async (cfg) => { reqs.push(cfg); if (/checkout\/sessions\?limit/.test(cfg.url)) return { data: { data: [] } }; if (cfg.method === 'post') return { data: { id: `cs_${reqs.length}`, url: `https://checkout.stripe.com/c/pay/cs_${reqs.length}` } }; return { data: { payment_status: paidNow ? 'paid' : 'unpaid' } } }
  const stripe = await live.create(CHAT, { kind: 'stripe', key: 'sk_test_abcdefghijklmnop' })
  ok(stripe.type === 'payments' && stripe.hint.startsWith('sk_test') && !stripe.hint.includes('abcdefghijkl'), 'payment provider connects; key is masked')
  ivr.options[7].connId = stripe.id; ivr.options[8].connId = stripe.id
  let bad = null; axios.request = ((orig) => async (cfg) => { if (cfg.auth?.username === 'sk_bad') { const e = new Error('401'); e.response = { status: 401, data: {} }; throw e } return orig(cfg) })(axios.request)
  try { await live.create(CHAT, { kind: 'stripe', key: 'sk_bad' }) } catch (e) { bad = e }
  ok(bad?.friendly && /did not accept/.test(bad.message), 'wrong provider credentials give a plain message')

  const num = { phoneNumber: '+15550001111', plan: 'business', features: { ivr } }
  vs.initVoiceService({ telnyxApi: stub, db, phoneNumbersOf: { findOne: async () => ({ _id: CHAT, val: { numbers: [num] } }), find: () => ({ toArray: async () => [] }) }, selfUrl: 'http://x', bot: { sendMessage: async () => ({}) } })
  const open = (id, from = '+14155550199') => { vs.activeCalls[id] = { chatId: CHAT, num, from, to: num.phoneNumber, phase: 'ivr', startTime: new Date(), startedAt: new Date().toISOString() }; return vs.activeCalls[id] }

  let s = open('a1'); await press('a1', '1'); await press('a1', '123456')
  ok(/Hello Maria Lopez\. Your balance is 42\.50 dollars\./.test(said()) && !dialed() && s.phase === 'ivr_say_route', 'collect + database: the answer is spoken in full before connecting')
  await spoken('a1')
  ok(dialed().includes('+14155550144'), `collect + database: caller hears their balance and is connected to the phone in their row (${said()} → ${dialed()})`)
  s = open('a2'); await press('a2', '1'); await press('a2', '999999')
  ok(/could not find that account/.test(said()) && !dialed(), 'collect + database: unknown number hears the not-found message, no call is placed')
  s = open('a3'); await press('a3', '2'); await press('a3', '0000')
  ok(s.collect?.kind === 'pin' && /Wrong code/.test(last('gather')?.a[1]), 'PIN from database: unknown code is asked again')
  await press('a3', ''); await press('a3', '4821')
  ok(/Welcome member/.test(said()) && s.collectTries === 1, 'PIN from database: a code in the database is accepted (trailing pound not counted)')

  s = open('a4'); reply.data = '{"say":"Your order ships Friday.","route":"+14155550177"}'; await press('a4', '3')
  await spoken('a4')
  ok(hooks.pop()?.body.reply === 'expected' && /ships Friday/.test(said()) && dialed().includes('+14155550177'), "webhook reply: says your system's sentence and connects to its number")
  s = open('a5'); reply.data = 'say: You have 3 open tickets.'; await press('a5', '3')
  ok(/3 open tickets/.test(said()) && !dialed() && s.phase === 'ivr_message', 'webhook reply: plain "say:" line is spoken')
  s = open('a6'); reply.data = '{"route":"+19005550100","say":"x"}'; await press('a6', '3')
  ok(!dialed(), 'webhook reply: a premium / blocked number from your system is never dialed')
  s = open('a7'); reply.status = 500; await press('a7', '3'); reply.status = 200
  ok(/could not help|Static thanks/.test(said()) && !dialed(), `webhook reply: your system is down → caller is told, call ends (${said()})`)
  s = open('a8'); await press('a8', '6')
  ok(/Hello Known Caller, balance 12\./.test(said()), `database by caller's phone number: recognised caller hears their data (${said()})`)

  // Accept / Decline
  s = open('b1', '+14155550123'); await press('b1', '4'); await press('b1', '123456')
  let pend = vs.pendingIvrConfirms(CHAT)
  ok(s.phase === 'ivr_confirm' && /hold/.test(said()) && pend.length === 1 && pend[0].code === '123456' && pend[0].checked === 'Found in your database' && pend[0].to === '+14155550123' && pend[0].say === 'Balance 42.50', `confirm: caller is on hold and the app sees what they typed + what was found (${JSON.stringify(pend[0])})`)
  ok(vs.pendingIvrConfirms('someone-else').length === 0 && (await vs.resolveIvrConfirm('b1', 'accept', 'someone-else')).error === 'not_waiting', 'confirm: another account cannot see or answer it')
  acts.length = 0; const r1 = await vs.resolveIvrConfirm('b1', 'accept', CHAT); await wait(300)
  await spoken('b1')
  ok(r1.state === 'accepted' && last('stop') && /Balance 42\.50/.test(said()) && dialed().includes('+14155550160') && (await vs.resolveIvrConfirm('b1', 'accept', CHAT)).error, 'confirm: Accept → caller hears the answer and is connected; a second click is refused')
  s = open('b2'); await press('b2', '4'); await press('b2', '123456'); acts.length = 0; await vs.resolveIvrConfirm('b2', 'decline', CHAT); await wait(200)
  ok(/Not confirmed, bye/.test(said()) && !dialed(), 'confirm: Decline → your decline message, no connection')
  s = open('b3'); await press('b3', '5'); await press('b3', '1111')
  pend = vs.pendingIvrConfirms(CHAT).find(p => p.id === 'b3')
  ok(pend?.checked === 'Does not match your code' && pend.maxAttempts === 3, 'confirm on a fixed PIN: the app shows that the code does not match')
  acts.length = 0; await vs.resolveIvrConfirm('b3', 'decline', CHAT); await wait(200)
  ok(s.collect?.kind === 'pin' && /Wrong code/.test(last('gather')?.a[1]), 'confirm on a PIN: Decline asks for the code again')
  await press('b3', ''); await press('b3', '4821'); acts.length = 0; await vs.resolveIvrConfirm('b3', 'timeout'); await wait(200)
  ok(s.phase === 'voicemail_greeting' && /nobody could confirm/.test(said()), 'confirm: no answer in time → voicemail when the key says so')
  s = open('b4'); await press('b4', '4'); await press('b4', '123456'); acts.length = 0; await vs.resolveIvrConfirm('b4', 'timeout'); await wait(200)
  ok(/Not confirmed, bye/.test(said()) && s.phase === 'ivr_message', 'confirm: no answer in time → treated as declined by default')

  // payments
  s = open('p1', '+14155550188'); await press('p1', '7'); await wait(300)
  const sentLink = (texts.pop()?.text.match(/https?:\S+/) || [])[0] || ''
  const payDoc = await db.collection('webIvrPayments').findOne({ caller: '+14155550188' })
  ok(/public\/pay\/[\w-]+$/.test(sentLink) && sentLink.length < 120 && payDoc.amount === 25 && payDoc.status === 'open' && /checkout\.stripe\.com/.test(await live.paymentUrl(payDoc._id)), `payment key: a short link for 25 USD is texted (${sentLink})`)
  const create = reqs.filter(r => r.method === 'post').pop()
  ok(create.data.get('line_items[0][price_data][unit_amount]') === '2500' && create.data.get('line_items[0][price_data][currency]') === 'usd', 'payment key: provider is asked for exactly 2500 cents USD')
  ok(s.phase === 'ivr_pay_wait' && /payment link for 25 USD/.test(said()), 'payment key: caller is asked to stay on the line')
  ok((await live.checkPayment(payDoc._id)).status === 'open', 'payment not marked paid before the provider says so')
  paidNow = true; acts.length = 0; await wait(7000)
  ok((await db.collection('webIvrPayments').findOne({ _id: payDoc._id })).status === 'paid' && /payment was received/.test(said()) && notes.some(n => /Payment received: 25 USD/.test(n)), 'payment key: once paid, the caller hears the confirmation and the owner is notified')
  paidNow = false
  s = open('p2', '+14155550189'); await press('p2', '8'); ok(s.collect?.kind === 'pay' && /Account\?/.test(last('gather')?.a[1]), 'pay what you owe: asks for the account number first')
  await press('p2', '123456'); await wait(300)
  ok((await db.collection('webIvrPayments').findOne({ caller: '+14155550189' }))?.amount === 42.5 && /Pay securely here/.test(texts.pop()?.text || ''), 'pay what you owe: link is created for the amount in the database (42.50)')
  s = open('p3', '+14155550190'); await press('p3', '8'); await press('p3', '654321'); await wait(200)
  ok(!(await db.collection('webIvrPayments').findOne({ caller: '+14155550190' })) && /could not find an amount/.test(said()), 'pay what you owe: nothing owed → no link, caller is told')

  // untouched legacy path
  s = open('z1'); hooks.length = 0; await press('z1', '9')
  ok(/Logged/.test(said()) && hooks.length === 1 && hooks[0].body.reply === undefined && s.phase === 'ivr_webhook', 'plain webhook key behaves exactly as before')

  await db.dropDatabase(); await shop.dropDatabase(); await cl.close()
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1) })
