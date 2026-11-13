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
  const mkNew = async (brand, id) => (await B.customer(brand, id, { username: `u${id}` }))._id
  const mk = async (brand, id) => { const cid = await mkNew(brand, id); await CU.updateOne({ _id: cid }, { $set: { createdAt: new Date(Date.now() - 30 * 86400000) } }); return cid }
  const num = (base, i) => `+1212${300 + i}${base}`
  const old = (cid, min) => M.updateMany({ cid }, { $set: { createdAt: new Date(Date.now() - min * 60000) } })

  ok('defaults: single texts + tests unlimited, one price', B.DEFAULTS.freeOneSends === 0 && B.DEFAULTS.testSends === 0 && (await B.cfg()).priceLink === (await B.cfg()).pricePlain && (await B.cfg()).pricePlain * 500 === 50)
  await B.setConfig({ freeOneSends: 2 }, 'test')
  const capped = await mk('Nomadly', 9001)
  await B.sendOne(capped, num(1000, 0), 'a'); await B.sendOne(capped, num(1000, 1), 'b')
  ok('limit can be switched back on: 2 free single texts', (await B.sendOne(capped, num(1000, 2), 'c')).error === 'err_one_used')

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
  ok('retrying right after the refusal is not a second strike', (await B.sendOne(spam, num(3000, 39), pitch('Abe'))).error === 'err_one_bulk' && (await CU.findOne({ _id: spam })).oneGuard.strikes === 1)
  await CU.updateOne({ _id: spam }, { $set: { 'oneGuard.strikeAt': new Date(Date.now() - 21 * 3600000) } })
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

  // Same text split across several accounts is added up, and the slow-down bites on a brand-new account.
  const ring = []; for (let i = 0; i < 6; i++) ring.push(await mk('Nomadly', 9100 + i))
  const res = []; for (let i = 0; i < 6; i++) res.push(await B.sendOne(ring[i], num(6000, i), 'Win a free cruise today click the link and claim'))
  ok('same text from several accounts: 6th account is refused + alert names the ring', res.slice(0, 5).every(x => x.ok) && res[5].error === 'err_one_bulk' && /from 5 other account/.test(AL()[AL().length - 1]), JSON.stringify(res[5]))

  // Ring of BRAND-NEW accounts: refused (not just slowed) as soon as it is past the similar threshold.
  const ring2 = []; for (let i = 0; i < 4; i++) ring2.push(await mkNew('Nomadly', 9200 + i))
  const res2 = []; for (let i = 0; i < 4; i++) res2.push(await B.sendOne(ring2[i], num(6100, i), 'Claim your prize cash reward now reply yes today'))
  ok('ring of new accounts: 4th account refused outright', res2.slice(0, 3).every(x => x.ok) && res2[3].error === 'err_one_bulk' && /new account/.test(AL()[AL().length - 1]), JSON.stringify(res2))
  // Established accounts in a ring: alert and refusal come at the same message (6th), not 6 vs 10.
  const ring3 = []; for (let i = 0; i < 6; i++) ring3.push(await mk('Nomadly', 9300 + i))
  const res3 = []; for (let i = 0; i < 6; i++) res3.push(await B.sendOne(ring3[i], num(6200, i), 'Cheap loans approved in minutes no credit check apply'))
  ok('ring of established accounts: refused at the 6th', res3.slice(0, 5).every(x => x.ok) && res3[5].error === 'err_one_bulk', JSON.stringify(res3[5]))
  // Every message genuinely different, new account: slowed past 5 new numbers, refused past 10.
  const dv = await mkNew('Nomadly', 9400), vocab = 'apple river cloud stone maple ocean tiger candle forest silver pepper rocket garden violet harbor meadow'.split(' ')
  const dmsg = (i) => `${vocab[i]} ${vocab[(i + 3) % 16]} ${vocab[(i + 7) % 16]} note ${i}`
  for (let i = 0; i < 5; i++) { await old(dv, 30); r = await B.sendOne(dv, num(6300, i), dmsg(i)) }
  ok('new account, different texts: 5 pass', r.ok)
  ok('new account, different texts: 6th slowed', (await B.sendOne(dv, num(6300, 5), dmsg(5))).error === 'err_one_slow')
  for (let i = 5; i < 11; i++) { await old(dv, 30); r = await B.sendOne(dv, num(6300, i), dmsg(i)) }
  ok('new account, different texts: past 10 refused', r.error === 'err_one_bulk', JSON.stringify(r))
  // Different texts, but the recipients come from one number block and nobody answers → refused early.
  const blk = await mk('Nomadly', 9500)
  for (let i = 0; i < 6; i++) { if (i < 5) await old(blk, 30); r = await B.sendOne(blk, `+1415555${7000 + i}`, dmsg(i + 2)) }
  ok('different texts to one number block: slowed at the 5th+, alert names the block', r.error === 'err_one_slow' && /number block/.test(AL()[AL().length - 1]), JSON.stringify(r))
  // Different texts from several accounts to the same list → shared-list signal.
  const sh1 = await mk('Nomadly', 9600), sh2 = await mk('Nomadly', 9601), lst = [0, 1, 2, 3].map(i => `+1${['617', '212', '310', '415'][i]}${330 + i}${8000 + i}`)
  for (let i = 0; i < 4; i++) await B.sendOne(sh1, lst[i], dmsg(i + 4))
  for (let i = 0; i < 3; i++) { if (i < 2) await old(sh2, 30); r = await B.sendOne(sh2, lst[i], dmsg(i + 9)) }
  ok('same list from another account is flagged', r.error === 'err_one_slow' && /other accounts also texted/.test(AL()[AL().length - 1]), JSON.stringify(r))

  // Different wording for every number, same link → still one pitch.
  const cta = await mk('Nomadly', 9005), words = ['Morning friend take a look when free', 'Thought you might enjoy this one', 'Quick thing I found for you', 'Saw this and remembered our chat', 'Not sure if useful but here', 'Last one I promise check it']
  for (let i = 0; i < 6; i++) { r = await B.sendOne(cta, num(7000, i), `${words[i]} dealz-shop.com/x`, null, { optOut: false }); if (i < 4) await old(cta, 20 + i) }
  ok('rewritten wording with the same link is caught', r.error === 'err_one_slow', JSON.stringify(r))

  // Campaign tests: unlimited + free to your own phone, removed once they are used on many numbers.
  const tc = await mk('Nomadly', 9006), list = Array.from({ length: 500 }, (_, i) => `+1310555${1000 + i}`).join('\n')
  const cr = await B.createCampaign(tc, { name: 'T', content: ['Big sale this weekend at our store, visit shop-example.com'], contacts: (await B.parseContacts(tc, list)).contacts, consent: true })
  ok('campaign with a link costs the same $50 / 500', cr.campaign && !cr.error && Math.round(cr.campaign.parts * (await B.cfg()).pricePlain) === 50, JSON.stringify(cr.error || cr.campaign?.parts))
  const cpId = cr.campaign._id, own = '+13105559001'
  ok('test offer: free, open, no wallet lock', JSON.stringify(await B.testOffer(tc)) === JSON.stringify({ firstTime: false, free: true, open: true, barred: false }))
  let tr; for (let i = 0; i < 8; i++) tr = await B.testSend(tc, cpId, own)
  ok('8 tests to the same phone: all free, none refused', tr.ok && tr.open && tr.charge === 0 && (await M.countDocuments({ cid: tc, test: true })) === 8)
  for (let i = 0; i < 4; i++) tr = await B.testSend(tc, cpId, `+1310${400 + i}9002`)
  ok('up to 5 different phones still fine', tr.ok)
  tr = await B.testSend(tc, cpId, '+13104509010')
  ok('6th different number: tests removed', tr.error === 'err_test_guard' && /tests removed/.test(all[all.length - 1]), JSON.stringify(tr))
  ok('removal sticks, even for the own phone', (await B.testBarred(tc)) && (await B.testOffer(tc)).barred && (await B.testCheck(tc, cpId, own)).error === 'err_test_guard')
  ok('campaign can still be submitted', !(await B.whenOptions(tc, cpId)).error)
  ok('single texts keep their own ladder after a test removal', !['err_one_blocked', 'err_test_guard'].includes((await B.sendOne(tc, '+13105559020', 'hello are you around later')).error))
  ok('admin clear gives tests back', (await B.oneGuardSet(tc, 'clear', 'test')).ok && !(await B.testBarred(tc)))
  ok('single-text abuser loses tests too', await B.testBarred(spam) === false && (await CU.updateOne({ _id: spam }, { $set: { oneGuard: { strikes: 1, level: 2 } } })) && await B.testBarred(spam))

  // Platform-wide ceiling on free texts.
  await B.setConfig({ oneGuardDailyFree: 5 }, 'test')
  const late = await mk('Nomadly', 9007)
  ok('daily free ceiling reached → refused politely + one alert', (await B.sendOne(late, num(8000, 1), 'hello there how are you')).error === 'err_free_busy' && /ceiling/.test(all.join('|')) && !!t('zh', 'err_free_busy'))
  await B.setConfig({ oneGuardDailyFree: 300 }, 'test')

  // Paid campaign replies / sessions are untouched.
  ok('guard off when the limit is on', (await B.setConfig({ freeOneSends: 2 }, 'test')).ok && (await B.sendOne(fan, num(5000, 11), 'x')).error === 'err_one_used')

  for (const c of COLS) await db.collection(c).deleteMany({})
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
