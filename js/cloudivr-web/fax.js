'use strict'
// Fax for web accounts: overview (numbers + allowance + history), upload → price → send, fax line switch, PDF download.
const fax = require('../fax-service')
const phoneConfig = require('../phone-config')

const bad = (res, status, error, message, extra = {}) => res.status(status).json({ error, message, ...extra })
const STATUS = { plan_upgrade_required: 403, insufficient_balance: 402, expired: 410, unavailable: 503, send_failed: 503, not_running: 409, not_found: 404, fax_only: 409 }
const fail = (res, e) => (e instanceof fax.FaxError ? bad(res, STATUS[e.code] || 400, e.code, e.message) : Promise.reject(e))

function routes(router, { db, h, upload, numbersApi, notifyAdmin }) {
  if (!fax.isReady()) fax.init({ db })
  const faxNums = require('../fax-numbers').create(db, { notifyAdmin, push: (id, text) => require('./notify').push(id, text, null, { kind: 'fax' }) })
  const faxOnly = (chatId) => db.collection('faxNumbers').find({ chatId: String(chatId), status: { $ne: 'released' } }).toArray()
  const mine = async (req, phone) => (await faxOnly(req.webChatId)).find(n => n.phoneNumber === phone) || null
  const out = (res, fn) => fn().then(r => res.json(r), e => (e.status && e.code ? bad(res, e.status, e.code, e.message) : Promise.reject(e)))

  router.get('/fax-numbers', h(async (req, res) => res.json({ ...faxNums.offer(), numbers: await faxNums.list(req.webChatId) })))
  router.get('/fax-numbers/search', h((req, res) => out(res, () => faxNums.search(req.webChatId, req.query.country, req.query.areaCode))))
  router.post('/fax-numbers', h((req, res) => out(res, () => faxNums.buy(req.webChatId, { phoneNumber: String(req.body?.phoneNumber || ''), autoRenew: req.body?.autoRenew !== false, email: req.webUser?.email }))))
  router.patch('/fax-numbers/:phone', h((req, res) => out(res, async () => ({ number: await faxNums.setAutoRenew(req.webChatId, req.params.phone, !!req.body?.autoRenew) }))))

  router.get('/fax', h(async (req, res) => {
    // Web fax runs on the fax-only account, so only fax-only numbers are listed.
    const nums = await faxOnly(req.webChatId)
    const numbers = await Promise.all(nums.map(async n => ({
      phoneNumber: n.phoneNumber, plan: n.plan, faxOnly: !!n.faxOnly, status: n.status, price: n.price, autoRenew: n.autoRenew !== false, expiresAt: n.expiresAt, eligible: fax.eligible(n), faxLine: fax.lineOn(n), voiceRouting: fax.voiceRouting(n), usage: fax.eligible(n) ? await fax.usage(n) : null,
    })))
    res.json({ numbers, faxes: await fax.list(req.webChatId), batches: await fax.listBatches(req.webChatId), pricing: { freePages: fax.FREE_PAGES, pagePrice: fax.PAGE_PRICE, bulkMax: fax.BULK_MAX } })
  }))

  router.post('/fax/stage', upload.single('file'), h(async (req, res) => {
    const num = await mine(req, String(req.body?.from || ''))
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    if (!req.file?.buffer) return bad(res, 400, 'no_file', 'Choose a PDF or photo to fax.')
    let cover = null
    try { cover = req.body?.cover ? JSON.parse(String(req.body.cover)) : null } catch (_) { return bad(res, 400, 'bad_cover', 'Cover page details could not be read.') }
    if (cover !== null && (typeof cover !== 'object' || Array.isArray(cover))) return bad(res, 400, 'bad_cover', 'Cover page details could not be read.')
    if (cover && req.body?.to) cover.toFax = String(req.body.to)
    try { res.json(await fax.stage({ chatId: req.webChatId, num, buffer: req.file.buffer, cover })) } catch (e) { return fail(res, e) }
  }))

  router.post('/fax/send', h(async (req, res) => {
    const num = await mine(req, String(req.body?.from || ''))
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    try { res.json({ fax: await fax.sendStaged({ chatId: req.webChatId, num, stageId: req.body?.stageId, to: req.body?.to }) }) } catch (e) { return fail(res, e) }
  }))

  router.post('/fax/bulk/quote', h(async (req, res) => {
    const num = await mine(req, String(req.body?.from || ''))
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    try {
      const r = await fax.bulkQuote({ chatId: req.webChatId, num, stageId: req.body?.stageId, recipients: req.body?.recipients })
      res.json({ quote: r.quote, invalid: r.invalid.slice(0, 20), invalidCount: r.invalid.length })
    } catch (e) { return fail(res, e) }
  }))

  router.post('/fax/bulk', h(async (req, res) => {
    const num = await mine(req, String(req.body?.from || ''))
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    try { res.json(await fax.sendBulk({ chatId: req.webChatId, num, stageId: req.body?.stageId, recipients: req.body?.recipients })) } catch (e) { return fail(res, e) }
  }))

  router.post('/fax/bulk/:id/cancel', h(async (req, res) => {
    try { res.json({ batch: await fax.cancelBatch(req.webChatId, req.params.id) }) } catch (e) { return fail(res, e) }
  }))

  router.patch('/fax/line', h(async (req, res) => {
    const num = await mine(req, String(req.body?.phone || ''))
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    const enabled = !!req.body?.enabled
    const warnOf = enabled && fax.voiceRouting(num)
    if (warnOf && !req.body?.confirm) return bad(res, 409, 'voice_routing_active', `This number takes calls with your ${warnOf}. A number can take calls or receive faxes, not both — callers will hear fax tones until you switch it back to voice.`, { voiceRouting: warnOf })
    try { res.json({ faxLine: await fax.setLine({ chatId: req.webChatId, num, enabled }) }) } catch (e) { return fail(res, e) }
  }))

  router.get('/fax/bulk/:id/report.csv', h(async (req, res) => {
    const rows = await fax.batchReport(req.webChatId, req.params.id)
    if (!rows) return bad(res, 404, 'not_found', 'Bulk fax not found.')
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="bulk_fax_${String(req.params.id).slice(0, 8)}.csv"` })
    res.send(fax.reportCsv(rows))
  }))

  router.get('/fax/:id/pdf', h(async (req, res) => {
    let f
    try { f = await fax.fileOf(req.webChatId, req.params.id) } catch (e) { return fail(res, e) }
    if (!f) return bad(res, 404, 'not_found', 'Fax not found.')
    const other = f.fax.direction === 'inbound' ? f.fax.from : f.fax.to
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="fax_${String(other).replace(/\D/g, '')}_${String(f.fax._id).slice(0, 8)}.pdf"` })
    res.send(f.buffer)
  }))
}

// Landing page (no account): fax offer + fax number search, 30 searches an hour per visitor.
function publicRoutes(router, { db, h }) {
  const faxNums = require('../fax-numbers').create(db, { sweep: false })
  const hits = new Map()
  router.get('/public/fax-offer', h(async (req, res) => res.json(faxNums.offer())))
  router.get('/public/fax-numbers/search', h(async (req, res) => {
    const ip = require('./auth').clientIp(req), hour = Math.floor(Date.now() / 3600000)
    const k = `${ip}|${hour}`, n = (hits.get(k) || 0) + 1
    if (hits.size > 5000) hits.clear()
    hits.set(k, n)
    if (n > 30) return bad(res, 429, 'too_many', 'Too many searches. Try again in a little while.')
    try { res.json(await faxNums.search(null, req.query.country, req.query.areaCode)) } catch (e) { return e.status ? bad(res, e.status, e.code, e.message) : Promise.reject(e) }
  }))
}

module.exports = { routes, publicRoutes, formatPhone: phoneConfig.formatPhone }
