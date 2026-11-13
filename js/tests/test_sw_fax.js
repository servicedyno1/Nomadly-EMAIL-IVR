// SignalWire fax (new fax numbers + sending incl. bulk) and Bird auto-link of customer SignalWire numbers. Run from /app.
'use strict'
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'false'; process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.SIGNALWIRE_PROJECT_ID = 'proj'; process.env.SIGNALWIRE_API_TOKEN = 'tok'; process.env.SIGNALWIRE_SPACE_URL = 'space.signalwire.com'; process.env.SIGNALWIRE_SIGNING_KEY = 'sk'
delete process.env.FAX_PROVIDER
const { MongoClient } = require('mongodb')
const swFax = require('../signalwire/fax')
const fax = require('../fax-service')
const { create } = require('../fax-numbers')
const { createBirdVerify } = require('../bird-callerid-verify')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }

;(async () => {
  // pure helpers
  ok('delivered status → fax.delivered', swFax.statusEvent({ FaxSid: 'FX1', FaxStatus: 'delivered', NumPages: '2' }).event_type === 'fax.delivered')
  const f = swFax.statusEvent({ FaxSid: 'FX1', FaxStatus: 'busy' })
  ok('busy → fax.failed user_busy', f.event_type === 'fax.failed' && f.payload.failure_reason === 'user_busy')
  ok('no-answer → fax.failed no_answer', swFax.statusEvent({ FaxStatus: 'no-answer' }).payload.failure_reason === 'no_answer')
  const fid = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  const u = new URL(swFax.mediaUrl(fid))
  ok('signed media link verifies', swFax.mediaOk(fid, u.searchParams.get('e'), u.searchParams.get('k')))
  ok('tampered media link refused', !swFax.mediaOk('bbbbbbbbbbbbbbbbbbbbbbbb', u.searchParams.get('e'), u.searchParams.get('k')))
  ok('expired media link refused', !swFax.mediaOk(fid, String(Date.now() - 1), u.searchParams.get('k')))
  ok('<Receive> LaML points at fax-received', /<Receive action="[^"]+\/signalwire\/fax-received"/.test(swFax.receiveLaml()))
  ok('fax number handler = fax receive mode only', swFax.faxHandler().call_receive_mode === 'fax' && !('message_request_url' in swFax.faxHandler()))

  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), CHAT = 'web-qa-swfax-1'
  const clean = async () => { await db.collection('walletOf').deleteOne({ _id: CHAT }); await db.collection('faxNumbers').deleteMany({ chatId: CHAT }); await db.collection('faxNumberSearch').deleteOne({ _id: CHAT }); await db.collection('transactions').deleteMany({ chatId: CHAT }); await db.collection('faxes').deleteMany({ chatId: CHAT }) }
  await clean()
  try {
    fax.init({ db, log: () => {} })
    const sent = [], ordered = [], released = []
    Object.assign(swFax, {
      searchFax: async () => [{ phoneNumber: '+12125550199', region: 'NY', nearby: false }],
      orderFax: async (n) => { ordered.push(n); return { id: 'sw:pn1' } },
      releaseFax: async (n) => { released.push(n); return true },
      sendFax: async ({ from, to }) => { sent.push(`${from}>${to}`); return `FX${String(sent.length).padStart(32, '0')}` },
    })
    const F = create(db, { log: () => {}, sweep: false })
    await db.collection('walletOf').updateOne({ _id: CHAT }, { $set: { usdIn: 100, usdOut: 0 } }, { upsert: true })
    ok('fax offer available on SignalWire', F.offer().available === true)
    const s = await F.search(CHAT, 'US', '212')
    ok('search returns SignalWire fax numbers', s.numbers[0]?.phoneNumber === '+12125550199')
    const b = await F.buy(CHAT, { phoneNumber: '+12125550199' })
    const doc = await db.collection('faxNumbers').findOne({ _id: '+12125550199' })
    ok('buy orders on SignalWire and stores provider', ordered[0] === '+12125550199' && doc.provider === 'signalwire_fax' && doc.swNumberId === 'sw:pn1', JSON.stringify(b.number))

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
    const st = await db.collection('faxStaged').insertOne({ _id: 'stg-swfax-1', chatId: CHAT, phoneNumber: '+12125550199', fileId: fid, pages: 1, createdAt: new Date() }).catch(() => null)
    const r = await fax.sendStaged({ chatId: CHAT, num: doc, stageId: 'stg-swfax-1', to: '+14155550100' }).catch(e => ({ err: e.message }))
    ok('single fax sent through SignalWire', sent[0] === '+12125550199>+14155550100' && /^FX/.test(r.id || ''), JSON.stringify(r))
    await fax.handleEvent(swFax.statusEvent({ FaxSid: r.id, FaxStatus: 'delivered', NumPages: '1' }))
    ok('status callback marks it delivered', (await db.collection('faxes').findOne({ _id: r.id }))?.status === 'delivered')

    await F.setAutoRenew(CHAT, '+12125550199', false)
    await db.collection('faxNumbers').updateOne({ _id: '+12125550199' }, { $set: { expiresAt: new Date(Date.now() - 1000).toISOString() } })
    await F.renewDue()
    ok('cancelled SignalWire fax number released on SignalWire', released[0] === '+12125550199')
    void st; void pdf
  } finally { await clean(); await db.collection('faxStaged').deleteOne({ _id: 'stg-swfax-1' }).catch(() => {}) }

  // Bird auto-link: one number at a time, skips linked ones, retries later
  const N1 = '+13125550001', N2 = '+13125550002', N3 = '+12074892004'
  await db.collection('birdCallerIdVerify').deleteMany({ _id: { $in: [N1, N2, N3] } })
  const armed = []
  const bird = { enabled: () => true, listCallerIds: async () => [{ phone_number: N3, outbound_enabled: true }], startCallerIdVerification: async (n) => { armed.push(n); return { id: `vn_${armed.length}`, status: 'calling' } }, deleteCallerId: async () => true }
  const V = createBirdVerify({ bird, transcribe: async () => ({}), db, log: () => {} })
  let t = await V.autoLinkTick({ numbers: [N3, N1, N2] })
  ok('already-linked number skipped, first unlinked armed', t.armed === N1 && armed.join() === N1, JSON.stringify(t))
  t = await V.autoLinkTick({ numbers: [N3, N1, N2] })
  ok('waits while a verification call is in progress', t.skipped === 'verification in progress' && armed.length === 1)
  await db.collection('birdCallerIdVerify').updateOne({ _id: N1 }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
  t = await V.autoLinkTick({ numbers: [N3, N1, N2] })
  ok('expired attempt → next number armed, failed one waits 6 h', t.armed === N2 && (await db.collection('birdCallerIdVerify').findOne({ _id: N1 })).status === 'failed', JSON.stringify(t))
  ok('linked number recorded as verified', (await db.collection('birdCallerIdVerify').findOne({ _id: N3 }))?.status === 'verified')
  await db.collection('birdCallerIdVerify').deleteMany({ _id: { $in: [N1, N2, N3] } })

  await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
