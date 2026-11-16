// Cardholder ID check after card top-ups. Run: node js/tests/test_card_check.js (needs mongod on 27017 or TEST_MONGO_URL)
const { MongoClient } = require('mongodb')
const CC = require('../cloudivr-web/card-check')
const { createMollie } = require('../cloudivr-web/mollie')
const { walletOps } = require('../cloudivr-web/wallet')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27017')
  const db = cl.db('cc_test_' + Date.now())
  // Names
  ok('exact match', CC.compareNames('John Smith', 'JOHN SMITH') === 'match')
  ok('accents + order', CC.compareNames('José Álvarez', 'ALVAREZ JOSE') === 'match')
  ok('middle name left off', CC.compareNames('John Peter Smith', 'John Smith') === 'match')
  ok('initial → doubt', CC.compareNames('John Smith', 'J Smith') === 'doubt')
  ok('surname only shared → doubt', CC.compareNames('John Smith', 'Mary Smith') === 'doubt')
  ok('different person → mismatch', CC.compareNames('John Smith', 'Ana Costa') === 'mismatch')
  ok('missing card name → doubt', CC.decide('John Smith', ['']) === 'doubt')
  ok('card methods', CC.isCardPayment({ method: 'creditcard' }) && CC.isCardPayment({ method: 'applepay' }) && CC.isCardPayment({ method: 'creditcard', details: { wallet: 'googlepay' } }) && !CC.isCardPayment({ method: 'ideal' }))

  const pushes = [], admin = [], refunds = []
  let refundFails = false
  const cc = CC.createCardCheck(db, { log: () => {}, notifyAdmin: (t) => admin.push(t), push: async (id, t) => pushes.push({ id, t }), refundPayment: async (dep) => { if (refundFails) throw new Error('mollie down'); refunds.push(dep.ref); return { id: 're_' + dep.ref } } })
  const m = createMollie(db, { log: () => {}, getCardCheck: () => cc, push: async () => {} })
  const w = walletOps(db), dep = db.collection('webDeposits'), comp = db.collection('compliance')
  const mk = async (chatId, ref, usd) => { await dep.insertOne({ chatId, ref, amountUsd: usd, provider: 'mollie', currency: 'EUR', amountCharged: (usd * 0.9).toFixed(2), molliePaymentId: 'tr_' + ref, createdAt: new Date() }); return dep.findOne({ ref }) }
  const pay = (d, extra) => m.settle(d, { id: d.molliePaymentId, status: 'paid', amount: { currency: d.currency, value: d.amountCharged }, ...extra })
  const held = async (id) => (await db.collection('walletOf').findOne({ _id: String(id) }))?.usdHeld || 0

  // 1) Card payment, no ID yet → credited but not spendable
  await w.credit('100', 5)
  const d1 = await mk('100', 'a1', 50)
  const r1 = await pay(d1, { method: 'creditcard', details: { cardHolder: 'JOHN SMITH' } })
  ok('card payment is held', r1.held === true && (await dep.findOne({ ref: 'a1' })).idHold === true)
  ok('balance unchanged while held', (await w.balance('100')) === 5 && (await held('100')) === 50)
  ok('cannot spend held money', (await w.debit('100', 20)) === false)
  ok('check required + deadline', (await cc.status('100')).status === 'required' && (await cc.status('100')).heldUsd === 50)
  ok('user told to verify', pushes.some(p => p.id === '100' && /Verify your ID/.test(p.t)))
  ok('replayed webhook does not double-credit', (await pay(d1, { method: 'creditcard' })).already === true && (await held('100')) === 50)
  // Stripe verified with matching name → released
  await comp.updateOne({ _id: '100' }, { $set: { identity: { status: 'verified', name: 'John Smith' } } })
  await cc.onIdentity('100', 'verified')
  ok('match → released', (await w.balance('100')) === 55 && (await held('100')) === 0 && (await cc.status('100')).status === 'passed')
  // Once per account: next card payment not held
  const d2 = await mk('100', 'a2', 20)
  ok('second card payment not held', (await pay(d2, { method: 'creditcard', details: { cardHolder: 'Someone Else' } })).held === false && (await w.balance('100')) === 75)

  // 2) Non-card method → never held
  const d3 = await mk('200', 'b1', 30)
  ok('iDEAL not held', (await pay(d3, { method: 'ideal' })).held === false && (await w.balance('200')) === 30)

  // 3) Mismatch → automatic refund
  const d4 = await mk('300', 'c1', 40)
  await pay(d4, { method: 'creditcard', details: { cardHolder: 'ANA COSTA' } })
  await comp.updateOne({ _id: '300' }, { $set: { identity: { status: 'verified', name: 'John Smith' } } })
  await cc.onIdentity('300', 'verified')
  const w300 = await db.collection('walletOf').findOne({ _id: '300' })
  ok('mismatch → refunded via Mollie', refunds.includes('c1') && (await cc.status('300')).status === 'refunded')
  ok('wallet reversed (in/out/held zero)', w300.usdIn === 0 && w300.usdOut === 0 && w300.usdHeld === 0)
  ok('refund in history', !!(await db.collection('transactions').findOne({ chatId: '300', type: 'card-refund' })))

  // 4) Apple Pay without card name → admin review → approve
  const d5 = await mk('400', 'd1', 25)
  await pay(d5, { method: 'applepay' })
  await comp.updateOne({ _id: '400' }, { $set: { identity: { status: 'verified', name: 'Mary Jones' } } })
  await cc.onIdentity('400', 'verified')
  ok('no card name → review + admin alert', (await cc.status('400')).status === 'review' && admin.some(t => /needs review/.test(t)))
  await cc.release('400', 'approved by test')
  ok('admin approve releases', (await w.balance('400')) === 25 && (await cc.status('400')).status === 'passed')

  // 5) Two failed ID attempts → refund
  const d6 = await mk('500', 'e1', 10)
  await pay(d6, { method: 'creditcard', details: { cardHolder: 'X Y' } })
  await cc.onIdentity('500', 'failed', { id: 'vs_1' })
  await cc.onIdentity('500', 'failed', { id: 'vs_1' })
  ok('same failed session counted once', (await cc.status('500')).status === 'required' && (await cc.status('500')).attempts === 1)
  await cc.onIdentity('500', 'failed', { id: 'vs_2' })
  ok('second failure → refunded', refunds.includes('e1') && (await cc.status('500')).status === 'refunded')

  // 6) Deadline passed → refund by sweep; refund failure keeps the hold
  const d7 = await mk('600', 'f1', 15)
  await pay(d7, { method: 'creditcard', details: { cardHolder: 'A B' } })
  await comp.updateOne({ _id: '600' }, { $set: { 'cardCheck.deadline': new Date(Date.now() - 1000) } })
  refundFails = true
  await cc.tick()
  ok('failed refund keeps money held + alerts admin', (await held('600')) === 15 && (await cc.status('600')).status === 'required' && admin.some(t => /refund failed/i.test(t)))
  refundFails = false
  await dep.updateMany({ chatId: '600' }, { $unset: { refundState: '' } })
  await cc.tick()
  ok('deadline sweep refunds', refunds.includes('f1') && (await cc.status('600')).status === 'refunded' && (await held('600')) === 0)

  // 7) Already ID-verified account (compliance) → decided at payment time
  await comp.insertOne({ _id: '700', identity: { status: 'verified', name: 'Li Wei' } })
  const d8 = await mk('700', 'g1', 12)
  await pay(d8, { method: 'creditcard', details: { cardHolder: 'WEI LI' } })
  ok('pre-verified ID matches instantly', (await w.balance('700')) === 12 && (await cc.status('700')).status === 'passed')

  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
