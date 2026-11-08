'use strict'
// Fax cover page (web stage + bot addCover), one-time Business announcement, daily caller ID report.
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const { PDFDocument } = require('pdf-lib')
const fax = require('../fax-service')
const report = require('../caller-id-report')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }
async function pdfOf(pages) { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([612, 792]); return Buffer.from(await d.save()) }

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('fax_cover_test_' + Date.now())
  const sent = []
  const bot = { sendMessage: async (id, t) => sent.push({ id, t }), sendDocument: async () => {} }
  fax.init({ db, bot, log: () => {} })
  const chatId = '888001'
  const biz = { phoneNumber: '+15550003333', plan: 'business', provider: 'telnyx', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z', features: {} }
  await db.collection('phoneNumbersOf').insertOne({ _id: chatId, val: { numbers: [biz] } })
  await db.collection('walletOf').insertOne({ _id: chatId, usdIn: 0, usdOut: 0 })
  await db.collection('state').insertOne({ _id: chatId, userLanguage: 'en' })

  console.log('Cover page')
  const s1 = await fax.stage({ chatId, num: biz, buffer: await pdfOf(2), cover: { name: 'Jane Smith', recipient: 'Dr. Lee', subject: 'Contract', note: 'Please sign page 3.\nThanks!', toFax: '+14155550123' } })
  ok(s1.pages === 3 && s1.cover === true, 'web stage with cover → 2 + 1 pages')
  const st = await db.collection('faxStaged').findOne({ _id: s1.stageId })
  const chunks = []; for await (const c of new (require('mongodb').GridFSBucket)(db, { bucketName: 'faxFiles' }).openDownloadStream(st.fileId)) chunks.push(c)
  ok((await PDFDocument.load(Buffer.concat(chunks))).getPageCount() === 3, 'stored PDF has 3 pages')
  const empty = await fax.stage({ chatId, num: biz, buffer: await pdfOf(1), cover: { name: '', recipient: '', subject: '', note: '' } })
  ok(empty.pages === 1 && !empty.cover, 'empty cover fields → no cover page')
  const u = await fax.stage({ chatId, num: biz, buffer: await pdfOf(1), cover: { name: '张伟 José', note: 'x'.repeat(5000) } })
  ok(u.pages === 2, 'non-Latin / very long text does not break the cover page')
  const p = fax.parseCoverText('Jane\n-\nInvoice 42\nline a\nline b')
  ok(p.name === 'Jane' && p.recipient === '' && p.subject === 'Invoice 42' && p.note === 'line a\nline b', 'bot cover text parsed (one per line, - = empty)')
  const b1 = await fax.stage({ chatId, num: biz, buffer: await pdfOf(1) })
  const a1 = await fax.addCover({ chatId, num: biz, stageId: b1.stageId, cover: p })
  ok(a1.pages === 2 && a1.stageId === b1.stageId, 'bot addCover → 1 + 1 pages, same upload')
  try { await fax.addCover({ chatId, num: biz, stageId: b1.stageId, cover: p }); ok(false, 'twice') } catch (e) { ok(e.code === 'has_cover', 'second cover refused') }
  try { await fax.addCover({ chatId, num: biz, stageId: empty.stageId, cover: { name: '-' } }); ok(false, 'blank') } catch (e) { ok(e.code === 'bad_cover', 'blank cover refused') }
  const bq = await fax.bulkQuote({ chatId, num: biz, stageId: a1.stageId, recipients: '+14155550101\n+14155550102' })
  ok(bq.quote.pages === 4 && bq.quote.pagesEach === 2, 'bulk counts cover page per number')
  const f = await fax.sendStaged({ chatId, num: biz, stageId: s1.stageId, to: '+14155550123' })
  ok(f.pages === 3, 'sent fax records 3 pages incl. cover')

  console.log('Voice-routing warning + nudge')
  ok(fax.voiceRouting({ plan: 'business', features: { ivr: { enabled: true } } }) === 'keypad menu (IVR)', 'IVR detected as voice routing')
  ok(fax.voiceRouting({ plan: 'business', features: { callForwarding: { enabled: true, forwardTo: '+15551234567' } } }) === 'call forwarding', 'call forwarding detected')
  ok(fax.voiceRouting(biz) === null, 'plain number has no voice routing')
  ok(/keypad menu/.test(fax.t('en').lineWarn('+15550003333', 'keypad menu (IVR)')) && /fax tones/.test(fax.t('en').lineWarn('+15550003333', 'x')), 'warning names the routing + fax tones')
  ok(['fr', 'zh', 'hi', 'fa'].every(l => fax.t(l).btnKeepVoice && fax.t(l).voiceOnFax('+1', 'x') !== fax.t('en').voiceOnFax('+1', 'x')), 'warn/nudge translated in all langs')
  // Nudge: fax-line number with IVR, a call that hit fax tones (media_failed) in last day, no real fax → one message/day.
  const ivrNum = { ...biz, phoneNumber: '+15550004444', features: { ivr: { enabled: true }, faxLine: { enabled: true } } }
  await db.collection('phoneNumbersOf').updateOne({ _id: chatId }, { $set: { 'val.numbers': [ivrNum] } })
  sent.length = 0
  await fax.voiceOnFaxNudge(chatId, ivrNum)
  ok(sent.length === 0, 'no nudge when there are no calls hitting fax tones')
  await db.collection('faxes').insertOne({ _id: 'vf1', chatId, phoneNumber: ivrNum.phoneNumber, direction: 'inbound', status: 'media_failed', createdAt: new Date() })
  await fax.voiceOnFaxNudge(chatId, ivrNum)
  ok(sent.some(m => /fax tones/.test(m.t) && /keypad menu/.test(m.t)), 'nudge sent when a call hit fax tones')
  sent.length = 0
  await fax.voiceOnFaxNudge(chatId, ivrNum)
  ok(sent.length === 0, 'nudge sent at most once per day per number')
  await db.collection('faxes').insertOne({ _id: 'vf2', chatId, phoneNumber: ivrNum.phoneNumber, direction: 'inbound', status: 'received', createdAt: new Date() })
  await db.collection('faxConfig').deleteMany({})
  sent.length = 0
  await fax.voiceOnFaxNudge(chatId, ivrNum)
  ok(sent.length === 0, 'no nudge when a real fax arrived in the window')
  await db.collection('phoneNumbersOf').updateOne({ _id: chatId }, { $set: { 'val.numbers': [biz] } })

  console.log('Failure reasons')
  ok(fax.reasonText('fax_initial_communication_timeout') === 'The number answered, but no fax machine responded. Check that it is a fax line that is switched on, then try again.', 'initial timeout → plain "no fax machine" wording')
  ok(fax.reasonText('user_busy', 'fr').includes('occupée') && fax.reasonText('weird_code').includes('couldn’t be completed') && !/_/.test(fax.reasonText('receiver_unallocated_number', 'fa')), 'busy (fr), unknown fallback, no raw codes')
  await db.collection('faxes').updateOne({ _id: f.id }, { $set: { status: 'queued' } })
  sent.length = 0
  await fax.handleEvent({ event_type: 'fax.failed', payload: { fax_id: f.id, failure_reason: 'fax_initial_communication_timeout' } })
  ok(sent.some(m => /no fax machine responded/.test(m.t) && !/fax_initial|initial communication/.test(m.t)), 'bot failure message uses plain reason')
  const h = await fax.list(chatId)
  ok(h.find(x => x.id === f.id)?.reason?.startsWith('The number answered'), 'web history returns plain reason')

  console.log('Announcement')
  ok((await fax.announce()) === 0, 'never sends in preview / dry run')
  ok(/50 free pages every month/.test(fax.t('en').announce('<b>x</b>')) && /📠 Fax/.test(fax.t('en').announce('x')), 'message mentions free pages and bot path')
  ok(['fr', 'zh', 'hi', 'fa'].every(l => fax.t(l).btnCover !== fax.t('en').btnCover && fax.t(l).announce('x').includes('50')), 'translated in fr/zh/hi/fa')

  console.log('Caller ID report')
  const now = new Date()
  const old = new Date(Date.now() - 2 * 86400000)
  await db.collection('callerIdUses').insertMany([
    { chatId: '1', showAs: '+18009359935', via: 'sip_test', at: now }, { chatId: '1', showAs: '+18009359935', via: 'sip_test_call', at: now },
    { chatId: '2', showAs: '+14155550199', via: 'ivr', at: now }, { chatId: '3', showAs: '+14155550199', via: 'bulk', at: old },
  ])
  await db.collection('callerIdDeclines').insertMany([{ chatId: '1', showAs: '+18009359935', via: 'sip', how: 'carrier', code: '603', at: now }, { chatId: '2', showAs: '+14155550199', via: 'ivr', how: 'telnyx', at: now }])
  const r = await report.build(db, new Date(Date.now() + 1000))
  ok(r.total === 3 && r.declined === 2, 'last 24h only: 3 uses, 2 declines')
  ok(/Chase/.test(r.text) && /Hotline look-alikes/.test(r.text), 'hotline look-alike flagged')
  ok(/Carrier declined/.test(r.text) && /Telnyx refused/.test(r.text) && /Free SIP test call/.test(r.text), 'declines and channels listed')
  const e = await report.build(db, new Date(Date.now() + 10 * 86400000))
  ok(/No custom caller IDs/.test(e.text), 'quiet day still reports')
  const caller = require('../cloudivr-web/caller-ids')
  ok(typeof caller.logDecline === 'function', 'decline logger exported')

  await db.dropDatabase(); await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
