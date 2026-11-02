'use strict'
const { smsTooLong, fitSms } = require('./sms-limit')
// Messages extras: contact notes + tags, scheduled texts, and AI summaries with suggested replies on long conversations.
const axios = require('axios')
const crypto = require('crypto')
const notify = require('./notify')

const LONG = 10
const MAX_TAGS = 10
const key = (chatId, number, contact) => `${chatId}|${number}|${contact}`
const cleanTag = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 24)

async function ai(lines, canText) {
  if (!process.env.APP_OPEN_API_KEY) return null
  try {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_SUMMARY_MODEL || 'gpt-4.1-mini', temperature: 0.3, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You help a small business owner keep up with a conversation with one customer (texts, voicemails, calls). Write in the language the customer uses. Reply as JSON {"summary": "2-3 short sentences: who they are, what they want, what was agreed, what is still open", "replies": [${canText ? '"up to 3 short text replies the owner could send next, under 160 characters each, friendly and specific, ready to send as is: no placeholders or brackets like [link] or [name]"' : ''}]}.` },
        { role: 'user', content: lines.join('\n').slice(-12000) },
      ],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 })
    const j = JSON.parse(r.data.choices[0].message.content)
    return { summary: String(j.summary || '').slice(0, 700), replies: canText ? (Array.isArray(j.replies) ? j.replies : []).map(x => fitSms(String(x))).filter(Boolean).slice(0, 3) : [] }
  } catch (e) { console.log(`[Messages] AI summary failed: ${e.response?.data?.error?.message || e.message}`); return null }
}
const lineOf = (e) => {
  const at = new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')
  if (e.kind === 'text') return `[${at}] ${e.out ? 'Owner' : 'Customer'}: ${e.body || ''}${e.media?.length ? ` (${e.media.length} picture)` : ''}`
  if (e.kind === 'voicemail') return `[${at}] Customer voicemail (${e.duration}s): ${e.transcript || '(no transcript)'}`
  return `[${at}] Call: ${e.type}${e.duration ? ` ${e.duration}s` : ''}`
}

function create({ db, M, log = console.log }) {
  const meta = db.collection('webThreadMeta')
  const sched = db.collection('webScheduledTexts')
  const sums = db.collection('webThreadSummaries')
  meta.createIndex({ chatId: 1, tags: 1 }).catch(() => {})
  sched.createIndex({ status: 1, sendAt: 1 }).catch(() => {})
  const working = new Set()

  async function tagsOf(chatId) { return [...new Set((await meta.find({ chatId: String(chatId) }, { projection: { tags: 1 } }).toArray()).flatMap(m => m.tags || []))].sort() }
  async function metaMap(chatId) { return Object.fromEntries((await meta.find({ chatId: String(chatId) }).toArray()).map(m => [m.contact, m])) }

  async function setMeta(chatId, { contact, notes, tags }) {
    if (!contact) return { error: 'Pick a contact.' }
    const t = [...new Set((Array.isArray(tags) ? tags : []).map(cleanTag).filter(Boolean))].slice(0, MAX_TAGS)
    const doc = { chatId: String(chatId), contact: String(contact), notes: String(notes || '').slice(0, 2000), tags: t, updatedAt: new Date() }
    await meta.updateOne({ _id: `${chatId}|${contact}` }, { $set: doc }, { upsert: true })
    return { notes: doc.notes, tags: t }
  }

  async function schedule(chatId, { number, contact, text, media = [], sendAt }) {
    const at = new Date(sendAt)
    if (!(at > new Date(Date.now() + 30000))) return { error: 'Pick a time at least a minute from now.' }
    if (at > new Date(Date.now() + 90 * 86400000)) return { error: 'Schedule up to 90 days ahead.' }
    const t = await M.thread(chatId, number, contact)
    if (!t) return { error: 'Conversation not found.' }
    if (!t.canText || t.blocked) return { error: 'You can’t text this contact from here.' }
    const body = String(text || '').replace(/\s+/g, ' ').trim()
    if (!body && !media.length) return { error: 'Type a message.' }
    const long = smsTooLong(body)
    if (long) return { error: long }
    if (media.length && !t.number.caps.pictures) return { error: 'This number can’t send pictures.' }
    const ids = media.slice(0, 5).map(String)
    const pics = ids.length ? await db.collection('webMedia').find({ _id: { $in: ids }, chatId: String(chatId), isDeleted: false }).toArray() : []
    if (pics.length !== ids.length) return { error: 'A picture couldn’t be found. Attach it again.' }
    if (pics.reduce((a, p) => a + p.size, 0) > 600 * 1024) return { error: 'Pictures must be under 600 KB in total.' }
    const doc = { _id: 'st_' + crypto.randomBytes(6).toString('hex'), chatId: String(chatId), number, contact, text: body, media: media.slice(0, 5).map(String), sendAt: at, status: 'scheduled', createdAt: new Date() }
    await sched.insertOne(doc)
    return { item: pubSched(doc) }
  }
  const pubSched = (d) => ({ id: d._id, text: d.text, media: (d.media || []).map(id => ({ id })), sendAt: d.sendAt, status: d.status, error: d.error || null })
  async function cancelSched(chatId, id) {
    const r = await sched.updateOne({ _id: String(id), chatId: String(chatId), status: { $in: ['scheduled', 'failed'] } }, { $set: { status: 'cancelled', updatedAt: new Date() } })
    return r.modifiedCount ? { ok: true } : { error: 'That text was already sent or cancelled.' }
  }
  async function runDue() {
    // A send cut off by a restart is not retried (it may have gone out); the owner is told.
    for (const s of await sched.find({ status: 'sending', updatedAt: { $lt: new Date(Date.now() - 5 * 60000) } }).limit(20).toArray()) {
      await sched.updateOne({ _id: s._id }, { $set: { status: 'failed', error: 'We couldn’t confirm this text was sent. Check the conversation before sending it again.', updatedAt: new Date() } })
    }
    for (;;) {
      const d = await sched.findOneAndUpdate({ status: 'scheduled', sendAt: { $lte: new Date() } }, { $set: { status: 'sending', updatedAt: new Date() } }, { returnDocument: 'after' })
      const doc = d && d.value !== undefined ? d.value : d
      if (!doc) return
      const r = await M.send(doc.chatId, { number: doc.number, contact: doc.contact, text: doc.text, media: doc.media }).catch(e => ({ error: [500, 'error', e.message] }))
      if (r.error) {
        await sched.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: r.error[2], updatedAt: new Date() } })
        await notify.push(doc.chatId, `⏰ Your scheduled text to ${doc.contact} wasn’t sent: ${r.error[2]} You weren’t charged.`, null, { kind: 'sms', meta: { scheduled: doc._id, to: doc.contact, from: doc.number } }).catch(() => {})
      } else await sched.updateOne({ _id: doc._id }, { $set: { status: 'sent', sentAt: new Date(), updatedAt: new Date() } })
    }
  }
  const timer = setInterval(() => runDue().catch(e => log(`[Messages] scheduled texts: ${e.message}`)), 20000)
  timer.unref?.()

  // Long conversations get a summary; it refreshes when new items arrive (at most every 2 minutes).
  async function summaryFor(chatId, t) {
    const id = key(chatId, t.number.phone, t.contact)
    const cur = await sums.findOne({ _id: id })
    const real = t.events.filter(e => !String(e.id).startsWith('tmp-'))
    if (real.length < LONG) return null
    const lastAt = new Date(real[real.length - 1].at)
    const fresh = cur?.summary && new Date(cur.upTo) >= lastAt
    const recent = cur && Date.now() - new Date(cur.at || cur.failedAt).getTime() < 120000
    if (!fresh && !recent && !working.has(id)) {
      working.add(id)
      ai(real.slice(-80).map(lineOf), t.canText).then(s => sums.updateOne({ _id: id }, { $set: s ? { chatId: String(chatId), ...s, upTo: lastAt, at: new Date() } : { chatId: String(chatId), failedAt: new Date() } }, { upsert: true }))
        .catch(e => log(`[Messages] summary: ${e.message}`)).finally(() => working.delete(id))
    }
    const busy = working.has(id)
    return cur?.summary ? { summary: cur.summary, replies: cur.replies || [], at: cur.at, updating: busy } : busy ? { summary: null, replies: [], updating: true } : null
  }

  async function decorate(chatId, t) {
    const [m, list, summary, tags] = await Promise.all([
      meta.findOne({ _id: `${chatId}|${t.contact}` }),
      sched.find({ chatId: String(chatId), number: t.number.phone, contact: t.contact, $or: [{ status: 'scheduled' }, { status: 'failed', updatedAt: { $gte: new Date(Date.now() - 3 * 86400000) } }] }).sort({ sendAt: 1 }).limit(20).toArray(),
      summaryFor(chatId, t),
      tagsOf(chatId),
    ])
    return { ...t, notes: m?.notes || '', tags: m?.tags || [], allTags: tags, scheduled: list.map(pubSched), ai: summary }
  }

  return { setMeta, schedule, cancelSched, decorate, tagsOf, metaMap, runDue }
}

function routes(r, { db, h, M, log }) {
  const X = create({ db, M, log })
  const out = (res, x) => (x.error ? res.status(400).json({ error: 'bad_request', message: x.error }) : res.json(x))
  r.put('/messages/contact', h(async (req, res) => out(res, await X.setMeta(req.webChatId, req.body || {}))))
  r.post('/messages/schedule', h(async (req, res) => out(res, await X.schedule(req.webChatId, req.body || {}))))
  r.delete('/messages/schedule/:id', h(async (req, res) => out(res, await X.cancelSched(req.webChatId, req.params.id))))
  return X
}

module.exports = { routes, create, LONG }
