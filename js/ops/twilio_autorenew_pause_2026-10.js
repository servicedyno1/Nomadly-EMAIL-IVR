// Pause auto-renew on DEAD Twilio numbers (Twilio account suspended 2026-10-22) across
// all production brands. Saves the previous value so it can be restored / carried over
// to the replacement Telnyx number by the migration tool.
//
//   node js/ops/twilio_autorenew_pause_2026-10.js                 # DRY RUN (default)
//   node js/ops/twilio_autorenew_pause_2026-10.js --apply         # write
//   node js/ops/twilio_autorenew_pause_2026-10.js --restore --apply   # undo (sets autoRenew back)
//   --brands=app-main,app-wl   to limit brands
//
// Touches ONLY numbers with provider='twilio' and status active|suspended.
// Fields: autoRenew=false, _autoRenewPausedForMigration=true, _autoRenewBeforePause=<prev>,
//         _autoRenewPausedAt=<date>. expiresAt is NOT changed.
const { MongoClient } = require('mongodb')
const { loadBrandEnv, parseBrandsArg, maskPhone } = require('./_brand_env')

const APPLY = process.argv.includes('--apply')
const RESTORE = process.argv.includes('--restore')

;(async () => {
  console.log(`MODE: ${RESTORE ? 'RESTORE' : 'PAUSE'} ${APPLY ? '(APPLY — writing)' : '(DRY RUN — no writes)'}`)
  const totals = { candidates: 0, changed: 0 }
  for (const brand of parseBrandsArg(process.argv)) {
    const env = loadBrandEnv(brand)
    const client = new MongoClient(env.MONGO_URL, { serverSelectionTimeoutMS: 20000 })
    await client.connect()
    const col = client.db(env.DB_NAME).collection('phoneNumbersOf')
    const docs = await col.find({ 'val.numbers.provider': 'twilio' }).toArray()
    console.log(`\n===== ${brand} (db=${env.DB_NAME}) — ${docs.length} user(s) with Twilio numbers`)
    for (const doc of docs) {
      for (const n of doc.val?.numbers || []) {
        if (n.provider !== 'twilio' || !['active', 'suspended'].includes(n.status)) continue
        const want = RESTORE ? !!n._autoRenewPausedForMigration : n.autoRenew === true || (n.autoRenew !== false && !n._autoRenewPausedForMigration)
        const line = `  chat=${doc._id} ${maskPhone(n.phoneNumber)} status=${n.status} plan=${n.plan} expires=${String(n.expiresAt).slice(0, 10)} autoRenew=${n.autoRenew} paused=${!!n._autoRenewPausedForMigration}`
        if (!want) { console.log(line + '  → skip'); continue }
        totals.candidates++
        const set = RESTORE
          ? { 'val.numbers.$[n].autoRenew': n._autoRenewBeforePause === true }
          : { 'val.numbers.$[n].autoRenew': false, 'val.numbers.$[n]._autoRenewPausedForMigration': true, 'val.numbers.$[n]._autoRenewBeforePause': n.autoRenew === true, 'val.numbers.$[n]._autoRenewPausedAt': new Date().toISOString() }
        const unset = RESTORE ? { 'val.numbers.$[n]._autoRenewPausedForMigration': '', 'val.numbers.$[n]._autoRenewBeforePause': '', 'val.numbers.$[n]._autoRenewPausedAt': '' } : undefined
        console.log(line + `  → ${RESTORE ? `restore autoRenew=${n._autoRenewBeforePause === true}` : 'PAUSE (autoRenew=false)'}`)
        if (APPLY) {
          const upd = unset ? { $set: set, $unset: unset } : { $set: set }
          const r = await col.updateOne({ _id: doc._id }, upd, { arrayFilters: [{ 'n.phoneNumber': n.phoneNumber, 'n.provider': 'twilio' }] })
          if (r.modifiedCount) totals.changed++
        }
      }
    }
    await client.close()
  }
  console.log(`\nTOTAL: candidates=${totals.candidates} changed=${totals.changed}${APPLY ? '' : ' (dry run)'}`)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
