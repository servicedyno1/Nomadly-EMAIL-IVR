'use strict'
// Softphone sign-in state, reported by our SIP server on each REGISTER (GET /sip-registered/:user?e=<expires>),
// and the "your phone isn't signed in" note sent when an incoming call can't ring it (max once per 6 h per number).
const NOTE_EVERY_MS = 6 * 3600000
const REPORT_EVERY_S = 240 // Kamailio reg=>autoexpire (ops/sip-server/kamailio.cfg)
const WARMUP_MS = 3600000 // phones re-register within the hour; before that "no record" may just mean "not reported yet"
const col = (db) => db.collection('sipPresence')

async function record(db, user, expires, ua, now = new Date()) {
  if (/^(cloudivr-selftest|preflight-check)/i.test(String(ua || ''))) return // our own registration checks are not a customer's phone
  const e = Math.max(0, Math.min(3600, Number(expires) || 0))
  // The SIP server re-reports a registered phone at most every 4 min, so short re-register timers (e.g. Zoiper's 60 s)
  // must stay "signed in" until the next report could arrive — otherwise the phone flaps offline between reports.
  const keep = e > 0 ? Math.max(e, REPORT_EVERY_S + 60) : 0
  await col(db).updateOne({ _id: String(user) }, { $set: { until: new Date(now.getTime() + keep * 1000), at: now, ...(ua ? { ua: String(ua).slice(0, 80) } : {}) } }, { upsert: true })
  await db.collection('appSettings').updateOne({ _id: 'sipPresenceSince' }, { $setOnInsert: { at: now } }, { upsert: true })
  // Remember whose login this is, so a later attempt with it after it was replaced can be explained to its owner.
  try {
    if (!(await col(db).findOne({ _id: String(user), chatId: { $exists: true } }, { projection: { _id: 1 } }))) {
      const o = await ownerOf(db, user)
      if (o) await col(db).updateOne({ _id: String(user) }, { $set: { chatId: o.chatId, phoneNumber: o.num.phoneNumber } })
    }
  } catch (_) { /* owner note is best-effort; presence is already saved */ }
}

// Why a known login could not sign in, as reported by the SIP server (GET /sip-failed/:user?r=password|locked).
const FAIL_FOR_MS = 24 * 3600000
const FAIL_TEXT = {
  password: 'The password in the phone app is wrong. Copy it again from this page, with no spaces.',
  locked: 'Too many wrong passwords from this app, so it is paused for 15 minutes. Then sign in with the password from this page.',
  old_login: (u) => `A phone app is still using an old username (${u}). Replace it with the username and password on this page.`,
}
async function fail(db, user, reason, ua, now = new Date()) {
  if (!['password', 'locked'].includes(reason) || /^(cloudivr-selftest|preflight-check)/i.test(String(ua || ''))) return false
  await col(db).updateOne({ _id: String(user) }, { $set: { failAt: now, failReason: reason, failUa: String(ua || '').slice(0, 80) } }, { upsert: true })
  return true
}
// Newest failure that happened after that login's last good sign-in, within 24 h.
const failureOf = (rows, now) => rows.filter(r => r.failAt && now - new Date(r.failAt) < FAIL_FOR_MS && (!r.at || new Date(r.failAt) > new Date(r.at)))
  .map(r => ({ at: r.failAt, reason: r.failReason, login: r._id, app: r.failUa || null, text: FAIL_TEXT[r.failReason] })).sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null

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

// Live badge for one number: signed in while a device's registration is still running (our SIP server reports every
// REGISTER and sign-out). → { state: 'signed_in'|'signed_out'|'unknown'|'none', devices, lastSeenAt, lastApp }
async function status(db, num, now = new Date()) {
  const users = [...new Set(loginsOf(num).filter(Boolean).map(String))]
  if (!users.length) return { state: 'none', devices: 0, lastSeenAt: null, lastApp: null, checkedAt: now }
  const [rows, since, stale] = await Promise.all([col(db).find({ _id: { $in: users } }).toArray(), db.collection('appSettings').findOne({ _id: 'sipPresenceSince' }),
    db.collection('sipStaleNotices').find({ phoneNumber: num.phoneNumber, at: { $gt: new Date(now - FAIL_FOR_MS) } }).sort({ at: -1 }).limit(1).toArray()])
  const on = rows.filter(r => r.until && new Date(r.until) > now)
  const last = rows.filter(r => r.at).sort((a, b) => new Date(b.at) - new Date(a.at))[0]
  const warm = !since || now - new Date(since.at) < WARMUP_MS
  const state = on.length ? 'signed_in' : !last && warm ? 'unknown' : 'signed_out'
  let lastFailure = failureOf(rows, now)
  const old = stale[0]
  if (old && users.includes(String(old.current)) && (!lastFailure || new Date(old.at) > new Date(lastFailure.at))) lastFailure = { at: old.at, reason: 'old_login', login: old._id, app: null, text: FAIL_TEXT.old_login(old._id) }
  return { state, devices: on.length, lastSeenAt: last?.at || null, lastApp: last?.ua || null, lastFailure, checkedAt: now }
}

// Every active number with a SIP login, for the owner's dashboard: problems first, then signed in, then most recent.
async function overview(db, now = new Date()) {
  const docs = await db.collection('phoneNumbersOf').find({ 'val.numbers': { $elemMatch: { status: 'active', $or: [{ sipUsername: { $exists: true, $ne: null } }, { telnyxSipUsername: { $exists: true, $ne: null } }] } } }, { projection: { 'val.numbers': 1 } }).toArray()
  const nums = docs.flatMap(d => (d.val?.numbers || []).filter(n => n.status === 'active' && loginsOf(n).some(Boolean)).map(n => ({ chatId: d._id, n })))
  const rows = await col(db).find({ _id: { $in: nums.flatMap(x => loginsOf(x.n).filter(Boolean).map(String)) } }).toArray()
  const by = new Map(rows.map(r => [r._id, r]))
  const ids = [...new Set(nums.map(x => x.chatId))].filter(c => /^\d+$/.test(String(c))).map(Number)
  const mail = new Map((await db.collection('webAccounts').find({ _id: { $in: ids } }, { projection: { email: 1 } }).toArray()).map(a => [String(a._id), a.email]))
  const items = nums.map(({ chatId, n }) => {
    const mine = loginsOf(n).filter(Boolean).map(u => by.get(String(u))).filter(Boolean)
    const on = mine.filter(r => r.until && new Date(r.until) > now)
    const last = mine.filter(r => r.at).sort((a, b) => new Date(b.at) - new Date(a.at))[0]
    return { chatId: String(chatId), email: mail.get(String(chatId)) || null, phoneNumber: n.phoneNumber, login: n.telnyxSipUsername || n.sipUsername, logins: loginsOf(n).filter(Boolean).length, state: on.length ? 'signed_in' : 'signed_out', devices: on.length, lastSeenAt: last?.at || null, lastApp: last?.ua || null, lastFailure: failureOf(mine, now) }
  })
  const rank = (i) => (i.lastFailure ? 0 : i.state === 'signed_in' ? 1 : 2)
  items.sort((a, b) => rank(a) - rank(b) || new Date(b.lastFailure?.at || b.lastSeenAt || 0) - new Date(a.lastFailure?.at || a.lastSeenAt || 0))
  return { items: items.slice(0, 500), total: items.length, signedIn: items.filter(i => i.state === 'signed_in').length, failing: items.filter(i => i.lastFailure).length, checkedAt: now }
}

const ST = {
  en: { in: (n, app) => `🟢 <b>Signed in</b> — ${n === 1 ? 'a phone app is' : `${n} phone apps are`} connected right now${app ? ` (${app})` : ''}.`, out: '🔴 <b>Not signed in</b> — no phone app is connected to this login right now.', last: (t) => `Last sign-in: ${t}`, never: 'No app has signed in with this login yet.', unknown: '⚪ <b>Sign-in status</b> — checking, try again in a few minutes.' },
  fr: { in: (n, app) => `🟢 <b>Connecté</b> — ${n === 1 ? 'une application est connectée' : `${n} applications sont connectées`} en ce moment${app ? ` (${app})` : ''}.`, out: '🔴 <b>Non connecté</b> — aucune application n’est connectée à cet identifiant en ce moment.', last: (t) => `Dernière connexion : ${t}`, never: 'Aucune application ne s’est encore connectée avec cet identifiant.', unknown: '⚪ <b>État de connexion</b> — vérification en cours, réessayez dans quelques minutes.' },
  zh: { in: (n, app) => `🟢 <b>已登录</b> — 当前有 ${n} 个电话应用已连接${app ? `（${app}）` : ''}。`, out: '🔴 <b>未登录</b> — 当前没有电话应用连接到此账号。', last: (t) => `上次登录：${t}`, never: '还没有应用用此账号登录过。', unknown: '⚪ <b>登录状态</b> — 正在检查，请几分钟后再试。' },
  hi: { in: (n, app) => `🟢 <b>साइन इन है</b> — अभी ${n} फ़ोन ऐप जुड़े हैं${app ? ` (${app})` : ''}।`, out: '🔴 <b>साइन इन नहीं है</b> — अभी इस लॉगिन से कोई फ़ोन ऐप नहीं जुड़ा है।', last: (t) => `पिछला साइन इन: ${t}`, never: 'इस लॉगिन से अभी तक किसी ऐप ने साइन इन नहीं किया है।', unknown: '⚪ <b>साइन-इन स्थिति</b> — जाँच हो रही है, कुछ मिनट बाद फिर देखें।' },
  fa: { in: (n, app) => `🟢 <b>وارد شده</b> — اکنون ${n} برنامه تلفن متصل است${app ? ` (${app})` : ''}.`, out: '🔴 <b>وارد نشده</b> — اکنون هیچ برنامه تلفنی به این حساب متصل نیست.', last: (t) => `آخرین ورود: ${t}`, never: 'هنوز هیچ برنامه‌ای با این حساب وارد نشده است.', unknown: '⚪ <b>وضعیت ورود</b> — در حال بررسی، چند دقیقه دیگر دوباره ببینید.' },
}
function statusLine(s, lang = 'en') {
  const t = ST[lang] || ST.en
  if (!s || s.state === 'none') return ''
  if (s.state === 'signed_in') return t.in(s.devices, s.lastApp)
  if (s.state === 'unknown') return t.unknown
  return `${t.out}\n${s.lastSeenAt ? t.last(`${new Date(s.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`) : t.never}`
}

module.exports = { status, fail, overview, FAIL_TEXT, statusLine, loginsOf, ownerOf, noteAsk, noteStale, staleText, facts, record, anyOnline, noteIfOffline, offlineText, NOTE_EVERY_MS, WARMUP_MS }
