/* global process, require, console */
// READ-ONLY ops inspection. Usage: node ops_db_inspect.js /path/to/backend.env
const fs = require('fs')
const path = require('path')

const envPath = process.argv[2]
if (!envPath || !fs.existsSync(envPath)) { console.error('env file not found:', envPath); process.exit(1) }
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); env[m[1]] = v }
}
const MONGO_URL = env.MONGO_URL
const DB_NAME = env.DB_NAME
const { MongoClient } = require(path.join(process.cwd(), 'node_modules', 'mongodb'))

const CP_USERS = ['nseu77f4', 'veri84a1', 'authc64a', 'wafrfa29', 'ghrx51df', 'pent14295', 'pent14361t179052']
const ORDER_CHAT = '1187860699'
const ORDER_DOMAIN = 'surpriseforyou.sbs'

;(async () => {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  console.log('==== DB_NAME:', DB_NAME, '====')

  const cp = db.collection('cpanelAccounts')
  console.log('\n--- expired/orphan cpUsers present in THIS db ---')
  for (const u of CP_USERS) {
    const doc = await cp.findOne({ cpUser: u })
    if (doc) console.log(`${u}: domain=${doc.domain} chatId=${doc.chatId} suspended=${doc.suspended} deleted=${doc.deleted} terminatedOnWhm=${doc.terminatedOnWhm} whmTerminatePending=${doc.whmTerminatePending} expiry=${doc.expiryDate} plan=${doc.plan}`)
  }

  console.log('\n--- failed order: cpanelAccounts for domain', ORDER_DOMAIN, '---')
  const oa = await cp.find({ domain: ORDER_DOMAIN }).toArray()
  oa.forEach(d => console.log(JSON.stringify({ _id: d._id, cpUser: d.cpUser, chatId: d.chatId, plan: d.plan, suspended: d.suspended, deleted: d.deleted, expiryDate: d.expiryDate, createdAt: d.createdAt, renewalPriceUsd: d.renewalPriceUsd })))

  console.log('\n--- registeredDomains for', ORDER_DOMAIN, '---')
  const rd = await db.collection('registeredDomains').findOne({ _id: ORDER_DOMAIN })
  console.log(rd ? JSON.stringify({ _id: rd._id, chatId: rd.chatId, registrar: rd.registrar, cfZoneId: rd.cfZoneId, nameservers: rd.nameservers, status: rd.status, createdAt: rd.createdAt }) : 'NOT FOUND in this db')

  console.log('\n--- wallet for chatId', ORDER_CHAT, '---')
  const w = await db.collection('walletOf').findOne({ _id: Number(ORDER_CHAT) }) || await db.collection('walletOf').findOne({ _id: ORDER_CHAT })
  if (w) console.log(`usdIn=${w.usdIn} usdOut=${w.usdOut} balance=${(Number(w.usdIn||0)-Number(w.usdOut||0)).toFixed(2)}`)
  else console.log('no wallet doc for', ORDER_CHAT, 'in this db')

  console.log('\n--- recent walletLedger for', ORDER_CHAT, '(last 12) ---')
  try {
    const led = await db.collection('walletLedger').find({ chatId: { $in: [Number(ORDER_CHAT), ORDER_CHAT] } }).sort({ _id: -1 }).limit(12).toArray()
    led.forEach(l => console.log(JSON.stringify({ at: l.createdAt || l.at || l.ts, type: l.type, amount: l.amountUsd ?? l.amount ?? l.usd, note: l.note || l.reason || l.desc })))
    if (!led.length) console.log('(no ledger rows)')
  } catch (e) { console.log('ledger query err:', e.message) }

  console.log('\n--- count: total cpanelAccounts, active (not deleted), suspended-not-deleted ---')
  console.log('total:', await cp.countDocuments({}))
  console.log('not-deleted:', await cp.countDocuments({ deleted: { $ne: true } }))
  console.log('suspended & not-deleted:', await cp.countDocuments({ suspended: true, deleted: { $ne: true } }))
  console.log('whmTerminatePending:', await cp.countDocuments({ whmTerminatePending: true }))

  await client.close()
})().catch(e => { console.error('ERR', e); process.exit(1) })
