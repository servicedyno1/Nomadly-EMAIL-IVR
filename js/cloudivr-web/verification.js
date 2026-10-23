'use strict'
// Pay-first number verification (regulated countries) for web accounts, driven by the bot's txReg session engine.
const crypto = require('crypto')
const axios = require('axios')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const MAX_BYTES = 10 * 1024 * 1024
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']

// Bot prompts are Telegram HTML: escape everything, then re-allow only simple inline tags.
const webHtml = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;(\/?)(b|i|u|code)&gt;/g, '<$1$2>')
const view = (text, keyboard) => ({ html: webHtml(text), options: (keyboard || []).flat().map(b => (typeof b === 'string' ? b : b?.text)).filter(Boolean) })

// txReg file loader: 'web:<id>' → uploaded on the web app; anything else is a Telegram file id.
function makeDownloader(getDb, bot) {
  return async (fileId) => {
    if (String(fileId).startsWith('web:')) {
      const doc = await getDb().collection('webUploads').findOne({ _id: String(fileId).slice(4) })
      if (!doc) throw new Error('uploaded document expired — please upload it again')
      return Buffer.from(doc.data.buffer || doc.data)
    }
    const link = await bot.getFileLink(fileId)
    const r = await axios.get(link, { responseType: 'arraybuffer', timeout: 60000 })
    return Buffer.from(r.data)
  }
}

function routes(router, { db, h, upload, txReg, refundTelnyxVerification, submitTelnyxVerification, notifyAdmin = () => {} }) {
  const uploads = db.collection('webUploads')
  uploads.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 86400 }).catch(() => {})

  const pending = async (chatId) => (await db.collection('telnyxPendingOrders').find({ chatId: String(chatId) }).sort({ createdAt: -1 }).limit(10).toArray())
    .map(o => ({ phoneNumber: o.phoneNumber, countryName: o.countryName, status: o.status, createdAt: o.createdAt }))

  async function step(req, res, input) {
    const chatId = req.webChatId
    const r = await txReg.handleInput(chatId, input, 'en')
    if (!r) return res.status(404).json({ error: 'no_session', message: 'There is no verification in progress.' })
    if (r.closed) return res.json({ state: 'closed', ...view(r.text) })
    if (r.cancelled) {
      if (r.refundable) {
        await refundTelnyxVerification(chatId, r.session?.payment?.refund, 'en')
        notifyAdmin(`↩️ [TelnyxVerify] Web user cancelled → refunded ${txReg.fmtAmount(r.session?.payment?.refund)}\nchatId: ${chatId}\nnumber: ${r.session?.selectedNumber}`)
      }
      return res.json({ state: 'cancelled', ...view(r.text) })
    }
    if (r.done) {
      if (dryRun()) {
        await txReg.setStatus(r.session._id, 'dryrun_submitted')
        return res.json({ state: 'submitted', dryRun: true, ...view(`${r.text}\n\n(Preview mode: details were checked but no carrier order was placed.)`) })
      }
      submitTelnyxVerification(r.session)
      return res.json({ state: 'submitted', ...view(r.text) })
    }
    res.json({ state: 'collecting', ...view(r.text, r.keyboard) })
  }

  router.get('/verification', h(async (req, res) => {
    const s = await txReg.getSession(req.webChatId)
    const orders = await pending(req.webChatId)
    if (!s) return res.json({ state: 'none', pending: orders })
    const p = await txReg.resumePrompt(req.webChatId, 'en')
    res.json({
      state: 'collecting', pending: orders,
      session: { phoneNumber: s.selectedNumber, countryName: String(s.countryName || s.countryCode).replace(/^[^\p{L}]+/u, ''), numberType: s.numberType, paid: txReg.fmtAmount(s.payment?.refund), startedAt: s.createdAt },
      ...view(p.text, p.keyboard),
    })
  }))

  router.post('/verification/input', h(async (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 500)
    if (!text) return res.status(400).json({ error: 'empty', message: 'Type an answer or pick an option.' })
    return step(req, res, { text })
  }))

  router.post('/verification/upload', upload.single('file'), h(async (req, res) => {
    const f = req.file
    if (!f) return res.status(400).json({ error: 'no_file', message: 'Choose a photo or PDF to upload.' })
    const mime = String(f.mimetype || '').toLowerCase()
    if (!OK_TYPES.includes(mime)) return res.status(400).json({ error: 'bad_type', message: 'Upload a PDF, JPG or PNG file.' })
    if (f.size > MAX_BYTES) return res.status(400).json({ error: 'too_big', message: 'That file is larger than 10 MB.' })
    const id = crypto.randomUUID()
    await uploads.insertOne({ _id: id, chatId: req.webChatId, name: f.originalname, mime, size: f.size, data: f.buffer, createdAt: new Date() })
    return step(req, res, { document: { file_id: `web:${id}`, file_name: String(f.originalname || 'document').slice(0, 120), mime_type: mime, file_size: f.size } })
  }))
}

module.exports = { routes, makeDownloader, webHtml }
