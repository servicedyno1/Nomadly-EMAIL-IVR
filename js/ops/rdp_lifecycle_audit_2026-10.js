/* global process, require, console */
// READ-ONLY: dump DO-RDP records (vpsPlansOf + doRdpServers) for audit. Usage: node rdp_lifecycle_audit_2026-10.js <backend.env> [id...]
const fs = require('fs')
const path = require('path')
const env = {}
for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) { let v = m[2].trim(); if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1); env[m[1]] = v }
}
const { MongoClient } = require(path.join(process.cwd(), 'node_modules', 'mongodb'))
const ids = process.argv.slice(3)
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]))
;(async () => {
  const c = new MongoClient(env.MONGO_URL); await c.connect()
  const db = c.db(env.DB_NAME)
  const plans = await db.collection('vpsPlansOf').find({ $or: [{ provider: 'digitalocean-rdp' }, { contaboInstanceId: /^rdp-/ }] }).toArray()
  const servers = await db.collection('doRdpServers').find({}).toArray()
  console.log('DB', env.DB_NAME, 'plans', plans.length, 'servers', servers.length)
  for (const p of plans) {
    const inst = String(p.contaboInstanceId || p.vpsId || '')
    const sid = inst.replace(/^rdp-/, '')
    const s = servers.find(x => x.server_id === sid || String(x.server_id).startsWith(sid.slice(0, 8)))
    if (ids.length && !ids.some(i => inst.includes(i) || String(p.vpsId).includes(i) || String(p._id).includes(i))) continue
    console.log(JSON.stringify({
      plan: pick(p, ['_id', 'chatId', 'vpsId', 'contaboInstanceId', 'provider', 'status', 'plan', 'start_time', 'end_time', 'grace_until', 'deleteRetryCount', 'lastDeleteError', 'autoRenewable', 'host']),
      server: s ? pick(s, ['server_id', 'status', 'do_droplet_id', 'do_size_slug', 'activated_at', 'expires_at', 'renewed_at', 'grace_until', 'destroyed_at', 'duration_months', 'chat_id', 'region']) : null,
    }))
  }
  await c.close()
})().catch(e => { console.error(e); process.exit(1) })
