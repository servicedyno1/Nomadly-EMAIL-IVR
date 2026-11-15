'use strict'
// Daily growth nudges (one app instance): owners missing calls, auto-renew off before expiry,
// and every Monday a report of badly rated support chats to the admin (Telegram + email).
const axios = require('axios')
const { isWebChatId } = require('./cloudivr-web/notify')
const DAY = 864e5
let db = null, send = () => {}, notifyAdmin = () => {}, log = console.log

const once = async (key) => { try { await db.collection('growthNudges').insertOne({ _id: key, at: new Date() }); return true } catch (e) { if (e.code === 11000) return false; throw e } }
const week = (d = new Date()) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return `${t.getUTCFullYear()}-W${Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7)}` }

async function activeNumbers() {
  const docs = await db.collection('phoneNumbersOf').find({}, { projection: { 'val.numbers': 1 } }).toArray()
  return docs.flatMap(d => (d.val?.numbers || []).filter(n => n.status === 'active').map(n => ({ chatId: String(d._id), n })))
}

// ≥5 missed calls in 7 days and nothing catches them (voicemail, AI receptionist, text-back) → one nudge per 14 days.
async function missedCalls(nums) {
  const since = new Date(Date.now() - 7 * DAY).toISOString()
  const rows = await db.collection('phoneLogs').aggregate([{ $match: { type: 'missed', timestamp: { $gte: since } } }, { $group: { _id: '$phoneNumber', n: { $sum: 1 } } }, { $match: { n: { $gte: 5 } } }]).toArray()
  const by = new Map(rows.map(r => [r._id, r.n]))
  let sent = 0
  for (const { chatId, n } of nums) {
    const missed = by.get(n.phoneNumber), f = n.features || {}
    if (!missed || f.voicemail?.enabled || f.aiAgent?.enabled || f.missedTextBack?.enabled) continue
    if (!(await once(`missed:${n.phoneNumber}:${Math.floor(Date.now() / (14 * DAY))}`))) continue
    const textBack = isWebChatId(chatId) ? '\n• 💬 Missed-call text — texts the caller back (number → Texting)' : ''
    send(chatId, `📵 <b>${n.phoneNumber} missed ${missed} calls this week</b>\n\nThose callers weren’t caught. Turn on one of these so they aren’t lost:\n• 🎙️ Voicemail — callers leave a message\n• 🤖 AI Receptionist — answers, takes messages, books visits${textBack}`)
    sent++
  }
  return sent
}

// ≥2 unanswered forwards in 7 days and no backup number → one nudge per 14 days.
async function forwardFails(nums) {
  const since = new Date(Date.now() - 7 * DAY).toISOString()
  const rows = await db.collection('phoneLogs').aggregate([{ $match: { type: 'forward_failed', timestamp: { $gte: since } } }, { $group: { _id: '$phoneNumber', n: { $sum: 1 } } }, { $match: { n: { $gte: 2 } } }]).toArray()
  const by = new Map(rows.map(r => [r._id, r.n]))
  let sent = 0
  for (const { chatId, n } of nums) {
    const failed = by.get(n.phoneNumber), cf = n.features?.callForwarding
    if (!failed || !cf?.enabled || (cf.backups || []).length) continue
    if (!(await once(`fwdfail:${n.phoneNumber}:${Math.floor(Date.now() / (14 * DAY))}`))) continue
    send(chatId, `📲 <b>${failed} forwarded calls to ${cf.forwardTo} weren’t answered this week</b>\n\nAdd a backup number (up to 4) under Call Forwarding → Backup numbers. When ${cf.forwardTo} doesn’t pick up, the next phone rings instead of losing the caller.`)
    sent++
  }
  return sent
}

// Auto-renew off and the number expires in 4–7 days → one reminder per expiry (the 3-day email follows).
async function renewOff(nums) {
  let sent = 0
  for (const { chatId, n } of nums) {
    if (n.autoRenew !== false || !n.expiresAt) continue
    const left = (new Date(n.expiresAt) - Date.now()) / DAY
    if (left < 3.5 || left > 7) continue
    if (!(await once(`renewoff:${n.phoneNumber}:${String(n.expiresAt).slice(0, 10)}`))) continue
    send(chatId, `⏳ <b>${n.phoneNumber} stops on ${new Date(n.expiresAt).toUTCString().slice(5, 16)}</b>\n\nAuto-renew is off, so the number will be released and callers will hear it’s out of service. Turn auto-renew on (or renew now) to keep it.`)
    sent++
  }
  return sent
}

// Monday: what customers rated "bad" in support chats last week — themes + examples.
async function supportReport() {
  const now = new Date()
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 8) return null
  if (!(await once(`supportreport:${week(now)}`))) return null
  const since = new Date(Date.now() - 7 * DAY)
  const bad = await db.collection('supportRatings').find({ rating: 'bad', createdAt: { $gte: since } }).toArray()
  const good = await db.collection('supportRatings').countDocuments({ rating: 'good', createdAt: { $gte: since } })
  if (!bad.length) { report(`📋 <b>Support report (last 7 days)</b>\n\nNo bad ratings 🎉 (${good} good).`); return 0 }
  const chats = []
  for (const r of bad.slice(0, 40)) {
    const msgs = await db.collection('aiSupportChats').find({ chatId: r.chatId, createdAt: { $lte: r.createdAt, $gte: new Date(new Date(r.createdAt) - DAY) } }).sort({ createdAt: 1 }).limit(12).toArray()
    if (msgs.length) chats.push(`--- chat ${r.chatId}\n${msgs.map(m => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${String(m.content || '').slice(0, 300)}`).join('\n')}`)
  }
  let themes = null
  if (process.env.APP_OPEN_API_KEY && chats.length) {
    try {
      const r = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: process.env.AI_AGENT_SUMMARY_MODEL || 'gpt-4.1-mini', temperature: 0.2,
        messages: [{ role: 'system', content: 'These support chats were rated BAD by customers. In plain English, list the top 3-5 reasons (short bullets, most common first, with how many chats each), then 3 concrete fixes for the product or the support bot. Max 180 words. No markdown headers.' }, { role: 'user', content: chats.join('\n\n').slice(-30000) }],
      }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 60000 })
      themes = r.data.choices[0].message.content.trim()
    } catch (e) { log(`[Growth] support summary failed: ${e.message}`) }
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  report(`📋 <b>Support report (last 7 days)</b>\n\n👎 ${bad.length} bad · 👍 ${good} good\n\n${themes ? esc(themes) : `${chats.length} rated chats found; summary unavailable.`}`)
  return bad.length
}
function report(text) {
  try { notifyAdmin(text) } catch (_) {}
  require('./admin-mail').adminMail(`${process.env.CHAT_BOT_BRAND || 'CloudIVR'} weekly support report`, `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/<\/?b>/g, '')}</pre>`)
}

async function tick() {
  const nums = await activeNumbers()
  const [m, f, r, s] = [await missedCalls(nums), await forwardFails(nums), await renewOff(nums), await supportReport()]
  if (m || f || r || s) log(`[Growth] nudges: missed=${m} forwardFails=${f} renewOff=${r} supportReport=${s ?? '-'}`)
}

function start(opts) {
  ;({ db, send, notifyAdmin, log = console.log } = { ...opts })
  require('./active-slot').singletonInterval('growth-nudges', () => tick().catch(e => log(`[Growth] ${e.message}`)), 3600000)
}

module.exports = { start, tick, missedCalls, forwardFails, renewOff, supportReport, week }
