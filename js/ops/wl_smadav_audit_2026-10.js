/* eslint-disable no-console */
// READ-ONLY audit of the Smadav (app-wl) cpanelAccounts. Reads MONGO_URL + DB_NAME
// from /opt/nomadly/shared/app-wl/backend.env. Run ON the droplet from an app-wl release dir.
const fs = require('fs')
const envTxt = fs.readFileSync('/opt/nomadly/shared/app-wl/backend.env', 'utf8')
const env = {}
for (const line of envTxt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) {
    let v = m[2].trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    env[m[1]] = v
  }
}
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect(env.MONGO_URL)
  const db = c.db(env.DB_NAME)
  const col = db.collection('cpanelAccounts')
  const now = new Date()
  const all = await col.find({}).toArray()
  const live = all.filter(a => !a.deleted && !a.terminatedOnWhm && !a.archived)
  console.log(`DB=${env.DB_NAME} total=${all.length} live=${live.length} deleted=${all.filter(a => a.deleted).length} now=${now.toISOString()}`)
  const rows = live.map(a => ({
    cpUser: a.cpUser,
    domain: a.domain,
    plan: (a.plan || '').slice(0, 34),
    exp: a.expiryDate ? new Date(a.expiryDate).toISOString().slice(0, 16) : '(none)',
    dLeft: a.expiryDate ? ((new Date(a.expiryDate) - now) / 86400000).toFixed(1) : '',
    susp: !!a.suspended,
    aRenew: a.autoRenew !== false,
    rnw: a.renewalCount || 0,
  })).sort((x, y) => (x.exp > y.exp ? 1 : -1))
  console.table(rows)
  const expired = live.filter(a => a.expiryDate && new Date(a.expiryDate) <= now)
  console.log(`expired-but-live=${expired.length}`, JSON.stringify(expired.map(a => `${a.cpUser} ${a.domain} susp=${!!a.suspended}`)))
  const noexp = live.filter(a => !a.expiryDate)
  console.log(`live-without-expiry=${noexp.length}`, JSON.stringify(noexp.map(a => `${a.cpUser} ${a.domain} created=${a.createdAt}`)))
  await c.close()
})().catch(e => { console.error(e.message); process.exit(1) })
