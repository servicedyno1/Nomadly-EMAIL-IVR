'use strict'
// Onboarding purpose, per-number setup plan, and customer reviews (asked after the first answered call).
const PURPOSES = ['sales', 'support', 'bookings', 'texting', 'accessible', 'other']
const SETUP_KEYS = ['forwarding', 'browser', 'ivr', 'ai', 'voicemail', 'recording', 'hours', 'sms', 'sip']

function routes(router, { db, h, numbersApi }) {
  const prefs = db.collection('webPrefs')
  const reviews = db.collection('webReviews')
  const bad = (res, status, error, message) => res.status(status).json({ error, message })
  const me = (req) => prefs.findOne({ _id: req.webChatId })

  router.get('/prefs/onboarding', h(async (req, res) => {
    const p = await me(req)
    res.json({ purposes: p?.purposes || [], onboarded: !!p?.onboardedAt, setups: p?.setups || {} })
  }))
  router.put('/prefs/onboarding', h(async (req, res) => {
    const purposes = [...new Set((Array.isArray(req.body.purposes) ? req.body.purposes : []).map(String))].filter(x => PURPOSES.includes(x))
    await prefs.updateOne({ _id: req.webChatId }, { $set: { purposes, onboardedAt: new Date() } }, { upsert: true })
    res.json({ purposes, onboarded: true })
  }))
  router.put('/prefs/setup/:phone', h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    const items = [...new Set((Array.isArray(req.body.items) ? req.body.items : []).map(String))].filter(x => SETUP_KEYS.includes(x))
    const plan = { items, done: !!req.body.done, at: new Date() }
    await prefs.updateOne({ _id: req.webChatId }, { $set: { [`setups.${num.phoneNumber}`]: plan } }, { upsert: true })
    res.json({ setup: plan })
  }))

  // Reviews: asked once a call on one of your numbers was actually answered.
  const answeredCall = async (chatId) => {
    const nums = ((await db.collection('phoneNumbersOf').findOne({ _id: chatId }))?.val?.numbers || []).map(n => n.phoneNumber)
    if (!nums.length) return false
    return !!(await db.collection('phoneLogs').findOne({ phoneNumber: { $in: nums }, $or: [{ duration: { $gt: 0 } }, { durationSec: { $gt: 0 } }, { status: { $in: ['completed', 'answered'] } }] }, { projection: { _id: 1 } }))
  }
  router.get('/reviews/mine', h(async (req, res) => {
    const r = await reviews.findOne({ _id: req.webChatId })
    const p = await me(req)
    res.json({ review: r ? { rating: r.rating, text: r.text, name: r.name } : null, eligible: !r && !p?.reviewDismissedAt && await answeredCall(req.webChatId) })
  }))
  router.post('/reviews', h(async (req, res) => {
    const rating = parseInt(req.body.rating, 10)
    const text = String(req.body.text || '').trim().slice(0, 280)
    const name = String(req.body.name || '').trim().slice(0, 40)
    if (!(await answeredCall(req.webChatId))) return bad(res, 403, 'not_eligible', 'You can leave a review after your first answered call.')
    if (!(rating >= 1 && rating <= 5)) return bad(res, 400, 'invalid_rating', 'Pick 1 to 5 stars.')
    if (rating >= 4 && text.length < 10) return bad(res, 400, 'too_short', 'Tell us a little more — at least a few words.')
    const doc = { rating, text, name, role: String(req.body.role || '').trim().slice(0, 40), updatedAt: new Date() }
    await reviews.updateOne({ _id: req.webChatId }, { $set: doc, $setOnInsert: { createdAt: new Date() } }, { upsert: true })
    res.json({ review: doc })
  }))
  router.post('/reviews/dismiss', h(async (req, res) => {
    await prefs.updateOne({ _id: req.webChatId }, { $set: { reviewDismissedAt: new Date() } }, { upsert: true })
    res.json({ ok: true })
  }))
}

// Landing page: 4–5 star reviews with text, newest first; first name + initial only.
function publicRoutes(router, { db, h }) {
  router.get('/public/reviews', h(async (req, res) => {
    const rows = await db.collection('webReviews').find({ rating: { $gte: 4 }, text: { $exists: true, $ne: '' }, hidden: { $ne: true } }).sort({ updatedAt: -1 }).limit(9).toArray()
    const short = (n) => { const [a, b] = String(n || '').split(/\s+/); return a ? `${a}${b ? ` ${b[0]}.` : ''}` : 'CloudIVR customer' }
    res.set('Cache-Control', 'public, max-age=600')
    res.json({ reviews: rows.map(r => ({ rating: r.rating, text: r.text, name: short(r.name), role: r.role || '', at: r.updatedAt })) })
  }))
}

module.exports = { routes, publicRoutes, PURPOSES }
