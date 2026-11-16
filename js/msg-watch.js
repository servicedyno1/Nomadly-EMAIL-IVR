'use strict'
// Spam / scam watch for text messages: every outgoing text (single texts, BulkSMS) and every received text is read by
// keyword rules + AI. A caught text alerts the admin on Telegram. Admin switch "hold": off (default) = alert only, the
// text still goes; on = an outgoing text waits for the admin's Approve / Reject. The customer is never told either way.
const crypto = require('crypto')
const scamWatch = require('./scam-watch')

const S = { db: null, bot: null, admin: null, log: console.log, brand: '', ai: null }
const stores = [] // collections holding caught texts (own DB + BulkSMS shared DB)
const actions = {} // type → { approve(action), reject(action) }
const cache = new Map() // text hash → verdict
let holdCache = { at: 0, on: false }
const clean = new Set() // group keys already judged fine

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex')
const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const col = () => S.db.collection('heldMessages')
const KINDS = { phishing: 'Phishing', impersonation: 'Impersonation', fraud: 'Fraud / scam', spam: 'Spam' }
const RULES = [
  [/verify\s+your\s+(account|identity|card|details)|account\s+(has\s+been\s+)?(suspended|locked|restricted|on\s+hold)|unusual\s+(sign|log).?in/i, 'phishing'],
  [/(won|winner|claim)\b.{0,40}\b(prize|gift\s*card|reward|lottery)|guaranteed\s+(income|return|profit)|double\s+your\s+(money|bitcoin|crypto)/i, 'fraud'],
  [/(package|parcel|delivery)\b.{0,40}\b(held|pending|failed|reschedul).{0,60}https?:\/\//i, 'phishing'],
  [/unpaid\s+toll|toll\s+(balance|violation)|final\s+notice.{0,60}https?:\/\//i, 'phishing'],
]

function init({ db, bot, adminChatId, log, brand, ai }) {
  Object.assign(S, { db, bot, admin: adminChatId ? String(adminChatId) : null, log: log || console.log, brand: brand || '', ai: ai === undefined ? defaultAi() : ai })
  if (!stores.includes(col())) stores.unshift(col())
  col().createIndex({ groupKey: 1 }, { sparse: true }).catch(() => {})
  bot?.on?.('callback_query', (q) => onCallback(q).catch(e => S.log(`[MsgWatch] callback: ${e.message}`)))
}
const addStore = (c) => { if (c && !stores.includes(c)) stores.push(c) }
const register = (type, fns) => { actions[type] = fns }

function defaultAi() {
  const key = process.env.OPEN_API_KEY || process.env.APP_OPEN_API_KEY
  if (!key) return null
  const OpenAI = require('openai'); const client = new OpenAI({ apiKey: key, timeout: 8000, maxRetries: 0 })
  return async (text) => {
    const r = await client.chat.completions.create({
      model: 'gpt-4.1-mini', temperature: 0, max_tokens: 80, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You screen SMS text messages for a phone company. Flag only clear abuse: phishing (fake login / payment / delivery / toll links), impersonation of a bank, government body or well-known company, fraud (fake prizes, investment or crypto scams, advance-fee, threats or extortion), or unsolicited bulk spam (gambling, adult, loans, pills, get-rich offers). Normal business texts, appointment reminders, marketing from a named business with opt-out, one-time codes and personal chat are NOT flagged. Reply as JSON: {"flag": true|false, "kind": "phishing"|"impersonation"|"fraud"|"spam"|"", "reason": "max 12 words"}.' },
        { role: 'user', content: String(text).slice(0, 1200) },
      ],
    })
    return JSON.parse(r.choices[0].message.content || '{}')
  }
}

// → { flagged, kind, reason, by }
async function verdict(text) {
  const body = String(text || '').trim()
  if (body.length < 8) return { flagged: false }
  const k = sha(body.toLowerCase().replace(/\s+/g, ' '))
  if (cache.has(k)) return cache.get(k)
  let v = { flagged: false }
  const rule = RULES.find(([re]) => re.test(body))
  const terms = scamWatch.scan([body])
  if (S.ai) {
    try { const a = await S.ai(body); if (a?.flag) v = { flagged: true, kind: KINDS[a.kind] ? a.kind : 'spam', reason: String(a.reason || '').slice(0, 120), by: 'AI' } } catch (e) { S.log(`[MsgWatch] AI check failed (${e.message}) — rules only`); v = null }
  }
  // Rules decide alone only when AI is unavailable; with AI they just add the matched name to the alert.
  if (!S.ai || v === null) v = rule ? { flagged: true, kind: rule[1], reason: 'matches a known scam pattern', by: 'rules' } : terms.length && /https?:\/\/|\bcall\b|\bverify\b|\bclick\b/i.test(body) ? { flagged: true, kind: 'impersonation', reason: `mentions ${terms[0].term}`, by: 'rules' } : { flagged: false }
  if (v.flagged && terms.length) v.terms = terms.slice(0, 3).map(t => t.term)
  if (cache.size > 5000) cache.delete(cache.keys().next().value)
  cache.set(k, v)
  return v
}

async function holdOn() {
  if (Date.now() - holdCache.at < 15000) return holdCache.on
  const d = await S.db.collection('adminSettings').findOne({ _id: 'msgWatch' }).catch(() => null)
  holdCache = { at: Date.now(), on: d?.hold === true }
  return holdCache.on
}
async function setHold(on, by) {
  await S.db.collection('adminSettings').updateOne({ _id: 'msgWatch' }, { $set: { hold: !!on, updatedAt: new Date(), updatedBy: by || null } }, { upsert: true })
  holdCache = { at: Date.now(), on: !!on }
  return status()
}
async function status() {
  const [held, caught] = await Promise.all([col().countDocuments({ status: 'held' }), col().countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 864e5) } })])
  return { hold: await holdOn(), held, caught7d: caught, ai: !!S.ai }
}

function alertText(d) {
  const dir = d.direction === 'in' ? 'received' : 'outgoing'
  const state = { held: '⏸ <b>Held — waiting for your decision.</b>', alerted: '<i>Alert only — the text was sent.</i>', inbound: '<i>Alert only — the text was delivered to the customer.</i>', approved: '✅ <b>Approved — sent.</b>', rejected: '🚫 <b>Rejected — not sent.</b>' }[d.status]
  return `🚩 <b>Suspicious ${dir} text</b>${S.brand ? ` · ${esc(S.brand)}` : ''}\n👤 ${esc(d.who || d.chatId)} (${esc(d.chatId)})\n📍 ${esc(d.where)}${d.from ? `\n📤 ${esc(d.from)} → ${esc(d.to || 'many')}` : ''}\n🧠 <b>${KINDS[d.kind] || 'Spam'}</b>${d.reason ? ` — ${esc(d.reason)}` : ''}${d.terms?.length ? ` (${esc(d.terms.join(', '))})` : ''}\n\n“${esc(String(d.text).slice(0, 600))}”\n\n${state}`
}
const buttons = (id) => ({ inline_keyboard: [[{ text: '✅ Approve & send', callback_data: `mw:a:${id}` }, { text: '🚫 Reject', callback_data: `mw:r:${id}` }]] })
async function alertAdmin(d) {
  if (!S.bot || !S.admin) return
  await S.bot.sendMessage(S.admin, alertText(d), { parse_mode: 'HTML', ...(d.status === 'held' ? { reply_markup: buttons(d._id) } : {}) }).catch(e => S.log(`[MsgWatch] alert failed: ${e.message}`))
}

// Outgoing text about to leave. → { act: 'send' | 'hold' | 'reject', id }
// groupKey: one decision for many texts (a BulkSMS campaign). store: where the record lives (BulkSMS shared DB).
async function gate({ chatId, who, where, from, to, text, groupKey, store }) {
  try {
    if (!S.db) return { act: 'send' }
    const c = store || col()
    if (groupKey) {
      const prev = await c.findOne({ groupKey })
      if (prev) return { act: prev.status === 'held' ? 'hold' : prev.status === 'rejected' ? 'reject' : 'send', id: prev._id }
    }
    if (groupKey && clean.has(groupKey)) return { act: 'send' }
    const v = await verdict(text)
    if (!v.flagged) { if (groupKey) { if (clean.size > 5000) clean.clear(); clean.add(groupKey) } return { act: 'send' } }
    const hold = await holdOn()
    const d = { _id: crypto.randomBytes(8).toString('hex'), ...(groupKey ? { groupKey } : {}), direction: 'out', status: hold ? 'held' : 'alerted', chatId: String(chatId), who: who || null, where, from: from || null, to: groupKey ? null : to || null, text: String(text).slice(0, 2000), kind: v.kind, reason: v.reason, by: v.by, terms: v.terms || [], brand: S.brand, createdAt: new Date() }
    if (groupKey) {
      const r = await c.updateOne({ groupKey }, { $setOnInsert: d }, { upsert: true })
      if (!r.upsertedCount) { const p = await c.findOne({ groupKey }); return { act: p.status === 'held' ? 'hold' : p.status === 'rejected' ? 'reject' : 'send', id: p._id } }
    } else await c.insertOne(d)
    S.log(`[MsgWatch] ${d.status} ${where} ${chatId}: ${v.kind} (${v.reason || ''})`)
    await alertAdmin(d)
    return { act: hold ? 'hold' : 'send', id: d._id }
  } catch (e) { S.log(`[MsgWatch] gate error (${e.message}) — letting the text through`); return { act: 'send' } }
}
// What to do when the admin decides on a held single text (how to really send it / give the charge back).
const attach = (id, action) => col().updateOne({ _id: id }, { $set: { action } }).catch(() => {})

// Received text: alert only, once per sender + text per day.
async function inbound({ chatId, who, where, from, to, text, id }) {
  try {
    const v = await verdict(text)
    if (!v.flagged) return false
    const d = { _id: sha(`in|${from}|${to}|${text}|${new Date().toISOString().slice(0, 10)}`).slice(0, 16), direction: 'in', status: 'inbound', chatId: String(chatId), who: who || null, where, from, to, text: String(text).slice(0, 2000), kind: v.kind, reason: v.reason, by: v.by, terms: v.terms || [], brand: S.brand, logId: id || null, createdAt: new Date() }
    const r = await col().updateOne({ _id: d._id }, { $setOnInsert: d }, { upsert: true })
    if (r.upsertedCount) await alertAdmin(d)
    return true
  } catch (e) { S.log(`[MsgWatch] inbound error: ${e.message}`); return false }
}
// Every received text lands in phoneLogs whichever carrier it came through — read new ones from there.
let lastId = null
async function inboundTick() {
  const { ObjectId } = require('mongodb')
  lastId ||= ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 120)
  const rows = await S.db.collection('phoneLogs').find({ _id: { $gt: lastId }, direction: 'inbound', type: { $in: ['sms', 'sms_in', 'mms'] } }).sort({ _id: 1 }).limit(50).toArray()
  for (const l of rows) {
    lastId = l._id
    if (!l.body || !(await S.db.collection('phoneLogs').updateOne({ _id: l._id, mwSeen: { $ne: true } }, { $set: { mwSeen: true } })).modifiedCount) continue
    await inbound({ chatId: l.chatId, where: `Text received on ${l.phoneNumber || l.to}`, from: l.from, to: l.phoneNumber || l.to, text: l.body, id: String(l._id) })
  }
  return rows.length
}

async function decide(id, approve, by) {
  for (const c of stores) {
    const r = await c.findOneAndUpdate({ _id: id, status: 'held' }, { $set: { status: approve ? 'approved' : 'rejected', decidedAt: new Date(), decidedBy: by || null } }, { returnDocument: 'after' })
    const d = r?.value !== undefined ? r.value : r
    if (!d) continue
    const fn = d.action && actions[d.action.type]?.[approve ? 'approve' : 'reject']
    if (fn) { try { await fn(d.action, d) } catch (e) { S.log(`[MsgWatch] ${approve ? 'approve' : 'reject'} ${id}: ${e.message}`); await c.updateOne({ _id: id }, { $set: { actionError: e.message } }) } }
    S.log(`[MsgWatch] ${id} ${d.status} by ${by}`)
    return d
  }
  return null
}
const find = async (id) => { for (const c of stores) { const d = await c.findOne({ _id: id }); if (d) return d } return null }

async function onCallback(q) {
  const m = /^mw:([ar]):([0-9a-f]{16})$/.exec(q?.data || ''); if (!m) return
  const ack = (text, alert) => S.bot.answerCallbackQuery(q.id, { text, show_alert: !!alert }).catch(() => {})
  if (String(q.from?.id) !== S.admin) return ack('⛔ Admin only.', true)
  const d = await decide(m[2], m[1] === 'a', String(q.from.id)) || await find(m[2])
  if (!d) return ack('This alert is no longer available.', true)
  await ack(d.status === 'approved' ? 'Approved — sending.' : d.status === 'rejected' ? 'Rejected — not sent.' : 'Already handled.')
  if (q.message) await S.bot.editMessageText(alertText(d), { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML' }).catch(() => {})
}

// Admin bot command: /spamhold [on|off]
async function command(text) {
  const m = /^\/spamhold(?:\s+(on|off))?\s*$/i.exec(String(text || '')); if (!m) return null
  const s = m[1] ? await setHold(m[1].toLowerCase() === 'on', 'bot') : await status()
  return `🚩 <b>Spam text watch</b>\nCaught texts: <b>${s.hold ? 'held for your decision' : 'sent, alert only'}</b>\nWaiting now: ${s.held} · caught in 7 days: ${s.caught7d}\n\n/spamhold on — hold caught texts until you approve\n/spamhold off — let them through and just alert`
}

module.exports = { init, addStore, register, verdict, gate, attach, inbound, inboundTick, decide, holdOn, setHold, status, command, onCallback, alertText, _S: S, _cache: cache, _reset: () => { cache.clear(); clean.clear(); holdCache = { at: 0, on: false }; lastId = null } }
