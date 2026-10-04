'use strict'
/**
 * Regression test for the CallRecon crash:
 *   "[CallRecon] scheduled sweep error: Cannot read properties of undefined (reading 'catch')"
 *
 * Root cause: js/_index.js `notifyAdmin` is a SYNCHRONOUS function that returns
 * undefined. call-billing-reconciler.js did `_notifyAdmin(...).catch(() => {})`,
 * i.e. called `.catch` on undefined, which threw and aborted the whole sweep
 * every time a leak was found in production (`leaksFound > 0 && !dryRun`).
 *
 * This test drives the REAL reconciler module through that exact code path using
 * mock Mongo collections (no network, no real wallet writes) and a synchronous
 * notifyAdmin that mirrors production. It must:
 *   - reach the notify branch (leaksFound > 0, dryRun=false)
 *   - NOT throw
 *   - still call notifyAdmin (best-effort)
 *   - return a valid summary
 *
 * Run:  node /app/tests/callrecon_notify_fix.test.js   (exit 0 = PASS)
 */

const path = require('path')
const reconciler = require(path.join(__dirname, '..', '..', 'js', 'call-billing-reconciler.js'))

let failures = 0
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg) }
  else { console.log('  ❌ FAIL:', msg); failures++ }
}

// ── 0. Prove the ORIGINAL bug class is real (control) ──
;(function controlReproducesOriginalCrash() {
  console.log('\n[Control] undefined.catch() throws the reported error:')
  const syncNotify = () => undefined // exactly like js/_index.js notifyAdmin
  let threw = null
  try { syncNotify('x').catch(() => {}) } catch (e) { threw = e }
  assert(!!threw && /Cannot read properties of undefined \(reading 'catch'\)/.test(threw.message),
    `synchronous-notify.catch() reproduces: "${threw && threw.message}"`)
})()

// ── Mock Mongo collections (leak-producing, no wallet writes) ──
const now = Date.now()
const leakRow = {
  _id: 'test_leg_ABC123',
  callRef: 'test_leg_ABC123',
  chatId: '999000111',
  phoneNumber: '+18885551234',
  destination: '+2348012345678', // non-US → not the point; provider!=twilio keeps minutes=null
  callType: 'Test_Forwarding',
  provider: 'signalwire',         // NON-twilio → skips leg fetch → minutes=null → needsReview (NO wallet write)
  subAccountSid: null,
  status: 'pending',
  createdAt: new Date(now - 60 * 1000), // 1 min old → past grace(0), within maxAge
}

let updateOneCalls = 0
const pendingColl = {
  createIndex: () => Promise.resolve(),
  find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [leakRow] }) }) }),
  updateOne: async () => { updateOneCalls++; return { acknowledged: true } },
  findOne: async () => null,
}
const walletLedgerColl = {
  findOne: async () => null, // no ledger row → suspected leak
}
const mockDb = {
  collection: (name) => {
    if (name === 'pendingCallBills') return pendingColl
    if (name === 'walletLedger') return walletLedgerColl
    return { createIndex: () => Promise.resolve(), find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }), updateOne: async () => ({}), findOne: async () => null }
  },
}

// Synchronous notifyAdmin that returns undefined — identical shape to production.
let notifyCalls = 0
const syncNotifyAdmin = (msg) => { notifyCalls++; /* returns undefined, like prod */ }

async function main() {
  console.log('\n[Test] Reconciler sweep with leak + synchronous notifyAdmin (non-dry-run):')
  reconciler.init({ db: mockDb, bot: null, notifyAdmin: syncNotifyAdmin, logger: () => {} })

  let summary = null
  let threw = null
  try {
    // dryRun:false + leak → hits the notify branch that used to crash.
    summary = await reconciler.sweepPendingBills({ dryRun: false, graceMinutes: 0, maxAgeHours: 100000 })
  } catch (e) {
    threw = e
  }

  assert(threw === null, `sweepPendingBills did NOT throw (was: ${threw && threw.message})`)
  assert(summary && typeof summary === 'object', 'returned a summary object')
  assert(summary && summary.leaksFound >= 1, `reached leak branch (leaksFound=${summary && summary.leaksFound})`)
  assert(summary && summary.dryRun === false, 'ran in non-dry-run (settlement) mode')
  assert(notifyCalls >= 1, `notifyAdmin was invoked (best-effort) — calls=${notifyCalls}`)

  console.log('\nSummary:', JSON.stringify(summary))
  console.log(failures === 0 ? '\n🎉 ALL TESTS PASSED' : `\n💥 ${failures} TEST(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2) })
