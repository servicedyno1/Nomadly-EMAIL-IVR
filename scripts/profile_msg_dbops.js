// Dev-only profiler: counts Mongo ops + wall time per bot message using the local mongod profiler.
// Usage: node scripts/profile_msg_dbops.js [chatId]
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') })
const { MongoClient } = require('mongodb')
const fs = require('fs')
const axios = require('axios')
const { makeSim, LOG, URL } = require('./lib/tg_sim')
let upd = Math.floor(Date.now() / 1000)

const chatId = process.argv[2] || '999000111'
const STEPS = [
  { label: '/start', st: { kind: 'text', v: '/start' } },
  { label: '🏠 Main Menu', st: { kind: 'text', v: '🏠 Main Menu' } },
  { label: '👛 Wallet', st: { kind: 'text', v: '👛 Wallet' } },
  { label: '🏠 Main Menu (2)', st: { kind: 'text', v: '🏠 Main Menu' } },
  { label: '📞 Cloud IVR', st: { kind: 'text', v: '📞 Cloud IVR' } },
  { label: '↩️ Back', st: { kind: 'text', v: '↩️ Back' } },
]

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME)
  await db.command({ profile: 2 })
  const sim = makeSim(chatId)
  for (const { label, st } of STEPS) {
    if (st.v === '/start') await new Promise(r => setTimeout(r, 3300))
    const since = new Date()
    const offset = fs.statSync(LOG).size
    const t0 = Date.now()
    await axios.post(URL, { update_id: upd++, message: { message_id: upd, date: Math.floor(t0 / 1000), chat: { id: Number(chatId), type: 'private' }, from: { id: Number(chatId), is_bot: false, first_name: 'Prof', username: 'prof' }, text: st.v } })
    let firstOut = null
    while (Date.now() - t0 < 8000) {
      await new Promise(r => setTimeout(r, 10))
      if (sim.parseOut(sim.readFrom(offset)).msgs.length) { firstOut = Date.now() - t0; break }
    }
    await new Promise(r => setTimeout(r, 1200))
    const out = sim.parseOut(sim.readFrom(offset))
    const ops = await db.collection('system.profile').find({ ts: { $gt: since }, ns: { $not: /system\.profile/ } }).toArray()
    const byOp = {}
    for (const o of ops) {
      const k = `${o.op}:${o.ns.split('.').slice(1).join('.')}`
      byOp[k] = (byOp[k] || 0) + 1
    }
    const top = Object.entries(byOp).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}×${v}`).join('  ')
    console.log(`\n▶ ${label}: ${ops.length} mongo ops, replies=${out.msgs.length}${firstOut !== null ? `, first reply after ${firstOut}ms` : ''}`)
    console.log('   ' + top)
  }
  await db.command({ profile: 0 })
  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
