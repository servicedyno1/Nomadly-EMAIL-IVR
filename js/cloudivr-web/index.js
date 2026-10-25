'use strict'
// CloudIVR web app API (mounted at /cloudivr-web → external /api/cloudivr-web). Web-only accounts drive the
// bot's existing phone engine through a reserved chatId range; see notify.js.
const express = require('express')
const multer = require('multer')
const notify = require('./notify')
const { createAuth } = require('./auth')
const wallet = require('./wallet')
const numbers = require('./numbers')
const verification = require('./verification')
const audio = require('./audio')
const calls = require('./calls')
const orders = require('./orders')
const trycall = require('./trycall')
const notes = require('./notes')
const outbound = require('./outbound')
const extras = require('./extras')
const support = require('./support')
const ai = require('./ai')
const referrals = require('./referrals')
const suggestions = require('./suggestions')
const relay = require('./relay')
const incoming = require('./incoming')
const smsReplyMod = require('./sms-reply')
const { sendMail } = require('./auth')

function createCloudIvrWeb(deps) {
  const { getDb, log = console.log } = deps
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
  const h = (fn) => async (req, res, next) => {
    try { await fn(req, res, next) } catch (e) {
      log(`[CloudIVR-Web] ${req.method} ${req.path} failed: ${e.stack || e.message}`)
      if (!res.headersSent) res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Please try again — if it keeps happening, message support.' })
    }
  }

  function build(db) {
    const r = express.Router()
    const auth = createAuth(db, { log })
    auth.routes(r, h)
    r.get('/public/catalog', (req, res) => res.json({
      ...numbers.catalog(), coins: deps.coins || [], minTopup: wallet.MIN_TOPUP_USD, supportLink: support.supportLink(), channelLink: String(process.env.CLOUDIVR_CHANNEL_LINK || '').trim(),
    }))
    trycall.routes(r, { ...deps, db, h })
    support.publicRoutes(r, { db, h, log })
    ai.publicRoutes(r, { h })
    r.use(auth.requireUser)
    notify.routes(r, { h })
    wallet.routes(r, { db, h, coins: deps.coins, createCryptoDeposit: deps.createCryptoDeposit })
    // Orders go first so /numbers/orders is not caught by /numbers/:phone; numbersApi is filled in right after.
    const numbersApi = {}
    orders.routes(r, { ...deps, db, h, numbersApi, sendMail })
    Object.assign(numbersApi, numbers.routes(r, { ...deps, db, h }))
    verification.routes(r, { ...deps, db, h, upload })
    audio.routes(r, { ...deps, db, h, upload })
    outbound.routes(r, { ...deps, db, h, numbersApi })
    calls.routes(r, { ...deps, db, h, numbersApi })
    notes.routes(r, { db, h, numbersApi })
    ai.routes(r, { h, numbersApi })
    extras.routes(r, { ...deps, db, h, numbersApi })
    support.routes(r, { ...deps, db, h, numbersApi })
    referrals.routes(r, { db, h })
    suggestions.routes(r, { ...deps, db, h })
    relay.routes(r, { ...deps, h, numbersApi })
    const smsReply = smsReplyMod.createSmsReply({ db, voiceService: deps.voiceService, log })
    smsReplyMod.routes(r, { db, h, numbersApi, smsReply })
    incoming.routes(r, { ...deps, db, h, numbersApi, smsReply })
    r.get('/dashboard', h(async (req, res) => {
      const id = req.webChatId
      const nums = await numbersApi.myNumbers(id)
      const [balance, unread, campaigns, pendingVerification] = await Promise.all([
        wallet.walletOps(db).balance(id),
        db.collection('webNotifications').countDocuments({ chatId: id, read: false }),
        db.collection('bulkCallCampaigns').countDocuments({ chatId: id, status: { $in: ['running', 'paused', 'scheduled'] } }),
        db.collection('telnyxRegSessions').countDocuments({ chatId: id, status: 'collecting' }),
      ])
      const soon = Date.now() + 7 * 86400000
      res.json({
        balance, unread, activeCampaigns: campaigns, pendingVerification,
        numbers: { total: nums.length, active: nums.filter(n => n.status === 'active').length, expiringSoon: nums.filter(n => n.expiresAt && new Date(n.expiresAt).getTime() < soon).length },
        minutesUsed: nums.reduce((s, n) => s + (n.minutesUsed || 0), 0), smsUsed: nums.reduce((s, n) => s + (n.smsUsed || 0), 0),
      })
    }))
    return r
  }

  let ready = null
  const boot = () => { if (!ready) { const db = getDb(); if (db) ready = build(db) } return ready }
  // Build as soon as the DB is up so background work (crypto order pickup) runs without waiting for a visitor.
  const bootTimer = setInterval(() => { if (boot()) clearInterval(bootTimer) }, 5000)
  if (bootTimer.unref) bootTimer.unref()
  const router = express.Router()
  router.use((req, res, next) => {
    boot()
    if (!ready) return res.status(503).json({ error: 'starting', message: 'Service is starting. Try again in a moment.' })
    ready(req, res, next)
  })
  router.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'upload_failed', message: err.code === 'LIMIT_FILE_SIZE' ? 'Files must be under 10 MB.' : 'Upload failed.' })
    log(`[CloudIVR-Web] unhandled: ${err.message}`)
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Please try again — if it keeps happening, message support.' })
  })
  return router
}

module.exports = { createCloudIvrWeb, notify, makeDownloader: verification.makeDownloader }
