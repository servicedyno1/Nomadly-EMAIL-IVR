// Spenza delivery-status callbacks: stored raw, matched to our text (provider id or to/from), delivered/failed recorded,
// failed text → admin alert only (customers are never told); no report after 10 min → admin alert (only once reports exist).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const P = require('../bulk-esim/provider-spenza')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const post = (body) => B.onStatus(JSON.stringify(body), {}, body)
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db('test_bse_dlr'); await db.dropDatabase()
  const alerts = []; await B.init({ db, log: () => {}, notifyAdmin: (m) => alerts.push(m) })
  const nA = (re) => alerts.filter(a => re.test(a)).length
  const M = db.collection('bsMessages'), now = new Date()
  const base = { direction: 'out', status: 'sent', cid: 'Nomadly:1', campaignId: null, sessionId: null, system: false, test: false, esimId: 'ESIM-0002', from: '+13025550001', sentAt: now, history: [] }
  await M.insertMany([{ _id: 'm1', ...base, to: '+14155550101', providerId: 'sp_1' }, { _id: 'm2', ...base, to: '+14155550102' }, { _id: 'm3', ...base, to: '+14155550103', sentAt: new Date(Date.now() - 20 * 60e3) }])
  ok('parser reads common delivered/failed shapes', P.parseStatus({ data: { messageId: 'x', status: 'DELIVERED' } }).state === 'delivered' && P.parseStatus({ Message_Status: 'undelivered' }).state === 'failed' && P.parseStatus({ status: 'queued' }).state === null)
  await B.dlrWatch()
  ok('before any report arrives, late texts give one "no reports yet" admin note', nA(/No delivery reports/) === 1)
  await post({ data: { messageId: 'sp_1', status: 'delivered' } })
  ok('report matched by provider id → delivered', (await M.findOne({ _id: 'm1' })).deliveryStatus === 'delivered' && (await M.findOne({ _id: 'm1' })).status === 'delivered')
  await post({ data: { to: '+14155550102', from: '+13025550001', status: 'failed', errorMessage: 'unreachable' } })
  const m2 = await M.findOne({ _id: 'm2' })
  ok('report matched by numbers → failed, error kept', m2.deliveryStatus === 'failed' && m2.deliveryError === 'unreachable')
  ok('failed single text → no customer notice (admin only)', (await db.collection('bsNotify').countDocuments({ chatId: '1' })) === 0)
  ok('failed text → admin alert', nA(/not delivered by the carrier/) === 1)
  await post({ data: { to: '+14155550102', from: '+13025550001', status: 'failed', errorMessage: 'unreachable' } })
  ok('duplicate report ignored', nA(/not delivered by the carrier/) === 1)
  ok('every payload stored raw', (await db.collection('bsDlr').countDocuments()) === 2)
  await M.updateOne({ _id: 'm3' }, { $unset: { dlrLate: 1 } })
  await B.dlrWatch()
  ok('text with no report after 10 min → admin alert', nA(/no delivery report 10\+ min/) === 1)
  await B.dlrWatch()
  ok('late alert is sent only once per text', nA(/no delivery report 10\+ min/) === 1)
  await db.collection('bsEsims').insertMany([{ _id: 'ESIM-L1', iccid: '8901', msisdn: '+13025550011', role: 'service', status: 'available', health: 'healthy', stats: {} }, { _id: 'ESIM-L2', iccid: '8902', msisdn: '+13025550012', role: 'service', status: 'available', health: 'healthy', stats: {} }])
  const fails = async (line, tos, tag) => { for (const [i, to] of tos.entries()) { await M.insertOne({ _id: `${tag}${i}`, ...base, esimId: line, from: line === 'ESIM-L1' ? '+13025550011' : '+13025550012', to, providerId: `${tag}${i}` }); await post({ data: { messageId: `${tag}${i}`, status: 'undelivered' } }) } }
  await fails('ESIM-L2', ['+14155550201', '+14155550202', '+14155550201', '+14155550202', '+14155550201'], 'b')
  ok('5 undelivered to only 2 numbers → line stays', (await db.collection('bsEsims').findOne({ _id: 'ESIM-L2' })).status === 'available')
  await M.insertOne({ _id: 'okL2', ...base, esimId: 'ESIM-L2', to: '+14155550209', providerId: 'okL2' }); await post({ data: { messageId: 'okL2', status: 'delivered' } })
  ok('a delivered report resets the streak', (await db.collection('bsEsims').findOne({ _id: 'ESIM-L2' })).undeliveredStreak === 0)
  await fails('ESIM-L1', ['+14155550301', '+14155550302', '+14155550303', '+14155550301', '+14155550302'], 'a')
  const l1 = await db.collection('bsEsims').findOne({ _id: 'ESIM-L1' }), nw = l1.replacedBy && await db.collection('bsEsims').findOne({ _id: l1.replacedBy })
  ok('5 in a row to 3 numbers → line taken out of use', l1.status === 'replaced', l1.status)
  ok('…and the same eSIM gets a new number first (no new line bought)', nw && nw.iccid === '8901' && nw.status === 'testing' && (await db.collection('bsReplacements').findOne({ oldEsimId: 'ESIM-L1' }))?.boughtEsimId === null, nw?.status)
  ok('admin told about the swap', nA(/taking it out of use/) === 1 && nA(/got a new number/) === 1)
  process.env.BULK_ESIM_FAKE_RENEW_FAIL = '8902'
  await fails('ESIM-L2', ['+14155550401', '+14155550402', '+14155550403', '+14155550404', '+14155550405'], 'c')
  const rp = await db.collection('bsReplacements').findOne({ oldEsimId: 'ESIM-L2' })
  ok('number change refused → a new line is ordered instead', rp?.status === 'failed' && !!rp?.boughtEsimId, JSON.stringify({ s: rp?.status, b: rp?.boughtEsimId }))
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
