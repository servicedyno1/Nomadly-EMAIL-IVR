'use strict'
// Fax for web accounts: overview (numbers + allowance + history), upload → price → send, fax line switch, PDF download.
const fax = require('../fax-service')
const phoneConfig = require('../phone-config')

const bad = (res, status, error, message, extra = {}) => res.status(status).json({ error, message, ...extra })
const STATUS = { plan_upgrade_required: 403, insufficient_balance: 402, expired: 410, unavailable: 503, send_failed: 502, not_running: 409, not_found: 404 }
const fail = (res, e) => (e instanceof fax.FaxError ? bad(res, STATUS[e.code] || 400, e.code, e.message) : Promise.reject(e))

function routes(router, { db, h, upload, numbersApi }) {
  if (!fax.isReady()) fax.init({ db })
  const mine = async (req, phone) => (await numbersApi.myNumbers(req.webChatId)).find(n => n.phoneNumber === phone) || null

  router.get('/fax', h(async (req, res) => {
    const nums = (await numbersApi.myNumbers(req.webChatId)).filter(n => n.status === 'active' && (n.provider || 'telnyx') === 'telnyx')
    const numbers = await Promise.all(nums.map(async n => ({
      phoneNumber: n.phoneNumber, plan: n.plan, eligible: fax.eligible(n), faxLine: fax.lineOn(n), voiceRouting: fax.voiceRouting(n), usage: fax.eligible(n) ? await fax.usage(n) : null,
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

module.exports = { routes, formatPhone: phoneConfig.formatPhone }
