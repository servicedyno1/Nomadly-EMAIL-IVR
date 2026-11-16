#!/usr/bin/env node
// One-time dead-number cleanup (approved 2026-06): HARD-DELETE released/expired/cancelled number entries from
// phoneNumbersOf, and drop the sip-e2e-test fixture's orphan. DRY RUN by default; pass --apply to execute.
//   node js/ops/dead_numbers_cleanup_2026-06.js [--apply]
'use strict'
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const APPLY = process.argv.includes('--apply')
const { MongoClient } = require('mongodb')
const DEAD = /released|expired|cancel|deleted/i
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), col = cl.db(process.env.DB_NAME).collection('phoneNumbersOf')
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} db=${process.env.DB_NAME}`)
  let deadRemoved = 0, accountsTouched = 0, e2eRemoved = 0
  for (const d of await col.find({}).toArray()) {
    const nums = d.val?.numbers || []
    const dead = nums.filter(n => DEAD.test(String(n.status || '')))
    if (dead.length) {
      console.log(`  ${String(d._id).slice(0, 10)}: remove ${dead.length} dead (${dead.map(n => n.status).join(',')})`)
      if (APPLY) { await col.updateOne({ _id: d._id }, { $pull: { 'val.numbers': { status: { $in: ['released', 'expired', 'cancelled', 'canceled', 'deleted'] } } } }); accountsTouched++ }
      deadRemoved += dead.length
    }
  }
  // sip-e2e-test: pure test fixture with an orphaned Telnyx number — drop the whole doc.
  const e2e = await col.findOne({ _id: 'sip-e2e-test' })
  if (e2e) { console.log('  sip-e2e-test: delete test fixture account (orphan telnyx number)'); if (APPLY) { await col.deleteOne({ _id: 'sip-e2e-test' }); e2eRemoved = 1 } else e2eRemoved = 1 }
  console.log(`RESULT ${APPLY ? 'applied' : 'would remove'}: deadNumbers=${deadRemoved} accounts=${accountsTouched} e2eFixtures=${e2eRemoved}`)
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
