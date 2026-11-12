// read-only: Spenza SIM list per account vs bsEsims, plus every cancel/replace/retire audit + replacements. Run in a release dir.
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(process.env.ENVF, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const { MongoClient } = require('mongodb')
;(async () => {
  const cl = await MongoClient.connect(process.env.BULK_ESIM_MONGO_URL || process.env.MONGO_URL), db = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME)
  const P = require(path.join(process.cwd(), 'js/bulk-esim/provider-spenza.js'))
  const mask = (s) => s ? String(s).slice(0, 6) + '…' + String(s).slice(-4) : s
  for (const a of await db.collection('bsAccounts').find({}).toArray()) {
    console.log('ACCOUNT', a._id, a.status || '')
    try { const sims = await P.listSims(a._id); for (const s of (Array.isArray(sims) ? sims : sims?.data || [])) console.log('  SPENZA', mask(s.iccid), s.status, s.msisdn || s.phoneNumber || s.number || '', s.subscriptionStatus || s.subscription?.status || '', s.updatedAt || s.updated_at || '') } catch (e) { console.log('  listSims ERR', e.message) }
  }
  for (const e of await db.collection('bsEsims').find({}).sort({ _id: 1 }).toArray()) console.log('ESIM', e._id, e.role, e.status, e.health, e.msisdn, mask(e.iccid), e.account, e.retiredAt || e.failedAt || '', e.statusReason || e.failReason || e.reason || '')
  console.log('## AUDIT (cancel/replace/retire/fail/provision)')
  for (const x of await db.collection('bsAudit').find({ action: { $regex: 'cancel|replace|retire|fail|provision|suspend|expire|renew|role|deactiv', $options: 'i' } }).sort({ at: 1 }).toArray()) console.log(x.at?.toISOString?.(), x.action, x.esimId || '', x.reason || x.why || '', x.by || '', JSON.stringify(x.result || x.error || '').slice(0, 160))
  console.log('## REPLACEMENTS'); for (const r of await db.collection('bsReplacements').find({}).sort({ at: 1 }).toArray()) console.log(JSON.stringify(r).slice(0, 400))
  console.log('## INCIDENTS'); for (const x of await db.collection('bsIncidents').find({ type: { $regex: 'fail|suspect|retire|replace|cancel|expire|check', $options: 'i' } }).sort({ at: 1 }).toArray()) console.log(x.at?.toISOString?.(), x.type, x.esimId || '', x.result || x.reason || x.kind || '')
  await cl.close(); process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
