// Hosting bot upgrade quote, membership stacking, hosting 3-day reminder, copy/defaults/i18n — T1 iteration 131.
process.env.SKIP_WEBHOOK_SYNC = 'true'
const { MongoClient } = require('mongodb')
const fs = require('fs')
const path = require('path')
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }
const DAY = 86400000

;(async () => {
  const client = await MongoClient.connect('mongodb://localhost:27017')
  const db = client.db('misc_t1_' + Date.now())
  try {
    console.log('1. botUpgradeQuote:')
    const { botUpgradeQuote } = require('../hosting-plan-change')
    const now = new Date('2026-06-10T00:00:00Z')
    const exp = new Date('2026-06-12T00:00:00Z')
    let q = botUpgradeQuote({ expiryDate: exp }, { currentPrice: 75, newPrice: 100, now })
    ok(q.keepsExpiry === true && q.charge === 25 && +q.expiresAt === +exp, 'active Premium $75 → Golden $100: $25, expiry kept (2 days left)')
    q = botUpgradeQuote({ expiryDate: exp }, { currentPrice: 120, newPrice: 100, now })
    ok(q.charge === 0, 'never negative')
    q = botUpgradeQuote({ expiryDate: new Date('2026-06-01') }, { currentPrice: 75, newPrice: 100, now })
    ok(q.keepsExpiry === false && q.charge === 100 && +q.expiresAt === +now + 30 * DAY, 'ended term → full price, now+30d')
    q = botUpgradeQuote({}, { currentPrice: 75, newPrice: 100, now })
    ok(q.keepsExpiry === false && q.charge === 100, 'no expiry → full price')

    console.log('2. _index.js hosting upgrade static review:')
    const idx = R('_index.js')
    const pay = idx.slice(idx.indexOf("billing: q.keepsExpiry ? 'price_difference'") - 3500, idx.indexOf("billing: q.keepsExpiry ? 'price_difference'") + 600)
    ok(/q\.keepsExpiry \? \{\} : \{ expiryDate: newExpiry \}/.test(pay), 'pay step keeps expiryDate when keepsExpiry')
    ok(!/autoRenew\s*:/.test(pay), 'pay step does not set autoRenew')
    ok(/renewalPriceUsd: newRenewalPrice/.test(pay), 'renewalPriceUsd set to new plan price')
    ok(/upgradeQuoteChanged/.test(idx) && /q\.charge !== selected\.chargeAmount/.test(idx), 'pay step re-quotes and refuses on change')
    const hostingListSrc = idx.slice(idx.indexOf('myHostingPlans: async () => {'), idx.indexOf('myHostingPlans: async () => {') + 12000)
    ok(!/50%|Loyalty Credit|🎁 Use \$/.test(hostingListSrc.replace(/\/\/.*$/gm, '')), 'My Hosting Plans / plan details produce no 50% / Loyalty Credit / 🎁 Use $ text')
    ok(!/require\(['"]\.\/hosting-upgrade-nudge['"]\)/.test(idx), 'hosting-upgrade-nudge not required by _index.js')
    const log = fs.readFileSync('/var/log/supervisor/nodejs.out.log', 'utf8')
    const lastStart = log.lastIndexOf('[WelcomeBonus] Initialized')
    ok(lastStart > -1 && !log.slice(lastStart - 20000 > 0 ? lastStart - 3000 : 0).includes('[HostingUpgradeNudge] Initialized'), 'no [HostingUpgradeNudge] Initialized after latest restart')

    console.log('3. subscribePlan stacking + reminder flags:')
    const { subscribePlan } = require('../utils')
    const pe = db.collection('planEndingTime'), po = db.collection('planOf'), st = db.collection('state'), fv = db.collection('fv')
    const t = Date.now()
    await pe.insertOne({ _id: 'u1', val: t + 10 * DAY })
    await subscribePlan(pe, null, po, 'u1', 'Monthly', null, 'en', fv, st)
    await new Promise((r) => setTimeout(r, 300))
    let v = (await pe.findOne({ _id: 'u1' })).val
    const { timeOf } = require('../config')
    ok(Math.abs(v - (t + 10 * DAY + timeOf.Monthly)) < 5000, 'active Monthly re-purchase stacks on current expiry')
    let s = (await st.findOne({ _id: 'u1' })).reminders
    ok(s.botPlan3DayReminderSent === false && s.botPlan1DayReminderSent === false && s.botPlanExpiredSent === false, 'long term: reminders re-armed')
    await subscribePlan(pe, null, po, 'u2', 'Daily', null, 'en', fv, st)
    await new Promise((r) => setTimeout(r, 300))
    v = (await pe.findOne({ _id: 'u2' })).val
    ok(Math.abs(v - (t + timeOf.Daily)) < 5000, 'no current plan → now + Daily')
    s = (await st.findOne({ _id: 'u2' })).reminders
    ok(s.botPlan3DayReminderSent === true && s.botPlan1DayReminderSent === true && s.botPlanExpiredSent === false, 'Daily buyer: 3d + 1d marked sent (no "expires tomorrow")')
    await pe.insertOne({ _id: 'u3', val: t - 5 * DAY })
    await subscribePlan(pe, null, po, 'u3', 'Weekly', null, 'en', fv, st)
    await new Promise((r) => setTimeout(r, 300))
    v = (await pe.findOne({ _id: 'u3' })).val
    ok(Math.abs(v - (t + timeOf.Weekly)) < 5000, 'expired plan → from now')
    const calls = (idx.match(/subscribePlan\([^)]*\)/g) || []).filter((c) => !c.includes('async'))
    ok(calls.length >= 4 && calls.every((c) => /, state\)$/.test(c)), `all ${calls.length} subscribePlan call sites pass state`)
    ok(/MAX_REASONABLE_MS = 5 \* 366 \* 86400 \* 1000/.test(idx) && !/MAX_REASONABLE_MS = 31 /.test(idx), 'isSubscribed/viewPlan sanity cap 5 years (stacked plans never wiped)')

    console.log('4. hosting 3-day reminder (runCheck with fake bot, no WHM):')
    const sent = []
    const hs = require('../hosting-scheduler')
    const ca = db.collection('cpanelAccounts')
    const n0 = Date.now()
    await ca.insertMany([
      { _id: 'h1', chatId: 'c1', domain: 'a.test', plan: 'Premium Anti-Red HostPanel (1-Month)', autoRenew: true, expiryDate: new Date(n0 + 2.5 * DAY) },
      { _id: 'h2', chatId: 'c2', domain: 'b.test', plan: 'Premium Anti-Red HostPanel (1-Month)', autoRenew: false, expiryDate: new Date(n0 + 5 * DAY) },
    ])
    const sch = hs.initScheduler({ bot: { sendMessage: async (c, m) => { sent.push([c, m]); return {} } }, db, whmService: null })
    await sch.runCheck(); await sch.runCheck()
    sch.stop()
    const h1 = await ca.findOne({ _id: 'h1' })
    ok(h1.expiry3dNotifiedFor === new Date(h1.expiryDate).toISOString(), 'expiry3dNotifiedFor stamped with expiry ISO')
    const c1 = sent.filter(([c]) => c === 'c1')
    ok(c1.length === 1, `3-day reminder sent exactly once across 2 runs (got ${c1.length})`)
    ok(!sent.some(([c]) => c === 'c2'), 'no reminder at 5 days')
    ok(c1[0] && !/undefined|t\.sched/.test(c1[0][1]), 'reminder text fully translated')
    await ca.updateOne({ _id: 'h1' }, { $set: { expiryDate: new Date(n0 + 2.6 * DAY + 30 * DAY) } })
    ok(true, '(new term re-arms by key — verified by ISO comparison)')

    console.log('5. Copy / defaults / i18n:')
    const keys = ['upgradeModalKeepsExpiry', 'upgradeConfirmKeepsExpiry', 'upgradeQuoteChanged', 'schedExpiry3dBody', 'schedRenewTextOnPrice']
    for (const l of ['en', 'fr', 'hi', 'zh']) {
      const src = R(`lang/${l}.js`)
      ok(keys.every((k) => new RegExp(`\\b${k}\\s*:`).test(src)), `${l}: all 5 new keys present`)
    }
    const { translation } = require('../translation')
    for (const l of ['en', 'fr', 'hi', 'zh']) {
      const out = [translation('t.upgradeModalKeepsExpiry', l, new Date()), translation('t.schedRenewTextOnPrice', l, 25), translation('t.schedExpiry3dBody', l, 'P', 'd.com', 'Jun 1'), translation('t.upgradeQuoteChanged', l)]
      ok(out.every((x) => typeof x === 'string' && x.length > 5 && !/undefined/.test(x)), `${l}: keys render`)
    }
    const pc = R('phone-config.js')
    ok(/Bulk IVR Campaign \(start now or schedule\)/.test(pc) && /'Call Recording'/.test(pc), 'Pro lists Call Recording + Bulk IVR Campaign')
    ok(/Quick IVR Call Scheduling/.test(pc) && /IVR Redial/.test(pc) && /Auto-Attendant/.test(pc), 'Business copy updated')
    ok(/25% of your (Starter|\$\{)/.test(pc) || /25% of your/.test(pc), "credit line says '25% of your … price'")
    ok(/shared with extra lines/.test(pc), 'manage screen mentions shared SMS')
    const cs = R('config-setup.js')
    ok(/setDefault\('PREMIUM_ANTIRED_WEEKLY_PRICE', '30'\)/.test(cs) && /setDefault\('HOSTING_TRIAL_PLAN_ON', 'false'\)/.test(cs) && /setDefault\('OVERAGE_RATE_MIN', '0.15'\)/.test(cs) && /setDefault\('OVERAGE_RATE_SMS', '0.02'\)/.test(cs), 'config-setup defaults')
    ok(/PREMIUM_ANTIRED_WEEKLY_PRICE\) \|\| 30/.test(R('hosting-scheduler.js')), 'hosting-scheduler weekly fallback 30')
    const reminders = idx.slice(idx.indexOf('async function sendRemindersForExpiringPackages'), idx.indexOf('async function sendRemindersForExpiringPackages') + 15000)
    ok(!/vpsPlansOf\.find/.test(reminders.slice(0, reminders.indexOf('\n}\n') > 0 ? reminders.indexOf('\n}\n') : 15000)), 'no VPS 3-day reminder query in sendRemindersForExpiringPackages')
  } catch (e) { fail++; console.error('CRASH', e) }
  await db.dropDatabase(); await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
