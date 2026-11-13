#!/usr/bin/env node
/*
 * Fully automatic Bird caller-ID link + proof, no human needed. Run on the prod app pod (needs the deployed
 * voice-service Bird hooks, BIRD_API_KEY, SignalWire, ARI).
 *  1. Picks two SignalWire numbers we own that no customer uses: X (to verify) and Y (to receive the proof call).
 *  2. Arms X: Bird calls X and reads a code; the app answers, records, transcribes and submits it.
 *  3. Waits for Bird to mark X outbound-enabled.
 *  4. Places a Bird outbound call from X to Y through the Bird trunk, and checks the app saw Y ring with caller ID X.
 *   node scripts/bird_autolink_test.js [--from +1X] [--to +1Y]
 */
'use strict'
const fs = require('fs'), path = require('path'), https = require('https'), crypto = require('crypto')
const ENVF = path.resolve(__dirname, '../backend/.env')
if (fs.existsSync(ENVF)) for (const l of fs.readFileSync(ENVF, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const axios = require('axios')
const { MongoClient } = require('mongodb')
const bird = require('../js/bird')
const rest = require('../js/signalwire/rest')
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const digits = (n) => String(n).replace(/\D/g, '')

;(async () => {
  if (!bird.enabled()) throw new Error('Bird not enabled (BIRD_API_KEY missing)')
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  try {
    await rest.refreshOwned(true)
    const used = new Set()
    for (const d of await db.collection('phoneNumbersOf').find({}, { projection: { 'val.numbers.phoneNumber': 1 } }).toArray()) for (const n of d.val?.numbers || []) used.add(n.phoneNumber)
    for (const d of await db.collection('webTextingNumbers').find({}, { projection: { phoneNumber: 1 } }).toArray().catch(() => [])) used.add(d.phoneNumber)
    for (const d of await db.collection('faxNumbers').find({}, { projection: { _id: 1 } }).toArray().catch(() => [])) used.add(d._id)
    const free = rest.ownedNumbers().filter(n => /^\+1\d{10}$/.test(n) && !used.has(n))
    console.log(`SignalWire numbers owned: ${rest.ownedNumbers().length}, not used by any customer: ${free.length}`)
    const X = arg('--from') || free[0], Y = arg('--to') || free.find(n => n !== X)
    if (!X || !Y) throw new Error('Need two free SignalWire numbers (buy one more, or pass --from/--to)')
    console.log(`Verify X=${X}; proof call lands on Y=${Y}`)
    for (const n of [X, Y]) { const id = (await rest.http().get('/api/relay/rest/phone_numbers', { params: { filter_number: digits(n).slice(1) } })).data.data?.[0]?.id; if (id) await rest.configureNumber(id) }
    console.log('Pointed X and Y at this server')

    const already = (await bird.listCallerIds()).find(v => v.phone_number === X && v.outbound_enabled)
    if (!already) {
      const { createBirdVerify } = require('../js/bird-callerid-verify')
      const V = createBirdVerify({ bird, transcribe: require('../js/voicemail-transcribe').transcribe, db, log: console.log })
      const a = await V.arm(X)
      if (a.error) throw new Error(a.error)
      console.log('Armed. Waiting for Bird to call X and the app to capture the code…')
      let st
      for (let i = 0; i < 36; i++) { // up to 6 min
        await sleep(10000)
        st = await db.collection('birdCallerIdVerify').findOne({ _id: X })
        process.stdout.write(`  ${st?.status} attempts=${st?.attempts || 0}${st?.lastCode ? ` code=${st.lastCode}` : ''}${st?.error ? ` (${st.error})` : ''}\n`)
        if (st?.status === 'verified' || st?.status === 'failed') break
        if (st?.status === 'calling' && st.attempts > 0 && i % 6 === 5) { await V.arm(X); console.log('  asked Bird to call again') }
      }
      if (st?.status !== 'verified') throw new Error(`X not verified (status ${st?.status})`)
    } else console.log('X already verified on Bird.')

    // Proof call: Bird from X → Y. The app logs inbound call.initiated for Y with from=X.
    const since = new Date()
    await db.collection('birdProofWatch').updateOne({ _id: Y }, { $set: { until: new Date(Date.now() + 5 * 60000) } }, { upsert: true })
    const ari = axios.create({ baseURL: `${String(process.env.ASTERISK_ARI_URL).replace(/\/+$/, '')}/ari`, httpsAgent: new https.Agent({ rejectUnauthorized: false }), auth: { username: process.env.ASTERISK_ARI_USER || 'cloudivr', password: process.env.ASTERISK_ARI_PASSWORD }, timeout: 15000 })
    const id = crypto.randomUUID()
    await ari.post(`/channels/${id}`, { variables: {} }, { params: { endpoint: `PJSIP/${digits(Y)}@bird`, app: process.env.ASTERISK_ARI_APP || 'cloudivr', appArgs: 'birdtest', callerId: digits(X), timeout: 30 } })
    console.log(`Bird call placed X→Y (channel ${id}); watching for Y to ring…`)
    let seen = null
    for (let i = 0; i < 12 && !seen; i++) {
      await sleep(5000)
      seen = await db.collection('birdProofCalls').findOne({ to: Y, at: { $gte: since } })
      const ch = await ari.get(`/channels/${id}`).then(r => r.data.state).catch(() => 'gone')
      console.log(`  bird leg: ${ch}${seen ? ` | Y rang, caller ID shown: ${seen.from}` : ''}`)
    }
    await ari.delete(`/channels/${id}`).catch(() => {})
    await db.collection('birdProofWatch').deleteOne({ _id: Y })
    if (!seen) console.log('RESULT: ❌ Y never rang via Bird — check Bird balance/trunk/caller-ID logs')
    else console.log(`RESULT: ${digits(seen.from).endsWith(digits(X).slice(-10)) ? '✅ Bird placed the call showing the SignalWire number' : `⚠️ Y rang but caller ID was ${seen.from}, not ${X}`}`)
  } finally { await cl.close() }
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
