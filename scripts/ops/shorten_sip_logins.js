// Switches numbers from Telnyx's long "gencred…" SIP login (49-char user, 32-char password) to a short per-number
// login (10-char user, 12-char password, js/sip-logins.js) and tells each owner their new login.
// Run from a release dir on the droplet (needs that brand's env):
//   node scripts/ops/shorten_sip_logins.js /opt/nomadly/shared/<app>/backend.env                 → dry run, lists numbers
//   node scripts/ops/shorten_sip_logins.js <env> --apply [--only=+1937…] [--no-notify]          → switch + notify
// The old login stops working at once. Restart the app afterwards so it learns the new per-number connections
// (sip-logins.loadKnown runs at startup) — until then outbound SIP calls from the new logins are not recognised.
const envFile = process.argv[2]
if (!envFile) { console.error('Usage: node scripts/ops/shorten_sip_logins.js <envfile> [--apply] [--only=+1…] [--no-notify]'); process.exit(2) }
require('dotenv').config({ path: envFile })
const path = require('path')
const { MongoClient } = require('mongodb')
const axios = require('axios')
const js = (m) => require(path.join(process.cwd(), 'js', m))
const telnyx = js('telnyx-service.js')
const sipLogins = js('sip-logins.js')

const args = process.argv.slice(3)
const APPLY = args.includes('--apply'), NOTIFY = !args.includes('--no-notify')
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
const WEB_BASE = 5e15
const DOMAIN = process.env.SIP_DOMAIN || 'sip.speechcue.com'
const WEB_DOMAIN = process.env.CLOUDIVR_SIP_DOMAIN || 'sip.cloudivr.net'
const TOKEN = process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN

const MSG = {
  en: (n, u, p, d) => `🔑 <b>Your SIP login is now shorter</b>\n\n📱 Number: <code>${n}</code>\n👤 SIP user: <code>${u}</code>\n🔒 SIP password: <code>${p}</code>\n🌐 Server: <code>${d}</code>\n\nYour old long login has stopped working. Enter this user and password in your softphone or PBX to keep making and receiving calls.`,
  fr: (n, u, p, d) => `🔑 <b>Votre identifiant SIP est maintenant plus court</b>\n\n📱 Numéro : <code>${n}</code>\n👤 Utilisateur SIP : <code>${u}</code>\n🔒 Mot de passe SIP : <code>${p}</code>\n🌐 Serveur : <code>${d}</code>\n\nL’ancien identifiant long ne fonctionne plus. Saisissez cet utilisateur et ce mot de passe dans votre softphone ou PBX pour continuer à passer et recevoir des appels.`,
  zh: (n, u, p, d) => `🔑 <b>您的 SIP 登录已缩短</b>\n\n📱 号码：<code>${n}</code>\n👤 SIP 用户名：<code>${u}</code>\n🔒 SIP 密码：<code>${p}</code>\n🌐 服务器：<code>${d}</code>\n\n旧的长登录已停止工作。请在您的软电话或 PBX 中输入新的用户名和密码，以继续拨打和接听电话。`,
  hi: (n, u, p, d) => `🔑 <b>आपका SIP लॉगिन अब छोटा है</b>\n\n📱 नंबर: <code>${n}</code>\n👤 SIP यूज़र: <code>${u}</code>\n🔒 SIP पासवर्ड: <code>${p}</code>\n🌐 सर्वर: <code>${d}</code>\n\nपुराना लंबा लॉगिन अब काम नहीं करता। कॉल करते और पाते रहने के लिए यह यूज़र और पासवर्ड अपने सॉफ्टफ़ोन या PBX में डालें।`,
}

async function langOf(db, chatId) {
  const s = await db.collection('state').findOne({ _id: String(chatId) }).catch(() => null) || await db.collection('state').findOne({ _id: Number(chatId) }).catch(() => null)
  const l = s?.val?.userLanguage || s?.userLanguage
  return MSG[l] ? l : 'en'
}

async function notify(db, chatId, text) {
  if (Number(chatId) >= WEB_BASE) {
    const clean = text.replace(/<[^>]+>/g, '')
    await db.collection('webNotifications').insertOne({ chatId: String(chatId), text: clean, kind: 'info', mediaUrl: null, meta: null, read: false, createdAt: new Date() })
    return 'inbox'
  }
  if (!TOKEN) return 'no-token'
  const r = await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML' }).catch(e => ({ data: { ok: false, description: e.response?.data?.description || e.message } }))
  return r.data?.ok ? 'telegram' : `telegram-failed: ${r.data?.description}`
}

;(async () => {
  const main = process.env.TELNYX_SIP_CONNECTION_ID
  if (!main || !process.env.TELNYX_API_KEY) throw new Error('TELNYX_SIP_CONNECTION_ID / TELNYX_API_KEY missing in the env file')
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const col = db.collection('phoneNumbersOf')
  const docs = await col.find({}, { projection: { 'val.numbers': 1 } }).toArray()
  const todo = []
  for (const d of docs) for (const n of d.val?.numbers || []) {
    if (n.status === 'released' || (ONLY.length && !ONLY.includes(n.phoneNumber))) continue
    const user = n.telnyxSipUsername || n.sipUsername
    if (!user || sipLogins.isShortLogin(user)) continue
    todo.push({ chatId: d._id, n })
  }
  console.log(`${todo.length} number(s) with a long SIP login${APPLY ? '' : ' (dry run — add --apply)'}`)
  const report = []
  for (const { chatId, n } of todo) {
    const row = { chatId: String(chatId), phone: n.phoneNumber, status: n.status, provider: n.provider }
    if (!APPLY) { report.push(row); continue }
    const tc = await telnyx.createShortSipLogin(main, n.phoneNumber)
    if (!tc?.sip_username) { report.push({ ...row, result: 'FAILED — kept the old login' }); continue }
    const set = { sipUsername: tc.sip_username, sipPassword: tc.sip_password, telnyxSipUsername: tc.sip_username, telnyxSipPassword: tc.sip_password, telnyxCredentialId: tc.id, sipShortenedAt: new Date().toISOString() }
    const r = await col.updateOne({ _id: chatId, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`val.numbers.$.${k}`, v])) })
    if (!r.modifiedCount) { await telnyx.deleteSIPCredential(tc.id); report.push({ ...row, result: 'FAILED — number not updated, new login removed' }); continue }
    const oldGone = n.telnyxCredentialId ? await telnyx.deleteSIPCredential(n.telnyxCredentialId) : 'none'
    const web = Number(chatId) >= WEB_BASE
    const sent = NOTIFY ? await notify(db, chatId, MSG[web ? 'en' : await langOf(db, chatId)](n.phoneNumber, tc.sip_username, tc.sip_password, web ? WEB_DOMAIN : DOMAIN)) : 'skipped'
    report.push({ ...row, result: 'OK', user: tc.sip_username, connection: tc.id, oldDeleted: oldGone, notified: sent })
    await new Promise(res => setTimeout(res, 400))
  }
  for (const r of report) console.log(JSON.stringify(r))
  await c.close()
  process.exit(0)
})().catch(e => { console.error('ERROR', e.message); process.exit(1) })
