'use strict'
// Picture messages: files kept in object storage (provider links expire), served from an unguessable public link
// so carriers can fetch what we send and <img> tags can show what arrived.
const axios = require('axios')
const crypto = require('crypto')

const STORE = () => ((process.env.INTEGRATION_PROXY_URL || '').trim() || 'https://integrations.emergentagent.com').replace(/\/$/, '') + '/objstore/api/v1/storage'
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
const MAX_TOTAL = 600 * 1024
const MAX_FILES = 5
let key = null

async function storageKey(force) {
  if (key && !force) return key
  const r = await axios.post(`${STORE()}/init`, { emergent_key: process.env.EMERGENT_LLM_KEY }, { timeout: 30000 })
  key = r.data.storage_key
  return key
}
async function withKey(fn) {
  try { return await fn(await storageKey()) } catch (e) { if (e.response?.status !== 404) throw e; return fn(await storageKey(true)) }
}
const put = (path, data, type) => withKey(k => axios.put(`${STORE()}/objects/${path}`, data, { headers: { 'X-Storage-Key': k, 'Content-Type': type }, timeout: 120000, maxBodyLength: Infinity }).then(r => r.data))
const get = (path) => withKey(k => axios.get(`${STORE()}/objects/${path}`, { headers: { 'X-Storage-Key': k }, responseType: 'arraybuffer', timeout: 60000 }))

const col = (db) => db.collection('webMedia')
async function save(db, chatId, buf, type, source) {
  const ext = TYPES[type]
  if (!ext) throw new Error('Pictures must be JPG, PNG, GIF or WebP.')
  const id = crypto.randomBytes(16).toString('hex')
  const r = await put(`cloudivr/media/${chatId}/${id}.${ext}`, buf, type)
  const doc = { _id: id, chatId: String(chatId), path: r.path, type, size: buf.length, source, isDeleted: false, createdAt: new Date() }
  await col(db).insertOne(doc)
  return { id, type, size: buf.length }
}
// Inbound MMS: copy each provider file into our storage → [{ id, type }]
async function keepRemote(db, chatId, list, log = console.log) {
  const out = []
  for (const m of (list || []).slice(0, 10)) {
    const type = String(m.content_type || m.type || '').split(';')[0]
    if (!m.url || !TYPES[type]) continue
    try {
      const r = await axios.get(m.url, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 5 * 1024 * 1024 })
      out.push(await save(db, chatId, Buffer.from(r.data), type, 'inbound'))
    } catch (e) { log(`[Media] keep inbound picture failed: ${e.message}`) }
  }
  return out
}
const publicUrl = (id) => `${String(process.env.SELF_URL_PROD || process.env.SELF_URL || '').replace(/\/$/, '')}/api/cloudivr-web/public/media/${id}`

function publicRoutes(r, { db, h }) {
  r.get('/public/media/:id', h(async (req, res) => {
    const d = /^[a-f0-9]{32}$/.test(req.params.id) && await col(db).findOne({ _id: req.params.id, isDeleted: false })
    if (!d) return res.status(404).json({ error: 'not_found', message: 'Picture not found.' })
    const f = await get(d.path)
    res.set({ 'Content-Type': d.type, 'Cache-Control': 'private, max-age=86400' }).send(Buffer.from(f.data))
  }))
}
function routes(r, { db, h, upload }) {
  r.post('/messages/media', upload.single('file'), h(async (req, res) => {
    const f = req.file
    if (!f) return res.status(400).json({ error: 'no_file', message: 'Pick a picture.' })
    if (f.size > MAX_TOTAL) return res.status(400).json({ error: 'too_big', message: 'Pictures must be under 600 KB in total.' })
    if (!TYPES[f.mimetype]) return res.status(400).json({ error: 'bad_type', message: 'Pictures must be JPG, PNG, GIF or WebP.' })
    res.status(201).json(await save(db, req.webChatId, f.buffer, f.mimetype, 'upload'))
  }))
}

module.exports = { save, keepRemote, publicUrl, publicRoutes, routes, col, MAX_TOTAL, MAX_FILES }
