// Unlimited single texts (freeOneSends 0) + the abuse guard: slow down → point to a campaign → block.
// Run from /app: node js/tests/test_bulk_esim_one_guard.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '200'
delete process.env.SPENZA_BULK_API_KEY; delete process.env.SPENZA_BULK_API_SECRET
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core'), { t } = require('../bulk-esim/i18n')
const COLS = ['bsConfig', 'bsAccounts', 'bsEsims', 'bsEsimDaily', 'bsDemand', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsFreeTests', 'bsDrafts', 'bsReviews']
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), M = db.collection('bsMessages'), CU = db.collection('bsCustomers')
  for (const c of COLS) await db.collection(c).deleteMany({})
  const all = [], alerts = { get length() { return all.filter(a => /Single texts/.test(a)).length } }
  const AL = () => all.filter(a => /Single texts/.test(a))
  await B.init({ db, log: () => {}, notifyAdmin: (x) => all.push(x) })
  await B.setConfig({ quietStart: 0, quietEnd: 24 }, 'test'); await B.bootstrap(); await B.healthCheck()
  const mk = async (brand, id) => (await B.customer(brand, id, { username: `u${id}` }))._id
  const num = (base, i) => `+1212555${base + i}`
  const old = (cid, min) => M.updateMany({ cid }, { $set: { createdAt: new Date(Date.now() - min * 60000) } })

  // Limit still on by default.
  const capped = await mk('Nomadly', 9001)
  await B.sendOne(capped, num(1000, 0), 'a'); await B.sendOne(capped, num(1000, 1), 'b')
  ok('default: still 2 free single texts', (await B.sendOne(capped, num(1000, 2), 'c')).error === 'err_one_used')

  await B.setConfig({ freeOneSends: 0 }, 'test')
  ok('opened up: no lifetime limit', (await B.oneLeft(capped)) === Infinity && (await B.sendOne(capped, num(1000, 3), 'd')).ok)

  // Normal person: a handful of different texts to different people → never touched.
  const human = await mk('Nomadly', 9002); let r
  const chats = ['Hey are we still on for dinner tonight', 'Running late be there in ten', 'Can you send me the address please', 'Happy birthday hope you have a great day']
  for (let i = 0; i < 4; i++) r = await B.sendOne(human, num(2000, i), chats[i])
  ok('normal use is not flagged', r.ok && r.left === null && !(await CU.findOne({ _id: human })).oneGuard)
  ok('texting the same person again is free', (await B.sendOne(human, num(2000, 0), chats[1])).ok)

  // Same pitch to many new numbers → slowed at the 6th near-identical text.
  const spam = await mk('Nomadly', 9003), pitch = (n) => `Hi ${n}, limited offer on car insurance today only, call us now`
  for (let i = 0; i < 5; i++) { r = await B.sendOne(spam, num(3000, i), pitch(['Ann', 'Bob', 'Cy', 'Di', 'Ed'][i])); await old(spam, 11 + i) }
  ok('5 near-identical texts still pass', r.ok)
  await M.updateOne({ _id: r.messageId }, { $set: { createdAt: new Date() } })
  r = await B.sendOne(spam, num(3000, 5), pitch('Flo'))
  ok('6th near-identical text to a new number is slowed', r.error === 'err_one_slow' && r.args[0] > 0, JSON.stringify(r))
  ok('admin alerted once, with the facts', alerts.length === 1 && /slowed down/.test(AL()[0]) && /@u9003/.test(AL()[0]) && /car insurance/.test(AL()[0]))
  ok('slow-down text reads well', /10 min/.test(t('en', 'err_one_slow', 10)) && !!t('fr', 'err_one_bulk') && !!t('fa', 'err_one_blocked'))
  await old(spam, 30)
  ok('after the wait the next new number goes', (await B.sendOne(spam, num(3000, 5), pitch('Flo'))).ok && alerts.length === 1)

  // A number that answered is a conversation: always allowed, never counted.
  await M.insertOne({ _id: 'in1', cid: spam, direction: 'in', from: num(3000, 0), to: '+10000000000', body: 'who is this', createdAt: new Date() })
  ok('recipient who replied can always be texted', (await B.sendOne(spam, num(3000, 0), pitch('Ann'))).ok)

  // Keeps going → refused for the day and pointed to a campaign.
  for (let i = 6; i < 12; i++) { await old(spam, 30); r = await B.sendOne(spam, num(3000, i), pitch(`P${i}`)) }
  ok('past twice the threshold: refused, pointed to a campaign', r.error === 'err_one_bulk', JSON.stringify(r))
  ok('second alert says refused for 24 h', alerts.length === 2 && /refused for 24 h/.test(AL()[1]))
  ok('strike recorded, not blocked yet', (await CU.findOne({ _id: spam })).oneGuard.strikes === 1 && !(await CU.findOne({ _id: spam })).oneGuard.blocked)

  // Second day at that level → blocked, across the user's other brand accounts too.
  await db.collection('bsConfig').deleteMany({ _id: /^oneguard:/ })
  r = await B.sendOne(spam, num(3000, 40), pitch('Zed'))
  ok('repeat offender is blocked', r.error === 'err_one_blocked' && (await CU.findOne({ _id: spam })).oneGuard.blocked && /BLOCKED/.test(AL()[2] || ''))
  const alt = await mk('Hostbay', 9003)
  ok('same Telegram user on another brand is blocked too', (await B.sendOne(alt, num(3000, 41), 'hello there my friend')).error === 'err_one_blocked')
  ok('admin can list and clear', (await B.oneGuardList()).some(x => x._id === spam) && (await B.oneGuardSet(spam, 'clear', 'test')).ok && !(await CU.findOne({ _id: spam })).oneGuard)
  ok('admin can trust a sender', (await B.oneGuardSet(spam, 'trust', 'test')).ok && (await B.sendOne(spam, num(3000, 42), pitch('Yo'))).ok)

  // Fan-out with different texts: 11th new number in a day is slowed.
  const fan = await mk('Nomadly', 9004)
  for (let i = 0; i < 10; i++) { r = await B.sendOne(fan, num(5000, i), `${['alpha', 'bravo', 'charlie', 'delta', 'echo', 'fox', 'golf', 'hotel', 'india', 'juliet'][i]} ${i} unique words here zz${i}x`); await old(fan, 60 + i) }
  await M.updateOne({ _id: r.messageId }, { $set: { createdAt: new Date() } })
  ok('10 different new numbers pass, the 11th is slowed', r.ok && (await B.sendOne(fan, num(5000, 10), 'something else entirely different')).error === 'err_one_slow')

  // Same text split across several accounts is added up.
  const ring = []; for (let i = 0; i < 6; i++) ring.push(await mk('Nomadly', 9100 + i))
  const res = []; for (let i = 0; i < 6; i++) res.push(await B.sendOne(ring[i], num(6000, i), 'Win a free cruise today click the link and claim'))
  ok('same text from several accounts is caught', res.slice(0, 5).every(x => x.ok) && res[5].ok && /from other accounts/.test(AL()[AL().length - 1]), JSON.stringify(res[5]))

  // Paid campaign replies / sessions are untouched.
  ok('guard off when the limit is on', (await B.setConfig({ freeOneSends: 2 }, 'test')).ok && (await B.sendOne(fan, num(5000, 11), 'x')).error === 'err_one_used')

  for (const c of COLS) await db.collection(c).deleteMany({})
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
