'use strict'
// Softphone sign-in state, reported by our SIP server on each REGISTER (GET /sip-registered/:user?e=<expires>),
// and the "your phone isn't signed in" note sent when an incoming call can't ring it (max once per 6 h per number).
const NOTE_EVERY_MS = 6 * 3600000
const WARMUP_MS = 3600000 // phones re-register within the hour; before that "no record" may just mean "not reported yet"
const col = (db) => db.collection('sipPresence')

async function record(db, user, expires, ua, now = new Date()) {
  if (/^(cloudivr-selftest|preflight-check)/i.test(String(ua || ''))) return // our own registration checks are not a customer's phone
  const e = Math.max(0, Math.min(3600, Number(expires) || 0))
  await col(db).updateOne({ _id: String(user) }, { $set: { until: new Date(now.getTime() + e * 1000), ua: String(ua || '').slice(0, 80), at: now } }, { upsert: true })
  await db.collection('appSettings').updateOne({ _id: 'sipPresenceSince' }, { $setOnInsert: { at: now } }, { upsert: true })
  // Remember whose login this is, so a later attempt with it after it was replaced can be explained to its owner.
  try {
    if (!(await col(db).findOne({ _id: String(user), chatId: { $exists: true } }, { projection: { _id: 1 } }))) {
      const o = await ownerOf(db, user)
      if (o) await col(db).updateOne({ _id: String(user) }, { $set: { chatId: o.chatId, phoneNumber: o.num.phoneNumber } })
    }
  } catch (_) { /* owner note is best-effort; presence is already saved */ }
}

const hasLogin = (n, u) => n.telnyxSipUsername === u || n.sipUsername === u || (n.extraSip || []).some(e => e.username === u)
async function ownerOf(db, user) {
  const u = String(user)
  const d = await db.collection('phoneNumbersOf').findOne({ $or: [{ 'val.numbers.telnyxSipUsername': u }, { 'val.numbers.sipUsername': u }, { 'val.numbers.extraSip.username': u }] }, { projection: { 'val.numbers': 1 } })
  const num = (d?.val?.numbers || []).find(n => n.status === 'active' && hasLogin(n, u))
  return num ? { chatId: d._id, num } : null
}

// The SIP server asked for this login's password (it does so on each sign-in try, at most every 5 min while it works).
const noteAsk = (db, user, found, now = new Date()) => db.collection('sipAuthAsks').updateOne({ _id: String(user) }, { $set: { at: now, found: !!found }, $inc: { n: 1 } }, { upsert: true }).catch(() => {})

function staleText(old, num, current, web) {
  const where = web ? 'Open the number → SIP tab' : 'Open 📋 My Plans → the number → 🔑 SIP Credentials'
  return `🔑 <b>Your SIP app is using an old login</b>\n\nA phone app just tried to sign in to ${num.phoneNumber} with the username <code>${old}</code>. That login was replaced and no longer works, so the app shows "unauthorized" / "not registered".\n\nCurrent username: <code>${current}</code>\n${where} to copy the current username and password into the app.\n\n<i>We send this at most once every 6 hours.</i>`
}

// An unknown login tried to sign in: if it used to be a customer's login, tell them which login to use now.
async function noteStale({ db, bot, user, web = () => false, log = console.log, now = new Date() }) {
  const p = await col(db).findOne({ _id: String(user) })
  if (!p?.chatId || !bot) return false
  const doc = await db.collection('phoneNumbersOf').findOne({ _id: p.chatId }, { projection: { 'val.numbers': 1 } })
  const num = (doc?.val?.numbers || []).find(n => n.phoneNumber === p.phoneNumber && n.status === 'active')
  const current = num && (num.telnyxSipUsername || num.sipUsername)
  if (!current || current === String(user)) return false
  const r = await db.collection('sipStaleNotices').updateOne(
    { _id: String(user), at: { $lt: new Date(now - NOTE_EVERY_MS) } }, { $set: { at: now, chatId: String(p.chatId), phoneNumber: num.phoneNumber, current } }, { upsert: true },
  ).catch(e => (e.code === 11000 ? null : Promise.reject(e)))
  if (!r || (!r.modifiedCount && !r.upsertedCount)) return false
  await bot.sendMessage(p.chatId, staleText(String(user), num, current, web(p.chatId)), { parse_mode: 'HTML' }).catch(() => {})
  log(`[SipPresence] old login ${user} tried for ${num.phoneNumber} — owner told to use ${current}`)
  return true
}

// Plain facts for the support assistant about one number's SIP login.
async function facts(db, chatId, num, now = new Date()) {
  const user = num.telnyxSipUsername || num.sipUsername
  if (!user) return null
  const ago = (d) => { const m = Math.round((now - new Date(d)) / 60000); return m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago` }
  const [p, a, old] = await Promise.all([col(db).findOne({ _id: user }), db.collection('sipAuthAsks').findOne({ _id: user }), db.collection('sipStaleNotices').find({ chatId: String(chatId), phoneNumber: num.phoneNumber, at: { $gt: new Date(now - 3 * 86400000) } }).toArray()])
  const out = [`SIP username ${user}`]
  if (p?.until && new Date(p.until) > now) out.push(`a phone app is signed in RIGHT NOW (${p.ua || 'unknown app'}) — the login works`)
  else if (p?.at) out.push(`last successful sign-in ${ago(p.at)} (${p.ua || 'unknown app'})`)
  else out.push('no app has ever signed in with it')
  const own = a?.selfAt && Math.abs(new Date(a.selfAt) - new Date(a.at)) < 120000 // that ask was our own self-test
  if (a?.at && !own && (!p?.at || new Date(a.at) - new Date(p.at) > 90000) && now - new Date(a.at) < 86400000) out.push(`an app tried this username ${ago(a.at)} but the sign-in did NOT succeed → the PASSWORD typed in the app is wrong: tell them to tap Reveal Password and copy it again exactly (no spaces), not to reset`)
  else if ((!p?.until || new Date(p.until) <= now) && (!a?.at || own || now - new Date(a.at) > 86400000)) out.push(`no sign-in attempt with this username reached our SIP server in the last 24 h → the app is using a different username or server, or cannot reach the internet: have them check the username is exactly ${user}, the server/domain is exactly the SIP domain, port 5060 UDP, STUN off`)
  for (const o of old) out.push(`an app tried the OLD replaced username ${o._id} ${ago(o.at)} → they must replace it with ${user} and the current password`)
  return out.join('; ')
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

module.exports = { ownerOf, noteAsk, noteStale, staleText, facts, record, anyOnline, noteIfOffline, offlineText, NOTE_EVERY_MS, WARMUP_MS }
