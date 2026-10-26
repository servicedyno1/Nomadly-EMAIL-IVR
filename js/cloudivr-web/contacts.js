'use strict'
// Contacts: saved people (phone, name, email, company, notes + any extra spreadsheet columns) grouped into lists.
// Upload flow: parse the file (column roles guessed) → check (new vs already saved) → import (skip or update the
// already-saved numbers). A list can be the audience of a Bulk IVR campaign (see calls.js listLeads).
const crypto = require('crypto')
const ci = require('../contacts-import')

const MAX_CONTACTS = 50000
const MAX_LISTS = 200
const MAX_IMPORT_BYTES = 12 * 1024 * 1024
const contactsCol = (db) => db.collection('webContacts')
const listsCol = (db) => db.collection('webContactLists')
const importsCol = (db) => db.collection('webContactImports')
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const str = (v, n) => String(v ?? '').trim().slice(0, n)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const publicContact = (c) => ({
  id: c._id, phone: c.phone, name: c.name || '', email: c.email || '', company: c.company || '', notes: c.notes || '',
  fields: c.fields || [], listIds: c.listIds || [], createdAt: c.createdAt, updatedAt: c.updatedAt,
})
const publicList = (l, count = 0) => ({ id: l._id, name: l.name, count, createdAt: l.createdAt })

async function listLeads(db, chatId, listId) {
  const list = await listsCol(db).findOne({ _id: String(listId), chatId: String(chatId) })
  if (!list) return { leads: [], errors: ['That contact list was not found.'] }
  const rows = await contactsCol(db).find({ chatId: String(chatId), listIds: list._id }, { projection: { phone: 1, name: 1 } }).sort({ createdAt: 1 }).toArray()
  return { leads: rows.map(r => ({ number: r.phone, name: r.name ? r.name.slice(0, 60) : null })), errors: rows.length ? [] : [`The list “${list.name}” has no contacts yet.`], list: publicList(list, rows.length) }
}

// Manual add / edit: only the fields sent are changed.
function cleanContact(b, partial) {
  const out = {}
  if (!partial || b.phone !== undefined) {
    const phone = ci.normalizeNumber(b.phone)
    if (!phone) throw new Error('Enter the phone number with country code, e.g. +14155550100.')
    out.phone = phone
  }
  for (const [k, n] of [['name', 80], ['company', 120], ['notes', 2000]]) if (b[k] !== undefined) out[k] = str(b[k], n)
  if (b.email !== undefined) {
    out.email = str(b.email, 120)
    if (out.email && !EMAIL.test(out.email)) throw new Error('That email address doesn’t look right.')
  }
  if (b.fields !== undefined) {
    out.fields = (Array.isArray(b.fields) ? b.fields : []).slice(0, 20).map(f => ({ label: str(f?.label, 40), value: str(f?.value, 200) })).filter(f => f.label && f.value)
  }
  return out
}

function routes(router, { db, h, upload }) {
  contactsCol(db).createIndex({ chatId: 1, phone: 1 }, { unique: true }).catch(() => {})
  contactsCol(db).createIndex({ chatId: 1, listIds: 1 }).catch(() => {})
  listsCol(db).createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  importsCol(db).createIndex({ createdAt: 1 }, { expireAfterSeconds: 7200 }).catch(() => {})

  const ownLists = async (chatId, ids) => {
    const want = [...new Set((Array.isArray(ids) ? ids : []).map(String))]
    if (!want.length) return []
    return (await listsCol(db).find({ chatId, _id: { $in: want } }, { projection: { _id: 1 } }).toArray()).map(l => l._id)
  }
  const newList = async (chatId, name) => {
    const clean = str(name, 60)
    if (!clean) throw new Error('Give the list a name.')
    if (await listsCol(db).countDocuments({ chatId }) >= MAX_LISTS) throw new Error(`You can have up to ${MAX_LISTS} lists.`)
    const doc = { _id: crypto.randomUUID(), chatId, name: clean, createdAt: new Date(), updatedAt: new Date() }
    await listsCol(db).insertOne(doc)
    return doc
  }

  // ── lists ──
  router.get('/contacts/lists', h(async (req, res) => {
    const chatId = req.webChatId
    const [lists, counts, total] = await Promise.all([
      listsCol(db).find({ chatId }).sort({ createdAt: -1 }).toArray(),
      contactsCol(db).aggregate([{ $match: { chatId } }, { $unwind: '$listIds' }, { $group: { _id: '$listIds', n: { $sum: 1 } } }]).toArray(),
      contactsCol(db).countDocuments({ chatId }),
    ])
    const n = Object.fromEntries(counts.map(c => [c._id, c.n]))
    res.json({ lists: lists.map(l => publicList(l, n[l._id] || 0)), total })
  }))

  router.post('/contacts/lists', h(async (req, res) => {
    try { res.status(201).json({ list: publicList(await newList(req.webChatId, req.body.name)) }) } catch (e) { bad(res, 400, 'invalid_list', e.message) }
  }))

  router.patch('/contacts/lists/:id', h(async (req, res) => {
    const name = str(req.body.name, 60)
    if (!name) return bad(res, 400, 'invalid_list', 'Give the list a name.')
    const r = await listsCol(db).updateOne({ _id: String(req.params.id), chatId: req.webChatId }, { $set: { name, updatedAt: new Date() } })
    if (!r.matchedCount) return bad(res, 404, 'not_found', 'List not found.')
    res.json({ ok: true })
  }))

  // Contacts stay saved (in All contacts) when their list is deleted.
  router.delete('/contacts/lists/:id', h(async (req, res) => {
    const id = String(req.params.id), chatId = req.webChatId
    const r = await listsCol(db).deleteOne({ _id: id, chatId })
    if (!r.deletedCount) return bad(res, 404, 'not_found', 'List not found.')
    await contactsCol(db).updateMany({ chatId, listIds: id }, { $pull: { listIds: id } })
    res.json({ deleted: true })
  }))

  // ── upload: parse → check → import ──
  router.post('/contacts/import/parse', upload.single('file'), h(async (req, res) => {
    const chatId = req.webChatId
    const fileName = str(req.file?.originalname || req.body.fileName || 'Pasted list', 120)
    let rows
    try { rows = ci.readTable(req.file ? req.file.buffer : String(req.body.text || ''), fileName) } catch (e) {
      if (!e.code) throw e
      return bad(res, 400, 'unsupported_file', e.message)
    }
    rows = rows.map(r => r.map(c => c.slice(0, 2000)))
    const filled = rows.filter(r => r.some(Boolean)).length
    if (!filled) return bad(res, 400, 'empty_file', 'We couldn’t find anything in that file.')
    if (filled > ci.MAX_ROWS + 1) return bad(res, 400, 'too_many_rows', `Upload up to ${ci.MAX_ROWS.toLocaleString('en-US')} contacts at a time — split the file and upload the rest after.`)
    if (Buffer.byteLength(JSON.stringify(rows)) > MAX_IMPORT_BYTES) return bad(res, 400, 'too_big', 'That file has too much text to import. Remove columns you don’t need, then try again.')
    const det = ci.detectColumns(rows)
    const doc = { _id: crypto.randomUUID(), chatId, fileName, rows, createdAt: new Date() }
    await importsCol(db).insertOne(doc)
    res.status(201).json({ importId: doc._id, fileName, hasHeader: det.hasHeader, columns: det.columns, preview: rows.filter(r => r.some(Boolean)).slice(0, 6), rows: filled, roles: ci.ROLES })
  }))

  async function prepared(req) {
    const imp = await importsCol(db).findOne({ _id: String(req.body.importId || ''), chatId: req.webChatId })
    if (!imp) return { err: [404, 'import_expired', 'This upload has expired. Upload the file again.'] }
    const roles = Array.isArray(req.body.roles) ? req.body.roles.map(String) : []
    if (roles.some(r => !ci.ROLES.includes(r))) return { err: [400, 'invalid_roles', 'Pick what each column holds.'] }
    if (roles.filter(r => r === 'phone').length !== 1) return { err: [400, 'no_phone_column', 'Pick the one column that holds the phone numbers.'] }
    const hasHeader = !!req.body.hasHeader
    const head = imp.rows[0] || []
    const columns = roles.map((role, i) => ({ index: i, role, header: (hasHeader && head[i]) || `Column ${i + 1}` }))
    const { records, invalid, dupes } = ci.toRecords(imp.rows, { hasHeader, columns })
    const existing = records.length ? await contactsCol(db).find({ chatId: req.webChatId, phone: { $in: records.map(r => r.phone) } }).toArray() : []
    return { imp, records, invalid, dupes, existing: new Map(existing.map(c => [c.phone, c])) }
  }

  router.post('/contacts/import/check', h(async (req, res) => {
    const p = await prepared(req)
    if (p.err) return bad(res, ...p.err)
    res.json({
      valid: p.records.length, newCount: p.records.length - p.existing.size, existingCount: p.existing.size, invalid: p.invalid.length, dupesInFile: p.dupes,
      invalidSample: p.invalid.slice(0, 5), existingSample: [...p.existing.values()].slice(0, 5).map(c => ({ phone: c.phone, name: c.name || '' })),
    })
  }))

  router.post('/contacts/import', h(async (req, res) => {
    const chatId = req.webChatId
    const p = await prepared(req)
    if (p.err) return bad(res, ...p.err)
    if (!p.records.length) return bad(res, 400, 'no_contacts', 'No row has a valid phone number. Check the phone column and try again.')
    const duplicates = req.body.duplicates === 'update' ? 'update' : 'skip'
    const fresh = p.records.filter(r => !p.existing.has(r.phone))
    if (await contactsCol(db).countDocuments({ chatId }) + fresh.length > MAX_CONTACTS) return bad(res, 400, 'too_many_contacts', `You can save up to ${MAX_CONTACTS.toLocaleString('en-US')} contacts.`)
    let list
    if (req.body.listId) {
      list = await listsCol(db).findOne({ _id: String(req.body.listId), chatId })
      if (!list) return bad(res, 404, 'not_found', 'List not found.')
    } else {
      try { list = await newList(chatId, req.body.listName || p.imp.fileName.replace(/\.[a-z0-9]+$/i, '')) } catch (e) { return bad(res, 400, 'invalid_list', e.message) }
    }
    const now = new Date()
    const ops = p.records.map(r => {
      const old = p.existing.get(r.phone)
      if (!old) return { insertOne: { document: { _id: crypto.randomUUID(), chatId, phone: r.phone, name: r.name, email: r.email, company: r.company, notes: r.notes, fields: r.fields, listIds: [list._id], source: 'import', createdAt: now, updatedAt: now } } }
      if (duplicates === 'skip') return { updateOne: { filter: { _id: old._id }, update: { $addToSet: { listIds: list._id } } } }
      const set = { updatedAt: now }
      for (const k of ['name', 'email', 'company', 'notes']) if (r[k]) set[k] = r[k]
      if (r.fields.length) {
        const merged = new Map((old.fields || []).map(f => [f.label, f]))
        for (const f of r.fields) merged.set(f.label, f)
        set.fields = [...merged.values()].slice(0, 20)
      }
      return { updateOne: { filter: { _id: old._id }, update: { $set: set, $addToSet: { listIds: list._id } } } }
    })
    let failed = 0
    for (let i = 0; i < ops.length; i += 1000) {
      try { await contactsCol(db).bulkWrite(ops.slice(i, i + 1000), { ordered: false }) } catch (e) { failed += e.writeErrors?.length || e.result?.getWriteErrors?.().length || 0; if (!e.writeErrors && !e.result) throw e }
    }
    await importsCol(db).deleteOne({ _id: p.imp._id })
    const count = await contactsCol(db).countDocuments({ chatId, listIds: list._id })
    res.status(201).json({
      list: publicList(list, count), created: fresh.length - failed, updated: duplicates === 'update' ? p.existing.size : 0,
      skipped: duplicates === 'skip' ? p.existing.size : 0, invalid: p.invalid.length, dupesInFile: p.dupes,
    })
  }))

  // Campaign form: a file → "number,name" lines for the numbers box.
  router.post('/contacts/leads-file', upload.single('file'), h(async (req, res) => {
    if (!req.file) return bad(res, 400, 'no_file', 'Pick a file to upload.')
    const r = require('../bulk-call-service').parseLeadsFile(req.file.buffer, req.file.originalname)
    if (r.binary) return bad(res, 400, 'unsupported_file', r.errors[0])
    const text = r.leads.map(l => (l.name ? `${l.number},${l.name.replace(/[,;"]/g, ' ').trim()}` : l.number)).join('\n')
    res.json({ text, count: r.leads.length, errors: r.errors.slice(0, 20), columns: r.columns })
  }))

  // ── contacts ──
  router.get('/contacts', h(async (req, res) => {
    const chatId = req.webChatId
    const q = { chatId }
    if (req.query.list && req.query.list !== 'all') q.listIds = String(req.query.list)
    const term = str(req.query.q, 60)
    if (term) {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      const digits = term.replace(/\D/g, '')
      q.$or = [{ name: re }, { email: re }, { company: re }, { phone: re }, ...(digits.length >= 3 ? [{ phone: new RegExp(digits) }] : [])]
    }
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0)
    const [list, total] = await Promise.all([
      contactsCol(db).find(q).collation({ locale: 'en', strength: 2 }).sort({ name: 1, phone: 1 }).skip(skip).limit(limit).toArray(),
      contactsCol(db).countDocuments(q),
    ])
    res.json({ contacts: list.map(publicContact), total, skip, limit })
  }))

  router.post('/contacts', h(async (req, res) => {
    const chatId = req.webChatId
    let fields
    try { fields = cleanContact(req.body, false) } catch (e) { return bad(res, 400, 'invalid_contact', e.message) }
    const dupe = await contactsCol(db).findOne({ chatId, phone: fields.phone })
    if (dupe) return res.status(409).json({ error: 'contact_exists', message: `${fields.phone} is already saved as ${dupe.name || 'a contact'}.`, id: dupe._id })
    if (await contactsCol(db).countDocuments({ chatId }) >= MAX_CONTACTS) return bad(res, 400, 'too_many_contacts', `You can save up to ${MAX_CONTACTS.toLocaleString('en-US')} contacts.`)
    const now = new Date()
    const doc = { _id: crypto.randomUUID(), chatId, name: '', email: '', company: '', notes: '', fields: [], ...fields, listIds: await ownLists(chatId, req.body.listIds), source: 'manual', createdAt: now, updatedAt: now }
    await contactsCol(db).insertOne(doc)
    res.status(201).json({ contact: publicContact(doc) })
  }))

  router.get('/contacts/:id', h(async (req, res) => {
    const c = await contactsCol(db).findOne({ _id: String(req.params.id), chatId: req.webChatId })
    if (!c) return bad(res, 404, 'not_found', 'Contact not found.')
    res.json({ contact: publicContact(c) })
  }))

  router.patch('/contacts/:id', h(async (req, res) => {
    const chatId = req.webChatId, id = String(req.params.id)
    let set
    try { set = cleanContact(req.body, true) } catch (e) { return bad(res, 400, 'invalid_contact', e.message) }
    if (req.body.listIds !== undefined) set.listIds = await ownLists(chatId, req.body.listIds)
    if (set.phone) {
      const dupe = await contactsCol(db).findOne({ chatId, phone: set.phone, _id: { $ne: id } })
      if (dupe) return bad(res, 409, 'contact_exists', `${set.phone} is already saved as ${dupe.name || 'another contact'}.`)
    }
    const r = await contactsCol(db).findOneAndUpdate({ _id: id, chatId }, { $set: { ...set, updatedAt: new Date() } }, { returnDocument: 'after' })
    const doc = r && (r.value !== undefined ? r.value : r)
    if (!doc) return bad(res, 404, 'not_found', 'Contact not found.')
    res.json({ contact: publicContact(doc) })
  }))

  router.delete('/contacts/:id', h(async (req, res) => {
    const r = await contactsCol(db).deleteOne({ _id: String(req.params.id), chatId: req.webChatId })
    if (!r.deletedCount) return bad(res, 404, 'not_found', 'Contact not found.')
    res.json({ deleted: true })
  }))
}

module.exports = { routes, listLeads }
