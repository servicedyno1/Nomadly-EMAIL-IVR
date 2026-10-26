// Ops: after /admin/comp-vps built a replacement RDP, give it the original order's end date and link old ↔ new.
//   cd /opt/nomadly/current/app-main && NODE_PATH=$PWD/node_modules node /root/rdp_replace_finalize.js <chatId> <oldInstanceId> [--go]
// Waits (up to 30 min) for the new box to be active, then sets vpsPlansOf.end_time + doRdpServers.expires_at.
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
const [chatId, oldId] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const GO = process.argv.includes('--go')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  if (!chatId || !oldId) throw new Error('usage: <chatId> <oldInstanceId> [--go]')
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(process.env.DB_NAME)
  const plans = db.collection('vpsPlansOf'), servers = db.collection('doRdpServers')
  const old = await plans.findOne({ chatId, vpsId: oldId })
  if (!old) throw new Error(`old plan ${oldId} not found`)
  const end = new Date(old.end_time)
  let fresh = null, srv = null
  for (let i = 0; i < 180; i++) {
    fresh = await plans.find({ chatId, isRDP: true, comp: true, timestamp: { $gt: new Date(old.timestamp) }, status: { $ne: 'DELETED' } }).sort({ timestamp: -1 }).limit(1).next()
    srv = fresh && await servers.findOne({ server_id: String(fresh.vpsId).replace(/^rdp-/, '') })
    if (srv && (srv.status === 'active' || srv.status === 'failed')) break
    await sleep(10000)
  }
  if (!fresh || !srv) throw new Error('replacement not found yet')
  console.log(`new ${fresh.vpsId} status=${srv.status} ip=${srv.ip_address} region=${srv.region} size=${srv.do_size_slug} os=${srv.os_id} activated=${srv.activated_at?.toISOString?.()} expires_at=${srv.expires_at?.toISOString?.()} plan end_time=${new Date(fresh.end_time).toISOString()}`)
  if (srv.status !== 'active') throw new Error(`replacement is ${srv.status} — not touching dates`)
  if (!GO) { console.log(`(dry) would set end_time/expires_at → ${end.toISOString()} and link ${oldId} ↔ ${fresh.vpsId}`); return client.close() }
  await plans.updateOne({ _id: fresh._id }, { $set: { end_time: end, replacesInstanceId: oldId, start_time: new Date(old.start_time) } })
  await servers.updateOne({ server_id: srv.server_id }, { $set: { expires_at: end, replaces_server_id: String(oldId).replace(/^rdp-/, '') } })
  await plans.updateOne({ _id: old._id }, { $set: { replacedBy: fresh.vpsId, replacedAt: new Date() } })
  const chk = await plans.findOne({ _id: fresh._id }), chk2 = await servers.findOne({ server_id: srv.server_id })
  console.log(`DONE end_time=${new Date(chk.end_time).toISOString()} expires_at=${new Date(chk2.expires_at).toISOString()} autoRenewable=${chk.autoRenewable} status=${chk.status}`)
  await client.close()
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1) })
