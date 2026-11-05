// Read-only: show the CloudIVR web accounts for the given emails (numbers, wallet, referral) + Telnyx balance.
// Run on the droplet: cd /opt/nomadly/current/app-main && node /root/civr_grant_inspect.js a@x.com b@y.com
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
const axios = require('axios')

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(process.env.DB_NAME)
  for (const raw of process.argv.slice(2)) {
    const email = raw.trim().toLowerCase()
    const acc = await db.collection('webAccounts').findOne({ email }, { projection: { passwordHash: 0, twoFactor: 0, twoFactorPending: 0 } })
    if (!acc) { console.log(`\n${email}: NO web account`); continue }
    const id = String(acc._id)
    const w = await db.collection('walletOf').findOne({ _id: id })
    const nums = ((await db.collection('phoneNumbersOf').findOne({ _id: id }))?.val?.numbers || [])
    const prefs = await db.collection('webPrefs').findOne({ _id: id }, { projection: { lang: 1 } })
    console.log(`\n${email}: id=${id} name=${JSON.stringify(acc.name)} created=${acc.createdAt?.toISOString?.()} disabled=${!!acc.disabled} referredBy=${acc.referredBy || '-'} lang=${prefs?.lang || 'en'}`)
    console.log(`  wallet: in=${w?.usdIn || 0} out=${w?.usdOut || 0} balance=${Math.round(((w?.usdIn || 0) - (w?.usdOut || 0)) * 100) / 100}`)
    for (const n of nums) console.log(`  number ${n.phoneNumber} ${n.type} plan=${n.plan} status=${n.status} expires=${n.expiresAt} autoRenew=${n.autoRenew}`)
    if (!nums.length) console.log('  numbers: none')
  }
  console.log('\nplans:', JSON.stringify(Object.fromEntries(Object.entries(require('/opt/nomadly/current/app-main/js/phone-config').plans).map(([k, p]) => [k, p.price]))))
  try {
    const b = await axios.get('https://api.telnyx.com/v2/balance', { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }, timeout: 15000 })
    console.log('telnyx balance:', b.data?.data?.balance, b.data?.data?.currency, 'available credit:', b.data?.data?.available_credit)
  } catch (e) { console.log('telnyx balance error', e.response?.status || e.message) }
  await client.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
