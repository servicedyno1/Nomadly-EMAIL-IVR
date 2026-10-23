'use strict'
// Call notes: free text the owner saves against a call — typed live in the browser phone, or added later to any
// row of a number's call log. A note saved from the browser phone has no log id yet, so it is matched to the log
// row with the same other party within 15 minutes.
const crypto = require('crypto')

const MAX_TEXT = 2000
const MATCH_WINDOW_MS = 15 * 60000
const col = (db) => db.collection('webCallNotes')
const digits = (p) => String(p || '').replace(/\D/g, '')
const bad = (res, status, error, message) => res.status(status).json({ error, message })

const publicNote = (n) => ({
  id: n._id, phoneNumber: n.phoneNumber, peer: n.peer || null, direction: n.direction || null, logId: n.logId || null,
  callAt: n.callAt, text: n.text, createdAt: n.createdAt, updatedAt: n.updatedAt,
})

// Adds `note` to each log row that has one (by log id first, then by other party + time).
async function attachNotes(db, chatId, phone, logs) {
  if (!logs.length) return logs
  const list = await col(db).find({ chatId: String(chatId), phoneNumber: phone }).sort({ callAt: -1 }).limit(500).toArray()
  if (!list.length) return logs
  const byLog = new Map(list.filter(n => n.logId).map(n => [n.logId, n]))
  const used = new Set()
  return logs.map(l => {
    let n = byLog.get(l.id)
    if (!n) {
      const t = new Date(l.timestamp).getTime()
      const peers = [l.from, l.to, l.forwardTo].map(digits).filter(Boolean)
      n = list.find(x => !x.logId && !used.has(x._id) && x.peer && peers.includes(digits(x.peer)) && Math.abs(new Date(x.callAt).getTime() - t) <= MATCH_WINDOW_MS)
    }
    if (!n) return l
    used.add(n._id)
    return { ...l, note: publicNote(n) }
  })
}

function cleanText(t) {
  const text = String(t || '').trim()
  if (!text) throw new Error('Write something before saving the note.')
  if (text.length > MAX_TEXT) throw new Error(`Notes can be up to ${MAX_TEXT} characters.`)
  return text
}

function routes(router, { db, h, numbersApi }) {
  col(db).createIndex({ chatId: 1, phoneNumber: 1, callAt: -1 }).catch(() => {})

  router.get('/numbers/:phone/notes', h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    const list = await col(db).find({ chatId: req.webChatId, phoneNumber: num.phoneNumber }).sort({ callAt: -1 }).limit(200).toArray()
    res.json({ notes: list.map(publicNote) })
  }))

  router.post('/numbers/:phone/notes', h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    let text
    try { text = cleanText(req.body.text) } catch (e) { return bad(res, 400, 'invalid_note', e.message) }
    const callAt = req.body.callAt ? new Date(req.body.callAt) : new Date()
    if (isNaN(callAt.getTime())) return bad(res, 400, 'invalid_time', 'Invalid call time.')
    const logId = req.body.logId ? String(req.body.logId).slice(0, 64) : null
    if (logId) {
      const dupe = await col(db).findOne({ chatId: req.webChatId, logId })
      if (dupe) return bad(res, 409, 'note_exists', 'This call already has a note — edit it instead.')
    }
    const now = new Date()
    const doc = {
      _id: crypto.randomUUID(), chatId: req.webChatId, phoneNumber: num.phoneNumber,
      peer: req.body.peer ? String(req.body.peer).replace(/[^\d+]/g, '').slice(0, 20) || null : null,
      direction: ['inbound', 'outbound'].includes(req.body.direction) ? req.body.direction : null,
      logId, callAt, text, createdAt: now, updatedAt: now,
    }
    await col(db).insertOne(doc)
    res.status(201).json({ note: publicNote(doc) })
  }))

  router.patch('/notes/:id', h(async (req, res) => {
    let text
    try { text = cleanText(req.body.text) } catch (e) { return bad(res, 400, 'invalid_note', e.message) }
    const r = await col(db).findOneAndUpdate({ _id: String(req.params.id), chatId: req.webChatId }, { $set: { text, updatedAt: new Date() } }, { returnDocument: 'after' })
    const doc = r && (r.value !== undefined ? r.value : r)
    if (!doc) return bad(res, 404, 'not_found', 'Note not found.')
    res.json({ note: publicNote(doc) })
  }))

  router.delete('/notes/:id', h(async (req, res) => {
    const r = await col(db).deleteOne({ _id: String(req.params.id), chatId: req.webChatId })
    if (!r.deletedCount) return bad(res, 404, 'not_found', 'Note not found.')
    res.json({ deleted: true })
  }))
}

module.exports = { routes, attachNotes, publicNote, MATCH_WINDOW_MS }
