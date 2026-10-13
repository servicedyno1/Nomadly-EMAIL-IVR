/* eslint-disable no-console */
// READ-ONLY: compare WHM /listaccts against production cpanelAccounts (DB test).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
const whm = require('../whm-service')

;(async () => {
  const accts = await whm.listAccounts()
  console.log(`WHM accounts: ${accts.length}`)
  const client = await MongoClient.connect(process.env.RESELLER_DB_URL)
  const col = client.db(process.argv[2] || 'test').collection('cpanelAccounts')
  const dbAll = await col.find({}).toArray()
  const byUser = new Map(dbAll.map(a => [a.cpUser, a]))
  const now = Date.now()

  const rows = accts.map(a => {
    const d = byUser.get(a.user)
    return {
      user: a.user, domain: a.domain, plan: a.plan, suspended: a.suspended ? 'Y' : '',
      whmStart: a.unix_startdate ? new Date(a.unix_startdate * 1000).toISOString().slice(0, 10) : '',
      disk: a.diskused, owner: a.owner,
      inDb: d ? 'Y' : 'NO',
      dbDeleted: d ? (d.deleted ? 'Y' : '') : '',
      dbTermOnWhm: d ? (d.terminatedOnWhm ? 'Y' : '') : '',
      dbExpiry: d && d.expiryDate ? new Date(d.expiryDate).toISOString().slice(0, 10) : '',
      dbDaysLeft: d && d.expiryDate ? ((new Date(d.expiryDate) - now) / 86400000).toFixed(1) : '',
      dbSusp: d ? (d.suspended ? 'Y' : '') : '',
    }
  }).sort((x, y) => (x.dbExpiry || 'zzzz').localeCompare(y.dbExpiry || 'zzzz'))
  console.table(rows)

  const orphans = rows.filter(r => r.inDb === 'NO' || r.dbDeleted === 'Y')
  console.log(`\nWHM accounts NOT backed by a live DB record (orphans → consume license seats): ${orphans.length}`)
  console.table(orphans)

  const whmUsers = new Set(accts.map(a => a.user))
  const liveNotOnWhm = dbAll.filter(a => !a.deleted && !a.terminatedOnWhm && !a.archived && a.cpUser && !whmUsers.has(a.cpUser))
  console.log(`\nLive DB accounts missing on WHM: ${liveNotOnWhm.length}`, liveNotOnWhm.map(a => `${a.cpUser} ${a.domain}`))

  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
