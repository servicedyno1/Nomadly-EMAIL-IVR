'use strict'
// Replace every active Telnyx number with a nearby MultiTEL number (same area code, else same country), keep the plan,
// features, SIP logins and expiry, release the old Telnyx number and delete it from our records.
// Usage (prod release dir): node js/scripts/replace-telnyx-numbers.js            → dry run (plan only)
//                           node js/scripts/replace-telnyx-numbers.js --apply    → buy, swap, release
//                           add --only=<chatId> to do one account.
require('../config-setup')
const { MongoClient } = require('mongodb')
const mt = require('../multitel')
const telnyx = require('../telnyx-service')

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null
const area = (p) => String(p).replace(/\D/g, '').slice(1, 4)

const used = new Set()
async function pickNear(old) {
  const cc = old.country === 'CA' ? 'CA' : 'US', ac = area(old.phoneNumber)
  for (const a of [ac, null]) {
    const r = (await mt.searchNumbers(cc, 'local', a, 6).catch(() => [])).filter(x => !used.has(x.phone_number))
    if (!r.length) continue
    const best = r.find(x => area(x.phone_number) === ac) || r[0]
    used.add(best.phone_number)
    return { phone: best.phone_number, sameArea: area(best.phone_number) === ac, sameState: !!a, cc }
  }
  return null
}

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const col = db.collection('phoneNumbersOf'), out = db.collection('numberReplacements')
  const q = ONLY ? { _id: ONLY } : {}
  let n = 0
  for (const d of await col.find(q).toArray()) {
    for (const old of (d.val?.numbers || []).filter(x => x.status === 'active' && (x.provider || 'telnyx') === 'telnyx')) {
      const pick = await pickNear(old)
      if (!pick) { console.log(`✗ ${d._id} ${old.phoneNumber}: no MultiTEL number found`); continue }
      console.log(`${APPLY ? '→' : '[dry]'} ${d._id} ${old.phoneNumber} → ${pick.phone}${pick.sameArea ? ' (same area code)' : pick.sameState ? ' (same state/province)' : ' (same country)'}`)
      n++
      if (!APPLY) continue
      const bought = await mt.buyNumber(pick.phone)
      if (!bought) { console.log(`  ✗ buy failed for ${pick.phone}`); continue }
      const doc = { ...old, phoneNumber: pick.phone, provider: 'multitel', telnyxOrderId: `mt:${pick.phone.replace(/\D/g, '')}`, country: pick.cc, replacedFrom: old.phoneNumber, replacedAt: new Date().toISOString(), messagingProfileId: null, capabilities: { ...(old.capabilities || {}), voice: true, fax: false } }
      await col.updateOne({ _id: d._id }, { $pull: { 'val.numbers': { phoneNumber: old.phoneNumber } } })
      await col.updateOne({ _id: d._id }, { $push: { 'val.numbers': doc } })
      const rel = await telnyx.releaseByPhoneNumber(old.phoneNumber).catch(e => ({ error: e.message }))
      await out.insertOne({ chatId: d._id, from: old.phoneNumber, to: pick.phone, sameArea: pick.sameArea, released: !rel?.error, at: new Date(), notified: false, credited: false })
      console.log(`  ✓ swapped; old number ${rel?.error ? `release failed: ${rel.error}` : 'released'}`)
    }
  }
  console.log(`${n} number(s) ${APPLY ? 'replaced' : 'would be replaced'}. Bird verification of the new numbers runs automatically (one every ~3 min).`)
  await c.close(); process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
