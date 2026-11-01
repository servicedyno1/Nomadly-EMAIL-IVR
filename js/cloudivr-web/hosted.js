'use strict'
// Landline to Texting (Hosted SMS) — web routes over js/hosted-sms.js.
const HS = require('../hosted-sms.js')
const notify = require('./notify')
const multer = require('multer')
const { clientIp, sendMail } = require('./auth')

function routes(router, { db, h, log, notifyAdmin }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 6 } })
  const mailSupport = (subject, html) => (process.env.CIVR_ADMIN_EMAIL ? sendMail(process.env.CIVR_ADMIN_EMAIL, subject, html).catch(e => log(`[HostedSMS] support email failed: ${e.message}`)) : Promise.resolve(false))
  HS.init({ db, log, notifyAdmin, mailSupport, brand: () => 'CloudIVR', tell: async (id, text, extra) => { await notify.push(id, text, null, extra || { kind: 'system' }).catch(() => {}); return null } })
  const bad = (res, msg, status = 400, code = 'bad_request') => res.status(status).json({ error: code, message: msg })
  const out = (res, r) => (r.error ? bad(res, r.error, r.code === 'insufficient_balance' ? 402 : 400, r.code || 'bad_request') : res.json(r))
  const holderOf = (b) => { try { return typeof b.holder === 'string' ? JSON.parse(b.holder) : b.holder || {} } catch (_) { return {} } }

  router.get('/hosted-sms', h(async (req, res) => res.json({ items: await HS.list(req.webChatId), planPrices: HS.PLAN_PRICE, planLimits: HS.PLAN_LIMIT, texting: HS.TEXTING, plans: await HS.plansFor(req.webChatId), reviewDays: HS.REVIEW_DAYS, monthly: HS.MONTHLY, textPrice: HS.TEXT_PRICE, maxText: HS.MAX_TEXT })))
  router.post('/hosted-sms/check', h(async (req, res) => res.json(await HS.check(req.body?.phone))))
  router.post('/hosted-sms', h(async (req, res) => out(res, await HS.start(req.webChatId, req.body?.phone, req.body?.planNumber))))
  router.post('/hosted-sms/:id/code/send', h(async (req, res) => out(res, await HS.sendCode(req.webChatId, req.params.id))))
  router.post('/hosted-sms/:id/code', h(async (req, res) => out(res, await HS.submitCode(req.webChatId, req.params.id, req.body?.code))))
  router.post('/hosted-sms/:id/code/skip', h(async (req, res) => out(res, await HS.skipCode(req.webChatId, req.params.id))))
  router.post('/hosted-sms/:id/loa', h(async (req, res) => out(res, await HS.signLoa(req.webChatId, req.params.id, { holder: holderOf(req.body), signature: req.body?.signature, consent: req.body?.consent === true, ip: clientIp(req) }))))
  router.post('/hosted-sms/:id/help', h(async (req, res) => out(res, await HS.requestHelp(req.webChatId, req.params.id))))
  router.post('/hosted-sms/:id/renew', h(async (req, res) => out(res, await HS.renew(req.webChatId, req.params.id))))
  router.post('/hosted-sms/:id/cancel', h(async (req, res) => out(res, await HS.cancel(req.webChatId, req.params.id))))
  // The letter exactly as it will be signed, so the customer can read it first.
  router.post('/hosted-sms/:id/loa-preview', h(async (req, res) => {
    const d = await HS.mine(req.webChatId, req.params.id)
    if (!d) return bad(res, 'Not found.', 404, 'not_found')
    const pdf = await HS.buildLoa(d, { name: '', business: '', address: '', city: '', state: '', zip: '', carrier: '', account: '', ...holderOf(req.body) }, { ip: clientIp(req) })
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline; filename="authorization-letter.pdf"').send(pdf)
  }))
  router.post('/hosted-sms/:id/documents', upload.array('files', 6), h(async (req, res) => out(res, await HS.submitDocs(req.webChatId, req.params.id, req.files || []))))
  router.get('/hosted-sms/recent', h(async (req, res) => {
    const rows = await HS.recent(req.webChatId, Number(req.query.limit) || 10)
    res.json({ messages: rows.map(m => ({ id: String(m._id), phoneNumber: m.phoneNumber, from: m.from, body: m.body, at: m.timestamp })) })
  }))
  router.get('/hosted-sms/:id/messages', h(async (req, res) => {
    const rows = await HS.messages(req.webChatId, req.params.id)
    if (!rows) return bad(res, 'Not found.', 404, 'not_found')
    res.json({ messages: rows.map(m => ({ id: String(m._id), direction: m.direction, from: m.from, to: m.to, body: m.body, at: m.timestamp, status: m.status || null })) })
  }))
  router.post('/hosted-sms/:id/send', h(async (req, res) => {
    const r = await HS.sendText(req.webChatId, req.params.id, req.body?.to, req.body?.text)
    if (r.error) return out(res, r)
    res.json({ message: { direction: 'outbound', to: r.log.to, body: r.log.body, at: r.log.timestamp, status: r.log.status }, charge: r.charge })
  }))
}

module.exports = { routes }
