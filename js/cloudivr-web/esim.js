'use strict'
// CloudIVR eSIM (Spenza) routes: public webhook, owner admin, customer lines.
const ES = require('../spenza.js')
const notify = require('./notify')

const out = (res, r) => (r?.error ? res.status(r.code === 'insufficient_balance' ? 402 : 400).json({ error: r.code || 'bad_request', message: r.error }) : res.json(r))
const tell = async (id, text, extra) => { await notify.push(id, text, null, extra || { kind: 'system' }).catch(() => {}); return null }

function publicRoutes(r, { db, h, log, A }) {
  ES.init({ db, log, tell })
  r.get('/public/esim-plans', h(async (req, res) => res.json({ plans: (await ES.plansForCustomers().catch(() => [])).map(p => ({ ...p, name: p.label || p.planId })) })))
  r.get('/public/mobile-offer', h(async (req, res) => res.json(await ES.mobileOffer().catch(() => ({ available: false, price: ES.MOBILE_PRICE })))))
  r.post('/public/waitlist', h(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 200)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'bad_email', message: 'Enter a valid email address.' })
    await db.collection('webWaitlist').updateOne({ _id: `mobile:${email}` }, { $setOnInsert: { email, product: 'mobile', createdAt: new Date() } }, { upsert: true })
    res.json({ ok: true })
  }))
  r.post('/public/spenza/webhook', h(async (req, res) => {
    const x = await ES.onWebhook(req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {}), req.headers, req.body)
    res.status(x.status).json({ ok: x.status === 200 })
  }))
  r.get('/admin/esim', A, h(async (req, res) => {
    const [plans, fleet] = await Promise.all([ES.catalog().catch(e => ({ error: e.message })), ES.fleet().catch(e => ({ error: e.message }))])
    res.json({ plans: Array.isArray(plans) ? plans : [], fleet: fleet.error ? null : fleet, error: plans.error || fleet.error || null, configured: !!(process.env.SPENZA_API_KEY && process.env.SPENZA_API_SECRET), sipIp: !!process.env.SPENZA_SIP_INGRESS_IP })
  }))
  r.put('/admin/esim/plans/:id', A, h(async (req, res) => out(res, await ES.setPlan(req.params.id, req.body || {}))))
  r.get('/admin/esim/sims/:iccid/usage', A, h(async (req, res) => out(res, await ES.usage(req.params.iccid))))
  r.post('/admin/esim/sims/:iccid/link', A, h(async (req, res) => out(res, await ES.linkSim(req.params.iccid, req.body?.email))))
  r.post('/admin/esim/webhook', A, h(async (req, res) => out(res, await ES.registerWebhook(process.env.SELF_URL_PROD || process.env.SELF_URL))))
}

function routes(r, { h }) {
  r.get('/esim', h(async (req, res) => res.json({ plans: await ES.plansForCustomers().catch(() => []), items: await ES.list(req.webChatId), textPrice: ES.TEXT_PRICE, replacePrice: ES.REPLACE_PRICE })))
  r.get('/mobile-numbers', h(async (req, res) => res.json({ ...(await ES.mobileOffer()), items: await ES.list(req.webChatId, 'mobile') })))
  r.post('/mobile-numbers', h(async (req, res) => out(res, await ES.buyMobile(req.webChatId, req.body || {}))))
  r.post('/esim', h(async (req, res) => out(res, await ES.buy(req.webChatId, req.body || {}))))
  r.get('/esim/:id/qr', h(async (req, res) => out(res, await ES.qr(req.webChatId, req.params.id))))
  r.get('/esim/:id/usage', h(async (req, res) => out(res, await ES.lineUsage(req.webChatId, req.params.id))))
  r.get('/esim/:id/messages', h(async (req, res) => res.json({ messages: (await ES.messages(req.webChatId, req.params.id)).map(m => ({ id: String(m._id), direction: m.direction, from: m.from, to: m.to, body: m.body, at: m.timestamp, status: m.status || null })) })))
  r.post('/esim/:id/sms', h(async (req, res) => out(res, await ES.sendSms(req.webChatId, req.params.id, req.body?.to, req.body?.text))))
  r.post('/esim/:id/calls', h(async (req, res) => out(res, await ES.setCallsTo(req.webChatId, req.params.id, req.body?.to, req.body?.ivrNumber))))
  r.post('/esim/:id/auto-renew', h(async (req, res) => out(res, await ES.setAutoRenew(req.webChatId, req.params.id, req.body?.on === true))))
  r.post('/esim/:id/renew', h(async (req, res) => out(res, await ES.renew(req.webChatId, req.params.id))))
  r.post('/esim/:id/email-qr', h(async (req, res) => out(res, await ES.resendQr(req.webChatId, req.params.id, req.body?.email))))
  r.post('/esim/:id/replace-number', h(async (req, res) => out(res, await ES.replaceNumber(req.webChatId, req.params.id))))
  r.post('/esim/:id/cancel', h(async (req, res) => out(res, await ES.cancel(req.webChatId, req.params.id))))
}

module.exports = { publicRoutes, routes }
