// Text relay engine in LIVE mode with Telnyx stubbed: dial → answered (intro + transcription_start) → interim/final
// speech → typed speak → keypad → hangup → per-minute billing. Uses a throwaway Mongo database.
// Run: node js/tests/relay_call_engine.test.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'false'
const assert = require('assert')
const axios = require('axios')
const { MongoClient } = require('mongodb')

const sent = []
axios.post = async (url, body) => { sent.push({ url, body }); return { data: { data: url.endsWith('/calls') ? { call_control_id: 'v3:test-ccid' } : { result: 'ok' } } } }

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(`relay_test_${Date.now()}`)
  const walletOf = db.collection('walletOf')
  await walletOf.insertOne({ _id: '42', usdIn: 5, usdOut: 0 })
  const relay = require('../relay-call')
  relay.init({ db, walletOf, selfUrl: 'https://example.test', log: () => {} })
  const ok = (m) => console.log('PASS', m)

  const low = await (async () => { await walletOf.updateOne({ _id: '42' }, { $set: { usdOut: 4.9 } }); const r = await relay.start({ chatId: '42', callerId: '+15550000001', to: '+14155550123', callRate: 0.15 }); await walletOf.updateOne({ _id: '42' }, { $set: { usdOut: 0 } }); return r })()
  assert.strictEqual(low.error[0], 402); ok('low balance → 402')

  const r = await relay.start({ chatId: '42', callerId: '+15550000001', to: '+14155550123', name: 'Maria', lang: 'es', voice: 'male', callRate: 0.15 })
  assert(r.id); const dial = sent.find(x => x.url.endsWith('/calls'))
  assert.strictEqual(dial.body.from, '+15550000001'); assert.strictEqual(dial.body.client_state, Buffer.from('text_relay').toString('base64')); ok('dials with relay client_state')
  assert(relay.owns('v3:test-ccid', {})); assert(relay.owns('other', { client_state: dial.body.client_state })); assert(!relay.owns('other', {})); ok('owns()')
  assert.strictEqual((await relay.start({ chatId: '42', callerId: '+15550000001', to: '+14155550124', callRate: 0.15 })).error[0], 409); ok('one live call per account')
  assert.strictEqual((await relay.say(r.id, '42', 'hola')).error[0], 409); ok('cannot type before answer')

  await relay.onWebhook('call.answered', { call_control_id: 'v3:test-ccid' })
  const intro = sent.find(x => x.url.endsWith('/speak'))
  assert(intro.body.payload.startsWith('Hola. Esta es una llamada escrita de Maria')); assert.strictEqual(intro.body.language, 'es-MX'); assert.strictEqual(intro.body.voice, 'male'); ok('Spanish intro with name + male voice')
  const tr = sent.find(x => x.url.endsWith('/transcription_start'))
  assert.strictEqual(tr.body.transcription_engine, 'Telnyx'); assert.strictEqual(tr.body.transcription_engine_config.language, 'es'); assert.strictEqual(tr.body.transcription_tracks, 'inbound'); ok('transcription_start (Telnyx engine, es, inbound)')

  await relay.onWebhook('call.transcription', { call_control_id: 'v3:test-ccid', transcription_data: { transcript: 'Hola quién', is_final: false } })
  let v = relay.view(await relay.find(r.id, '42'))
  assert.strictEqual(v.interim, 'Hola quién'); assert.strictEqual(v.status, 'live'); ok('interim text shown')
  await relay.onWebhook('call.transcription', { call_control_id: 'v3:test-ccid', transcription_data: { transcript: 'Hola, ¿quién habla?', is_final: true } })
  v = relay.view(await relay.find(r.id, '42'))
  assert.strictEqual(v.interim, ''); assert.deepStrictEqual(v.lines.filter(l => l.who === 'them').map(l => l.text), ['Hola, ¿quién habla?']); ok('final text becomes a line')
  await relay.onWebhook('call.transcription', { call_control_id: 'v3:test-ccid', transcription_data: { transcript: 'sin final', is_final: false } })
  await new Promise(r => setTimeout(r, 2700))
  v = relay.view(await relay.find(r.id, '42'))
  assert.strictEqual(v.interim, ''); assert.deepStrictEqual(v.lines.filter(l => l.who === 'them').map(l => l.text), ['Hola, ¿quién habla?', 'sin final']); ok('unfinalised interim becomes a line after a pause')

  const s1 = await relay.say(r.id, '42', '  Soy   Maria  ')
  assert.strictEqual(s1.line.text, 'Soy Maria'); assert.strictEqual(sent.filter(x => x.url.endsWith('/speak')).pop().body.payload, 'Soy Maria'); ok('typed text spoken (trimmed)')
  assert.strictEqual((await relay.say(r.id, '99', 'x')).error[0], 404); ok('other account cannot type')
  assert.strictEqual((await relay.dtmf(r.id, '42', '1a#')).ok, true); assert.strictEqual(sent.find(x => x.url.endsWith('/send_dtmf')).body.digits, '1#'); ok('keypad sends DTMF')
  assert(await relay.find(r.id, '42') && !(await relay.find(r.id, '99'))); ok('find() is account-scoped')

  const live = await relay.find(r.id, '42'); live.answeredAt = new Date(Date.now() - 125000)
  await relay.onWebhook('call.hangup', { call_control_id: 'v3:test-ccid', hangup_cause: 'normal_clearing' })
  const doc = await db.collection('relayCalls').findOne({ _id: r.id })
  assert.strictEqual(doc.status, 'ended'); assert.strictEqual(doc.outcome, 'completed'); assert.strictEqual(doc.minutes, 3); assert.strictEqual(doc.charge, 0.54); ok('3 started minutes × $0.18 = $0.54')
  assert(doc.expiresAt - doc.createdAt >= 89 * 86400000); ok('kept 90 days')
  const w = await walletOf.findOne({ _id: '42' }); assert(Math.abs(w.usdOut - 0.54) < 1e-9, `usdOut ${w.usdOut}`); ok('wallet charged once')
  await relay.onWebhook('call.hangup', { call_control_id: 'v3:test-ccid' }); assert(Math.abs((await walletOf.findOne({ _id: '42' })).usdOut - 0.54) < 1e-9); ok('duplicate hangup not billed twice')

  // Unanswered call → no charge, outcome busy
  const r2 = await relay.start({ chatId: '42', callerId: '+15550000001', to: '+14155550125', callRate: 0.15 })
  await relay.onWebhook('call.hangup', { call_control_id: 'v3:test-ccid', hangup_cause: 'user_busy' })
  const d2 = await db.collection('relayCalls').findOne({ _id: r2.id }); assert.strictEqual(d2.outcome, 'busy'); assert.strictEqual(d2.charge, 0); ok('busy → no charge')
  assert.strictEqual((await relay.list('42')).length, 2); assert.strictEqual((await relay.remove(r2.id, '42')).ok, true); ok('history list + delete')

  // Restart mid-call: a fresh copy of the module picks the call up from Mongo on the next webhook, then bills it.
  const r3 = await relay.start({ chatId: '42', callerId: '+15550000001', to: '+14155550126', callRate: 0.15 })
  await relay.onWebhook('call.answered', { call_control_id: 'v3:test-ccid' })
  for (const k of Object.keys(require.cache)) if (k.includes('/relay-call/')) delete require.cache[k]
  await new Promise(r => setTimeout(r, 300)) // let the answered write land
  await db.collection('relayCalls').updateOne({ _id: r3.id }, { $set: { answeredAt: new Date(Date.now() - 61000) } })
  const relay2 = require('../relay-call')
  relay2.init({ db, walletOf, selfUrl: 'https://example.test', log: () => {} })
  assert((await relay2.liveFor('42'))?._id === r3.id); ok('after restart the live call is still found (no second call allowed)')
  assert.strictEqual((await relay2.start({ chatId: '42', callerId: '+15550000001', to: '+14155550127', callRate: 0.15 })).error[0], 409); ok('restart: still one live call')
  await relay2.onWebhook('call.transcription', { call_control_id: 'v3:test-ccid', transcription_data: { transcript: 'still here', is_final: true } })
  assert.deepStrictEqual((await relay2.find(r3.id, '42')).lines.filter(l => l.who === 'them').map(l => l.text), ['still here']); ok('restart: transcription keeps flowing')
  assert((await relay2.say(r3.id, '42', 'ok')).line); ok('restart: typing works')
  const before = (await walletOf.findOne({ _id: '42' })).usdOut
  await relay2.onWebhook('call.hangup', { call_control_id: 'v3:test-ccid', hangup_cause: 'normal_clearing' })
  const d3 = await db.collection('relayCalls').findOne({ _id: r3.id })
  assert.strictEqual(d3.status, 'ended'); assert(Math.abs((await walletOf.findOne({ _id: '42' })).usdOut - before - d3.charge) < 1e-9 && d3.charge > 0); ok('restart: hangup billed')

  // Orphan (no heartbeat for minutes): sweep hangs up and bills up to the last sign of life.
  const t0 = Date.now() - 10 * 60000
  await db.collection('relayCalls').insertOne({ _id: 'orphan-1', chatId: '42', callerId: '+15550000001', to: '+14155550128', ccid: 'v3:orphan', status: 'live', lines: [], rate: 0.18, relayRate: 0.03, createdAt: new Date(t0), answeredAt: new Date(t0), beatAt: new Date(t0 + 150000), expiresAt: new Date(Date.now() + 86400000) })
  const b2 = (await walletOf.findOne({ _id: '42' })).usdOut
  await relay2.sweep()
  const o = await db.collection('relayCalls').findOne({ _id: 'orphan-1' })
  assert.strictEqual(o.status, 'ended'); assert.strictEqual(o.minutes, 3); assert(sent.some(x => x.url.includes('/calls/v3:orphan/actions/hangup'))); ok('sweep: stale call hung up, 3 min billed (to last heartbeat)')
  assert(Math.abs((await walletOf.findOne({ _id: '42' })).usdOut - b2 - 0.54) < 1e-9); await relay2.sweep(); assert(Math.abs((await walletOf.findOne({ _id: '42' })).usdOut - b2 - 0.54) < 1e-9); ok('sweep bills once')

  await db.dropDatabase(); await client.close()
  console.log('ALL PASS'); process.exit(0)
})().catch(e => { console.error('FAIL', e); process.exit(1) })
