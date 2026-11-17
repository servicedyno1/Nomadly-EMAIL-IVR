#!/usr/bin/env node
// Live keypad-menu probe. Run ON the prod droplet from the app release dir:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node ivr_live_probe.js --env backend/.env --pm2 <slot> --menu menu.json --number +1... --sms-from <line id> [--only A,B]
// Puts a test menu on ONE number (backed up + always restored), calls it through the Bird trunk from our own caller ID,
// presses keys, records what the caller hears, transcribes it, and prints the app's own log lines for each call.
'use strict'
const fs = require('fs'), path = require('path'), https = require('https'), { execSync } = require('child_process')
const A = process.argv.slice(2), arg = (k, d) => (A.includes(`--${k}`) ? A[A.indexOf(`--${k}`) + 1] : d)
for (const l of fs.readFileSync(arg('env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const { MongoClient } = require(path.join(process.cwd(), 'node_modules/mongodb'))
const axios = require(path.join(process.cwd(), 'node_modules/axios'))
const PM2 = arg('pm2'), Y = arg('number'), X = arg('from', '+18648308599'), TRUNK = arg('trunk', 'bird'), ONLY = arg('only', '').split(',').filter(Boolean)
const sleep = (ms) => new Promise(r => setTimeout(r, ms)), digits = (n) => String(n).replace(/\D/g, '')
const base = String(process.env.ASTERISK_ARI_URL).replace(/\/+$/, ''), auth = { username: process.env.ASTERISK_ARI_USER || 'cloudivr', password: process.env.ASTERISK_ARI_PASSWORD || process.env.ASTERISK_ARI_PASS }
const ari = axios.create({ baseURL: `${base}/ari`, httpsAgent: new https.Agent({ rejectUnauthorized: false }), auth, timeout: 15000, validateStatus: () => true })
const APP = 'qaprobe', INBAND = A.includes('--inband')
const TONE = { 1: '697+1209', 2: '697+1336', 3: '697+1477', 4: '770+1209', 5: '770+1336', 6: '770+1477', 7: '852+1209', 8: '852+1336', 9: '852+1477', '*': '941+1209', 0: '941+1336', '#': '941+1477' }
const logsSince = (t) => execSync(`pm2 logs ${PM2} --nostream --lines 3000 2>/dev/null`, { encoding: 'utf8', maxBuffer: 128e6 }).split('\n').filter(l => { const m = l.match(/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)/); return m && new Date(m[1] + 'Z') >= t })

// name → [seconds to wait, keys to press | null = just listen]
const CALLS = {
  A_deep_menu: [[9, '1'], [7, '1'], [7, '1'], [7, '1'], [9, null]],
  B_webhook: [[9, '2'], [10, null]],
  C_collect: [[9, '3'], [8, '123456#'], [10, null]],
  D_collect_nothing: [[9, '3'], [28, null]],
  E_pin_wrong_then_right: [[9, '4'], [7, '0000#'], [9, '4821#'], [9, null]],
  F_pin_three_wrong: [[9, '4'], [7, '1111#'], [9, '2222#'], [9, '3333#'], [10, null]],
  G_pay_text: [[9, '5'], [12, null]],
  H_wrong_key_then_silence: [[9, '9'], [30, null]],
}

async function transcribe(buf) {
  const fd = new FormData(); fd.append('model', 'whisper-1'); fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'call.wav')
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, body: fd })
  return r.ok ? (await r.json()).text : `transcription failed ${r.status}`
}

async function call(name, steps) {
  const id = `qaprobe-${Date.now()}`, rec = `qaprobe-${name}-${Date.now()}`, t0 = new Date(Date.now() - 1000)
  const o = await ari.post(`/channels/${id}`, {}, { params: { endpoint: `PJSIP/${digits(Y)}@${TRUNK}`, app: APP, callerId: digits(X), timeout: 40 } })
  if (o.status >= 300) return console.log(`\n=== ${name}: originate failed ${o.status} ${JSON.stringify(o.data)}`)
  let up = false
  for (let i = 0; i < 90; i++) { const st = await ari.get(`/channels/${id}`); if (st.status === 404) break; if (st.data.state === 'Up') { up = true; break } await sleep(500) }
  if (!up) { await ari.delete(`/channels/${id}`); return console.log(`\n=== ${name}: NOT ANSWERED`) }
  const tUp = Date.now()
  // record through a snoop channel: recording the call leg itself would queue our key presses behind the recording
  const sn = await ari.post(`/channels/${id}/snoop/${id}-snoop`, {}, { params: { spy: 'in', app: APP } })
  await sleep(300)
  const r = await ari.post(`/channels/${id}-snoop/record`, {}, { params: { name: rec, format: 'wav', maxDurationSeconds: 120, ifExists: 'overwrite', beep: false } })
  if (sn.status >= 300 || r.status >= 300) console.log(`   (recording setup: snoop ${sn.status} record ${r.status} ${JSON.stringify(r.data).slice(0, 120)})`)
  const sent = []
  let ended = false
  for (const [wait, keys] of steps) {
    for (let i = 0; i < wait * 2 && !ended; i++) { await sleep(500); if ((await ari.get(`/channels/${id}`)).status === 404) ended = true }
    if (ended) break
    if (keys && INBAND) { sent.push(`${Math.round((Date.now() - tUp) / 1000)}s:${keys}(tones)`); for (const k of keys) { const pb = await ari.post(`/channels/${id}/play`, {}, { params: { media: `tone:${TONE[k]}/220,0/120` } }); await sleep(260); if (pb.data?.id) await ari.delete(`/playbacks/${pb.data.id}`); await sleep(160) } }
    else if (keys) { const d = await ari.post(`/channels/${id}/dtmf`, {}, { params: { dtmf: keys, between: 250, duration: 160 } }); sent.push(`${Math.round((Date.now() - tUp) / 1000)}s:${keys}${d.status >= 300 ? `(!${d.status})` : ''}`); await sleep(keys.length * 420) }
  }
  const secs = Math.round((Date.now() - tUp) / 1000)
  await ari.post(`/recordings/live/${rec}/stop`); await ari.delete(`/channels/${id}-snoop`)
  if (!ended) await ari.delete(`/channels/${id}`)
  await sleep(2500)
  const f = await ari.get(`/recordings/stored/${rec}/file`, { responseType: 'arraybuffer' })
  const heard = f.status === 200 ? await transcribe(Buffer.from(f.data)) : `no recording (${r.status}/${f.status})`
  await ari.delete(`/recordings/stored/${rec}`)
  await sleep(3500)
  const L = logsSince(t0).filter(l => /\[Voice\].*(DTMF|IVR|ivr|webhook|ollect|PIN|pin|pay|SMS|sms|invalid|sub-menu|gather)|IvrSms|Billed Inbound/i.test(l) && !/PAYLOAD DUMP|Buffer|OutboundIVR|Number owner|Answering call|handleCallAnswered/i.test(l))
  console.log(`\n=== ${name}: answered, ${ended ? 'far end hung up' : 'we hung up'} after ${secs}s · keys sent ${sent.join(' ') || 'none'}`)
  console.log(`   HEARD: ${heard}`)
  for (const l of L.slice(0, 22)) console.log('   │', l.replace(/^\d+\|[^|]+\|\s*/, '').replace(/^\S+T(\d\d:\d\d:\d\d)\S*\s*/, '$1 ').slice(0, 230))
}

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), col = db.collection('phoneNumbersOf')
  const doc = await col.findOne({ 'val.numbers.phoneNumber': Y })
  if (!doc) throw new Error(`number ${Y} not found`)
  const idx = doc.val.numbers.findIndex(n => n.phoneNumber === Y), before = doc.val.numbers[idx].features?.ivr
  const bak = `/root/qaprobe_ivr_backup_${digits(Y)}_${Date.now()}.json`
  fs.writeFileSync(bak, JSON.stringify({ _id: doc._id, idx, ivr: before === undefined ? null : before }))
  const menu = JSON.parse(fs.readFileSync(arg('menu'), 'utf8').replace(/mn_ab01/g, arg('sms-from', 'mn_ab01')))
  menu.enabled = true
  const WS = (() => { try { return require(path.join(process.cwd(), 'node_modules/ws')) } catch (_) { return globalThis.WebSocket } })()
  const ws = new WS(`${base.replace(/^http/, 'ws')}/ari/events?app=${APP}&api_key=${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password)}`, WS === globalThis.WebSocket ? undefined : { rejectUnauthorized: false })
  await new Promise((res, rej) => { const ok = () => res(), no = (e) => rej(new Error(`ARI websocket: ${e.message || e.type}`)); if (ws.on) { ws.on('open', ok); ws.on('error', no) } else { ws.onopen = ok; ws.onerror = no } })
  try {
    await col.updateOne({ _id: doc._id }, { $set: { [`val.numbers.${idx}.features.ivr`]: menu } })
    console.log(`menu set on ${Y} (backup ${bak}); calling from ${X} via ${TRUNK}`)
    await sleep(2000)
    for (const [name, steps] of Object.entries(CALLS)) { if (ONLY.length && !ONLY.some(o => name.startsWith(o))) continue; try { await call(name, steps) } catch (e) { console.log(`\n=== ${name}: probe error ${e.message}`) } await sleep(4000) }
  } finally {
    await col.updateOne({ _id: doc._id }, before === undefined ? { $unset: { [`val.numbers.${idx}.features.ivr`]: '' } } : { $set: { [`val.numbers.${idx}.features.ivr`]: before } })
    const now = (await col.findOne({ _id: doc._id })).val.numbers[idx].features?.ivr
    console.log(`\nRESTORED ${Y}: ivr is ${JSON.stringify(now === undefined ? null : now).slice(0, 80)} (was ${JSON.stringify(before === undefined ? null : before).slice(0, 80)})`)
    try { ws.close() } catch (_) {}
    await cl.close()
  }
  process.exit(0)
})().catch(e => { console.error('PROBE FAILED', e.message); process.exit(1) })
