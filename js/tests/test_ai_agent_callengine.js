'use strict'
// AI agent calls on our call engine: RTP media framing, SIP-leg handover, Bird-only outbound dialing.
const assert = require('assert')
const dgram = require('dgram')
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, e.message) } }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

process.env.AI_RTP_PORT = '41999'
process.env.AI_RTP_HOST = '127.0.0.1'
const rtp = require('../ai-agent/rtp')

;(async () => {
  await ok('payloadOf strips header, CSRCs and extension; ignores DTMF', async () => {
    const h = Buffer.from([0x80, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1])
    assert.deepStrictEqual(rtp.payloadOf(Buffer.concat([h, Buffer.from([1, 2, 3])])), Buffer.from([1, 2, 3]))
    const ext = Buffer.from([0x91, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 9, 9, 9, 9, 0xbe, 0xde, 0, 1, 7, 7, 7, 7, 5])
    assert.deepStrictEqual(rtp.payloadOf(ext), Buffer.from([5]))
    assert.strictEqual(rtp.payloadOf(Buffer.from([0x80, 101, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1])), null)
  })

  // Fake Asterisk side: sends one RTP packet so the media learns where to reply, then counts the frames it gets back.
  const ast = dgram.createSocket('udp4')
  await new Promise(r => ast.bind(0, '127.0.0.1', r))
  const got = []
  ast.on('message', (m) => got.push(m))
  const m = rtp.open(ast.address().port)
  const msgs = []
  m.on('message', (x) => msgs.push(JSON.parse(x)))
  await wait(50)
  ast.send(Buffer.concat([Buffer.from([0x80, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]), Buffer.alloc(160, 0x7f)]), rtp.port(), '127.0.0.1')
  await wait(100)
  await ok('caller audio arrives as a Telnyx-style media frame', async () => {
    const f = msgs.find(x => x.event === 'media')
    assert.ok(f); assert.strictEqual(Buffer.from(f.media.payload, 'base64').length, 160)
  })
  await ok('agent audio is paced as 20 ms PCMU frames and the mark comes back after it plays', async () => {
    got.length = 0
    m.send(JSON.stringify({ event: 'media', media: { payload: Buffer.alloc(800, 0x10).toString('base64') } }))
    m.send(JSON.stringify({ event: 'mark', mark: { name: 'end' } }))
    await wait(40)
    assert.ok(!msgs.some(x => x.event === 'mark'), 'mark too early')
    await wait(200)
    assert.ok(msgs.some(x => x.event === 'mark' && x.mark.name === 'end'), 'mark missing')
    const audio = got.filter(p => p[12] === 0x10)
    assert.strictEqual(audio.length, 5)
    assert.strictEqual(audio[0][1] & 0x7f, 0)
    assert.strictEqual(audio[0].length, 172)
  })
  await ok('clear drops queued audio', async () => {
    m.send(JSON.stringify({ event: 'media', media: { payload: Buffer.alloc(16000, 0x20).toString('base64') } }))
    await wait(60)
    m.send(JSON.stringify({ event: 'clear' }))
    got.length = 0
    await wait(100)
    assert.ok(got.every(p => p[12] !== 0x20))
  })
  await ok('close stops it and emits close', async () => {
    let closed = false; m.on('close', () => { closed = true })
    m.close(); assert.ok(closed); assert.strictEqual(m.readyState, 3)
  })
  ast.close()

  // Call engine: an ai.<app>.<token> SIP leg goes to the AI hook, never out as a call event; externalMedia legs are ignored.
  const ce = require('../callengine')
  const events = []
  ce._setSink((e) => events.push(e.data.event_type))
  const hooked = []
  ce.setAiHook((t, id) => hooked.push([t, id]))
  ce._onEvent({ type: 'StasisStart', args: ['sip', 'ai.nomadly.tok_EN-1'], channel: { id: 'c1', name: 'PJSIP/kamailio-1', caller: { number: '+15550001111' }, state: 'Ring' } })
  ce._onEvent({ type: 'StasisStart', args: [], channel: { id: 'c2', name: 'UnicastRTP/127.0.0.1:41000-0001', caller: {}, state: 'Up' } })
  await wait(20)
  await ok('AI SIP leg handed to the agent with its token', async () => assert.deepStrictEqual(hooked, [['tok_EN-1', 'ae:c1']]))
  await ok('no call events for the AI leg or the media channel', async () => assert.deepStrictEqual(events, []))

  // dialLead: Bird only; anything Bird can't take right now waits in the queue.
  const calls = require('../ai-agent/calls')
  const store = require('../ai-agent/store')
  const bird = require('../bird')
  store.getAgent = async () => ({ id: 'a1', name: 'Ava' })
  const booking = require('../ai-agent/booking'); booking.forCall = async () => null
  calls.init({ log: () => {}, selfUrl: 'https://x' })
  ce._setConnected(true)
  process.env.ASTERISK_ARI_URL = 'https://ari'; process.env.ASTERISK_ARI_PASSWORD = 'p'; process.env.BIRD_API_KEY = 'k'
  let placed = null
  ce.createOutboundCall = async (from, to, w, c, o) => { placed = { from, to, o }; return { callControlId: 'ae:out1' } }
  bird.presentable = async (n) => n === '+18444681978'
  bird.spendLeft = async () => 50
  const camp = { chatId: '9', agentId: 'a1', callerId: '+18444681978', id: 'c1' }
  await ok('lead is dialed through the call engine (Bird) with the AI client state', async () => {
    const r = await calls.dialLead(camp, { number: '+13055550100', index: 0 })
    assert.strictEqual(r.callControlId, 'ae:out1')
    assert.strictEqual(placed.from, '+18444681978')
    assert.strictEqual(placed.o.client_state, Buffer.from('ai_agent').toString('base64'))
    assert.ok(calls.owns('ae:out1'))
  })
  await ok('unlinked caller ID waits instead of failing', async () => {
    const r = await calls.dialLead({ ...camp, callerId: '+18005550000' }, { number: '+13055550101', index: 1 })
    assert.ok(r.lineLimit && /not linked/.test(r.error))
  })
  await ok('spend cap reached waits', async () => {
    bird.spendLeft = async () => 0
    const r = await calls.dialLead(camp, { number: '+13055550102', index: 2 })
    bird.spendLeft = async () => 50
    assert.ok(r.lineLimit && /spend/.test(r.error))
  })
  await ok('non-US/Canada lead fails clearly', async () => {
    const r = await calls.dialLead(camp, { number: '+447700900000', index: 3 })
    assert.ok(!r.lineLimit && /US and Canada/.test(r.error))
  })
  await ok('engine offline waits', async () => {
    ce._setConnected(false)
    const r = await calls.dialLead(camp, { number: '+13055550103', index: 4 })
    ce._setConnected(true)
    assert.ok(r.lineLimit)
  })

  // Inbound on an Infobip-delivered number: answered at Infobip, then handed to our call engine by SIP (never to Telnyx).
  const ib = require('../infobip')
  const ibDone = []
  ib.voice.answerCall = async (id) => { ibDone.push(['answer', id]); return {} }
  ib.connectSip = async (id, user, from) => { ibDone.push(['connect', id, user, from]); return {} }
  ib.voice.hangupCall = async (id) => { ibDone.push(['hangup', id]); return null }
  process.env.APP_OPEN_API_KEY = 'k'
  calls.init({ log: () => {}, selfUrl: 'https://x', walletOf: { findOne: async () => ({ usdIn: 50, usdOut: 0 }) } })
  const numIb = { phoneNumber: '+18885550100', plan: 'business', features: { aiAgent: { enabled: true, agentId: 'a1' } } }
  await ok('Infobip inbound call is answered and handed to the call engine', async () => {
    const r = await calls.tryInbound({ payload: { call_control_id: 'ib:x1', from: '+19085550100' }, chatId: '9', num: numIb })
    assert.strictEqual(r, true)
    assert.deepStrictEqual(ibDone[0], ['answer', 'ib:x1'])
    assert.strictEqual(ibDone[1][0], 'connect'); assert.ok(/^ai\.[^.]+\..+/.test(ibDone[1][2])); assert.strictEqual(ibDone[1][3], '+19085550100')
    assert.ok(calls.owns('ib:x1'))
  })
  await ok('when the agent leg ends, the Infobip caller is hung up', async () => {
    const s = calls.sessions.get('ib:x1')
    ce.answerCall = async () => ({}); ce.startExternalMedia = async () => null; ce.hangupCall = async () => null
    ce._onEvent({ type: 'StasisStart', args: ['sip', `ai.nomadly.${s.token}`], channel: { id: 'c9', name: 'PJSIP/kamailio-9', caller: {}, state: 'Ring' } })
    await wait(30)
    assert.ok(calls.sessions.get('ae:c9'), 'agent runs on the engine leg'); assert.ok(calls.owns('ib:x1'))
    await calls.finish(calls.sessions.get('ae:c9'), {}).catch(() => {})
    assert.ok(ibDone.some(d => d[0] === 'hangup' && d[1] === 'ib:x1'))
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
