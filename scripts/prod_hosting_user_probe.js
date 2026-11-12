// read-only: a user's hosting accounts, addon domains, domain records and recent hosting events. Usage: node prod_hosting_user_probe.js <chatId> [days]
const fs = require('fs'), { MongoClient } = require('mongodb')
const env = {}; for (const l of fs.readFileSync(process.env.ENVF || '/opt/nomadly/shared/app-main/backend.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
;(async () => {
  const id = process.argv[2], days = Number(process.argv[3] || 5), since = new Date(Date.now() - days * 864e5)
  const cl = await MongoClient.connect(env.MONGO_URL), db = cl.db(env.DB_NAME)
  const hide = (d) => JSON.stringify(d, (k, v) => /pass|token|secret|key$/i.test(k) ? '***' : v)
  for (const c of ['cpanelAccounts']) for (const d of await db.collection(c).find({ $or: [{ chatId: id }, { chatId: Number(id) }] }).toArray()) console.log(c, hide(d).slice(0, 2500), '\n')
  const cols = (await db.listCollections().toArray()).map(c => c.name).filter(n => /addon|hostingLog|domainLog|panel|audit|event/i.test(n))
  console.log('CANDIDATE COLS', cols.join(','))
  for (const c of cols) { const r = await db.collection(c).find({ $or: [{ chatId: id }, { chatId: Number(id) }, { userId: id }] }).sort({ _id: -1 }).limit(15).toArray().catch(() => []); if (r.length) { console.log('\n##', c); r.forEach(d => console.log(hide(d).slice(0, 600))) } }
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
