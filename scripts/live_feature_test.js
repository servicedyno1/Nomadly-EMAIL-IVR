#!/usr/bin/env node
// Live feature test on a hidden test account (no customer touched). Run on the prod droplet from the brand release dir:
//   node scripts/live_feature_test.js --env <brand backend.env> --pm2 <pm2 app> setup|voicemail|forward|sip|sipout|cleanup
// Test number Y (SignalWire, ours) gets the features; calls into it are placed through Bird from X; evidence = the app's own logs.
'use strict'
const fs = require('fs'), path = require('path'), https = require('https'), { execSync, spawn } = require('child_process')
const A = process.argv.slice(2), arg = (k) => A[A.indexOf(`--${k}`) + 1]
for (const l of fs.readFileSync(arg('env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const STEP = A[A.length - 1], PM2 = arg('pm2')
const X = process.env.QA_X || '+12074892004', Y = process.env.QA_Y || '+12074891859'
const CHAT = 990000111, SIPU = 'qalive' + (process.env.CHAT_BOT_BRAND || 'x').toLowerCase().replace(/[^a-z]/g, '').slice(0, 6), SIPP = 'QaLive' + require('crypto').createHash('sha1').update(String(process.env.SIP_SERVER_SECRET)).digest('hex').slice(0, 12)
const DOMAIN = process.env.SIP_DOMAIN, SIP_IP = '188.166.34.29'
const { MongoClient } = require(path.join(process.cwd(), 'node_modules/mongodb'))
const axios = require(path.join(process.cwd(), 'node_modules/axios'))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const digits = (n) => String(n).replace(/\D/g, '')
const logsSince = (t) => execSync(`pm2 logs ${PM2} --nostream --lines 1500 2>/dev/null`, { encoding: 'utf8', maxBuffer: 64e6 }).split('\n').filter(l => { const m = l.match(/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)/); return m && new Date(m[1] + 'Z') >= t })
const ari = axios.create({ baseURL: `${String(process.env.ASTERISK_ARI_URL).replace(/\/+$/, '')}/ari`, httpsAgent: new https.Agent({ rejectUnauthorized: false }), auth: { username: process.env.ASTERISK_ARI_USER || 'cloudivr', password: process.env.ASTERISK_ARI_PASSWORD }, timeout: 15000 })
const features = (k) => ({
  voice: true, sms: true, callRecording: false,
  voicemail: { enabled: true, greetingType: 'default', forwardToTelegram: false, ringTimeout: 10 },
  callForwarding: k === 'forward' ? { enabled: true, mode: 'always', forwardTo: X, ringTimeout: 20 } : k === 'sip' ? { enabled: true, mode: 'no_answer', forwardTo: X, ringTimeout: 20 } : { enabled: false },
})
async function setFeatures(db, k) {
  await db.collection('phoneNumbersOf').updateOne({ _id: CHAT }, { $set: { 'val.numbers.0.features': features(k) } })
}
async function birdCall(holdSecs) {
  const id = `qa-${Date.now()}`
  await ari.post(`/channels/${id}`, { variables: {} }, { params: { endpoint: `PJSIP/${digits(Y)}@bird`, context: 'qa-hold', extension: 'hold', priority: 1, callerId: digits(X), timeout: 30 } })
  let up = false
  for (let i = 0; i < holdSecs * 2; i++) { const st = await ari.get(`/channels/${id}`).then(r => r.data.state).catch(() => 'gone'); if (st === 'Up') up = true; if (st === 'gone') break; await sleep(500) }
  await ari.delete(`/channels/${id}`).catch(() => {})
  return up
}
const show = (lines, re) => { const hit = lines.filter(l => re.test(l)); for (const l of hit.slice(-8)) console.log('   │', l.replace(/^\d+\|[^|]+\|\s*/, '').slice(0, 220)); return hit.length > 0 }

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  try {
    if (STEP === 'setup') {
      await db.collection('phoneNumbersOf').updateOne({ _id: CHAT }, { $set: { val: { numbers: [{ phoneNumber: Y, provider: 'signalwire', status: 'active', country: 'US', type: 'local', plan: 'pro', planPrice: 0, expiresAt: new Date(Date.now() + 86400000).toISOString(), autoRenew: false, sipUsername: SIPU, sipPassword: SIPP, telnyxCredentialId: `kam:${SIPU}`, sipDomain: DOMAIN, features: features('voicemail'), qaTest: true }] } } }, { upsert: true })
      await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 5, usdOut: 0, qaTest: true } }, { upsert: true })
      console.log(`setup: test account ${CHAT}, number ${Y}, SIP ${SIPU}@${DOMAIN}`)
    } else if (STEP === 'voicemail' || STEP === 'forward') {
      await setFeatures(db, STEP); await sleep(1500)
      const t = new Date(Date.now() - 1000)
      const up = await birdCall(STEP === 'voicemail' ? 25 : 30)
      await sleep(6000)
      const L = logsSince(t)
      console.log(`${STEP}: Bird call X→Y ${up ? 'ANSWERED' : 'not answered'}`)
      const ok = STEP === 'voicemail' ? show(L, new RegExp(`${digits(Y)}.*(voicemail|greeting|record)|voicemail.*${digits(Y)}`, 'i')) : show(L, new RegExp(`(forward|transfer|dial).*${digits(X)}|to=\\+${digits(X)}`, 'i'))
      console.log(`RESULT ${STEP}: ${up && ok ? '✅' : '❌'}`)
    } else if (STEP === 'sip' || STEP === 'sipout') {
      await setFeatures(db, 'sip'); await sleep(1500)
      const t = new Date(Date.now() - 1000)
      const phone = spawn('python3', [path.join(__dirname, 'sip_softphone_test.py'), SIPU, SIPP, DOMAIN, SIP_IP, STEP === 'sipout' ? digits(X) : '-', '40'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''; phone.stdout.on('data', d => { out += d }); phone.stderr.on('data', d => { out += d })
      await sleep(4000)
      if (STEP === 'sip') birdCall(20).catch(() => {})
      await new Promise(r => phone.on('close', r))
      console.log(out.split('\n').map(l => '   ☎ ' + l).join('\n'))
      const L = logsSince(t)
      show(L, new RegExp(`${SIPU}|sip.*${digits(Y)}|${digits(X)}`, 'i'))
      const ok = STEP === 'sip' ? /incoming=True/.test(out) : /outgoing=answered|OUTGOING → SIP\/2\.0 18[03]/.test(out)
      console.log(`RESULT ${STEP}: ${/REGISTER → SIP\/2\.0 200/.test(out) && ok ? '✅' : '❌'}`)
    } else if (STEP === 'quickivr') {
      // QuickIVR / outbound IVR end-to-end: insert a due scheduled call; the running app places it (Bird first).
      // Caller = Y (verified on Bird), destination = X (ours, which rings back into the app — proves the full path).
      await db.collection('phoneNumbersOf').updateOne({ _id: CHAT }, { $set: { 'val.numbers.0.features': features('voicemail') } })
      const id = 'qa-ivr-' + Date.now(), t = new Date(Date.now() - 1000)
      await db.collection('scheduledCalls').insertOne({ _id: id, chatId: String(CHAT), web: true, scheduledAt: new Date(Date.now() - 2000), createdAt: new Date(), status: 'pending',
        ivrObData: { callerId: Y, callerProvider: 'telnyx', targetNumber: X, greetingText: 'This is an automated test call. Press 1 to continue.', activeKeys: ['1'], ivrMode: 'transfer', templateName: 'QA Test' } })
      console.log(`quickivr: scheduled call ${id} (caller ${Y} → ${X}) — waiting for the app to place it`)
      let st = 'pending'
      for (let i = 0; i < 20 && st !== 'completed' && st !== 'failed' && st !== 'error'; i++) { await sleep(3000); st = (await db.collection('scheduledCalls').findOne({ _id: id }))?.status }
      await sleep(4000)
      const L = logsSince(t)
      console.log(`quickivr: scheduler status = ${st}`)
      show(L, /Scheduler\]|initiateOutboundIvrCall|Bird|CallEngine|outbound.*2074891859|dial .*2074891859|caller/i)
      const placed = L.some(l => /Executing scheduled call|outbound.*2074891859|dial/i.test(l))
      const connected = L.some(l => /answered|gather|speak|bridged|Up/i.test(l) && /207489/.test(l))
      await db.collection('scheduledCalls').deleteOne({ _id: id })
      console.log(`RESULT quickivr: ${st === 'completed' && placed ? '✅ placed' : '❌ (' + st + ')'}${connected ? ' + reached the destination' : ''}`)
    } else if (STEP === 'bulk') {
      // Bulk IVR end-to-end through the real web API: seed a web account + audio, create a 1-lead report-only campaign.
      const jwt = require(path.join(process.cwd(), 'node_modules/jsonwebtoken'))
      const crypto = require('crypto')
      const sec = crypto.createHash('sha256').update(`cloudivr-web:${process.env.WEB_SESSION_SECRET || process.env.SESSION_SECRET}`).digest('hex')
      const AUDIO = process.env.QA_AUDIO_URL || 'https://nomadly-email-ivr-production.up.railway.app/assets/user-audio/tts_1776734280028_alloy.mp3'
      const audioId = 'qa-audio-1'
      await db.collection('webAccounts').updateOne({ _id: CHAT }, { $set: { _id: CHAT, email: 'qa+bulk@cloudivr.net', name: 'QA Bulk', tokenVersion: 0, plan: 'business', createdAt: new Date() } }, { upsert: true })
      await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { webAccount: true, userLanguage: 'en' } }, { upsert: true })
      await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 20, usdOut: 0, qaTest: true } }, { upsert: true })
      await db.collection('phoneNumbersOf').updateOne({ _id: CHAT }, { $set: { 'val.numbers.0.plan': 'business', 'val.numbers.0.features': { voice: true, sms: true, bulkIvr: true } } })
      // Web looks numbers up by STRING chatId — mirror the doc under the string key.
      const numDoc = (await db.collection('phoneNumbersOf').findOne({ _id: CHAT }))?.val
      await db.collection('phoneNumbersOf').updateOne({ _id: String(CHAT) }, { $set: { val: numDoc } }, { upsert: true })
      await db.collection('ivrAudioFiles').updateOne({ id: audioId }, { $set: { id: audioId, chatId: String(CHAT), filename: 'qa.mp3', audioUrl: AUDIO, duration: 8, name: 'QA Audio', createdAt: new Date() } }, { upsert: true })
      const token = jwt.sign({ sub: CHAT, v: 0 }, sec, { expiresIn: '20m' })
      const base = (process.env.SELF_URL || 'https://2.speechcue.com').replace(/\/api$/, '')
      const t = new Date(Date.now() - 1000)
      const r = await axios.post(`${base}/cloudivr-web/campaigns`, { callerId: Y, mode: 'report_only', audioId, leads: `${X},QA Lead`, name: 'QA Bulk Test' }, { headers: { Cookie: `civr_session=${token}`, 'Content-Type': 'application/json' }, validateStatus: () => true })
      console.log(`bulk: create campaign HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`)
      const cid = r.data?.campaign?.id || r.data?.id
      if (cid) { await axios.post(`${base}/cloudivr-web/campaigns/${cid}/start`, {}, { headers: { Cookie: `civr_session=${token}` }, validateStatus: () => true }).then(x => console.log(`bulk: start HTTP ${x.status}`)).catch(() => {}) }
      for (let i = 0; i < 12; i++) { await sleep(3000); const c = await db.collection('bulkCallCampaigns').findOne({ id: cid }); if (c && ['completed', 'running', 'failed'].includes(c.status) && (c.stats?.called || c.leads?.some(l => l.status && l.status !== 'pending'))) break }
      const camp = await db.collection('bulkCallCampaigns').findOne({ id: cid })
      const L = logsSince(t)
      show(L, /BulkCall|CallEngine|Bird|dial.*2074892004|campaign/i)
      const lead0 = camp?.leads?.[0]
      console.log(`bulk: campaign status=${camp?.status} lead=${lead0?.status} provider seen in logs`)
      const placed = L.some(l => /CallEngine voice event|OutboundIVR\] Call initiated.*2074892004|dial.*2074892004/i.test(l))
      await db.collection('bulkCallCampaigns').deleteOne({ id: cid })
      await db.collection('ivrAudioFiles').deleteOne({ id: audioId })
      await db.collection('webAccounts').deleteOne({ _id: CHAT })
      await db.collection('phoneNumbersOf').deleteOne({ _id: String(CHAT) })
      console.log(`RESULT bulk: ${r.status === 201 && cid && placed ? '✅ campaign placed a call (Bird)' : r.status === 201 && cid ? '⚠️ created but no dial seen' : '❌ HTTP ' + r.status}`)
    } else if (STEP === 'cleanup') {
      await db.collection('phoneNumbersOf').deleteOne({ _id: CHAT, 'val.numbers.qaTest': true })
      await db.collection('walletOf').deleteOne({ _id: String(CHAT), qaTest: true })
      console.log('cleanup: test account removed')
    }
  } finally { await cl.close() }
})().catch(e => { console.error('ERR', e.response?.data ? JSON.stringify(e.response.data) : e.message); process.exit(1) })
