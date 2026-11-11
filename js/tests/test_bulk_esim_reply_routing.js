// Two senders, same recipient: a new conversation never shares a line with another customer's open conversation to that
// number; if no line is free the single text is refused; an ambiguous reply is held and the admin sees text + customers.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db('test_bse_routing'); await db.dropDatabase()
  const alerts = []; await B.init({ db, log: () => {}, notifyAdmin: (m) => alerts.push(m) })
  process.env.BULK_ESIM_WORKER = ''
  await B.setConfig({ quietStart: 0, quietEnd: 24, freeOneSends: 100, platformPerMin: 600, esimPerMin: 200 }, 'test')
  const E = db.collection('bsEsims'), S = db.collection('bsSessions'), X = '+14155550777'
  await E.insertOne({ _id: 'ESIM-T', role: 'tester', status: 'available', health: 'healthy', msisdn: '+13025550090', stats: {}, createdAt: new Date() })
  const A = (await B.customer('Nomadly', '111'))._id, Bc = (await B.customer('VoodooLand', '222'))._id
  const r1 = await B.sendOne(A, X, 'hi from A'); await B.claimWorker(); await B.tick()
  ok('customer A texts X on the only line', r1.ok && !!(await S.findOne({ cid: A, to: X, esimId: 'ESIM-T' })))
  const r2 = await B.sendOne(Bc, X, 'hi from B')
  ok('customer B is refused while A has an open conversation with X on the only line', r2.error === 'err_number_busy', r2.error)
  ok('A can keep texting X', (await B.sendOne(A, X, 'again from A')).ok)
  ok('B can still text a different number', (await B.sendOne(Bc, '+14155550778', 'other')).ok)
  await E.insertOne({ _id: 'ESIM-S1', role: 'service', status: 'available', health: 'healthy', msisdn: '+13025550091', activationDate: new Date(Date.now() - 60 * 86400e3), stats: {}, createdAt: new Date() })
  await S.insertOne({ _id: 's_A_S1', cid: A, esimId: 'ESIM-S1', to: X, status: 'active', lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) })
  await E.insertOne({ _id: 'ESIM-S2', role: 'service', status: 'available', health: 'healthy', msisdn: '+13025550092', activationDate: new Date(Date.now() - 60 * 86400e3), stats: { submitted: 50 }, createdAt: new Date() })
  const r3 = await B.sendOne(Bc, X, 'hi from B on a free line'); await B.claimWorker(); await B.tick()
  const m3 = await db.collection('bsMessages').findOne({ _id: r3.messageId })
  ok('with a free line, B is sent on a line A is not using with X', r3.ok && m3.esimId === 'ESIM-S2', m3?.esimId)
  await S.insertOne({ _id: 's_B_T', cid: Bc, esimId: 'ESIM-T', to: X, status: 'active', lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) })
  await B.onWebhook(JSON.stringify({}), {}, { data: { direction: 'inbound', from: X, to: '+13025550090', text: 'who is this?', messageId: 'in1' } })
  ok('an ambiguous reply is held and the admin sees the text and both customers', alerts.some(a => /held for review/.test(a) && a.includes('who is this?') && a.includes(A) && a.includes(Bc)), alerts.filter(a => /review/.test(a)).join(' | ').slice(0, 160))
  // Customer replies: only within a campaign with replies on, only from the same line.
  ok('no reply back to a single-text conversation', (await B.sendOne(A, X, 'reply?', 's_A_S1')).error === 'reply_campaign_only' || (await B.replyRoute(A, (await S.findOne({ cid: A, esimId: 'ESIM-T' }))._id)).error === 'reply_campaign_only')
  await db.collection('bsCampaigns').insertOne({ _id: 'cp1', cid: A, replies: true })
  await db.collection('bsMessages').insertOne({ _id: 'mc1', cid: A, campaignId: 'cp1', to: '+14155550900', esimId: 'ESIM-S2', direction: 'out', status: 'sent', createdAt: new Date() })
  await S.insertOne({ _id: 's_cp', cid: A, esimId: 'ESIM-S2', to: '+14155550900', status: 'active', lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) })
  const rp = await B.sendOne(A, '+14155550900', 'campaign reply', 's_cp'); await B.claimWorker(); await B.tick()
  ok('reply inside a campaign with replies on goes out on the same line', rp.ok && (await db.collection('bsMessages').findOne({ _id: rp.messageId })).esimId === 'ESIM-S2')
  const rq = await B.sendOne(A, '+14155550900', 'queued reply', 's_cp')
  await E.updateOne({ _id: 'ESIM-S2' }, { $set: { status: 'replaced', replacedBy: 'ESIM-S9' } })
  ok('once that line is replaced, replying is refused: route changed', (await B.sendOne(A, '+14155550900', 'late', 's_cp')).error === 'reply_route_changed')
  await B.claimWorker(); await B.tick()
  const q = await db.collection('bsMessages').findOne({ _id: rq.messageId })
  ok('a reply still queued when its line is replaced is never moved to another line', q.status === 'failed' && q.failureReason === 'route_changed', `${q.status} ${q.failureReason} ${q.esimId || ''}`)
  await db.dropDatabase(); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
