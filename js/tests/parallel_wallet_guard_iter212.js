// iter212 — Mid-call wallet guard across PARALLEL outbound IVR calls of one owner. SANDBOX MONGO ONLY (127.0.0.1:27999).
//   node js/tests/parallel_wallet_guard_iter212.js
// REAL voice-service; Telnyx API + Telegram stubbed; 60 s wallet-monitor intervals captured and fired by hand.
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'iter212_parallel_sandbox'
process.env.TWILIO_ENABLED = 'false'
delete process.env.SELF_URL; delete process.env.SELF_URL_PROD

const intervals = []
global.setInterval = function (fn, ms) { const h = { _fake: intervals.length }; intervals.push({ fn, ms, h, src: String(fn) }); return h }
const cleared = new Set()
const _ci = global.clearInterval
global.clearInterval = function (h) { cleared.add(h); try { _ci(h) } catch (e) {} }

const { MongoClient } = require('mongodb')
const voice = require('../voice-service.js')
const { translation } = require('../translation.js')

const results = []
const ok = (id, name, pass, detail) => { results.push({ id, pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} — ${detail}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const r2 = (n) => Math.round(n * 100) / 100

let seq = 0
const hangups = []
const telnyxStub = {
  async createOutboundCall() { return { callControlId: `v3:pw-${++seq}` } },
  async isCallAlive() { return true },
  async gatherDTMFWithAudio() { return {} }, async gatherDTMF() { return {} }, async gatherDTMFWithSpeak() { return {} },
  async gatherStop() { return {} }, async speakOnCall() { return {} }, async playbackStart() { return {} }, async playbackStop() { return {} },
  async bridgeCalls() { return {} }, async transferCall() { return {} }, async answerCall() { return {} },
  async hangupCall(id) { hangups.push(id); return {} },
}
const sent = []
const botStub = { sendMessage: async (c, t) => { sent.push({ c: String(c), t: String(t) }); return {} }, sendDocument: async () => ({}) }
const hook = (event_type, payload) => voice.handleVoiceWebhook({ body: { data: { event_type, payload } } }, { sendStatus() {} })
const monitorAt = (idx) => intervals.slice(idx).filter(i => i.src.includes('Mid-call wallet')).slice(-1)[0]

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()
  const walletOf = db.collection('walletOf'), phoneNumbersOf = db.collection('phoneNumbersOf')
  voice.initVoiceService({ bot: botStub, phoneNumbersOf, phoneLogs: db.collection('phoneLogs'), telnyxApi: telnyxStub, walletOf, translation, selfUrl: 'https://sandbox.invalid', state: db.collection('state') })
  const balance = async (c) => { const w = await walletOf.findOne({ _id: c }); return r2((w?.usdIn || 0) - (w?.usdOut || 0)) }

  // Runs N parallel answered calls for one owner, minute by minute; hung-up calls are billed via the hangup webhook.
  async function scenario(tag, chatId, caller, wallet, n, opts = {}) {
    await walletOf.insertOne({ _id: chatId, usdIn: wallet, usdOut: 0 })
    await phoneNumbersOf.insertOne({ _id: chatId, val: { numbers: [{ phoneNumber: caller, status: 'active', plan: 'pro', provider: 'telnyx' }] } })
    const calls = []
    for (let i = 0; i < n; i++) {
      const idx = intervals.length
      const target = `+1415556${String(1000 + i + (opts.base || 0)).slice(-4)}`
      const r = await voice.initiateOutboundIvrCall({ chatId, callerId: caller, targetNumber: target, ivrNumber: opts.leg ? '+14155559999' : null, audioUrl: 'https://cdn.invalid/a.mp3', activeKeys: ['1'], templateName: 't', campaignId: opts.campaignId })
      const id = r.callControlId || Object.keys(voice.outboundIvrCalls).slice(-1)[0]
      await hook('call.initiated', { call_control_id: id, direction: 'outgoing', from: caller, to: target })
      await hook('call.answered', { call_control_id: id })
      calls.push({ id, mon: monitorAt(idx), offset: i * 7000, ended: false, endMin: null })
    }
    if (opts.leg) { // first call has an answered transfer leg too
      const c0 = calls[0]; voice.outboundIvrCalls[c0.id].phase = 'transferring'
      c0.leg = `v3:pwleg-${tag}`
      await hook('call.initiated', { call_control_id: c0.leg, direction: 'outgoing', from: caller, to: '+14155559999' })
      await hook('call.answered', { call_control_id: c0.leg })
    }
    const perMin = 0.15 * (n + (opts.leg ? 1 : 0))
    let msgs = 0
    for (let m = 1; m <= 30 && calls.some(c => !c.ended); m++) {
      for (const c of calls) { // age every live session to minute m (staggered a few seconds apart)
        const s = voice.outboundIvrCalls[c.id]; if (s) s.answerTime = Date.now() - m * 60000 + 1000 + c.offset
        if (c.leg && voice.ivrTransferLegs[c.leg]) voice.ivrTransferLegs[c.leg].answerTime = Date.now() - m * 60000 + 1000 + c.offset
      }
      for (const c of calls) {
        if (c.ended || cleared.has(c.mon.h)) continue
        hangups.length = 0; sent.length = 0
        await c.mon.fn(); await sleep(30)
        msgs += sent.filter(s => s.c === String(chatId)).length
        if (hangups.includes(c.id)) {
          c.ended = true; c.endMin = m
          const dur = m * 60 - 1 - Math.round(c.offset / 1000)
          if (c.leg && hangups.includes(c.leg)) await hook('call.hangup', { call_control_id: c.leg, hangup_cause: 'normal_clearing', duration_secs: dur })
          await hook('call.hangup', { call_control_id: c.id, hangup_cause: 'normal_clearing', duration_secs: dur })
          // campaign legs are billed by bulk-call-service billLead (not wired here) — mimic it: ceil(min) x $0.15
          if (opts.campaignId) await walletOf.updateOne({ _id: chatId }, { $inc: { usdOut: Math.ceil(dur / 60) * 0.15 } })
          await sleep(60)
        }
      }
    }
    const bal = await balance(chatId)
    const reachMin = Math.ceil(wallet / perMin) // minute at which combined cost reaches the balance
    const lastEnd = Math.max(...calls.map(c => c.endMin || 99))
    return { bal, ends: calls.map(c => c.endMin), lastEnd, reachMin, msgs, calls }
  }

  // S1: $1 wallet, 5 parallel answered calls ($0.75/min combined)
  const a = await scenario('A', '9000000701', '+18885550701', 1, 5, { campaignId: 'camp-A' })
  ok('PW-01', '$1 + 5 calls: all 5 hung up', a.ends.every(Boolean), `ends(min)=${a.ends}`)
  ok('PW-02', '$1 + 5 calls: all hung up within ~1 min of combined cost reaching balance', a.lastEnd <= a.reachMin + 1, `lastEnd=${a.lastEnd} reach=${a.reachMin}`)
  ok('PW-03', '$1 + 5 calls: wallet not meaningfully negative', a.bal >= -0.15, `final balance=$${a.bal}`)
  console.log(`   info: wallet-exhausted messages sent = ${a.msgs}`)

  // S1b: same as S1 but multi-number Quick IVR (no campaignId → voice-service bills at hangup)
  const q = await scenario('Q', '9000000706', '+18885550706', 1, 5, { base: 80 })
  ok('PW-01b', 'Quick IVR $1 + 5 calls: all hung up within ~1 min of reach', q.ends.every(Boolean) && q.lastEnd <= q.reachMin + 1, `ends=${q.ends} reach=${q.reachMin}`)
  ok('PW-03b', 'Quick IVR $1 + 5 calls: wallet not meaningfully negative', q.bal >= -0.15, `final=$${q.bal}`)

  // S2: $2 wallet, 5 parallel calls
  const b = await scenario('B', '9000000702', '+18885550702', 2, 5, { base: 10 })
  ok('PW-04', '$2 + 5 calls: all hung up, within ~1 min of reach', b.ends.every(Boolean) && b.lastEnd <= b.reachMin + 1, `ends=${b.ends} reach=${b.reachMin}`)
  ok('PW-05', '$2 + 5 calls: wallet not meaningfully negative', b.bal >= -0.15, `final=$${b.bal}`)

  // S3: $5 wallet, 10 multi-number Quick IVR calls + 1 transfer leg on the first
  const c = await scenario('C', '9000000703', '+18885550703', 5, 10, { base: 30, leg: true })
  ok('PW-06', '$5 + 10 calls + transfer leg: all hung up within ~1 min', c.ends.every(Boolean) && c.lastEnd <= c.reachMin + 1, `ends=${c.ends} reach=${c.reachMin}`)
  ok('PW-07', '$5 + 10 calls + leg: wallet not meaningfully negative', c.bal >= -0.2, `final=$${c.bal}`)

  // S4: other owner's live calls must not count. Owner D $1 with 1 call while owner E has 5 live calls (big wallet).
  await walletOf.insertOne({ _id: '9000000705', usdIn: 100, usdOut: 0 })
  await phoneNumbersOf.insertOne({ _id: '9000000705', val: { numbers: [{ phoneNumber: '+18885550705', status: 'active', plan: 'pro', provider: 'telnyx' }] } })
  for (let i = 0; i < 5; i++) {
    const r = await voice.initiateOutboundIvrCall({ chatId: '9000000705', callerId: '+18885550705', targetNumber: `+1415557${1000 + i}`, audioUrl: 'https://cdn.invalid/a.mp3', activeKeys: ['1'], templateName: 't' })
    const id = r.callControlId || Object.keys(voice.outboundIvrCalls).slice(-1)[0]
    await hook('call.answered', { call_control_id: id })
    voice.outboundIvrCalls[id].answerTime = Date.now() - 10 * 60000
  }
  const d = await scenario('D', '9000000704', '+18885550704', 1, 1, { base: 60 })
  ok('PW-08', 'other owner calls ignored: single $1 call runs ~6 min (not cut at min 1)', d.ends[0] >= 5, `ended at min ${d.ends[0]} final=$${d.bal}`)

  const failed = results.filter(r => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  await db.dropDatabase(); await client.close(); process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(3) })
