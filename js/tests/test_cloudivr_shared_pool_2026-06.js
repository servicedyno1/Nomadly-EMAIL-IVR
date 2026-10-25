// CloudIVR shared allowance, usage reset, safe saving, auto-renew, upgrade quote — T1 iteration 131 (throwaway Mongo).
process.env.SKIP_WEBHOOK_SYNC = 'true'
const { MongoClient } = require('mongodb')
const lifecycle = require('../plan-lifecycle')
const phoneConfig = require('../phone-config')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }
const DAY = 86400000

;(async () => {
  const client = await MongoClient.connect('mongodb://localhost:27017')
  const db = client.db('civr_shared_t1_' + Date.now())
  try {
    const plans = phoneConfig.plans
    const proMin = lifecycle.planLimit('pro', 'minutes'), proSms = lifecycle.planLimit('pro', 'sms')
    console.log(`1. poolUsage (pro limits: ${proMin} min / ${proSms} sms):`)
    const main = { phoneNumber: '+1000', plan: 'pro', status: 'active', minutesUsed: proMin - 10, smsUsed: proSms - 1 }
    const ex1 = { phoneNumber: '+1001', plan: 'starter', isSubNumber: true, parentNumber: '+1000', status: 'active', minutesUsed: 6, smsUsed: 0 }
    const ex2 = { phoneNumber: '+1002', isSubNumber: true, parentNumber: '+1000', status: 'released', minutesUsed: 500, smsUsed: 500 }
    const other = { phoneNumber: '+2000', plan: 'starter', status: 'active', minutesUsed: 999, smsUsed: 999 }
    const nums = [main, ex1, ex2, other]
    const u = lifecycle.poolUsage(nums, ex1)
    ok(u.main === main && u.lines.length === 2, 'extra line resolves to main; released extra excluded; other main excluded')
    ok(u.minutesUsed === proMin - 4 && u.smsUsed === proSms - 1, 'sums main + live extra usage')
    ok(u.minuteLimit === proMin && u.smsLimit === proSms, "uses MAIN line plan limits (not extra's 'starter')")
    const vs = require('../voice-service')
    ok(!vs.isMinuteLimitReached(ex1, nums), 'not yet at minute limit')
    ex1.minutesUsed = 10
    ok(vs.isMinuteLimitReached(ex1, nums) && vs.isMinuteLimitReached(main, nums), 'extra line usage pushes shared pool over limit (both lines)')
    ok(!vs.isMinuteLimitReached(main, [main]), 'without extras main alone is under limit')
    ok(!vs.isSmsLimitReached(ex1, nums), 'sms under limit'); ex1.smsUsed = 1
    ok(vs.isSmsLimitReached(ex1, nums) && vs.isSmsLimitReached(main, nums), 'sms shared limit reached via extra')

    console.log('2. incrementSmsUsed / incrementMinutesUsed flag the MAIN line:')
    const pn = db.collection('phoneNumbersOf')
    const sent = []
    vs.initVoiceService({ bot: { sendMessage: async (c, m) => sent.push(m) }, phoneNumbersOf: pn, translation: (k) => k, walletOf: db.collection('walletOf'), payments: db.collection('payments'), state: db.collection('state'), phoneLogs: db.collection('phoneLogs'), nanoid: () => 'x' })
    await pn.insertOne({ _id: '700', val: { numbers: [{ ...main, smsUsed: proSms - 1, minutesUsed: proMin - 2 }, { ...ex1, smsUsed: 0, minutesUsed: 0 }] } })
    await vs.incrementSmsUsed('700', '+1001')
    let d = (await pn.findOne({ _id: '700' })).val.numbers
    ok(d[1].smsUsed === 1 && d[0]._smsLimitNotified === true && !d[1]._smsLimitNotified, 'SMS on extra → counted on extra, _smsLimitNotified set on main')
    const r = await vs.incrementMinutesUsed('700', '+1001', 5)
    d = (await pn.findOne({ _id: '700' })).val.numbers
    ok(r.used === proMin + 3 && r.limit === proMin && r.overageMinutes === 3, `minutes pool used/limit/overage = ${r.used}/${r.limit}/${r.overageMinutes}`)
    ok(d[0]._minLimitNotified === true && !d[1]._minLimitNotified, '_minLimitNotified on main line')

    console.log('3. usageResetPatches:')
    const now = new Date()
    const m2 = { phoneNumber: '+3000', plan: 'pro', status: 'active', expiresAt: new Date(now.getTime() + 20 * DAY).toISOString(), smsUsed: 5, minutesUsed: 7 }
    const e2 = { phoneNumber: '+3001', isSubNumber: true, parentNumber: '+3000', status: 'active', smsUsed: 2, minutesUsed: 3, _smsAlert80: true }
    let p = lifecycle.usageResetPatches([m2, e2], m2, now)
    ok(p.length === 1 && p[0].set._usageResetAt && !('smsUsed' in p[0].set), 'first sight: stamps only, no wipe')
    m2._usageResetAt = p[0].set._usageResetAt
    ok(lifecycle.usageResetPatches([m2, e2], m2, now).length === 0, 'same cycle: no reset')
    m2._usageResetAt = new Date(now.getTime() - 15 * DAY).toISOString() // before current cycle start (now-10d)
    p = lifecycle.usageResetPatches([m2, e2], m2, now)
    ok(p.length === 2 && p.every((x) => x.set.smsUsed === 0 && x.set.minutesUsed === 0 && x.set._smsAlert80 === false), 'new cycle: whole group reset incl. alert flags')
    ok(lifecycle.usageResetPatches([m2, e2], e2, now).length === 0, 'extra line itself never triggers reset')

    console.log('4. upgrade quote boundaries:')
    const age = (days) => ({ plan: 'starter', purchaseDate: new Date(Date.now() - days * DAY - 60000).toISOString() })
    const sp = plans.starter.price, pp = plans.pro.price
    for (const days of [0, 14]) { const q = phoneConfig.computeUpgradeQuote(age(days), 'pro'); ok(q.credit === +(sp * 0.25).toFixed(2) && q.chargeAmount === +(pp - sp * 0.25).toFixed(2), `${days}d → credit 25% of starter ($${q.credit}), charge $${q.chargeAmount}`) }
    const q15 = phoneConfig.computeUpgradeQuote(age(15), 'pro')
    ok(q15.credit === 0 && q15.chargeAmount === pp, `15d → no credit, full $${pp}`)
    const qn = phoneConfig.computeUpgradeQuote({ plan: 'pro' }, 'business')
    ok(qn.credit === +(pp * 0.25).toFixed(2), 'no purchaseDate → credit 25% of current')
    ok(lifecycle.priceOnPlan({ plan: 'starter', planPrice: sp + 5 }, 'pro') === pp + 5, 'priceOnPlan keeps surcharge')

    console.log('5. phone-scheduler safe saving + monthly reset + usage tracking:')
    const ps = require('../phone-scheduler')
    const wallet = db.collection('walletOf')
    await wallet.insertOne({ _id: '800', usdIn: 1000, usdOut: 0 })
    let concurrentAdded = false
    const pnWrapped = new Proxy(pn, { get(t, k) {
      if (k === 'find') return (...a) => { const cur = t.find(...a); return { toArray: async () => { const arr = await cur.toArray(); if (!concurrentAdded) { concurrentAdded = true; await t.updateOne({ _id: '800' }, { $push: { 'val.numbers': { phoneNumber: '+8999', plan: 'starter', status: 'active', expiresAt: new Date(Date.now() + 25 * DAY).toISOString() } }, $set: { 'val.twilioSubAccountSid': 'AC_NEW' } }) } return arr } } }
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v } })
    const exp3 = new Date(Date.now() + 2.8 * DAY).toISOString()
    const expPast = new Date(Date.now() - 40 * DAY).toISOString()
    await pn.insertOne({ _id: '800', val: { twilioSubAccountSid: 'AC_OLD', addresses: ['x'], numbers: [
      { phoneNumber: '+8000', plan: 'pro', planPrice: plans.pro.price, status: 'active', provider: 'telnyx', autoRenew: false, expiresAt: exp3, customField: 'keep' },
      { phoneNumber: '+8100', plan: 'starter', planPrice: plans.starter.price, status: 'active', provider: 'telnyx', autoRenew: true, expiresAt: expPast },
    ] } })
    ps.initPhoneScheduler({ bot: { sendMessage: async () => {} }, db, phoneNumbersOf: pnWrapped, phoneTransactions: db.collection('phoneTransactions'), phoneLogs: db.collection('phoneLogs'), walletOf: wallet, payments: db.collection('payments'), nameOf: db.collection('nameOf'), stateOf: db.collection('state'), notifyGroup: () => {}, notifyAdmin: () => {}, maskName: (x) => x, nanoid: () => String(Math.random()) })
    await ps.runExpiryCheck()
    let doc = (await pn.findOne({ _id: '800' })).val
    const n8000 = doc.numbers.find((n) => n.phoneNumber === '+8000'), n8100 = doc.numbers.find((n) => n.phoneNumber === '+8100')
    ok(doc.twilioSubAccountSid === 'AC_NEW' && doc.addresses?.[0] === 'x', 'val fields written concurrently survive (no whole-val overwrite)')
    ok(doc.numbers.some((n) => n.phoneNumber === '+8999'), 'number added concurrently survives')
    ok(n8000._reminder3Sent === true && n8000.customField === 'keep', '3-day reminder flag persisted per-field')
    const w = await wallet.findOne({ _id: '800' })
    console.log(`     (+8100 after run: status=${n8100.status} expiresAt=${n8100.expiresAt} wallet usdOut=${w.usdOut})`)
    if (n8100.status === 'active') ok(new Date(n8100.expiresAt) > new Date(Date.now() + 27 * DAY) && new Date(n8100.expiresAt) < new Date(Date.now() + 32 * DAY), 'auto-renew of long-lapsed line → now + 1 month (not old+1mo in past)')
    else ok(false, `long-lapsed auto-renew line not renewed (status ${n8100.status})`)
    ok(w.usdOut === plans.starter.price, `charged once ($${w.usdOut})`)
    await ps.runExpiryCheck()
    ok((await wallet.findOne({ _id: '800' })).usdOut === plans.starter.price, 'second hourly run: no repeat charge')

    // Usage tracking: alerts only, no counter changes
    await pn.insertOne({ _id: '810', val: { numbers: [
      { phoneNumber: '+8200', plan: 'pro', status: 'active', expiresAt: new Date(Date.now() + 20 * DAY).toISOString(), smsUsed: Math.ceil(proSms * 0.5), minutesUsed: 0 },
      { phoneNumber: '+8201', isSubNumber: true, parentNumber: '+8200', plan: 'pro', status: 'active', smsUsed: Math.ceil(proSms * 0.35), minutesUsed: 0 },
    ] } })
    await ps.runUsageTracking()
    doc = (await pn.findOne({ _id: '810' })).val
    ok(doc.numbers[0].smsUsed === Math.ceil(proSms * 0.5) && doc.numbers[1].smsUsed === Math.ceil(proSms * 0.35), 'runUsageTracking does not add usage')
    ok(doc.numbers[0]._smsAlert80 === true && !doc.numbers[0]._smsAlert100, '80% alert flag on main from shared pool (85%)')
    await ps.runMonthlyReset()
    doc = (await pn.findOne({ _id: '810' })).val
    ok(doc.numbers[0]._usageResetAt && doc.numbers[0].smsUsed > 0, 'monthly reset first sight: stamp only')

    // Inactive released cleanup uses $pull
    await pn.insertOne({ _id: '820', val: { keepMe: 1, numbers: [
      { phoneNumber: '+8300', status: 'inactive_released', _inactiveSince: new Date(Date.now() - 3 * DAY).toISOString() },
      { phoneNumber: '+8301', status: 'active', plan: 'pro', expiresAt: new Date(Date.now() + 20 * DAY).toISOString() },
    ] } })
    await ps.runInactiveReleasedCleanup()
    doc = (await pn.findOne({ _id: '820' })).val
    ok(doc.numbers.length === 1 && doc.numbers[0].phoneNumber === '+8301' && doc.keepMe === 1, 'inactive_released >48h removed, rest intact')
  } catch (e) { fail++; console.error('CRASH', e) }
  await db.dropDatabase(); await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
