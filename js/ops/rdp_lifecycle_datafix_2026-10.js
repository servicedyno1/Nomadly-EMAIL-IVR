/* global process, require, console */
// One-time prod data fix (2026-10-14) for the DO-RDP lifecycle issues. Dry-run by default; --apply writes.
//   node js/ops/rdp_lifecycle_datafix_2026-10.js <backend.env> [--apply]
const fs = require('fs')
const path = require('path')
const env = {}
for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) { let v = m[2].trim(); if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1); env[m[1]] = v }
}
const APPLY = process.argv.includes('--apply')
const { MongoClient } = require(path.join(process.cwd(), 'node_modules', 'mongodb'))
const GONE = { server: '60811b81-70e9-47d8-807c-c5dc8616423c', droplet: 605654801, destroyedAt: new Date('2026-10-05T12:59:19Z'), refundTxn: 'TXN-20261014-1E0PI' }
const STUCK_PLAN = '227de9e3-c9da-4d38-aa06-8ff31b216057'
;(async () => {
  const c = new MongoClient(env.MONGO_URL); await c.connect()
  const db = c.db(env.DB_NAME)
  const servers = db.collection('doRdpServers'), plans = db.collection('vpsPlansOf')
  const now = new Date()
  console.log(`DB ${env.DB_NAME} — ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  // 1) @morganfreebandzz Power RDP — droplet destroyed outside the bot on Oct 5, owner refunded $156 on Oct 14.
  const g = await servers.findOne({ server_id: GONE.server }, { projection: { logs: 0, callback_token: 0, vnc_password: 0 } })
  const gp = await plans.findOne({ contaboInstanceId: `rdp-${GONE.server}` })
  console.log('1) before:', g && g.status, g && g.do_droplet_id, '| plan', gp && gp.status)
  if (APPLY && g && g.status !== 'destroyed') {
    await servers.updateOne({ server_id: GONE.server }, { $set: { status: 'destroyed', destroy_reason: 'droplet_gone_external', destroyed_at: GONE.destroyedAt, ip_address: null, do_droplet_id: null, gone_droplet_id: GONE.droplet, refund_txn: GONE.refundTxn },
      $push: { logs: { ts: now, stage: 'droplet_gone', message: `Droplet ${GONE.droplet} was destroyed outside the bot on 2026-10-05; customer refunded (${GONE.refundTxn}). Marked by ops.` } } })
    await plans.updateOne({ _id: gp._id }, { $set: { status: 'DELETED', deletedAt: GONE.destroyedAt, cancelReason: 'droplet_gone_external', refundTxn: GONE.refundTxn } })
  }

  // 2) Owner test record looping "[RDP Grace] destroy" via Vultr every 5 min — the box is long gone.
  const sp = await plans.findOne({ _id: STUCK_PLAN })
  console.log('2) before:', sp && sp.status, 'retries', sp && sp.deleteRetryCount)
  if (APPLY && sp && sp.status === 'EXPIRED_GRACE') {
    await plans.updateOne({ _id: STUCK_PLAN }, { $set: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'expired_grace_already_gone' }, $unset: { deleteRetryCount: '', lastDeleteError: '', lastDeleteAlertAt: '' } })
  }

  // 3) Active boxes: doRdpServers.expires_at := the customer's paid-until (vpsPlansOf.end_time).
  for await (const s of servers.find({ status: 'active' }, { projection: { server_id: 1, expires_at: 1 } })) {
    const p = await plans.findOne({ $or: [{ contaboInstanceId: `rdp-${s.server_id}` }, { instanceId: `rdp-${s.server_id}` }] })
    if (!p || !p.end_time || !['RUNNING', 'running', 'active'].includes(String(p.status))) continue
    const same = s.expires_at && new Date(s.expires_at).getTime() === new Date(p.end_time).getTime()
    console.log(`3) ${s.server_id.slice(0, 8)} expires_at ${s.expires_at ? new Date(s.expires_at).toISOString() : null} → ${new Date(p.end_time).toISOString()}${same ? ' (same)' : ''}`)
    if (APPLY && !same) await servers.updateOne({ server_id: s.server_id }, { $set: { expires_at: new Date(p.end_time) } })
  }
  await c.close()
})().catch(e => { console.error(e); process.exit(1) })
