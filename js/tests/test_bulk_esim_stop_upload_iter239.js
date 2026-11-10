// iter239 QA: eSIM BulkSMS STOP/HELP compliance, contacts upload (bot flow with fake document), storage failure path,
// no-auto-provision defaults, low credit pause/resume. Simulated provider only. Run with nodejs stopped:
//   sudo supervisorctl stop nodejs && node js/tests/test_bulk_esim_stop_upload_iter239.js; sudo supervisorctl start nodejs
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const http = require('http')
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
const P = require('../bulk-esim/provider-spenza')
const BOT = require('../bulk-esim/bot')
const storage = require('../bulk-esim/storage')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const COLS = ['bsConfig', 'bsEsims', 'bsMessages', 'bsSessions', 'bsDaily', 'bsTests', 'bsReplacements', 'bsBookings', 'bsCampaigns', 'bsWebhooks', 'bsSuppression', 'bsIncidents', 'bsAudit', 'bsNotify', 'bsLocks', 'bsCustomers', 'bsPayments', 'bsReputation', 'bsUploads']

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  for (const c of COLS) if (await db.collection(c).countDocuments() > 1) throw new Error(`${c} not empty — refusing to run`)
  for (const c of COLS) await db.collection(c).deleteMany({})
  const alerts = []
  await BOT.init({ db, log: () => {}, notifyAdmin: (t) => alerts.push(t) })
  process.env.BULK_ESIM_WORKER = ''

  // ---- defaults / no auto provisioning ----
  const c0 = await B.cfg()
  ok('defaults minEsims=1 autoProvision=false manualApproval=true', c0.minEsims === 1 && c0.autoProvision === false && c0.manualApproval === true)
  let provCalls = 0; const realProv = P.provision; P.provision = async (...a) => { provCalls++; return realProv(...a) }
  await B.autoscale()
  ok('autoscale with 0 eSIMs does NOT provision (alerts instead)', provCalls === 0 && (await db.collection('bsEsims').countDocuments()) === 0 && alerts.some(a => /Provisioning needs approval/.test(a)))
  // one eSIM via admin command path only
  const said = []; await BOT.admin('1', '/bulkprovision', (t) => said.push(t))
  ok('/bulkprovision (admin) provisions exactly one (simulated)', provCalls === 1 && (await db.collection('bsEsims').countDocuments()) === 1, said.join('|'))
  await B.healthCheck()
  const e1 = await db.collection('bsEsims').findOne({ _id: 'ESIM-0001' })
  ok('eSIM healthy + available after check', e1.status === 'available' && e1.health === 'healthy')
  // booking needing more capacity than 1 eSIM → no provisioning
  const cA = (await B.customer('Nomadly', '9001'))._id
  await B.setConfig({ esimPerMin: 1, platformPerMin: 1 }, 'qa') // cap = 48/hour
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  const bk = await B.createBooking(cA, { date: day, hour: 1, volume: 500 })
  await db.collection('bsBookings').updateOne({ _id: bk.booking._id }, { $set: { allocation: { [`${day}T01`]: 500 } } })
  await B.confirmBooking(bk.booking._id, { method: 'wallet' })
  await B.autoscale()
  ok('confirmBooking needing capacity + autoscale demand do NOT buy eSIM', provCalls === 1 && (await db.collection('bsEsims').countDocuments()) === 1)
  await B.setConfig({ esimPerMin: 10, platformPerMin: 30 }, 'qa')

  // ---- STOP variants & cross-customer ----
  const eSim = e1.msisdn, cB = (await B.customer('Nomadly', '9002'))._id, cC = (await B.customer('OtherBrand', '9003'))._id
  const variants = ['STOP', 'stopall', ' Unsubscribe ', 'Opt Out', 'QUIT', 'cancel', 'End']
  for (let i = 0; i < variants.length; i++) {
    const ph = `+1415555${String(1000 + i)}`
    // queued texts from two customers to this number
    const q1 = await B.sendOne(cB, ph, 'hello B'), q2 = await B.sendOne(cC, ph, 'hello C')
    await B.onWebhook('', {}, { data: { From: ph, Owner: eSim, Message_Body: variants[i], Message_ID: `stopv${i}` } })
    const sup = await db.collection('bsSuppression').findOne({ cid: '*', phone: ph })
    const m1 = await db.collection('bsMessages').findOne({ _id: q1.messageId }), m2 = await db.collection('bsMessages').findOne({ _id: q2.messageId })
    const conf = await db.collection('bsMessages').findOne({ to: ph, system: true, body: /unsubscribed/, status: 'queued' })
    ok(`STOP variant ${JSON.stringify(variants[i])} → block + queued rejected for all customers + confirmation`, !!sup && m1.status === 'rejected' && m2.status === 'rejected' && m1.failureReason === 'opted_out' && !!conf)
  }
  const ph0 = '+14155551000'
  ok('sendOne blocked for other brands too', !!(await B.sendOne(cC, ph0, 'x')).error && !!(await B.sendOne(cA, ph0, 'x')).error)
  ok('parseContacts drops it for all customers', !(await B.parseContacts(cA, `${ph0}\n4155551001`)).contacts.length)
  // processOne: message already in "processing" (claimed) when STOP arrives → rejected by worker
  const ph9 = '+14155552222'
  const qa = await B.sendOne(cA, ph9, 'race')
  await db.collection('bsMessages').updateOne({ _id: qa.messageId }, { $set: { status: 'processing' } })
  await B.onWebhook('', {}, { data: { From: ph9, Owner: eSim, Message_Body: 'stop', Message_ID: 'race1' } })
  await db.collection('bsMessages').updateOne({ _id: qa.messageId }, { $set: { status: 'queued', nextAt: new Date(Date.now() - 1000) } })
  await db.collection('bsMessages').updateMany({ system: true }, { $set: { nextAt: new Date(Date.now() + 3600000) } }) // keep system msgs aside
  for (let i = 0; i < 3; i++) await B.tick()
  const qam = await db.collection('bsMessages').findOne({ _id: qa.messageId })
  ok('send worker (processOne) rejects opted-out number', qam.status === 'rejected' && qam.failureReason === 'opted_out', qam.status)
  // confirmation still delivered (system texts bypass suppression)
  await db.collection('bsMessages').updateMany({ system: true }, { $set: { nextAt: new Date(Date.now() - 1000) } })
  for (let i = 0; i < 5; i++) await B.tick()
  ok('STOP confirmation actually sent to opted-out number', !!(await db.collection('bsMessages').findOne({ to: ph9, system: true, status: 'sent' })))
  // ambiguous: two customers with active sessions to same number
  const phA = '+14155553333', exp = new Date(Date.now() + 3600000)
  for (const cid of [cA, cB]) await db.collection('bsSessions').insertOne({ _id: `s_${cid}`, cid, esimId: e1._id, to: phA, status: 'active', lastActivityAt: new Date(), expiresAt: exp })
  await B.onWebhook('', {}, { data: { From: phA, Owner: eSim, Message_Body: 'STOP', Message_ID: 'amb1' } })
  ok('STOP from ambiguous sender still blocks globally (msg held for review)', !!(await db.collection('bsSuppression').findOne({ cid: '*', phone: phA })) && (await db.collection('bsMessages').findOne({ from: phA, direction: 'in' }))?.status === 'review')
  // routed STOP: owner notified, by set
  const phR = '+14155554444'
  await db.collection('bsSessions').insertOne({ _id: 's_r', cid: cA, esimId: e1._id, to: phR, status: 'active', lastActivityAt: new Date(), expiresAt: exp })
  await B.onWebhook('', {}, { data: { From: phR, Owner: eSim, Message_Body: 'Stop', Message_ID: 'r1' } })
  ok('routed STOP → suppression.by=cid + owner notified', (await db.collection('bsSuppression').findOne({ cid: '*', phone: phR }))?.by === cA && !!(await db.collection('bsNotify').findOne({ type: 'inbound', from: phR, text: /opted out/ })))
  // non-STOP texts must not block
  await B.onWebhook('', {}, { data: { From: '+14155555555', Owner: eSim, Message_Body: 'please stop by tomorrow', Message_ID: 'ns1' } })
  ok('sentence containing "stop" does not block', !(await db.collection('bsSuppression').findOne({ phone: '+14155555555' })))
  await B.onWebhook('', {}, { data: { From: '+14155556666', Owner: eSim, Message_Body: 'STOP.', Message_ID: 'punct1' } })
  const punct = !!(await db.collection('bsSuppression').findOne({ phone: '+14155556666' }))
  console.log(`ℹ️  "STOP." (trailing punctuation) blocks: ${punct}`)
  // HELP
  await B.onWebhook('', {}, { data: { From: '+14155557777', Owner: eSim, Message_Body: 'help', Message_ID: 'h1' } })
  const help = await db.collection('bsMessages').findOne({ to: '+14155557777', system: true, body: /Reply STOP to opt out/ })
  ok('HELP queues auto reply (no suppression)', !!help && !(await db.collection('bsSuppression').findOne({ phone: '+14155557777' })))
  // webhook dedup for STOP
  const before = await db.collection('bsMessages').countDocuments({ to: phR, system: true })
  await B.onWebhook('', {}, { data: { From: phR, Owner: eSim, Message_Body: 'Stop', Message_ID: 'r1' } })
  ok('duplicate STOP webhook (same Message_ID) is idempotent', (await db.collection('bsMessages').countDocuments({ to: phR, system: true })) === before)
  // STOP to an unknown platform number → nothing stored (documented behaviour)
  await B.onWebhook('', {}, { data: { From: '+14155558888', Owner: '+19999999999', Message_Body: 'STOP', Message_ID: 'un1' } })
  console.log(`ℹ️  STOP to unknown platform number blocks: ${!!(await db.collection('bsSuppression').findOne({ phone: '+14155558888' }))}`)

  // ---- low credit ----
  process.env.BULK_ESIM_FAKE_CREDIT = '3'; await B.creditWatch()
  const qL = await B.sendOne(cA, '+14155559991', 'credit test'); await B.tick()
  ok('low credit pauses (nothing sent) + admin alert', (await B.state()).reasons.includes('provider_credit') && (await db.collection('bsMessages').findOne({ _id: qL.messageId })).status === 'queued' && alerts.some(a => /PAUSED/.test(a)))
  process.env.BULK_ESIM_FAKE_CREDIT = '80'; await B.creditWatch(); for (let i = 0; i < 3; i++) await B.tick()
  const qLm = await db.collection('bsMessages').findOne({ _id: qL.messageId })
  ok('top-up → auto resume (reasons cleared + resumed alert)', !(await B.state()).reasons.length && alerts.some(a => /resumed/i.test(a)))
  ok('queued text no longer blocked by pause after resume (sent or waiting on per-eSIM rate window)', qLm.status === 'sent' || (qLm.status === 'queued' && qLm.nextAt > new Date()), `${qLm.status} sentToday=${await db.collection('bsMessages').countDocuments({ esimId: e1._id, status: 'sent', sentAt: { $gt: new Date(Date.now() - 60000) } })}`)
  delete process.env.BULK_ESIM_FAKE_CREDIT

  // ---- contacts upload via bot flow ----
  const nums = Array.from({ length: 505 }, (_, i) => `(212) 555-${String(3000 + i)}`).join('\n') + `\n${ph0}\nfoo,bar\n`
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(nums) }).listen(0)
  const port = srv.address().port
  const mkCtx = (chatId, msg, st) => {
    const sent = []
    return { sent, ctx: { chatId, msg, message: msg.text || '', info: st, state: {}, set: async (_s, _c, k, v) => { st[k] = v }, saveInfo: async (k, v) => { st[k] = v }, send: async (_c, t) => { sent.push(t) }, goto: {}, bot: { getFileLink: async () => `http://127.0.0.1:${port}/f.csv` } } }
  }
  let st = { action: 'bse-contacts', bseName: 'TEST_upload', bseContent: ['Hi'] }
  let r = mkCtx('9100', { document: { file_id: 'x', file_name: 'list.exe', file_size: 100 } }, st); await BOT.handle(r.ctx)
  ok('upload .exe rejected', /\.txt or \.csv/.test(r.sent[0] || '') && st.action === 'bse-contacts')
  r = mkCtx('9100', { document: { file_id: 'x', file_name: 'big.csv', file_size: 3e6 } }, st); await BOT.handle(r.ctx)
  ok('upload >2MB rejected', /under 2 MB/.test(r.sent[0] || '') && st.action === 'bse-contacts')
  r = mkCtx('9100', { document: { file_id: 'x', file_name: 'Contacts.CSV', file_size: 9000 } }, st); await BOT.handle(r.ctx)
  const cp = await db.collection('bsCampaigns').findOne({ _id: st.bseCampaign })
  const up = cp?.uploadId && await db.collection('bsUploads').findOne({ _id: cp.uploadId })
  ok('.CSV upload parsed → campaign (opted-out skipped)', st.action === 'bse-test' && cp?.volume === 505 && /opted out/.test(r.sent[0] || ''), r.sent[0]?.slice(0, 90))
  ok('upload copy stored (bsUploads with storagePath, campaign.uploadId)', !!up && !!up.storagePath && up.originalName === 'Contacts.CSV' && up.contentType === 'text/csv')
  if (up) ok('stored object readable from Object Storage', (await storage.get(up.storagePath)).toString().includes('555-3000'))
  // storage failure → campaign still created
  const realKey = process.env.EMERGENT_LLM_KEY, realProxy = process.env.INTEGRATION_PROXY_URL
  process.env.INTEGRATION_PROXY_URL = 'http://127.0.0.1:1'; await storage.init(true).catch(() => {})
  st = { action: 'bse-contacts', bseName: 'TEST_upload2', bseContent: ['Hi'] }
  r = mkCtx('9101', { document: { file_id: 'x', file_name: 'list.txt', file_size: 9000 } }, st); await BOT.handle(r.ctx)
  const cp2 = await db.collection('bsCampaigns').findOne({ _id: st.bseCampaign })
  ok('storage failure → campaign still proceeds (uploadId null)', st.action === 'bse-test' && cp2?.volume === 505 && !cp2.uploadId)
  process.env.INTEGRATION_PROXY_URL = realProxy; process.env.EMERGENT_LLM_KEY = realKey
  // file unreachable
  st = { action: 'bse-contacts', bseName: 'TEST_upload3', bseContent: ['Hi'] }
  r = mkCtx('9102', { document: { file_id: 'x', file_name: 'list.txt', file_size: 10 } }, st); r.ctx.bot.getFileLink = async () => { throw new Error('nope') }; await BOT.handle(r.ctx)
  ok('unreadable file → friendly error', /Couldn’t read/.test(r.sent[0] || ''))
  // paste still works
  st = { action: 'bse-contacts', bseName: 'TEST_paste', bseContent: ['Hi'] }
  r = mkCtx('9103', { text: nums }, st); await BOT.handle(r.ctx)
  ok('paste path still works', st.action === 'bse-test' && !(await db.collection('bsCampaigns').findOne({ _id: st.bseCampaign })).uploadId)
  srv.close()

  console.log(`\n${pass} passed, ${fail} failed`)
  // cleanup: stored objects can't be deleted via API; remove the DB rows this run created (collections were empty before)
  for (const c of COLS) await db.collection(c).deleteMany({})
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
