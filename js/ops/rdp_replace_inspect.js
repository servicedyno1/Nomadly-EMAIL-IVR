// Read-only: show a bot user's RDP orders (vpsPlansOf + doRdpServers + purchase txns) for replacement ops.
//   cd /opt/nomadly/current/app-main && NODE_PATH=$PWD/node_modules node /root/rdp_replace_inspect.js <username|chatId>
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
const who = String(process.argv[2] || '').replace(/^@/, '')

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(process.env.DB_NAME)
  let chatId = /^\d+$/.test(who) ? who : null
  if (!chatId) {
    const rows = await db.collection('nameOf').find({ val: { $regex: `^${who}$`, $options: 'i' } }).toArray()
    console.log('nameOf matches:', rows.map(r => `${r._id}=${r.val}`).join(', ') || 'none')
    chatId = rows[0] && String(rows[0]._id)
  }
  if (!chatId) return client.close()
  const st = await db.collection('state').findOne({ _id: chatId }, { projection: { userLanguage: 1, vpsDetails: 1 } }) || await db.collection('state').findOne({ _id: Number(chatId) }, { projection: { userLanguage: 1, vpsDetails: 1 } })
  const w = await db.collection('walletOf').findOne({ _id: chatId })
  console.log(`chatId ${chatId} lang=${st?.userLanguage} wallet=$${((w?.usdIn || 0) - (w?.usdOut || 0)).toFixed(2)}`)
  const plans = await db.collection('vpsPlansOf').find({ chatId }).sort({ timestamp: -1 }).toArray()
  for (const p of plans) {
    const { rootPasswordSecretId, credentials, ...safe } = p
    console.log('\nvpsPlansOf', JSON.stringify(safe, null, 1))
    const sid = String(p.contaboInstanceId || p.vpsId || '').replace(/^rdp-/, '')
    const s = await db.collection('doRdpServers').findOne({ server_id: sid })
    if (s) {
      const { callback_token, vnc_password, logs, commands, ...rest } = s
      console.log('doRdpServers', JSON.stringify(rest, null, 1))
      console.log('last logs:', (logs || []).slice(-6).map(l => `${new Date(l.ts).toISOString()} ${l.stage}: ${l.message}`).join('\n  '))
    }
  }
  const tx = await db.collection('transactions').find({ chatId: { $in: [chatId, Number(chatId)] }, type: { $in: ['vps', 'vps-renewal', 'rdp', 'admin-credit', 'refund'] } }).sort({ createdAt: -1 }).limit(10).toArray()
  console.log('\ntransactions:', tx.map(t => `${t._id} ${t.type} $${t.amount} ${t.status} ${t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt} ${JSON.stringify(t.metadata || {})}`).join('\n  '))
  console.log('\nstate.vpsDetails:', JSON.stringify(st?.vpsDetails || null).slice(0, 1500))
  await client.close()
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1) })
