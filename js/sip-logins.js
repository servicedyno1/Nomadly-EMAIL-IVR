// Short SIP logins (2026-06): instead of Telnyx's ~49-character "gencred…" telephony credentials, each number can get
// its own small credential connection with a 10-character username and a 12-character password, cloned from the main
// SIP connection (same webhook, outbound profile and codecs) with the number itself as the outgoing caller ID.
// Switched on with SIP_SHORT_LOGINS=true; when off (or if Telnyx refuses) the old telephony credential is used.
const crypto = require('crypto')

const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const PREFIX = 'cv'
const pick = (chars, n) => Array.from(crypto.randomBytes(n), b => chars[b % chars.length]).join('')
const shuffle = (s) => s.split('').map(c => [crypto.randomBytes(2).readUInt16BE(0), c]).sort((a, b) => a[0] - b[0]).map(x => x[1]).join('')

// Telnyx: 4–32 letters/digits, a letter within the first 5 → "cv" + 8 (e.g. cvk3x9p2qa).
const shortUser = () => PREFIX + pick(LOWER + DIGITS, 8)
// 12 characters, always upper + lower + digit, no look-alikes (0/O, 1/l/I).
const shortPass = () => shuffle(pick(UPPER, 2) + pick(DIGITS, 3) + pick(LOWER, 2) + pick(LOWER + UPPER + DIGITS, 5))

const enabled = () => String(process.env.SIP_SHORT_LOGINS || '').toLowerCase() === 'true'
const isShortLogin = (v) => /^cv[a-z0-9]{8}$/.test(String(v || '').replace(/^sip:/, '').split('@')[0])
// Credential connection ids are long numbers; telephony credential ids are UUIDs.
const isConnectionId = (id) => /^\d{6,}$/.test(String(id || ''))

const byConnection = new Map() // per-number connection id → SIP username
const remember = (connectionId, username) => { if (isConnectionId(connectionId)) byConnection.set(String(connectionId), username || null) }
const forget = (connectionId) => byConnection.delete(String(connectionId))
const userForConnection = (id) => byConnection.get(String(id || '')) || null
const isSipConnection = (id) => {
  const s = String(id || '')
  return !!s && (s === String(process.env.TELNYX_SIP_CONNECTION_ID || '') || byConnection.has(s))
}

// Startup: learn every per-number connection already handed out, so calls from those softphones are recognised.
async function loadKnown(phoneNumbersOf, log = console.log) {
  try {
    const docs = await phoneNumbersOf.find({ 'val.numbers.telnyxCredentialId': { $regex: '^\\d{6,}$' } }, { projection: { 'val.numbers': 1 } }).toArray()
    for (const d of docs) for (const n of d.val?.numbers || []) if (isConnectionId(n.telnyxCredentialId)) remember(n.telnyxCredentialId, n.telnyxSipUsername)
    if (byConnection.size) log(`[SipLogins] ${byConnection.size} short SIP login(s) loaded`)
  } catch (e) { log(`[SipLogins] load failed: ${e.message}`) }
}

// Every active calling number on a plan with SIP keeps one working login on our own SIP server (served by /sip-auth).
// Missing login → a new one; the shown pair (telnyxSip* first) is kept as is, so logins that work never change.
const brandDomain = (chatId) => (require('./cloudivr-web/notify').isWebChatId(chatId) ? require('./phone-config').WEB_SIP_DOMAIN : require('./phone-config').SIP_DOMAIN)
function repairFields(chatId, n) {
  if (!n || n.status !== 'active' || !process.env.SIP_SERVER_SECRET || n.capabilities?.voice === false) return null
  if (!require('./phone-config').canAccessFeature(n.plan, 'sipCredentials')) return null
  const user = n.telnyxSipUsername || n.sipUsername
  const pass = user && (n.telnyxSipUsername ? n.telnyxSipPassword || n.sipPassword : n.sipPassword)
  const [u, p] = user && pass ? [user, pass] : [shortUser(), shortPass()]
  const want = { telnyxSipUsername: u, telnyxSipPassword: p, telnyxCredentialId: `kam:${u}`, sipDomain: brandDomain(chatId), ...(n.sipDisabled ? { sipDisabled: false } : {}) }
  if (!n.sipUsername || !n.sipPassword || !(user && pass)) Object.assign(want, { sipUsername: u, sipPassword: p })
  const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => n[k] !== v))
  return Object.keys(diff).length ? diff : null
}
async function ensure(col, chatId, n) {
  const diff = repairFields(chatId, n)
  if (!diff) return n
  await col.updateOne({ _id: chatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: Object.fromEntries(Object.entries(diff).map(([k, v]) => [`val.numbers.$.${k}`, v])) })
  return Object.assign(n, diff)
}

// Free-test logins (SIP test page, landing browser call) live on our own SIP server too — /sip-auth reads testCredentials.
const testLogin = () => { if (!process.env.SIP_SERVER_SECRET) return null; const u = shortUser(); return { sipUsername: u, sipPassword: shortPass(), credentialId: `kam:${u}` } }

module.exports = { testLogin, shortUser, shortPass, enabled, isShortLogin, isConnectionId, remember, forget, userForConnection, isSipConnection, loadKnown, repairFields, ensure, brandDomain }
