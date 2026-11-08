'use strict'
// Fax service: staging (PDF/photo), free-page allowance, wallet charges on delivery/receipt, idempotency, plan gate.
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const { PDFDocument } = require('pdf-lib')
const axios = require('axios')
const fax = require('../fax-service')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }

async function pdfOf(pages) { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([612, 792]); return Buffer.from(await d.save()) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('fax_test_' + Date.now())
  const sent = []
  const bot = { sendMessage: async (id, t) => sent.push({ id, t }), sendDocument: async (id, buf, o) => sent.push({ id, doc: buf.length, t: o.caption }) }
  fax.init({ db, bot, log: () => {} })
  const chatId = '777001'
  const biz = { phoneNumber: '+15550001111', plan: 'business', provider: 'telnyx', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z', features: {} }
  const pro = { ...biz, phoneNumber: '+15550002222', plan: 'pro' }
  await db.collection('phoneNumbersOf').insertOne({ _id: chatId, val: { numbers: [biz, pro] } })
  await db.collection('walletOf').insertOne({ _id: chatId, usdIn: 5, usdOut: 0 })
  await db.collection('state').insertOne({ _id: chatId, userLanguage: 'en' })

  console.log('Plan gate')
  try { await fax.stage({ chatId, num: pro, buffer: await pdfOf(1) }); ok(false, 'pro rejected') } catch (e) { ok(e.code === 'plan_upgrade_required', 'pro plan rejected') }
  ok(fax.eligible(biz) && !fax.eligible(pro), 'eligible only on business')

  console.log('Staging')
  const s1 = await fax.stage({ chatId, num: biz, buffer: await pdfOf(3) })
  ok(s1.pages === 3 && s1.quote.freePages === 3 && s1.quote.cost === 0, 'PDF 3 pages → free')
  const sp = await fax.stage({ chatId, num: biz, buffer: PNG })
  ok(sp.pages === 1, 'PNG photo → 1 page PDF')
  try { await fax.stage({ chatId, num: biz, buffer: Buffer.from('hello world') }); ok(false, 'bad type') } catch (e) { ok(e.code === 'bad_type', 'non PDF/image rejected') }
  ok(!!fax.checkTo('+15550001111', '+15550001111').error, 'own number rejected')
  ok(!!fax.checkTo('12', biz.phoneNumber).error, 'short number rejected')

  console.log('Send + delivery (dry run)')
  const f1 = await fax.sendStaged({ chatId, num: biz, stageId: s1.stageId, to: '+14155550123' })
  ok(f1.status === 'queued', 'queued')
  try { await fax.sendStaged({ chatId, num: biz, stageId: s1.stageId, to: '+14155550123' }); ok(false, 'reuse') } catch (e) { ok(e.code === 'expired', 'stage cannot be reused') }
  await new Promise(r => setTimeout(r, 3500))
  let d1 = await db.collection('faxes').findOne({ _id: f1.id })
  ok(d1.status === 'delivered' && d1.cost === 0 && d1.freePages === 3, 'delivered, 3 free pages, no charge')
  ok((await fax.usage(biz)).left === 47, 'allowance 47 left')
  ok(sent.some(m => /Fax delivered/.test(m.t)), 'owner told delivered')

  console.log('Overage + idempotency')
  await db.collection('faxUsage').updateOne({ _id: `${biz.phoneNumber}|2099-01-01` }, { $set: { pages: 49 } })
  const s2 = await fax.stage({ chatId, num: biz, buffer: await pdfOf(2) })
  ok(s2.quote.freePages === 1 && s2.quote.paidPages === 1 && s2.quote.cost === 2, 'quote 1 free + 1 paid = $2')
  const f2 = await fax.sendStaged({ chatId, num: biz, stageId: s2.stageId, to: '+14155550123' })
  await fax.handleEvent({ event_type: 'fax.delivered', payload: { fax_id: f2.id, page_count: 2 } })
  await fax.handleEvent({ event_type: 'fax.delivered', payload: { fax_id: f2.id, page_count: 2 } })
  await new Promise(r => setTimeout(r, 3500))
  const w = await db.collection('walletOf').findOne({ _id: chatId })
  ok(w.usdOut === 2, `charged $2 exactly once (usdOut=${w.usdOut})`)
  const led = await db.collection('walletLedger').find({ callRef: `fax:${f2.id}` }).toArray()
  ok(led.length === 1 && led[0].type === 'fax', 'one ledger row type=fax')

  console.log('Insufficient balance blocks send')
  await db.collection('walletOf').updateOne({ _id: chatId }, { $set: { usdIn: 2, usdOut: 2 } })
  const s3 = await fax.stage({ chatId, num: biz, buffer: await pdfOf(2) })
  try { await fax.sendStaged({ chatId, num: biz, stageId: s3.stageId, to: '+14155550123' }); ok(false, 'insufficient') } catch (e) { ok(e.code === 'insufficient_balance', 'insufficient balance rejected') }

  console.log('Failed fax → no charge')
  await db.collection('walletOf').updateOne({ _id: chatId }, { $set: { usdIn: 100, usdOut: 0 } })
  const s4 = await fax.stage({ chatId, num: biz, buffer: await pdfOf(1) })
  const f4 = await fax.sendStaged({ chatId, num: biz, stageId: s4.stageId, to: '+14155550124' })
  await fax.handleEvent({ event_type: 'fax.failed', payload: { fax_id: f4.id, failure_reason: 'receiver_no_answer' } })
  await new Promise(r => setTimeout(r, 3500))
  const d4 = await db.collection('faxes').findOne({ _id: f4.id })
  ok(d4.status === 'failed' && !d4.settled, 'failed stays failed, never settled (dry-run delivered ignored)')

  console.log('Fax line + inbound')
  await fax.setLine({ chatId, num: biz, enabled: true })
  const after = await fax.findMine(chatId, biz.phoneNumber)
  ok(fax.lineOn(after), 'fax line saved on number')
  const pdf = await pdfOf(2)
  const origGet = axios.get
  axios.get = async (url) => (url === 'https://media.test/fax.pdf' ? { data: pdf } : origGet(url))
  await fax.handleEvent({ event_type: 'fax.received', payload: { fax_id: 'in-1', from: '+14155550199', to: biz.phoneNumber, media_url: 'https://media.test/fax.pdf', page_count: 2 } })
  await fax.handleEvent({ event_type: 'fax.received', payload: { fax_id: 'in-1', from: '+14155550199', to: biz.phoneNumber, media_url: 'https://media.test/fax.pdf', page_count: 2 } })
  axios.get = origGet
  const inb = await db.collection('faxes').find({ _id: 'in-1' }).toArray()
  ok(inb.length === 1 && inb[0].pages === 2 && inb[0].paidPages === 2 && inb[0].cost === 4, 'received 2 pages charged $4 (allowance used up), stored once')
  ok(sent.filter(m => m.doc && /Fax received/.test(m.t)).length === 1, 'PDF sent to bot once')
  const file = await fax.fileOf(chatId, 'in-1')
  ok(file && file.buffer.slice(0, 4).toString() === '%PDF', 'PDF stored & downloadable')
  ok(!(await fax.fileOf('someone-else', 'in-1')), 'other account cannot download')
  const list = await fax.list(chatId)
  ok(list.length >= 4 && list[0].id, 'history lists faxes')
  await fax.setLine({ chatId, num: biz, enabled: false })
  ok(!fax.lineOn(await fax.findMine(chatId, biz.phoneNumber)), 'fax line off')

  console.log('Stage tied to number; failed balance keeps stage')
  const biz2 = { ...biz, phoneNumber: '+15550003333' }
  await db.collection('phoneNumbersOf').updateOne({ _id: chatId }, { $push: { 'val.numbers': biz2 } })
  const s5 = await fax.stage({ chatId, num: biz, buffer: await pdfOf(1) })
  try { await fax.sendStaged({ chatId, num: biz2, stageId: s5.stageId, to: '+14155550123' }); ok(false, 'cross') } catch (e) { ok(e.code === 'expired', 'stage from number A cannot be sent from B') }
  await db.collection('walletOf').updateOne({ _id: chatId }, { $set: { usdIn: 0, usdOut: 0 } })
  try { await fax.sendStaged({ chatId, num: biz, stageId: s5.stageId, to: '+14155550123' }); ok(false, 'nobal') } catch (e) { ok(e.code === 'insufficient_balance', '402 on empty wallet (allowance used up)') }
  await db.collection('walletOf').updateOne({ _id: chatId }, { $set: { usdIn: 100 } })
  const f5 = await fax.sendStaged({ chatId, num: biz, stageId: s5.stageId, to: '+14155550123' })
  ok(!!f5.id, 'same stage still sendable after top-up')

  console.log('Bulk')
  const pr = fax.parseRecipients('name,phone\nA,+14155550101\n+14155550102 +14155550103\n+14155550101\n12\n' + biz2.phoneNumber, biz2.phoneNumber)
  ok(pr.list.length === 3 && pr.invalid.length === 1, `parse: 3 unique valid, own number skipped (${pr.list.length}/${pr.invalid.length})`)
  const big = Array.from({ length: 501 }, (_, i) => `+1415555${String(1000 + i).padStart(4, '0')}`).join('\n')
  const s6 = await fax.stage({ chatId, num: biz2, buffer: await pdfOf(2) })
  try { await fax.bulkQuote({ chatId, num: biz2, stageId: s6.stageId, recipients: big }); ok(false, '501') } catch (e) { ok(e.code === 'too_many', '501 recipients rejected') }
  const list30 = Array.from({ length: 30 }, (_, i) => `+1415556${String(1000 + i)}`).join('\n')
  const bq = await fax.bulkQuote({ chatId, num: biz2, stageId: s6.stageId, recipients: list30 })
  ok(bq.quote.pages === 60 && bq.quote.freePages === 50 && bq.quote.cost === 20, `bulk quote 30×2=60 pages: 50 free, $20 (${bq.quote.freePages}/${bq.quote.cost})`)
  const r = await fax.sendBulk({ chatId, num: biz2, stageId: s6.stageId, recipients: list30 })
  ok(r.batch.total === 30, 'batch created for 30')
  const s7 = await fax.stage({ chatId, num: biz2, buffer: await pdfOf(1) })
  ok(s7.quote.freePages === 0, 'pending bulk pages hold the allowance')
  for (let i = 0; i < 40 && !(await db.collection('faxBatches').findOne({ _id: r.batch.id })).summarySent; i++) await new Promise(res => setTimeout(res, 500))
  const b = await db.collection('faxBatches').findOne({ _id: r.batch.id })
  ok(b.status === 'done' && b.delivered === 30, `batch done, 30 delivered (${b.status}/${b.delivered})`)
  const charged = (await db.collection('faxes').find({ batchId: r.batch.id }).toArray()).reduce((t, f) => t + (f.cost || 0), 0)
  ok(charged === 20, `bulk charged $20 total (free pages first) — got $${charged}`)
  ok(sent.filter(m => /Bulk fax finished/.test(m.t)).length === 1 && !sent.some(m => m.t && /Fax delivered/.test(m.t) && m.t.includes('415556')), 'one summary, no per-fax spam')
  ok(!(await fax.list(chatId)).some(f => f.to.startsWith('+1415556')), 'bulk faxes kept out of single history')
  const s8 = await fax.stage({ chatId, num: biz2, buffer: await pdfOf(1) })
  const r2 = await fax.sendBulk({ chatId, num: biz2, stageId: s8.stageId, recipients: list30 })
  await fax.cancelBatch(chatId, r2.batch.id)
  await new Promise(res => setTimeout(res, 6000))
  const b2 = await db.collection('faxBatches').findOne({ _id: r2.batch.id })
  ok(b2.status === 'cancelled' && b2.cursor < 30, `cancel stops the rest (sent ${b2.cursor}/30)`)

  console.log('Held fax (wallet empty, allowance used) → released after top-up')
  await db.collection('walletOf').updateOne({ _id: chatId }, { $set: { usdIn: 0, usdOut: 0 } })
  await fax.setLine({ chatId, num: biz, enabled: true })
  const origGet2 = axios.get
  axios.get = async (url) => (url === 'https://media.test/h.pdf' ? { data: pdf } : origGet2(url))
  await fax.handleEvent({ event_type: 'fax.received', payload: { fax_id: 'in-held', from: '+14155550188', to: biz.phoneNumber, media_url: 'https://media.test/h.pdf', page_count: 2 } })
  axios.get = origGet2
  let h = await db.collection('faxes').findOne({ _id: 'in-held' })
  ok(h.held === true && h.cost === 4, 'received fax held, $4 owed')
  ok(sent.some(m => /Top up and the fax is delivered/.test(m.t || '')), 'owner told to top up')
  try { await fax.fileOf(chatId, 'in-held'); ok(false, 'held download') } catch (e) { ok(e.code === 'insufficient_balance', 'held fax cannot be downloaded') }
  ok((await fax.list(chatId)).find(f => f.id === 'in-held').status === 'held', 'history shows held')
  const docsBefore = sent.filter(m => m.doc).length
  await fax.maintain()
  ok((await db.collection('faxes').findOne({ _id: 'in-held' })).held === true, 'still held → no release without funds')
  await db.collection('walletOf').updateOne({ _id: chatId }, { $set: { usdIn: 10 } })
  await fax.maintain()
  h = await db.collection('faxes').findOne({ _id: 'in-held' })
  ok(!h.held && sent.filter(m => m.doc).length === docsBefore + 1, 'released + PDF delivered after top-up')
  ok((await db.collection('walletOf').findOne({ _id: chatId })).usdOut === 4, 'charged $4 on release')
  await fax.maintain()
  ok((await db.collection('walletOf').findOne({ _id: chatId })).usdOut === 4, 'release is one-time')

  console.log('Fax line auto-off when plan is no longer Business')
  await db.collection('phoneNumbersOf').updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].plan': 'pro' } }, { arrayFilters: [{ 'n.phoneNumber': biz.phoneNumber }] })
  await fax.maintain()
  ok(!fax.lineOn(await fax.findMine(chatId, biz.phoneNumber)), 'fax line switched off after downgrade')
  ok(sent.some(m => /no longer on an active Business plan/.test(m.t || '')), 'owner told number is back on voice')
  await db.collection('phoneNumbersOf').updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].plan': 'business' } }, { arrayFilters: [{ 'n.phoneNumber': biz.phoneNumber }] })

  console.log('Bulk report + fax email')
  const rep = await fax.batchReport(chatId, r.batch.id)
  ok(rep.length === 30 && rep.every(x => x.status === 'delivered'), 'report lists all 30 recipients')
  ok(/^fax_number,status/.test(fax.reportCsv(rep)), 'CSV header')
  ok(!(await fax.batchReport('nobody', r.batch.id)), 'other account gets no report')
  await db.collection('state').updateOne({ _id: chatId }, { $set: { faxEmail: 'fx@example.com' } })
  ok((await fax.emailOf(chatId)) === 'fx@example.com', 'fax email used for copies')

  await db.dropDatabase(); await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
