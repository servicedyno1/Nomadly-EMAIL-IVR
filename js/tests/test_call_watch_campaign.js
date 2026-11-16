// Spam watch + call campaigns: real bulk-call-service and call-watch, dialing stubbed. Run: cd /tmp && node /app/js/tests/test_call_watch_campaign.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.BULK_IVR_MAINTENANCE = 'false'; process.env.BULK_TELNYX_DIAL_GAP_MS = '20'
const { MongoClient } = require('mongodb')
let dialed = 0
const vsPath = require.resolve('/app/js/voice-service.js')
require.cache[vsPath] = { id: vsPath, filename: vsPath, loaded: true, exports: { initiateOutboundIvrCall: async () => { dialed++; return { success: true, callControlId: `cc_${Math.random()}` } }, recordOutboundMenuPress: () => {}, billCallMinutesUnified: async () => ({}) } }
const B = require('/app/js/bulk-call-service.js'), MW = require('/app/js/msg-watch'), CW = require('/app/js/call-watch')
const wait = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_cwbulk`)
  await db.dropDatabase()
  const W = db.collection('walletOf'); await W.insertOne({ _id: 't', usdIn: 100000, usdOut: 0 })
  const adminMsgs = [], userMsgs = []; let cb
  const bot = { on: (e, f) => { cb = f }, sendMessage: async (id, t, o) => { (String(id) === '1' ? adminMsgs : userMsgs).push({ t, o }); return {} }, sendDocument: async () => ({}), answerCallbackQuery: async () => {}, editMessageText: async () => {} }
  MW.init({ db, bot, adminChatId: '1', log: () => {}, brand: 'Test', ai: async (t) => (/fraud department/i.test(t) ? { flag: true, kind: 'impersonation', reason: 'poses as a bank' } : { flag: false }) })
  CW._X.hear = async (u) => (/scam/.test(u || '') ? 'This is the fraud department of your bank' : 'Hello from the bakery')
  await B.initBulkCallService(db, bot, {}, W, null)
  const leads = () => Array.from({ length: 6 }, (_, i) => ({ number: `+1212558${String(1000 + i * 13)}` }))
  const mk = (audioUrl) => B.createCampaign({ chatId: 't', callerId: '+14155551001', audioUrl, audioName: 'clip', mode: 'report_only', leads: leads(), provider: 'telnyx', concurrency: 5 })
  const c0 = await mk('https://x/ok.mp3'); if (c0.error) throw new Error(JSON.stringify(c0))
  await B.startCampaign(c0.id); await wait(1500)
  ok('clean campaign dials as before', dialed > 0 && !adminMsgs.length)
  const c1 = await mk('https://x/scam1.mp3'); const d1 = dialed
  const r1 = await B.startCampaign(c1.id); await wait(1500)
  ok('hold off: scam campaign dials + admin alert without buttons', r1.success && dialed > d1 && adminMsgs.length === 1 && !adminMsgs[0].o.reply_markup && !(await db.collection('bulkCallCampaigns').findOne({ id: c1.id })).adminHold)
  await MW.setHold(true, 't'); MW._reset()
  CW._X.hear = async () => 'Fraud department calling, stay on the line'
  const c2 = await mk('https://x/scam2.mp3'); const d2 = dialed, u2 = userMsgs.length
  const r2 = await B.startCampaign(c2.id); await wait(1500)
  const doc2 = await db.collection('bulkCallCampaigns').findOne({ id: c2.id })
  ok('hold on: campaign looks started to the customer but dials nothing', r2.success && dialed === d2 && doc2.status === 'running' && !!doc2.adminHold && userMsgs.slice(u2).some(m => /Campaign Started/.test(m.t)) && !userMsgs.slice(u2).some(m => /held|review|spam/i.test(m.t)))
  ok('admin alert has Approve / Reject', adminMsgs.length === 2 && !!adminMsgs[1].o.reply_markup)
  await B.resumeCampaign(c2.id).catch(() => {}); await wait(800)
  ok('customer pause/resume cannot start a held campaign', dialed === d2)
  await cb({ id: 'q', data: `mw:a:${doc2.adminHold}`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 1 } }); await wait(2000)
  ok('approve → campaign dials', dialed > d2 && !(await db.collection('bulkCallCampaigns').findOne({ id: c2.id })).adminHold)
  CW._X.hear = async () => 'This is the fraud department, final warning'
  const c3 = await mk('https://x/scam3.mp3'); const d3 = dialed
  await B.startCampaign(c3.id); await wait(800)
  const doc3 = await db.collection('bulkCallCampaigns').findOne({ id: c3.id })
  await cb({ id: 'q', data: `mw:r:${doc3.adminHold}`, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 1 } }); await wait(1200)
  ok('reject → never dials', dialed === d3 && !!(await db.collection('bulkCallCampaigns').findOne({ id: c3.id })).adminHold)
  for (const c of [c0, c1, c2, c3]) await B.cancelCampaign(c.id, 'test', { sendReport: false }).catch(() => {})
  await wait(800); await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
