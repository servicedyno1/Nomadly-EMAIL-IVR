require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb'); const { makeSim, strip } = require('/app/scripts/lib/tg_sim')
;(async () => { const cl = await MongoClient.connect(process.env.MONGO_URL), st = cl.db(process.env.DB_NAME).collection('state'), C = '990000206'
  let pass = 0, fail = 0
  for (const a of ['bse-one-text', 'bse-one-to', 'bse-one-opt', 'bse-reply', 'bse-home']) {
    await st.replaceOne({ _id: C }, { _id: C, action: a, userLanguage: 'en', history: [] }, { upsert: true })
    const r = await makeSim(C).step({ kind: 'text', v: '/start' }); const s = await st.findOne({ _id: C }), out = r.msgs.map(m => strip(m.text)).join(' ')
    const ok = !String(s.action).startsWith('bse-') && !/conversation with another sender|On its way/.test(out) && r.msgs.length > 0
    ok ? pass++ : fail++; console.log(ok ? '✓' : '✗', a, '→', s.action, '|', out.slice(0, 60))
  }
  const bd = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME), E = bd.collection('bsEsims'), S = bd.collection('bsSessions')
  const seeded = !(await E.findOne({ role: 'tester', status: 'available', health: 'healthy' }))
  if (seeded) await E.insertOne({ _id: 'ESIM-QA-ST', role: 'tester', status: 'available', health: 'healthy', msisdn: '+15550001235', stats: {}, createdAt: new Date() })
  const t = await E.findOne({ role: 'tester', status: 'available', health: 'healthy' })
  for (const e of await E.find({ status: 'available', health: 'healthy', msisdn: { $ne: null }, role: { $ne: 'monitor' } }).toArray()) await S.insertOne({ _id: `s_qa_busy_${e._id}`, cid: 'VoodooLand:1', esimId: e._id, to: '+14155550888', status: 'active', lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) })
  await bd.collection('bsCustomers').updateOne({ _id: `Nomadly:${C}` }, { $set: { status: 'active' } }, { upsert: true })
  await st.replaceOne({ _id: C }, { _id: C, action: 'bse-one-to', userLanguage: 'en', history: [] }, { upsert: true })
  const rb = await makeSim(C).step({ kind: 'text', v: '+14155550888' }), sb = await st.findOne({ _id: C })
  const okb = /conversation with another sender/.test(rb.msgs.map(m => strip(m.text)).join(' ')) && sb.action === 'bse-home'
  okb ? pass++ : fail++; console.log(okb ? '✓' : '✗', 'busy number is caught right at the number step and returns to BulkSMS home')
  await S.deleteMany({ _id: /^s_qa_busy/ }); void t; if (seeded) await E.deleteOne({ _id: 'ESIM-QA-ST' }); await bd.collection('bsCustomers').deleteOne({ _id: `Nomadly:${C}` })
  await st.deleteOne({ _id: C }); await cl.close(); console.log(`${pass} passed, ${fail} failed`); process.exit(0) })()
