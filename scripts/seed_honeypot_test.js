// Sandbox seed: two hosting accounts (monthly + weekly) owned by the e2e key
// owner, each with a CF-backed registeredDomains doc so resolveDomainCfState
// resolves hasCloudflare via the DB path (no live Cloudflare API call).
// The monthly account is made login-able (bcrypt PIN + encrypted pass) so the
// customer HostPanel /security/* flow can be exercised end-to-end.
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') })
const { MongoClient } = require('mongodb')
const cpAuth = require('../js/cpanel-auth')

const OWNER = '5590563715'
const MONTHLY_DOMAIN = 'hp-monthly-test.com'
const WEEKLY_DOMAIN = 'hp-weekly-test.com'
const PIN = '135790'

async function main() {
  const url = process.env.MONGO_URL
  const dbName = process.env.DB_NAME
  const client = new MongoClient(url)
  await client.connect()
  const db = client.db(dbName)

  const pinHash = await cpAuth.hashPin(PIN)
  const encPass = cpAuth.encrypt('DummyCpPass123!')

  await db.collection('cpanelAccounts').updateOne(
    { _id: 'hptestmonthly' },
    { $set: {
      _id: 'hptestmonthly', chatId: OWNER, cpUser: 'hptestmonthly', domain: MONTHLY_DOMAIN,
      plan: 'Premium Anti-Red HostPanel', deleted: false, addonDomains: [],
      pinHash, cpPass_encrypted: encPass.encrypted, cpPass_iv: encPass.iv, cpPass_tag: encPass.tag,
    } },
    { upsert: true }
  )
  await db.collection('cpanelAccounts').updateOne(
    { _id: 'hptestweekly' },
    { $set: {
      _id: 'hptestweekly', chatId: OWNER, cpUser: 'hptestweekly', domain: WEEKLY_DOMAIN,
      plan: 'Premium Anti-Red (1-Week)', deleted: false, addonDomains: [],
      pinHash, cpPass_encrypted: encPass.encrypted, cpPass_iv: encPass.iv, cpPass_tag: encPass.tag,
    } },
    { upsert: true }
  )
  for (const d of [MONTHLY_DOMAIN, WEEKLY_DOMAIN]) {
    await db.collection('registeredDomains').updateOne(
      { _id: d },
      { $set: { _id: d, val: { cfZoneId: 'zone-test-' + d, nameserverType: 'cloudflare' } } },
      { upsert: true }
    )
  }

  console.log(JSON.stringify({ monthly: MONTHLY_DOMAIN, weekly: WEEKLY_DOMAIN, owner: OWNER, db: dbName, monthlyLogin: { username: 'hptestmonthly', pin: PIN }, weeklyLogin: { username: 'hptestweekly', pin: PIN } }))
  await client.close()
}
main().catch(e => { console.error(e); process.exit(1) })
