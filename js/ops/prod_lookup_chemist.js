#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/*
 * READ-ONLY production lookup for @chemist454's Cloud IVR / voice activity.
 * Connects to the ORIGINAL production Mongo (from backend/.env comment line),
 * performs ONLY find/aggregate queries (no writes), and dumps results to
 * /app/investigations/chemist_ivr/.
 */
const fs = require('fs')
const path = require('path')
const { MongoClient } = require('mongodb')

function readEnvProdMongo() {
  const envPath = path.resolve(__dirname, '../../backend/.env')
  const txt = fs.readFileSync(envPath, 'utf8')
  // ORIGINAL_PROD_MONGO_URL is stored as a comment line: # ORIGINAL_PROD_MONGO_URL="..."
  const m = txt.match(/ORIGINAL_PROD_MONGO_URL\s*=\s*"?([^"\n]+)"?/)
  if (!m) throw new Error('ORIGINAL_PROD_MONGO_URL not found in backend/.env')
  return m[1].trim()
}

const USERNAME_CANDIDATES = ['chemist454', 'Chemist454', 'CHEMIST454', '@chemist454']
const DAYS = parseInt(process.env.LOOKUP_DAYS || '5', 10)
const sinceMs = Date.now() - DAYS * 24 * 3600 * 1000
const sinceDate = new Date(sinceMs)

const OUT = '/app/investigations/chemist_ivr'
fs.mkdirSync(OUT, { recursive: true })

function write(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2))
}

;(async () => {
  const url = readEnvProdMongo()
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 20000 })
  await client.connect()
  // Pick the db that actually holds the bot collections (prod default DB_NAME='nomadly_bot').
  let dbName = process.env.PROD_DB_NAME || 'nomadly_bot'
  try {
    const admin = client.db('admin').admin()
    const { databases } = await admin.listDatabases()
    console.log('[lookup] databases:', databases.map(d => d.name).join(', '))
    const candidates = [process.env.PROD_DB_NAME, 'nomadly_bot', 'test', 'nomadly', 'production'].filter(Boolean)
    for (const c of candidates) {
      if (!databases.find(d => d.name === c)) continue
      const cols = await client.db(c).listCollections({ name: 'chatIdOf' }).toArray()
      if (cols.length) { dbName = c; break }
    }
  } catch (e) { console.log('[lookup] listDatabases failed, using default:', e.message) }
  const db = client.db(dbName)
  console.log(`[lookup] connected, db=${dbName}, window=${DAYS}d since ${sinceDate.toISOString()}`)

  // 1) Resolve chatId
  let chatId = null
  const chatIdOf = db.collection('chatIdOf')
  for (const u of USERNAME_CANDIDATES) {
    const doc = await chatIdOf.findOne({ _id: u })
    if (doc) { chatId = doc.val != null ? String(doc.val) : null; console.log(`[lookup] chatIdOf[${u}] = ${JSON.stringify(doc)}`); if (chatId) break }
  }
  // fallback: scan nameOf for the username value
  if (!chatId) {
    const nameOf = db.collection('nameOf')
    const hit = await nameOf.findOne({ val: { $in: USERNAME_CANDIDATES } })
    if (hit) { chatId = String(hit._id); console.log(`[lookup] nameOf reverse hit: ${JSON.stringify(hit)}`) }
  }
  if (!chatId) {
    console.log('[lookup] Could NOT resolve chatId for chemist454. Dumping candidate nameOf matches...')
    const nameOf = db.collection('nameOf')
    const partial = await nameOf.find({ val: { $regex: 'chemist', $options: 'i' } }).limit(20).toArray()
    write('nameOf_partial.json', partial)
    console.log(`[lookup] nameOf partial 'chemist' matches: ${partial.length}`)
    partial.forEach(d => console.log('   ', d._id, '=>', d.val))
    await client.close()
    return
  }
  console.log(`[lookup] RESOLVED chatId = ${chatId}`)

  const num = Number(chatId)
  const idVariants = [chatId, num]

  // 2) Profile
  const nameOf = db.collection('nameOf')
  const profile = {
    chatId,
    name: await nameOf.findOne({ _id: chatId }),
    wallet: await db.collection('walletOf').findOne({ _id: chatId }),
  }
  write('profile.json', profile)
  console.log(`[lookup] name=${JSON.stringify(profile.name)} wallet=${JSON.stringify(profile.wallet)}`)

  // 3) Owned phone numbers
  const phones = await db.collection('phoneNumbersOf').find({ _id: { $in: idVariants.map(String) } }).toArray()
  write('phoneNumbers.json', phones)
  const numbers = []
  phones.forEach(p => {
    const arr = p.val || p.numbers || p.phoneNumbers || []
    if (Array.isArray(arr)) arr.forEach(n => numbers.push(n.phoneNumber || n.number || n))
  })
  console.log(`[lookup] owned numbers: ${JSON.stringify(numbers)}`)

  // 4) callLogs for this chat in window
  const callLogs = db.collection('callLogs')
  const calls = await callLogs.find({
    chatId: { $in: idVariants },
    $or: [
      { createdAt: { $gte: sinceDate } },
      { createdAt: { $gte: sinceMs } },
      { updatedAt: { $gte: sinceDate } },
    ]
  }).sort({ createdAt: -1 }).limit(500).toArray()
  write('callLogs.json', calls)
  console.log(`[lookup] callLogs in window: ${calls.length}`)

  // status / hangup-cause histogram
  const hist = {}
  const keysSeen = new Set()
  calls.forEach(c => {
    Object.keys(c).forEach(k => keysSeen.add(k))
    const st = c.status || c.callStatus || c.hangupCause || c.result || 'unknown'
    hist[st] = (hist[st] || 0) + 1
  })
  console.log(`[lookup] callLogs fields present: ${[...keysSeen].join(', ')}`)
  console.log(`[lookup] status histogram: ${JSON.stringify(hist, null, 2)}`)

  // 5) walletLedger + pendingCallBills + transactions (voice-related) in window
  const ledger = await db.collection('walletLedger').find({
    chatId: { $in: idVariants },
    $or: [{ createdAt: { $gte: sinceDate } }, { timestamp: { $gte: sinceDate } }, { createdAt: { $gte: sinceMs } }]
  }).sort({ createdAt: -1 }).limit(500).toArray().catch(() => [])
  write('walletLedger.json', ledger)
  console.log(`[lookup] walletLedger rows in window: ${ledger.length}`)

  const pend = await db.collection('pendingCallBills').find({ chatId: { $in: idVariants } })
    .sort({ createdAt: -1 }).limit(200).toArray().catch(() => [])
  write('pendingCallBills.json', pend)
  console.log(`[lookup] pendingCallBills rows: ${pend.length}`)

  const txns = await db.collection('transactions').find({
    $or: [{ chatId: { $in: idVariants } }, { userId: { $in: idVariants } }, { _id: { $regex: String(chatId) } }]
  }).sort({ createdAt: -1 }).limit(200).toArray().catch(() => [])
  write('transactions.json', txns)
  console.log(`[lookup] transactions rows: ${txns.length}`)

  // 6) bulk call campaigns (dropped calls might be bulk IVR)
  const bulk = await db.collection('bulkCallCampaigns').find({ chatId: { $in: idVariants } })
    .sort({ createdAt: -1 }).limit(50).toArray().catch(() => [])
  write('bulkCallCampaigns.json', bulk)
  console.log(`[lookup] bulkCallCampaigns rows: ${bulk.length}`)

  // Print the most recent 15 calls compactly
  console.log('\n[lookup] === most recent calls (up to 15) ===')
  calls.slice(0, 15).forEach(c => {
    console.log(JSON.stringify({
      at: c.createdAt, dir: c.direction, to: c.to || c.destination || c.dialedNumber,
      from: c.from || c.callerId, status: c.status || c.callStatus, cause: c.hangupCause,
      dur: c.duration || c.durationSec, type: c.type, provider: c.provider,
      callSid: c.callSid, callControlId: c.callControlId, bridged: c.bridged, notes: c.error || c.reason
    }))
  })

  await client.close()
  console.log(`\n[lookup] done. Files written to ${OUT}`)
})().catch(e => { console.error('[lookup] FATAL', e); process.exit(1) })
