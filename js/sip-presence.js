'use strict'
// Softphone sign-in state, reported by our SIP server on each REGISTER (GET /sip-registered/:user?e=<expires>),
// and the "your phone isn't signed in" note sent when an incoming call can't ring it (max once per 6 h per number).
const NOTE_EVERY_MS = 6 * 3600000
const WARMUP_MS = 3600000 // phones re-register within the hour; before that "no record" may just mean "not reported yet"
const col = (db) => db.collection('sipPresence')

async function record(db, user, expires, ua, now = new Date()) {
  const e = Math.max(0, Math.min(3600, Number(expires) || 0))
  await col(db).updateOne({ _id: String(user) }, { $set: { until: new Date(now.getTime() + e * 1000), ua: String(ua || '').slice(0, 80), at: now } }, { upsert: true })
  await db.collection('appSettings').updateOne({ _id: 'sipPresenceSince' }, { $setOnInsert: { at: now } }, { upsert: true })
}

// true / false, or null when we can't tell yet (tracking just started).
async function anyOnline(db, users, now = new Date()) {
  const since = await db.collection('appSettings').findOne({ _id: 'sipPresenceSince' })
  if (!since || now - new Date(since.at) < WARMUP_MS) return null
  return !!(await col(db).findOne({ _id: { $in: users.filter(Boolean).map(String) }, until: { $gt: now } }))
}

const loginsOf = (num) => [num.telnyxSipUsername || num.sipUsername, ...(num.extraSip || []).map(x => x.username)]

function offlineText(num, from, web) {
  const where = web ? 'Open the number → SIP tab → Setup QR' : 'Open the number → 🔑 SIP Credentials → 📲 QR Setup'
  return `📵 <b>Your softphone didn't ring</b>\n\n${from} called ${num.phoneNumber}, but no phone app is signed in to this number's SIP login, so it couldn't ring. The call went to your next step (voicemail or forwarding).\n\nOpen your SIP app and check it shows Registered / Online. To set it up again: ${where}.\n\n<i>We send this at most once every 6 hours.</i>`
}

// Call before ringing a softphone. Never blocks the ring.
async function noteIfOffline({ db, bot, chatId, num, from, web, log = console.log, now = new Date() }) {
  if (!db || !bot || !chatId || !num?.phoneNumber) return false
  if ((await anyOnline(db, loginsOf(num), now)) !== false) return false
  const r = await db.collection('sipOfflineNotices').updateOne(
    { _id: num.phoneNumber, at: { $lt: new Date(now - NOTE_EVERY_MS) } }, { $set: { at: now, chatId: String(chatId) } }, { upsert: true },
  ).catch(e => (e.code === 11000 ? null : Promise.reject(e)))
  if (!r || (!r.modifiedCount && !r.upsertedCount)) return false
  await bot.sendMessage(chatId, offlineText(num, from, web), { parse_mode: 'HTML' }).catch(() => {})
  log(`[SipPresence] ${num.phoneNumber}: softphone not signed in — owner notified`)
  return true
}

module.exports = { record, anyOnline, noteIfOffline, offlineText, NOTE_EVERY_MS, WARMUP_MS }
