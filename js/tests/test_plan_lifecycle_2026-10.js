// Plan lifecycle (2026-10): main line + extra lines are suspended together, held 7 days, restored by paying the
// plan price (extras with paid time left come back free), and released for good after the hold. Also guards the
// group-privacy fixes: internal reports go to the admin chat only and groups never see a full phone number.
// Run: node js/tests/test_plan_lifecycle_2026-10.js   (uses the local MongoDB, database plan_lifecycle_test)
'use strict'
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
const { MongoClient } = require('mongodb')
const telnyx = require('../telnyx-service.js')
const released = []
telnyx.releaseNumber = async (id) => { released.push(id); return true }
telnyx.releaseByPhoneNumber = async (p) => { released.push(p); return true }
const lc = require('../plan-lifecycle.js')
const phoneConfig = require('../phone-config.js')
const scheduler = require('../phone-scheduler.js')

let pass = 0, fail = 0
const it = (label, cond, detail = '') => { if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}${detail ? `\n     ${detail}` : ''}`) } }
const DAY = 86400000
const iso = (d) => new Date(Date.now() + d * DAY).toISOString()
const PRO = phoneConfig.plans.pro.price, SUB = phoneConfig.SUB_NUMBER_BASE_PRICE
const line = (phoneNumber, extra = {}) => ({ phoneNumber, provider: 'telnyx', telnyxOrderId: `ord-${phoneNumber}`, plan: 'pro', planPrice: PRO, expiresAt: iso(10), autoRenew: false, status: 'active', ...extra })

function unit() {
  console.log('\n=== plan-lifecycle (pure) ===')
  it('main line renews at the canonical plan price', lc.renewalPrice(line('+1', { planPrice: 25 })) === PRO)
  it('grandfathered main line keeps its stored price', lc.renewalPrice(line('+1', { planPrice: 25, grandfathered: true })) === 25)
  it('extra line renews at max(stored, base)', lc.renewalPrice(line('+1', { isSubNumber: true, planPrice: 5 })) === SUB)
  it('surcharge is part of the canonical price', lc.canonicalPrice(line('+1', { numberSurcharge: 10 })) === PRO + 10)
  it('e2e test line is free', lc.renewalPrice(line('+1', { e2eTest: true, planPrice: 0 })) === 0)

  const nums = [line('+100'), line('+101', { isSubNumber: true, parentNumber: '+100', planPrice: SUB }), line('+102', { isSubNumber: true, parentNumber: '+999' }), line('+103', { formerSubNumberOf: '+998', planPrice: 25 })]
  it('extra with a live main line is not an orphan', !lc.isOrphan(nums, nums[1]))
  it('extra whose main line is gone is an orphan', lc.isOrphan(nums, nums[2]))
  it('migration-standalone former extra is an orphan until handled', lc.isOrphan(nums, nums[3]))
  const o = lc.orphanToMain(nums[3])[0].set
  it('orphan becomes a suspended Pro main line priced at the plan', o.status === 'suspended' && o.isSubNumber === false && o.planPrice === PRO && !!o._holdUntil && o._suspendReason === 'plan_expired')

  const sp = lc.suspendPlan(nums, nums[0])
  it('suspending a main line also suspends its extras', sp.length === 2 && sp[1].phoneNumber === '+101' && sp[1].set._suspendReason === 'main_line_expired')
  const holdDays = (new Date(sp[0].set._holdUntil) - Date.now()) / DAY
  it(`hold lasts ${lc.HOLD_DAYS} days`, Math.abs(holdDays - lc.HOLD_DAYS) < 0.01)

  const held = [line('+200', { status: 'suspended', _holdUntil: iso(5), _suspendReason: 'plan_expired', expiresAt: iso(-1) }),
    line('+201', { isSubNumber: true, parentNumber: '+200', planPrice: SUB, status: 'suspended', _holdUntil: iso(5), _suspendReason: 'main_line_expired', expiresAt: iso(12) }),
    line('+202', { isSubNumber: true, parentNumber: '+200', planPrice: SUB, status: 'suspended', _holdUntil: iso(5), _suspendReason: 'main_line_expired', expiresAt: iso(-2) })]
  it('extra cannot be renewed while its main line is suspended', lc.renewBlock(held, held[1]) === 'main_line_suspended')
  it('suspended main line can be restored', lc.renewBlock(held, held[0]) === null)
  const r = lc.renewPatches(held, held[0])
  it('restore charges the plan price', r.price === PRO && r.wasSuspended)
  it('restore brings back extras with paid time left', r.restored.length === 1 && r.restored[0] === '+201')
  it('extras whose paid month ended stay suspended and owe the extra price', r.waiting.length === 1 && r.waiting[0].phoneNumber === '+202' && r.waiting[0].price === SUB)
  const main = r.patches[0].set
  it('restored main line is active for a month with usage reset', main.status === 'active' && main._holdUntil === null && Math.abs((new Date(main.expiresAt) - Date.now()) / DAY - 30) < 2 && main.minutesUsed === 0)
  it('released line cannot be renewed', lc.renewBlock([], { status: 'released' }) === 'released')

  console.log('\n=== group masking guard ===')
  const t = phoneConfig.maskPhonesInText('• 1185070608 +18445392121 · pro · $25 → $75 · +1 (937) 980-0767 · 18445392121 · +20%')
  it('masks + numbers, formatted numbers and bare 11-digit +1 numbers', !t.includes('8445392121') && !t.includes('980-0767') && t.includes('+1 (84•) •••-••21'), t)
  it('leaves user IDs, prices and percentages alone', t.includes('1185070608') && t.includes('$25 → $75') && t.includes('+20%'), t)
  it('masking is idempotent', phoneConfig.maskPhonesInText(t) === t)
}

async function integration() {
  console.log('\n=== scheduler (local MongoDB) ===')
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('plan_lifecycle_test')
  await db.dropDatabase()
  const col = (n) => db.collection(n)
  const sent = [], group = [], admin = []
  scheduler.initPhoneScheduler({
    bot: { sendMessage: async (chatId, text) => { sent.push({ chatId, text }) } },
    db, phoneNumbersOf: col('phoneNumbersOf'), phoneTransactions: col('phoneTransactions'), phoneLogs: col('phoneLogs'),
    walletOf: col('walletOf'), payments: col('payments'), nameOf: col('nameOf'), stateOf: col('state'),
    notifyGroup: (g, a) => group.push({ g, a }), notifyAdmin: (m) => admin.push(m), maskName: (n) => `${String(n || '').slice(0, 2)}***`, nanoid: () => Math.random().toString(36).slice(2),
  })
  require('node-schedule').gracefulShutdown()
  const put = (id, numbers) => col('phoneNumbersOf').insertOne({ _id: id, val: { numbers } })
  await put(1001, [line('+15550001000', { expiresAt: iso(-0.1) }),
    line('+15550001001', { isSubNumber: true, parentNumber: '+15550001000', planPrice: SUB, expiresAt: iso(12) }),
    line('+15550001002', { isSubNumber: true, parentNumber: '+15550001000', planPrice: SUB, expiresAt: iso(20) })])
  await put(1002, [line('+18445392121', { formerSubNumberOf: '+15550009999', planPrice: 25, expiresAt: iso(12), autoRenew: true })])
  await put(1003, [line('+15550003000', { isSubNumber: true, parentNumber: '+15550003999', planPrice: SUB })])
  await put(1004, [line('+19379800767', { planPrice: 0, e2eTest: true, expiresAt: iso(-3) })])
  await put(1005, [line('+15550005000', { status: 'suspended', _holdUntil: iso(-0.01), _suspendReason: 'plan_expired', expiresAt: iso(-8) }),
    line('+15550005001', { isSubNumber: true, parentNumber: '+15550005000', planPrice: SUB, status: 'suspended', _holdUntil: iso(-0.01), _suspendReason: 'main_line_expired' })])

  await scheduler.runExpiryCheck()
  const doc = async (id) => (await col('phoneNumbersOf').findOne({ _id: id })).val.numbers
  const u1 = await doc(1001)
  it('expired main line (no auto-renew) is suspended, not released', u1[0].status === 'suspended' && !!u1[0]._holdUntil && !released.includes('ord-+15550001000'))
  it('its extra lines are suspended with it (even with paid time left)', u1[1].status === 'suspended' && u1[2].status === 'suspended' && u1[1]._suspendReason === 'main_line_expired')
  it('owner gets one restore message listing the extras', sent.filter(s => s.chatId === 1001).length === 1 && /Renew for <b>\$75/.test(sent.find(s => s.chatId === 1001).text) && sent.find(s => s.chatId === 1001).text.includes('Extra lines also suspended'))
  const u2 = (await doc(1002))[0]
  it('migration-standalone $25 line is suspended and restorable as a $75 Pro main line', u2.status === 'suspended' && u2.planPrice === PRO && u2.isSubNumber === false && u2._orphanPriceFrom === 25)
  it('…and its owner is told how to restore it', sent.some(s => s.chatId === 1002 && s.text.includes('restore it as your main Pro line')))
  const u3 = (await doc(1003))[0]
  it('extra line whose main line is gone is suspended the same way', u3.status === 'suspended' && u3.isSubNumber === false && u3.formerSubNumberOf === '+15550003999')
  const u4 = (await doc(1004))[0]
  it('e2e test line is left alone', u4.status === 'active' && !u4._holdUntil)
  const u5 = await doc(1005)
  it('hold over → main line and extra released for good', u5.every(n => n.status === 'released' && n._releasedAfterHold) && released.includes('ord-+15550005000') && released.includes('ord-+15550005001'))
  it('no group post contains a full phone number', group.every(m => !/\d{3}[-) ]*\d{3}[- ]?\d{4}/.test(phoneConfig.maskPhonesInText(m.g)) && !/(\+?1\d{10})/.test(m.g)), JSON.stringify(group.map(m => m.g)))

  // Restore U1 from the wallet path used by the bot + web (renewPatches + applyDb)
  const numbers = await doc(1001)
  const r = lc.renewPatches(numbers, numbers[0])
  await lc.applyDb(col('phoneNumbersOf'), 1001, r.patches)
  const after = await doc(1001)
  it('restoring the main line brings it and its paid-up extras back', after.every(n => n.status === 'active' && !n._holdUntil) && r.price === PRO && r.restored.length === 2)

  // Pricing check: admin chat only; skips the test line; no anomaly for the converted line
  group.length = 0; admin.length = 0
  await col('phoneNumbersOf').insertOne({ _id: 1006, val: { numbers: [line('+15550006000', { planPrice: 25 })] } })
  await scheduler.runPricingReconciler()
  it('pricing report goes to the admin chat only', group.length === 0 && admin.length === 1 && admin[0].includes('Daily pricing reconciler'))
  it('pricing report skips the e2e test line and the converted line', !admin[0].includes('+19379800767') && !admin[0].includes('+18445392121') && admin[0].includes('+15550006000'), admin[0])

  await db.dropDatabase()
  await client.close()
}

unit()
integration().then(() => { console.log(`\n═══ ${pass} passed, ${fail} failed ═══`); process.exit(fail ? 1 : 0) })
  .catch(e => { console.error(e); process.exit(1) })
