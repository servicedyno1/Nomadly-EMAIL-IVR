'use strict'
// Bird auto-link for Retell numbers: fast retry, give-up alert once. Retell search/buy wiring (no network).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
const { createBirdVerify } = require('../bird-callerid-verify')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('✅', m) } else { fail++; console.log('❌', m) } }

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(`${process.env.DB_NAME}_test_retell_link`)
  const N0 = ['+18885550101']
  await db.collection('birdCallerIdVerify').deleteMany({ _id: { $in: N0 } })
  let armed = 0
  const bird = { enabled: () => true, listCallerIds: async () => [], startCallerIdVerification: async () => { armed++; return { id: `v${armed}`, status: 'pending' } } }
  const V = createBirdVerify({ bird, transcribe: async () => ({ text: '' }), db, log: () => {} })
  const N = '+18885550101', gave = []
  const opts = { numbers: [N], retryMs: 15 * 60000, maxRounds: 2, onGiveUp: (n) => gave.push(n) }
  let r = await V.autoLinkTick(opts)
  ok(r.armed === N && armed === 1, 'first tick arms the new number')
  r = await V.autoLinkTick(opts)
  ok(r.skipped === 'verification in progress', 'one verification at a time')
  const col = db.collection('birdCallerIdVerify')
  await col.updateOne({ _id: N }, { $set: { expiresAt: new Date(Date.now() - 1000), armedAt: new Date(Date.now() - 10 * 60000) } })
  r = await V.autoLinkTick(opts)
  ok(armed === 1, 'not retried before 15 min')
  await col.updateOne({ _id: N }, { $set: { armedAt: new Date(Date.now() - 16 * 60000) } })
  r = await V.autoLinkTick(opts)
  ok(r.armed === N && armed === 2, 'retried after 15 min (not 6 h)')
  await col.updateOne({ _id: N }, { $set: { status: 'failed', expiresAt: new Date(Date.now() - 1000), armedAt: new Date(Date.now() - 16 * 60000) } })
  await V.autoLinkTick(opts); await V.autoLinkTick(opts)
  ok(armed === 2 && gave.length === 1 && gave[0] === N, 'after max rounds: no more calls, admin alerted once')

  // Retell wiring
  process.env.RETELL_API_KEY = process.env.RETELL_API_KEY || 'x'
  process.env.NUMBER_PROVIDERS = 'retell'
  const rt = require('../retell')
  ok(rt.selling() && rt.sellsType('US', 'toll_free') && rt.sellsType('CA', 'local') && !rt.sellsType('CA', 'toll_free'), 'Retell sells US local/toll-free and CA local')
  const cat = require('../number-catalog')
  const sold = cat.sold()
  ok(sold.US?.includes('local') && sold.US?.includes('toll_free') && sold.CA?.includes('local'), 'catalog lists Retell US/CA types')
  ok(cat.best('US', 'toll_free')?.provider === 'retell' && cat.best('US', 'toll_free')?.sms === false, 'catalog: US toll-free → Retell, calls only')
  ok(rt.isRt('rt:+18885550101') && !rt.isRt('ib:abc'), 'rt: order ids')
  rt.remember('+18885550102')
  ok(rt.isRtSearched('+18885550102'), 'a number forgotten after restart can still be bought on Retell')

  await db.collection('birdCallerIdVerify').deleteMany({ _id: { $in: N0 } }); await c.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
