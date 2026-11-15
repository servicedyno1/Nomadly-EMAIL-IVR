'use strict'
// Documents for MultiTEL countries that need ID / company papers. Customers upload them before buying (kept in Emergent
// object storage, references in Mongo); after the purchase they are emailed with the end user's details to MultiTEL's
// registration desk (their documented route), and a tick watches the number until MultiTEL approves or rejects it.
const crypto = require('crypto')
const axios = require('axios')
const multer = require('multer')
const { offer } = require('../multitel/countries')

const MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 4 } })
const STORE = () => `${((process.env.INTEGRATION_PROXY_URL || '').trim() || 'https://integrations.emergentagent.com').replace(/\/+$/, '')}/objstore/api/v1/storage`
let storageKey = null
async function key(force = false) {
  if (storageKey && !force) return storageKey
  storageKey = (await axios.post(`${STORE()}/init`, { emergent_key: process.env.EMERGENT_LLM_KEY }, { timeout: 30000 })).data.storage_key
  return storageKey
}
async function withKey(fn) { try { return await fn(await key()) } catch (e) { if (e.response?.status !== 404) throw e; return fn(await key(true)) } }
const put = (path, buf, type) => withKey(k => axios.put(`${STORE()}/objects/${path}`, buf, { headers: { 'X-Storage-Key': k, 'Content-Type': type }, timeout: 120000, maxBodyLength: Infinity }).then(r => r.data))
const get = (path) => withKey(k => axios.get(`${STORE()}/objects/${path}`, { headers: { 'X-Storage-Key': k }, responseType: 'arraybuffer', timeout: 60000 }).then(r => Buffer.from(r.data)))

function createNumberDocs({ db, h, sendMail, legalProfile, notify, notifyAdmin = () => {}, walletOps, log = console.log }) {
  const col = db.collection('numberDocs')
  const nums = db.collection('phoneNumbersOf')
  const pubFile = (f) => ({ id: f.id, name: f.name, size: f.size, type: f.type })

  async function status(chatId, country) {
    const d = await col.findOne({ _id: `${chatId}:${country}` })
    const files = (d?.files || []).filter(f => !f.deleted)
    return { ready: files.length > 0, files: files.map(pubFile), uploadedAt: d?.updatedAt || null }
  }

  function routes(r) {
    r.get('/numbers/documents', h(async (req, res) => res.json(await status(req.webChatId, String(req.query.country || '').toUpperCase()))))
    r.post('/numbers/documents', (req, res, next) => upload.array('files', 4)(req, res, (e) => (e ? res.status(400).json({ error: 'bad_upload', message: e.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10 MB or less.' : 'Upload up to 4 files (PDF, JPG or PNG).' }) : next())), h(async (req, res) => {
      const country = String(req.body?.country || '').toUpperCase()
      if (![...Object.keys(require('../multitel/countries').OFFERS[country] || {})].some(t => offer(country, t)?.level === 2)) return res.status(400).json({ error: 'invalid_country', message: 'This country does not need documents.' })
      const files = req.files || []
      if (!files.length) return res.status(400).json({ error: 'no_files', message: 'Pick at least one file.' })
      const bad = files.find(f => !MIME[f.mimetype])
      if (bad) return res.status(400).json({ error: 'bad_type', message: `${bad.originalname} is not a PDF, JPG or PNG.` })
      const saved = []
      for (const f of files) {
        const id = crypto.randomUUID()
        const out = await put(`cloudivr/number-docs/${req.webChatId}/${id}.${MIME[f.mimetype]}`, f.buffer, f.mimetype)
        saved.push({ id, path: out.path, name: String(f.originalname || 'document').slice(0, 120), type: f.mimetype, size: f.size, at: new Date(), deleted: false })
      }
      await col.updateOne({ _id: `${req.webChatId}:${country}` }, { $set: { chatId: req.webChatId, country, updatedAt: new Date() }, $push: { files: { $each: saved } } }, { upsert: true })
      log(`[NumberDocs] ${req.webChatId} uploaded ${saved.length} document(s) for ${country}`)
      res.json(await status(req.webChatId, country))
    }))
    r.delete('/numbers/documents/:id', h(async (req, res) => {
      const country = String(req.query.country || '').toUpperCase()
      await col.updateOne({ _id: `${req.webChatId}:${country}` }, { $set: { 'files.$[f].deleted': true, updatedAt: new Date() } }, { arrayFilters: [{ 'f.id': req.params.id }] })
      res.json(await status(req.webChatId, country))
    }))
  }

  // Emails the documents + end-user details for a just-bought number to MultiTEL.
  async function submit({ chatId, email, phoneNumber, country, countryName, type }) {
    const d = await col.findOne({ _id: `${chatId}:${country}` })
    const files = (d?.files || []).filter(f => !f.deleted)
    const eu = await legalProfile.endUserOf(chatId)
    // Preferred: the customer's MultiTEL registration profile (created once, reused) attached to the number.
    const person = require('../multitel/identity').personFromLegal(await db.collection('webAccounts').findOne({ _id: Number(chatId) }))
    if (person?.signature) {
      try {
        const docs = []
        for (const f of files) docs.push({ buffer: await get(f.path), name: f.name, type: f.type })
        const r = await require('../multitel/identity').registerNumber(db, { chatId, phoneNumber, person: { ...person, email: person.email || email }, files: docs })
        await nums.updateOne({ _id: chatId, 'val.numbers.phoneNumber': phoneNumber }, { $set: { 'val.numbers.$.registration.via': 'api', 'val.numbers.$.registration.profile': r.profile, 'val.numbers.$.registration.documentsSent': true, 'val.numbers.$.registration.sentAt': new Date().toISOString(), 'val.numbers.$.registration.files': files.length } })
        return notifyAdmin(`📄 MultiTEL registration submitted via customer profile for ${phoneNumber} (${countryName}) — web account ${chatId}, ${files.length} file(s)`)
      } catch (e) { log(`[NumberDocs] profile registration ${phoneNumber} failed, emailing instead: ${e.message}`) }
    }
    const attachments = []
    for (const f of files) attachments.push({ filename: `${phoneNumber.replace(/\D/g, '')}-${f.name}`, content: (await get(f.path)).toString('base64') })
    const to = process.env.MULTITEL_DOCS_EMAIL || 'support@multitel.net'
    const html = `<p>Hello MultiTEL team,</p><p>Please register this number for its end user. Documents are attached.</p>
<ul><li>Number: <b>${phoneNumber}</b> (${countryName} ${type})</li><li>End user type: ${eu?.type || '-'}</li><li>Name: ${eu?.name || '-'}</li><li>Contact person: ${eu?.contact || '-'}</li><li>Address: ${eu?.address || '-'}</li>${eu?.registrationNumber ? `<li>Company registration: ${eu.registrationNumber}</li>` : ''}<li>Contact email: ${email}</li></ul><p>Thank you,<br>CloudIVR</p>`
    const sent = await sendMail(to, `DID registration documents: ${phoneNumber} (${countryName})`, html, attachments).catch(e => { log(`[NumberDocs] email to MultiTEL failed: ${e.message}`); return false })
    await nums.updateOne({ _id: chatId, 'val.numbers.phoneNumber': phoneNumber }, { $set: { 'val.numbers.$.registration.documentsSent': !!sent, 'val.numbers.$.registration.sentAt': new Date().toISOString(), 'val.numbers.$.registration.files': files.length } })
    notifyAdmin(`📄 MultiTEL registration ${sent ? 'sent' : 'NOT sent (email failed)'} for ${phoneNumber} (${countryName}) — web account ${chatId}, ${files.length} file(s)`)
  }

  // Pending MultiTEL registrations: active → tell the customer; rejected → release, refund, tell the customer.
  async function tick() {
    const mt = require('../multitel')
    if (!mt.enabled()) return
    const w = walletOps(db)
    for (const doc of await nums.find({ 'val.numbers': { $elemMatch: { provider: 'multitel', 'registration.status': 'pending' } } }).limit(50).toArray()) {
      for (const n of (doc.val?.numbers || []).filter(x => x.provider === 'multitel' && x.registration?.status === 'pending' && !x.dryRun)) {
        try {
          const st = await mt.registrationStatus(n.phoneNumber)
          if (st.state === 'pending') continue
          const u = await nums.updateOne({ _id: doc._id, 'val.numbers': { $elemMatch: { phoneNumber: n.phoneNumber, 'registration.status': 'pending' } } }, { $set: { 'val.numbers.$.registration.status': st.state, 'val.numbers.$.registration.decidedAt': new Date().toISOString() } })
          if (!u.modifiedCount) continue
          if (st.state === 'active') {
            await notify?.push(doc._id, `Your ${n.countryName || n.country} number ${n.phoneNumber} was approved by the carrier and is now live.`, null, { kind: 'billing' }).catch(() => {})
            log(`[NumberDocs] ${n.phoneNumber} registration approved`)
          } else {
            await mt.releaseNumber(`mt:${n.phoneNumber}`)
            await nums.updateOne({ _id: doc._id, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: { 'val.numbers.$.status': 'released', 'val.numbers.$.releasedAt': new Date().toISOString() } })
            const amount = Number(n.planPrice) || 0
            if (amount) await w.credit(doc._id, amount)
            await notify?.push(doc._id, `The carrier did not approve the documents for ${n.phoneNumber}. We released the number and refunded $${amount.toFixed(2)} to your wallet.`, null, { kind: 'billing' }).catch(() => {})
            notifyAdmin(`❌ MultiTEL rejected registration for ${n.phoneNumber} (web account ${doc._id}) — released, refunded $${amount} (${st.raw})`)
          }
        } catch (e) { log(`[NumberDocs] status ${n.phoneNumber}: ${e.message}`) }
      }
    }
  }

  return { routes, status, submit, tick }
}

module.exports = { createNumberDocs, put, get, MIME, upload }
