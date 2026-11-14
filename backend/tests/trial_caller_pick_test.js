// Web Quick IVR trial + landing test call use rotated system caller and log systemCallerPicks (dry-run, no real calls)
require('/app/node_modules/dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('/app/node_modules/mongodb')
const jwt = require('/app/node_modules/jsonwebtoken')
const crypto = require('crypto')
const BASE = (require('fs').readFileSync('/app/frontend/.env', 'utf8').match(/REACT_APP_BACKEND_URL=(.*)/) || [])[1].trim()
const API = `${BASE}/api/cloudivr-web`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let COOKIE = ''
const j = async (method, path, body) => { const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(COOKIE ? { Cookie: COOKIE } : {}) }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.getSetCookie?.() || []; if (sc.length) COOKIE = sc.map((c) => c.split(';')[0]).join('; '); let d = null; try { d = await r.json() } catch (_) {} return { s: r.status, d } }

;(async () => {
  const client = await new MongoClient(process.env.MONGO_URL).connect()
  const db = client.db(process.env.DB_NAME)
  const picks = db.collection('systemCallerPicks')
  const since = new Date()
  try {
    // Web Quick IVR trial (Bob, no numbers) — invalid number so trial is NOT consumed
    const lg = await j('POST', '/auth/login', { email: 'civr.bob@example.com', password: 'BobTest#2026' })
    console.log('bob login', lg.s)
    const tok = lg.d?.token
    console.log('trial status', JSON.stringify((await j('GET', '/calls/trial', null, tok)).d))
    const t1 = await j('POST', '/calls/trial', { to: '12' }, tok)
    console.log('trial invalid →', t1.s, t1.d?.error)
    await sleep(800)
    const webPicks = await picks.find({ purpose: 'web_quick_ivr_trial', at: { $gte: since } }).toArray()
    console.log('web_quick_ivr_trial picks after INVALID request:', webPicks.map((p) => `${p.callerId} chat=${p.chatId} to=${p.to}`))

    // Landing test call (dry run)
    const { secret } = require('/app/js/cloudivr-web/auth')
    const trySecret = crypto.createHash('sha256').update(`try:${secret()}`).digest('hex')
    const email = `test_trycall_${Date.now()}@example.com`
    const token = jwt.sign({ email, k: 'try' }, trySecret, { expiresIn: '5m' })
    const c1 = await j('POST', '/public/try/call-me', { token, to: '+14155550123', showAs: '12' })
    console.log('call-me invalid showAs →', c1.s, c1.d?.error)
    const c2 = await j('POST', '/public/try/call-me', { token, to: '+14155550123' })
    console.log('call-me valid →', c2.s, JSON.stringify(c2.d))
    if (c2.d?.id) await db.collection('webTryCalls').deleteOne({ _id: c2.d.id })
    await sleep(800)
    const lp = await picks.find({ purpose: 'landing_test_call', at: { $gte: since } }).toArray()
    console.log('landing_test_call picks:', lp.map((p) => `${p.callerId} to=${p.to}`))
    await db.collection('webTryCalls').deleteMany({ email }).catch(() => {})
  } catch (e) { console.log('ERROR', e) } finally { await client.close(); process.exit(0) }
})()
