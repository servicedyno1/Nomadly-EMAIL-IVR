/* eslint-disable no-console */
// READ-ONLY audit of cpanelAccounts expiry/billing state on the PRODUCTION DB.
// Usage: node js/ops/hosting_expiry_audit_2026-10.js [dbName]
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')

const url = process.env.RESELLER_DB_URL
const dbName = process.argv[2] || 'test'

function days(ms) { return (ms / 86400000).toFixed(1) }

;(async () => {
  const client = await MongoClient.connect(url)
  const db = client.db(dbName)
  const col = db.collection('cpanelAccounts')
  const now = new Date()

  const all = await col.find({}).toArray()
  console.log(`DB=${dbName} cpanelAccounts total=${all.length} now=${now.toISOString()}`)

  const live = all.filter(a => !a.deleted && !a.terminatedOnWhm && !a.archived)
  const deleted = all.filter(a => a.deleted)
  console.log(`live(not deleted/terminated/archived)=${live.length} deleted=${deleted.length} terminatedOnWhm=${all.filter(a => a.terminatedOnWhm).length} archived=${all.filter(a => a.archived).length}`)

  // Type distribution of expiryDate
  const types = {}
  for (const a of live) {
    const t = a.expiryDate === undefined ? 'missing' : a.expiryDate === null ? 'null' : a.expiryDate instanceof Date ? 'Date' : typeof a.expiryDate
    types[t] = (types[t] || 0) + 1
  }
  console.log('expiryDate types (live):', types)

  console.log('\n=== LIVE accounts (sorted by expiry) ===')
  const rows = live.map(a => {
    const exp = a.expiryDate ? new Date(a.expiryDate) : null
    return {
      cpUser: a.cpUser, domain: a.domain, plan: a.plan, chatId: a.chatId,
      expiry: exp ? exp.toISOString().slice(0, 16) : '(none)',
      dLeft: exp ? days(exp - now) : '',
      status: a.status, suspended: !!a.suspended, autoRenew: a.autoRenew !== false,
      notified: !!a.expiryNotified, price: a.renewalPriceUsd, term: a.termMonths,
      renewals: a.renewalCount || 0, lastRenew: a.lastRenewedAt ? new Date(a.lastRenewedAt).toISOString().slice(0, 10) : '',
      created: a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : '',
      via: a.via || a.source || (a.apiKeyId ? 'api' : ''),
      lastErr: a.autoRenewLastError || '',
    }
  }).sort((x, y) => (x.expiry > y.expiry ? 1 : -1))
  console.table(rows)

  console.log('\n=== Anomalies ===')
  const expiredLive = live.filter(a => a.expiryDate && new Date(a.expiryDate) <= now)
  console.log(`expired but still live: ${expiredLive.length}`, expiredLive.map(a => `${a.cpUser} ${a.domain} exp=${new Date(a.expiryDate).toISOString()} suspended=${!!a.suspended}`))
  const noExpiry = live.filter(a => !a.expiryDate)
  console.log(`live without expiryDate: ${noExpiry.length}`, noExpiry.map(a => `${a.cpUser} ${a.domain} status=${a.status} created=${a.createdAt}`))
  const far = live.filter(a => a.expiryDate && (new Date(a.expiryDate) - now) > 40 * 86400000)
  console.log(`live with expiry > 40 days out: ${far.length}`, far.map(a => `${a.cpUser} ${a.domain} plan=${a.plan} term=${a.termMonths} exp=${new Date(a.expiryDate).toISOString().slice(0, 10)}`))
  const notifiedStuck = live.filter(a => a.expiryNotified && a.expiryDate && (new Date(a.expiryDate) - now) > 1.5 * 86400000)
  console.log(`expiryNotified=true but expiry > 36h away (warning will NOT fire this cycle): ${notifiedStuck.length}`, notifiedStuck.map(a => `${a.cpUser} ${a.domain} exp=${new Date(a.expiryDate).toISOString().slice(0, 10)} lastRenew=${a.lastRenewedAt}`))
  const weeklyStack = live.filter(a => /week/i.test(a.plan || '') && a.expiryDate && (new Date(a.expiryDate) - now) > 8 * 86400000)
  console.log(`weekly plans with > 8 days left: ${weeklyStack.length}`, weeklyStack.map(a => `${a.cpUser} ${a.domain} exp=${new Date(a.expiryDate).toISOString().slice(0, 10)}`))

  console.log('\n=== Deleted but NOT terminated on WHM (whmTerminatePending) ===')
  const pend = all.filter(a => a.deleted && a.whmTerminatePending && !a.terminatedOnWhm)
  console.log(pend.length, pend.map(a => `${a.cpUser} ${a.domain} deletedAt=${a.deletedAt}`))

  console.log('\n=== Recently deleted (last 30d) ===')
  const recentDel = deleted.filter(a => a.deletedAt && (now - new Date(a.deletedAt)) < 30 * 86400000)
  console.table(recentDel.map(a => ({ cpUser: a.cpUser, domain: a.domain, plan: a.plan, expiry: a.expiryDate ? new Date(a.expiryDate).toISOString().slice(0, 10) : '', deletedAt: new Date(a.deletedAt).toISOString().slice(0, 16), terminatedOnWhm: !!a.terminatedOnWhm, pending: !!a.whmTerminatePending })))

  console.log('\n=== Renewal history (lastRenewedAt in last 60d) ===')
  const recentRenew = all.filter(a => a.lastRenewedAt && (now - new Date(a.lastRenewedAt)) < 60 * 86400000)
  console.table(recentRenew.map(a => ({ cpUser: a.cpUser, domain: a.domain, plan: a.plan, lastRenewedAt: new Date(a.lastRenewedAt).toISOString().slice(0, 16), renewals: a.renewalCount, deleted: !!a.deleted })))

  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
