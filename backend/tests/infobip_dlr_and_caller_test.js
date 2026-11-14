// Infobip SMS DLR webhook + system caller rotation (iteration 277). Run: node backend/tests/infobip_dlr_and_caller_test.js
require('/app/node_modules/dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('/app/node_modules/mongodb')
const BASE = (require('fs').readFileSync('/app/frontend/.env', 'utf8').match(/REACT_APP_BACKEND_URL=(.*)/) || [])[1].trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const res = []
const ok = (name, cond, extra = '') => { res.push([name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`) }
const post = (k, body) => fetch(`${BASE}/api/infobip/sms-dlr/${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

;(async () => {
  const client = await new MongoClient(process.env.MONGO_URL).connect()
  const db = client.db(process.env.DB_NAME)
  const CHAT = '5000000000000077'
  const logs = db.collection('phoneLogs'), walletOf = db.collection('walletOf'), tx = db.collection('transactions')
  const w0 = await walletOf.findOne({ _id: CHAT })
  const ids = []
  try {
    // --- System caller rotation ---
    const ivr = require('/app/js/ivr-outbound')
    ivr.setPickLogDb(db)
    const before = await db.collection('systemCallerPicks').countDocuments({ purpose: 'TEST_rot' })
    const a = await ivr.getTrialCaller({ purpose: 'TEST_rot', chatId: 1, to: '+15550000000' })
    const b = await ivr.getTrialCaller({ purpose: 'TEST_rot' })
    const c = await ivr.getTrialCaller({ purpose: 'TEST_rot' })
    console.log('picks', a.callerId, b.callerId, c.callerId)
    ok('rotation alternates', new Set([a.callerId, b.callerId]).size === 2 && a.callerId === c.callerId && [a.callerId, b.callerId].sort().join() === '+16479457172,+18648308599')
    await sleep(500)
    const after = await db.collection('systemCallerPicks').countDocuments({ purpose: 'TEST_rot' })
    ok('picks logged', after - before === 3, `${before}->${after}`)
    await db.collection('systemCallerPicks').deleteMany({ purpose: 'TEST_rot' })

    // --- DLR ---
    const key = require('/app/js/infobip').smsHookKey()
    const mk = async (mid) => { const r = await logs.insertOne({ type: 'sms_out', webReply: true, status: 'sent', messageId: mid, chatId: CHAT, phoneNumber: '+447860089499', from: '+447860089499', to: '+447700900123', country: 'GB', charge: 0.1, TEST_: true, timestamp: new Date().toISOString() }); ids.push(r.insertedId); return r.insertedId }
    const id1 = await mk('test-dlr-1')
    const r0 = await post('badkey123', { results: [{ messageId: 'test-dlr-1', status: { groupName: 'UNDELIVERABLE' } }] })
    await sleep(4500)
    ok('bad key 200', r0.status === 200)
    ok('bad key no change', (await logs.findOne({ _id: id1 })).status === 'sent')
    const r1 = await post(key, { results: [{ messageId: 'test-dlr-1', to: '447700900123', status: { groupName: 'UNDELIVERABLE', id: 5, description: 'Message undeliverable' }, error: { id: 1, name: 'EC_UNKNOWN_SUBSCRIBER', description: 'Unknown subscriber' } }] })
    await sleep(4500)
    const d1 = await logs.findOne({ _id: id1 }), w1 = await walletOf.findOne({ _id: CHAT })
    ok('good key 200', r1.status === 200)
    ok('status failed', d1.status === 'failed', `status=${d1.status} reason=${d1.smsReason}`)
    const inc = +(((w1?.usdIn || 0) - (w0?.usdIn || 0)).toFixed(4))
    ok('wallet +0.1', inc === 0.1, `inc=${inc}`)
    ok('refund tx', !!(await tx.findOne({ _id: `smsref-${id1}`, type: 'sms-refund' })))
    await post(key, { results: [{ messageId: 'test-dlr-1', status: { groupName: 'UNDELIVERABLE' } }] })
    await sleep(4500)
    const w2 = await walletOf.findOne({ _id: CHAT })
    ok('duplicate no change', (w2?.usdIn || 0) === (w1?.usdIn || 0) && (await tx.countDocuments({ _id: `smsref-${id1}` })) === 1)
    const id2 = await mk('test-dlr-2')
    await post(key, { results: [{ messageId: 'test-dlr-2', status: { groupName: 'DELIVERED' } }] })
    await sleep(4500)
    const w3 = await walletOf.findOne({ _id: CHAT })
    ok('delivered', (await logs.findOne({ _id: id2 })).status === 'delivered')
    ok('delivered no refund', (w3?.usdIn || 0) === (w2?.usdIn || 0) && !(await tx.findOne({ _id: `smsref-${id2}` })))
  } catch (e) { console.log('ERROR', e) } finally {
    for (const id of ids) { await logs.deleteOne({ _id: id }); await tx.deleteOne({ _id: `smsref-${id}` }) }
    await db.collection('webNotifications').deleteMany({ chatId: { $in: [CHAT, Number(CHAT)] }, 'meta.smsFailed.to': '+447700900123', createdAt: { $gte: new Date(Date.now() - 600000) } }).catch(() => {})
    const wn = await walletOf.findOne({ _id: CHAT })
    const diff = +(((wn?.usdIn || 0) - (w0?.usdIn || 0)).toFixed(4))
    if (!w0 && wn) await walletOf.deleteOne({ _id: CHAT })
    else if (diff) await walletOf.updateOne({ _id: CHAT }, { $inc: { usdIn: -diff } })
    console.log('cleanup: wallet reversed', diff, 'walletExistedBefore', !!w0)
    console.log(`SUMMARY ${res.filter((r) => r[1]).length}/${res.length}`)
    await client.close(); process.exit(0)
  }
})()
