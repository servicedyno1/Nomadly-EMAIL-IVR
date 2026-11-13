#!/usr/bin/env node
/*
 * Bird outbound test: verify a number as a Bird caller ID, then place a real outbound call through the
 * Bird SIP trunk (Asterisk ARI on the SIP server) presenting that number, to confirm Bird accepts it.
 *
 * Run ON the prod app pod or the SIP box (where BIRD_API_KEY + ARI are reachable). Reads config from
 * /opt/nomadly/shared/app-main/backend.env unless the env vars are already set.
 *
 *   node bird_outbound_test.js --from +1XXXXXXXXXX --to +1YYYYYYYYYY [--verify] [--code 1234] [--confirm]
 *
 *   --from     caller ID to present (e.g. your SignalWire number)
 *   --to       destination to call (use your own phone)
 *   --verify   start Bird caller-ID verification for --from (Bird calls/texts it a code), then exit
 *   --code     submit this verification code for --from, then exit
 *   --confirm  actually place the billable call (without it, the script only reports readiness)
 */
'use strict'
const fs = require('fs')
const path = require('path')
const https = require('https')
const axios = require('axios')

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : null }
// Load prod env if keys aren't already present.
const ENVF = '/opt/nomadly/shared/app-main/backend.env'
if (!process.env.BIRD_API_KEY && fs.existsSync(ENVF)) {
  for (const line of fs.readFileSync(ENVF, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
const bird = require(path.resolve(__dirname, '../js/bird'))
const FROM = arg('--from'), TO = arg('--to')
const E164 = (p) => `+${String(p || '').replace(/[^\d]/g, '')}`

async function main() {
  console.log(`Bird enabled: ${bird.enabled()} (host ${bird.enabled() ? bird.host() : '—'})`)
  if (!bird.enabled()) return console.log('❌ BIRD_API_KEY not loaded in this environment — load it before testing.')

  if (arg('--verify')) {
    if (!FROM) return console.log('Pass --from +1... to verify.')
    const { createBirdVerify } = require(path.resolve(__dirname, '../js/bird-callerid-verify'))
    const { MongoClient } = require('mongodb')
    const cl = await MongoClient.connect(process.env.MONGO_URL); const db = cl.db(process.env.DB_NAME)
    const V = createBirdVerify({ bird, transcribe: require(path.resolve(__dirname, '../js/voicemail-transcribe')).transcribe, db, log: console.log })
    const a = await V.arm(E164(FROM))
    console.log('Armed:', JSON.stringify(a))
    console.log('→ Bird is now calling', E164(FROM), 'and reading a 6-digit code. If that number has voicemail on and points at this app, the code is captured and submitted automatically. Poll status with --status --from', E164(FROM))
    await cl.close()
    return
  }
  if (arg('--status')) {
    const { MongoClient } = require('mongodb')
    const cl = await MongoClient.connect(process.env.MONGO_URL); const db = cl.db(process.env.DB_NAME)
    console.log('Verification record:', JSON.stringify(await db.collection('birdCallerIdVerify').findOne({ _id: E164(FROM) })))
    await cl.close()
    return
  }
  if (arg('--code')) {
    const list = await bird.listCallerIds().catch(() => [])
    const v = list.find(x => E164(x.phone_number) === E164(FROM))
    if (!v) return console.log('No pending verification for', E164(FROM), '— run --verify first.')
    const r = await bird.submitCallerIdCode(v.id, String(arg('--code')))
    return console.log('Verification result:', JSON.stringify(r))
  }

  // Readiness report
  const verified = (await bird.listCallerIds().catch(() => [])).map(x => ({ n: E164(x.phone_number), status: x.status, outbound: x.outbound_enabled }))
  const dests = (await bird.listDestinations().catch(() => [])).filter(d => d.enabled).map(d => d.country_code)
  const trunk = await bird.ensureTrunk().catch(e => ({ error: e.message }))
  console.log('Verified caller IDs:', JSON.stringify(verified))
  console.log('Enabled destinations:', JSON.stringify(dests))
  console.log('Bird trunk:', trunk?.id ? `ok (${trunk.id})` : JSON.stringify(trunk))
  const fromOk = !FROM || verified.some(v => v.n === E164(FROM) && v.outbound)
  if (FROM && !fromOk) console.log(`⚠️  ${E164(FROM)} is NOT a verified outbound caller ID on Bird yet — run --verify / --code first, or Bird will drop or replace it.`)

  if (!arg('--confirm')) return console.log('\nDry run. Add --confirm --from +1.. --to +1.. to place a real (billable) call.')
  if (!FROM || !TO) return console.log('Need --from and --to to place a call.')

  // Place the call via Asterisk ARI → PJSIP/<to>@bird, caller ID = FROM.
  const url = (process.env.ASTERISK_ARI_URL || '').replace(/\/+$/, '')
  const chId = require('crypto').randomUUID()
  const ari = axios.create({ baseURL: `${url}/ari`, httpsAgent: new https.Agent({ rejectUnauthorized: false }), auth: { username: process.env.ASTERISK_ARI_USER || 'cloudivr', password: process.env.ASTERISK_ARI_PASSWORD }, timeout: 15000 })
  console.log(`\n📞 Originating PJSIP/${E164(TO).replace(/\D/g, '')}@bird  callerId=${E164(FROM).replace(/^\+/, '')} …`)
  try {
    await ari.post(`/channels/${chId}`, { variables: {} }, { params: { endpoint: `PJSIP/${E164(TO).replace(/\D/g, '')}@bird`, app: process.env.ASTERISK_ARI_APP || 'cloudivr', appArgs: 'birdtest', callerId: E164(FROM).replace(/^\+/, ''), timeout: 40 } })
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const ch = await ari.get(`/channels/${chId}`).then(r => r.data).catch(() => null)
      if (!ch) { console.log('Call ended.'); break }
      console.log(`  state: ${ch.state}`)
      if (ch.state === 'Up') { console.log('✅ Answered — Bird placed the call with the caller ID. Hang up now.'); break }
    }
  } catch (e) { console.log('❌ Originate failed:', e.response?.data?.message || e.response?.status || e.message) }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1) })
