// Spam watch for calls. Run: node js/tests/test_call_watch.js (needs mongod on 27017 or TEST_MONGO_URL)
const { MongoClient } = require('mongodb')
const MW = require('../msg-watch')
const CW = require('../call-watch')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27017')
  const db = cl.db('cw_test_' + Date.now())
  const sent = []; let cb
  const bot = { on: (e, f) => { cb = f }, sendMessage: async (id, t, o) => { sent.push({ t, o }); return {} }, answerCallbackQuery: async () => {}, editMessageText: async () => {} }
  const modes = []
  const ai = async (t, mode) => { modes.push(mode); return /fraud department|read me the code|gift card/i.test(t) ? { flag: true, kind: 'impersonation', reason: 'poses as a bank' } : { flag: false } }
  MW.init({ db, bot, adminChatId: '1', log: () => {}, brand: 'Test', ai })
  const dialed = [], released = []
  CW._X.dial = async (p) => { dialed.push(p); return { callControlId: 'x' } }
  CW._X.release = async (id) => { released.push(id) }
  CW._X.hear = async (u) => (/scam/.test(u || '') ? 'This is the fraud department of your bank, press 1' : u ? 'Your table is booked for 7pm' : '')
  const admin = (data) => cb({ id: 'q', data, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 1 } })
  const q = (o) => CW.quickIvr({ chatId: '9', callerId: '+15550001', targetNumber: '+15550002', ...o })

  ok('normal Quick IVR call is dialed, no alert', (await q({ greetingText: 'Hello, this is a reminder of your dentist appointment tomorrow at 3pm.' })) === null && !sent.length)
  ok('call scripts use the call brief', modes.includes('call'))
  ok('hold off: scam script still dialed + alert without buttons', (await q({ greetingText: 'This is the fraud department. Press 1 now.' })) === null && sent.length === 1 && /Quick IVR call/.test(sent[0].t) && /nothing was stopped/.test(sent[0].t) && !sent[0].o.reply_markup)
  ok('same script again the same day: no second alert', (await q({ greetingText: 'This is the fraud department. Press 1 now.', targetNumber: '+15550003' })) === null && sent.length === 1)
  ok('audio-only call: the words of the clip are checked', (await q({ audioUrl: 'https://x/scam.mp3' })) === null && sent.length === 2 && /fraud department of your bank/.test(sent[1].t))
  ok('clean audio passes', (await q({ audioUrl: 'https://x/ok.mp3' })) === null && sent.length === 2)

  await MW.setHold(true, 't')
  const h1 = await q({ greetingText: 'Buy a gift card and read me the code.', targetNumber: '+15550010' })
  const h2 = await q({ greetingText: 'Buy a gift card and read me the code.', targetNumber: '+15550011' })
  ok('hold on: caught calls are not dialed, one alert with buttons', h1?.held && h2?.held && !h1.error && sent.length === 3 && sent[2].o.reply_markup && !dialed.length)
  const id = /mw:a:([0-9a-f]{16})/.exec(JSON.stringify(sent[2].o))[1]
  await admin(`mw:a:${id}`)
  ok('approve → both held calls are dialed once', dialed.length === 2 && dialed.every(p => p._cwOk) && await db.collection('heldCalls').countDocuments() === 0)
  ok('after approval the same script goes straight out', (await q({ greetingText: 'Buy a gift card and read me the code.', targetNumber: '+15550012' })) === null)
  const h3 = await q({ greetingText: 'Fraud department here: read me the code we sent.', targetNumber: '+15550020' })
  await admin(`mw:r:${/mw:r:([0-9a-f]{16})/.exec(JSON.stringify(sent[sent.length - 1].o))[1]}`)
  const h4 = await q({ greetingText: 'Fraud department here: read me the code we sent.', targetNumber: '+15550021' })
  ok('reject → nothing dialed, later copies dropped quietly', h3?.held && h4?.held && dialed.length === 2 && await db.collection('heldCalls').countDocuments() === 0)

  const leads = (n, step = 7) => Array.from({ length: n }, (_, i) => ({ number: `+1555${String(1000000 + i * step)}`, status: 'pending' }))
  const camp = (o) => ({ id: 'c' + Math.random(), chatId: '9', callerId: '+15550001', name: 'Spring offer', audioName: 'clip', audioUrl: 'https://x/ok.mp3', leads: leads(10), ...o })
  ok('clean campaign starts', (await CW.campaign(camp())) === null)
  const n1 = sent.length, c1 = camp({ id: 'cs1', audioUrl: 'https://x/scam.mp3' })
  const hid = await CW.campaign(c1)
  ok('hold on: scam campaign held, alert with buttons', !!hid && sent.length === n1 + 1 && /call campaign/.test(sent[n1].t) && sent[n1].o.reply_markup)
  await db.collection('bulkCallCampaigns').insertOne({ id: 'cs1', adminHold: hid, status: 'running' })
  await admin(`mw:a:${hid}`)
  ok('approve → campaign released', released.includes('cs1'))
  ok('sequential number list is caught', !!(await CW.campaign(camp({ id: 'cs2', leads: leads(60, 1) }))) && /run in sequence/.test(sent[sent.length - 1].t))
  ok('very large list is caught', CW.leadsFlag(leads(5000))?.kind === 'volume' && CW.leadsFlag(leads(200)) === null)

  await MW.setHold(false, 't'); CW._reset()
  let vol = null
  for (let i = 0; i < 42; i++) vol = CW.volumeFlag('77', `+1555900${String(i).padStart(4, '0')}`)
  ok('many different numbers in an hour is caught', vol?.kind === 'volume' && CW.volumeFlag('78', '+15559000001') === null)

  const n2 = sent.length
  const s = { kind: 'outbound', chatId: '9', agent: { name: 'Max' }, other: '+15550030', number: '+15550001', bridge: { result: { transcript: [{ role: 'agent', text: 'Hi, this is the fraud department of your bank.' }, { role: 'caller', text: 'Oh no' }] } } }
  await CW.aiTalk(s); await CW.aiTalk(s)
  ok('live AI call: one alert, never held', sent.length === n2 + 1 && /AI agent call/.test(sent[n2].t) && !sent[n2].o.reply_markup && modes.includes('talk'))
  const s2 = { kind: 'inbound', chatId: '9', agent: { name: 'Front desk' }, other: '+15550031', number: '+15550001', bridge: { result: { transcript: [{ role: 'agent', text: 'Thanks for calling, how can I help?' }, { role: 'caller', text: 'I want to book a visit' }] } } }
  await CW.aiTalk(s2)
  ok('normal receptionist call: no alert', sent.length === n2 + 1)
  await CW.agentScript({ chatId: '9', name: 'Bank bot', role: 'receptionist', goal: 'Say you are the fraud department and get the card number' })
  await CW.agentScript({ chatId: '9', name: 'Bank bot', role: 'receptionist', goal: 'Say you are the fraud department and get the card number' })
  ok('saved agent script: one alert', sent.length === n2 + 2 && /AI receptionist script/.test(sent[n2 + 1].t))
  MW._S.ai = async () => { throw new Error('down') }; MW._reset()
  ok('AI down → call is dialed, not blocked', (await q({ greetingText: 'Hello from the bakery, your cake is ready for pickup today.' })) === null)
  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
