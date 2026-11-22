'use strict'
// 2Chat orders that fail stay quiet ("setting up") and the admin can finish them by hand.
const { MongoClient } = require('mongodb')
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const po = require('../pending-orders'), tc = require('../twochat')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(`test_twochat_po_${Date.now()}`)
  const admin = [], told = [], activated = []
  await po.init({ db, notifyAdmin: (t) => admin.push(t), adminEmail: () => {}, send: (id, t) => told.push(t), email: () => {}, credit: async () => {},
    removeNumber: async () => {}, activateNumber: async (id, phone, r) => activated.push({ id, phone, ...r }) })

  const order = po.pendingResult('2chat', '+4420', { cc: 'GB', type: 'local', groupId: 'g1', label: '+44 (20)', why: 'balance too low' })
  ok(order._pending && order._provider === '2chat', 'failed 2Chat buy becomes a held order')
  ok(/Setting up your UK number/.test(po.pendingMsg('+4420')) && !/refund|carrier|reserv/i.test(po.pendingMsg('+4420')), 'customer only sees "setting up" — no failure, no refund talk')
  await po.enqueue({ chatId: '111', phoneNumber: '+4420', order, amount: 100 })
  ok(admin.some(t => /needs a hand/.test(t) && /balance too low/.test(t) && /2Chat orders/.test(t)), 'admin told why and where to finish it')
  ok(!po.isHeld('+4420'), 'a location pool is not locked for other buyers')

  const [o] = await po.waiting('2chat')
  ok(o && o.meta.label === '+44 (20)', 'order listed for the admin dashboard')

  tc.adopt = async (number, landing) => ({ id: 'tc:DIDx', phone_numbers: [{ phone_number: number }], _landingNumber: landing || '+17635550100' })
  const got = await po.completeManual(o._id, '+442012345678', '+17635550199')
  ok(got.phone === '+442012345678' && got.landingNumber === '+17635550199', 'admin-entered number + own landing used')
  ok(activated[0]?.phone === '+4420' && activated[0].phoneNumber === '+442012345678' && activated[0].landingNumber === '+17635550199', 'placeholder swapped for the real number on the account')
  ok(!told.length, 'customer not messaged yet (told once calls reach it)')
  ok((await po.waiting('2chat')).length === 0, 'order no longer waiting')
  let threw = null; try { await po.completeManual(o._id, '+442012345678') } catch (e) { threw = e.message }
  ok(/no longer waiting/.test(threw || ''), 'finishing twice is refused')

  await db.dropDatabase(); await c.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
