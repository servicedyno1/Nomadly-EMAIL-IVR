'use strict'
// CloudIVR Messages: one conversation per contact per business number, mixing texts, pictures, voicemails and calls
// from phoneLogs for every number type (calling numbers, CloudIVR eSIM, Landline to Texting).
const ES = require('../spenza.js')
const phoneConfig = require('../phone-config')
const { canMms } = require('./sms-reply')

const TEXTS = ['sms', 'sms_out']
const CALLS = ['missed', 'voicemail', 'forwarded', 'forward_failed', 'off_hours', 'outbound_sip', 'outbound_ivr']
const ALL = [...TEXTS, ...CALLS]
const UNREAD = ['missed', 'voicemail', 'off_hours']
const E164 = /^\+[1-9]\d{7,14}$/
const bad = (res, s, error, message) => res.status(s).json({ error, message })
const OUT = { $or: [{ $eq: ['$type', 'sms_out'] }, { $and: [{ $eq: ['$type', 'sms'] }, { $eq: ['$direction', 'outbound'] }] }] }
const IN_UNREAD = { $or: [{ $in: ['$type', UNREAD] }, { $and: [{ $eq: ['$type', 'sms'] }, { $ne: ['$direction', 'outbound'] }] }] }
const digits = (s) => String(s || '').replace(/\D/g, '')

function create({ db, numbersApi, smsReply }) {
  const logs = db.collection('phoneLogs')
  const reads = db.collection('webThreadReads')
  const blocked = db.collection('webBlocked')
  reads.createIndex({ chatId: 1 }).catch(() => {})

  // Every business number of the account with what it can do.
  async function numbers(chatId) {
    const out = []
    for (const n of await numbersApi.myNumbers(chatId)) {
      const on = n.status === 'active', sms = n.capabilities?.sms !== false, cur = on && !n.replacedBy
      out.push({ phone: n.phoneNumber, kind: 'calling', status: n.status, since: n.purchaseDate || null, caps: { send: cur && sms, receive: sms, pictures: cur && sms && canMms(n), calls: cur }, old: n.replacedBy ? { newNumber: n.replacedBy, until: n.releaseAt } : null })
    }
    for (const d of await db.collection('esimLines').find({ chatId: String(chatId), status: { $in: ['active', 'suspended', 'cancelled'] } }).toArray()) {
      if (d.phoneNumber && d.status !== 'cancelled') out.push({ phone: d.phoneNumber, kind: 'esim', status: d.status, since: d.createdAt, lineId: d._id, caps: { send: d.status === 'active', receive: true, pictures: false, calls: d.callsTo === 'browser' && d.status === 'active' }, old: null })
      for (const f of d.formerNumbers || []) out.push({ phone: f.phone, kind: 'esim', status: 'replaced', since: d.createdAt, lineId: d._id, caps: { send: false, receive: false, pictures: false, calls: false }, old: { newNumber: d.phoneNumber, until: f.until } })
    }
    for (const d of await db.collection('hostedSms').find({ chatId: String(chatId), status: { $nin: ['cancelled', 'rejected', 'failed'] } }).toArray()) {
      if (!out.some(x => x.phone === d.phoneNumber)) out.push({ phone: d.phoneNumber, kind: 'texting', status: d.status, since: d.createdAt, caps: { send: false, receive: d.status === 'active', pictures: false, calls: false }, old: null })
    }
    return out
  }
  const scope = (nums) => ({ $or: nums.map(n => ({ phoneNumber: n.phone, ...(n.since ? { at: { $gte: new Date(n.since) } } : {}) })) })
  const base = (nums) => [
    { $match: { phoneNumber: { $in: nums.map(n => n.phone) }, type: { $in: ALL } } },
    { $addFields: { at: { $toDate: '$timestamp' }, contact: { $cond: [OUT, '$to', '$from'] } } },
    { $match: { ...scope(nums), contact: { $nin: [null, ''] }, $expr: { $ne: ['$contact', '$phoneNumber'] } } },
  ]

  async function threads(chatId, { filter = 'all', q = '' } = {}) {
    const nums = await numbers(chatId)
    if (!nums.length) return { threads: [], numbers: nums, unread: 0 }
    const rows = await logs.aggregate([...base(nums), { $sort: { at: -1 } }, { $group: {
      _id: { b: '$phoneNumber', c: '$contact' }, last: { $first: '$$ROOT' }, lastIn: { $max: { $cond: [IN_UNREAD, '$at', null] } },
      texts: { $sum: { $cond: [{ $in: ['$type', TEXTS] }, 1, 0] } }, vm: { $sum: { $cond: [{ $eq: ['$type', 'voicemail'] }, 1, 0] } }, missed: { $sum: { $cond: [{ $in: ['$type', ['missed', 'off_hours']] }, 1, 0] } },
    } }, { $sort: { 'last.at': -1 } }, { $limit: 500 }]).toArray()
    const [rd, names, blk] = await Promise.all([
      reads.find({ chatId: String(chatId) }).toArray(),
      db.collection('webContacts').find({ chatId, phone: { $in: [...new Set(rows.map(r => r._id.c))] } }, { projection: { phone: 1, name: 1 } }).toArray(),
      blocked.find({ chatId: String(chatId) }).toArray(),
    ])
    const readAt = Object.fromEntries(rd.map(r => [`${r.b}|${r.c}`, r.at]))
    const nameOf = Object.fromEntries(names.map(c => [c.phone, c.name]))
    const blockSet = new Set(blk.map(b => b.contact))
    const byPhone = Object.fromEntries(nums.map(n => [n.phone, n]))
    let list = rows.map(r => ({
      id: `${r._id.b}|${r._id.c}`, number: r._id.b, contact: r._id.c, name: nameOf[r._id.c] || null, blocked: blockSet.has(r._id.c),
      last: preview(r.last), at: r.last.at, unread: !!(r.lastIn && (!readAt[`${r._id.b}|${r._id.c}`] || r.lastIn > readAt[`${r._id.b}|${r._id.c}`])),
      has: { texts: r.texts > 0, voicemail: r.vm > 0, missed: r.missed > 0 }, kind: byPhone[r._id.b]?.kind, old: !!byPhone[r._id.b]?.old,
    }))
    const unread = list.filter(t => t.unread).length
    if (filter === 'unread') list = list.filter(t => t.unread)
    else if (filter === 'texts') list = list.filter(t => t.has.texts)
    else if (filter === 'voicemail') list = list.filter(t => t.has.voicemail)
    else if (filter === 'missed') list = list.filter(t => t.has.missed)
    const s = String(q || '').trim().toLowerCase()
    if (s) {
      const rx = { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
      const hits = new Set((await logs.aggregate([...base(nums), { $match: { $or: [{ body: rx }, { transcript: rx }] } }, { $group: { _id: { b: '$phoneNumber', c: '$contact' } } }, { $limit: 500 }]).toArray()).map(r => `${r._id.b}|${r._id.c}`))
      const d = digits(s)
      list = list.filter(t => hits.has(t.id) || (t.name || '').toLowerCase().includes(s) || (d.length >= 3 && (digits(t.contact).includes(d) || digits(t.number).includes(d))))
    }
    return { threads: list.slice(0, 200), numbers: nums, unread }
  }

  async function unreadCount(chatId) { return (await threads(chatId)).unread }

  async function thread(chatId, number, contact) {
    const nums = await numbers(chatId)
    const biz = nums.find(n => n.phone === number)
    if (!biz) return null
    const rows = await logs.aggregate([...base([biz]), { $match: { contact } }, { $sort: { at: -1 } }, { $limit: 300 }]).toArray()
    const name = (await db.collection('webContacts').findOne({ chatId, phone: contact }, { projection: { name: 1 } }))?.name || null
    const isBlocked = !!(await blocked.findOne({ _id: `${chatId}|${contact}` }))
    // Replies go out from this number; if it can't text (old or receive-only), say which one would.
    const replyFrom = biz.caps.send ? biz.phone : (biz.old && nums.find(n => n.phone === biz.old.newNumber && n.caps.send)?.phone) || null
    return { number: biz, contact, name, blocked: isBlocked, replyFrom, canText: !!replyFrom && !isBlocked && E164.test(contact), events: rows.reverse().map(event), cost: costOf(biz), maxLength: biz.kind === 'esim' ? 1000 : smsReply.MAX }
  }
  const costOf = (n) => (n.kind === 'esim' ? { each: ES.TEXT_PRICE, note: 'wallet' } : { each: phoneConfig.OVERAGE_RATE_SMS, note: 'plan' })

  async function markRead(chatId, number, contact) {
    if (!(await numbers(chatId)).some(n => n.phone === number)) return
    await reads.updateOne({ _id: `${chatId}|${number}|${contact}` }, { $set: { chatId: String(chatId), b: number, c: contact, at: new Date() } }, { upsert: true })
  }

  async function send(chatId, { number, contact, text, media = [] }) {
    const t = await thread(chatId, number, contact)
    if (!t) return { error: [404, 'not_found', 'Conversation not found.'] }
    if (t.blocked) return { error: [400, 'blocked', 'You blocked this contact. Unblock them to text.'] }
    if (!t.replyFrom) return { error: [400, 'receive_only', t.number.kind === 'texting' ? 'This number receives texts only.' : 'This number can’t send texts right now.'] }
    if (!t.canText) return { error: [400, 'invalid_number', 'Enter the number in international format, like +14155550123.'] }
    if (!E164.test(contact)) return { error: [400, 'invalid_number', 'This contact’s number can’t receive texts.'] }
    const from = nums => nums.find(n => n.phone === t.replyFrom)
    const biz = from(await numbers(chatId))
    const ids = (Array.isArray(media) ? media : []).slice(0, 5).map(String)
    const pics = ids.length ? await db.collection('webMedia').find({ _id: { $in: ids }, chatId: String(chatId), isDeleted: false }).toArray() : []
    if (pics.length !== ids.length) return { error: [400, 'bad_media', 'A picture couldn’t be found. Attach it again.'] }
    if (pics.reduce((a, p) => a + p.size, 0) > 600 * 1024) return { error: [400, 'too_big', 'Pictures must be under 600 KB in total.'] }
    if (pics.length && !biz.caps.pictures) return { error: [400, 'no_mms', 'This number can’t send pictures.'] }
    if (biz.kind === 'esim') {
      const r = await ES.sendSms(chatId, biz.lineId, contact, text)
      return r.error ? { error: [r.error.includes('wallet') ? 402 : 400, r.error.includes('wallet') ? 'insufficient_balance' : 'send_failed', r.error] } : { event: event({ ...r.log, at: r.log.timestamp, contact }) }
    }
    const num = await numbersApi.findMine(chatId, biz.phone)
    const r = await smsReply.send({ chatId, num, to: contact, text, media: pics.map(p => ({ id: p._id, type: p.type })) })
    return r.error ? { error: r.error } : { event: event({ ...r.log, at: new Date(r.log.timestamp), contact }), charge: r.charge }
  }

  return { numbers, threads, thread, markRead, send, unreadCount, blocked }
}

function preview(l) {
  if (TEXTS.includes(l.type)) return { type: 'text', out: l.type === 'sms_out' || l.direction === 'outbound', body: l.body || (l.media?.length ? 'Picture' : '') }
  return { type: l.type, out: ['outbound_sip', 'outbound_ivr'].includes(l.type), duration: l.duration || 0 }
}
function event(l) {
  const text = TEXTS.includes(l.type)
  const out = text ? (l.type === 'sms_out' || l.direction === 'outbound') : ['outbound_sip', 'outbound_ivr'].includes(l.type)
  return {
    id: String(l._id || ''), kind: text ? 'text' : l.type === 'voicemail' ? 'voicemail' : 'call', type: l.type, out, at: l.at || l.timestamp,
    ...(text ? { body: l.body || '', media: (l.media || []).map(m => ({ id: m.id, type: m.type })), status: out ? (l.status || 'sent') : null, reason: l.smsReason || null, charge: l.charge || 0 } : { duration: l.duration || 0 }),
    ...(l.type === 'voicemail' ? { recordingUrl: l.recordingUrl || null, transcript: l.transcript || null } : {}),
  }
}

function routes(r, { db, h, numbersApi, smsReply }) {
  const M = create({ db, numbersApi, smsReply })
  const X = require('./messages-extra').routes(r, { db, h, M })
  r.get('/messages', h(async (req, res) => {
    const [d, meta] = await Promise.all([M.threads(req.webChatId, { filter: String(req.query.filter || 'all'), q: String(req.query.q || '').slice(0, 80) }), X.metaMap(req.webChatId)])
    const tag = String(req.query.tag || '')
    let threads = d.threads.map(t => ({ ...t, tags: meta[t.contact]?.tags || [] }))
    const q = String(req.query.q || '').trim().toLowerCase()
    if (q) {
      const extra = Object.values(meta).filter(m => (m.notes || '').toLowerCase().includes(q) || (m.tags || []).some(x => x.toLowerCase().includes(q))).map(m => m.contact)
      if (extra.length) {
        const all = (await M.threads(req.webChatId, { filter: String(req.query.filter || 'all') })).threads.filter(t => extra.includes(t.contact) && !threads.some(x => x.id === t.id))
        threads = [...threads, ...all.map(t => ({ ...t, tags: meta[t.contact]?.tags || [] }))]
      }
    }
    if (tag) threads = threads.filter(t => t.tags.includes(tag))
    res.json({ ...d, threads, allTags: await X.tagsOf(req.webChatId) })
  }))
  r.get('/messages/unread', h(async (req, res) => res.json({ unread: await M.unreadCount(req.webChatId) })))
  r.get('/messages/thread', h(async (req, res) => {
    const t = await M.thread(req.webChatId, String(req.query.number || ''), String(req.query.contact || ''))
    if (!t) return bad(res, 404, 'not_found', 'Conversation not found.')
    res.json(await X.decorate(req.webChatId, t))
  }))
  r.post('/messages/read', h(async (req, res) => { await M.markRead(req.webChatId, String(req.body?.number || ''), String(req.body?.contact || '')); res.json({ ok: true }) }))
  r.post('/messages/send', h(async (req, res) => {
    const x = await M.send(req.webChatId, req.body || {})
    if (x.error) return bad(res, ...x.error)
    await M.markRead(req.webChatId, req.body.number, req.body.contact)
    res.json(x)
  }))
  r.post('/messages/block', h(async (req, res) => {
    const contact = String(req.body?.contact || ''), id = `${req.webChatId}|${contact}`
    if (!contact) return bad(res, 400, 'bad_request', 'Pick a contact.')
    if (req.body?.on === false) await M.blocked.deleteOne({ _id: id })
    else await M.blocked.updateOne({ _id: id }, { $set: { chatId: String(req.webChatId), contact, at: new Date() } }, { upsert: true })
    res.json({ blocked: req.body?.on !== false })
  }))
  return M
}

module.exports = { routes, create, event }
