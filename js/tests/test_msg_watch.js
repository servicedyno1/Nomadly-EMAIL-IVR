// Spam text watch. Run: node js/tests/test_msg_watch.js (needs a throwaway mongod on 27999 or MONGO_URL)
const { MongoClient } = require('mongodb')
const MW = require('../msg-watch')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27017')
  const db = cl.db('mw_test_' + Date.now())
  const sent = [], edits = [], acks = []; let cb
  const bot = { on: (e, f) => { cb = f }, sendMessage: async (id, t, o) => { sent.push({ id, t, o }); return {} }, answerCallbackQuery: async (i, o) => { acks.push(o) }, editMessageText: async (t) => { edits.push(t) } }
  const ai = async (t) => (/toll|prize|verify/i.test(t) ? { flag: true, kind: 'phishing', reason: 'fake toll link' } : { flag: false })
  MW.init({ db, bot, adminChatId: '1', log: () => {}, brand: 'Test', ai })
  ok('normal text passes, no alert', (await MW.gate({ chatId: '9', where: 'x', from: '+1', to: '+2', text: 'Hi John, your appointment is at 3pm tomorrow.' })).act === 'send' && !sent.length)
  const g1 = await MW.gate({ chatId: '9', where: 'Text', from: '+1', to: '+2', text: 'Unpaid toll balance. Pay now http://x.co/a' })
  ok('hold off (default): caught text still sent + alert without buttons', g1.act === 'send' && sent.length === 1 && !sent[0].o.reply_markup && /Alert only/.test(sent[0].t))
  await MW.setHold(true, 't')
  let released = null, refunded = null
  MW.register('t', { approve: async (a) => { released = a }, reject: async (a) => { refunded = a } })
  const g2 = await MW.gate({ chatId: '9', where: 'Text', from: '+1', to: '+2', text: 'You won a prize! verify at http://x.co/b' })
  await MW.attach(g2.id, { type: 't', n: 1 })
  ok('hold on: caught text held + alert with buttons', g2.act === 'hold' && sent[1].o.reply_markup.inline_keyboard[0].length === 2)
  await cb({ id: 'q', data: `mw:a:${g2.id}`, from: { id: 5 } })
  ok('non-admin cannot decide', released === null && acks[0].show_alert)
  await cb({ id: 'q', data: `mw:a:${g2.id}`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 7 } })
  ok('approve → really sent, alert updated', released?.n === 1 && /Approved/.test(edits[0]))
  await cb({ id: 'q', data: `mw:r:${g2.id}`, from: { id: 1 } })
  ok('second tap changes nothing', refunded === null)
  const g3 = await MW.gate({ chatId: '9', where: 'Text', from: '+1', to: '+3', text: 'Final notice: verify your account http://x.co/c' })
  await MW.attach(g3.id, { type: 't', n: 2 }); await MW.decide(g3.id, false, '1')
  ok('reject → charge given back, not sent', refunded?.n === 2 && released.n === 1)
  const key = 'camp:c1:abc'
  const c1 = await MW.gate({ groupKey: key, chatId: '9', where: 'BulkSMS campaign', text: 'Claim your prize now: verify http://x.co/d' }), n = sent.length
  const c2 = await MW.gate({ groupKey: key, chatId: '9', where: 'BulkSMS campaign', text: 'Claim your prize now: verify http://x.co/d' })
  ok('campaign: one alert, every text waits', c1.act === 'hold' && c2.act === 'hold' && sent.length === n)
  await MW.decide(c1.id, false, '1')
  ok('campaign rejected → texts dropped', (await MW.gate({ groupKey: key, chatId: '9', where: 'x', text: 'y' })).act === 'reject')
  const before = sent.length
  ok('received scam text → alert only', await MW.inbound({ chatId: '9', where: 'in', from: '+5', to: '+1', text: 'Unpaid toll, pay http://x.co/z' }) && sent.length === before + 1 && !sent[before].o.reply_markup)
  await MW.inbound({ chatId: '9', where: 'in', from: '+5', to: '+1', text: 'Unpaid toll, pay http://x.co/z' })
  ok('same received text alerts once a day', sent.length === before + 1)
  await db.collection('phoneLogs').insertMany([{ chatId: '9', phoneNumber: '+1', from: '+6', type: 'sms', direction: 'inbound', body: 'verify your card http://x.co/q' }, { chatId: '9', phoneNumber: '+1', from: '+7', type: 'sms', direction: 'inbound', body: 'see you at 5' }])
  await MW.inboundTick(); await MW.inboundTick()
  ok('inbox reader alerts on the scam text only, once', sent.length === before + 2)
  MW._S.ai = async () => { throw new Error('down') }; MW._reset(); await MW.setHold(false)
  ok('AI down → rules still catch, others pass', (await MW.verdict('Your package is held, reschedule http://x.co/p')).flagged && !(await MW.verdict('Lunch at noon tomorrow?')).flagged)
  ok('/spamhold on switches hold', /held for your decision/.test(await MW.command('/spamhold on')) && await MW.holdOn())
  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
