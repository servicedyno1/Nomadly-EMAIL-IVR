#!/usr/bin/env node
// Starter gets the browser phone (make + take calls in the web app) but not SIP apps / desk phones; a drop to a
// lower plan keeps settings saved; carrier names never reach web users. Run: node js/tests/test_starter_browser_phone_2026-10.js
process.env.TELNYX_SIP_CONNECTION_ID = 'conn-test'
process.env.TELNYX_DEFAULT_ANI = '+18889999999'
process.env.CALL_CONNECTION_FEE = '0.03'
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret'
const assert = require('assert')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const phoneConfig = require('../phone-config')
const key = require('../browser-call-key')
const lifecycle = require('../plan-lifecycle')
const { scrubProviderNames } = require('../sanitize-provider')
const numbers = require('../cloudivr-web/numbers')

;(async () => {
  console.log('plan access')
  await t('Starter: browser phone + browser ring, no SIP apps', () => {
    assert.strictEqual(phoneConfig.canAccessFeature('starter', 'browserPhone'), true)
    assert.strictEqual(phoneConfig.canAccessFeature('starter', 'browserRing'), true)
    assert.strictEqual(phoneConfig.canAccessFeature('starter', 'sipCredentials'), false)
  })
  await t('Pro + Business: browser phone and SIP apps', () => {
    for (const p of ['pro', 'business']) for (const f of ['browserPhone', 'browserRing', 'sipCredentials']) assert.strictEqual(phoneConfig.canAccessFeature(p, f), true, `${p}.${f}`)
  })
  await t('plan cards: Starter lists the browser phone, SIP apps start at Pro', () => {
    const inc = (id) => numbers.webFeatures(id).filter(f => f.included).map(f => f.key)
    assert.ok(inc('starter').includes('browserPhone') && !inc('starter').includes('sip'))
    assert.ok(inc('pro').includes('browserPhone') && inc('pro').includes('sip'))
  })
  await t('numbers expose access.browserPhone', () => {
    const pub = numbers.publicNumber({ phoneNumber: '+15550001111', plan: 'starter', status: 'active', features: {} })
    assert.strictEqual(pub.access.browserPhone, true)
    assert.strictEqual(pub.access.sipCredentials, false)
    assert.strictEqual(pub.access.browserRing, true)
  })

  console.log('browser call key')
  const PHONE = '+18883304418'
  await t('a minted key is valid for its own number only', () => {
    const k = key.mint(PHONE)
    assert.strictEqual(k.name, 'X-Civr-Browser')
    assert.strictEqual(key.valid(PHONE, k.value), true)
    assert.strictEqual(key.valid('+18883304419', k.value), false)
  })
  await t('expired, tampered, empty and far-future keys are refused', () => {
    const old = key.mint(PHONE, Date.now() - key.TTL_MS - 1000)
    assert.strictEqual(key.valid(PHONE, old.value), false)
    const k = key.mint(PHONE)
    assert.strictEqual(key.valid(PHONE, k.value.slice(0, -1) + (k.value.endsWith('a') ? 'b' : 'a')), false)
    assert.strictEqual(key.valid(PHONE, ''), false)
    assert.strictEqual(key.valid(PHONE, null), false)
    const far = key.mint(PHONE, Date.now() + 10 * key.TTL_MS)
    assert.strictEqual(key.valid(PHONE, far.value), false)
  })
  await t('header read from Telnyx custom_headers (any case)', () => {
    assert.strictEqual(key.fromPayload({ custom_headers: [{ name: 'x-civr-browser', value: 'abc' }] }), 'abc')
    assert.strictEqual(key.fromPayload({}), null)
  })

  console.log('plan change keeps settings')
  const pro = { phoneNumber: PHONE, plan: 'business', features: { ivr: { enabled: true, options: { 1: { action: 'forward', forwardTo: '+14155550100' } } }, recording: true, voicemail: { enabled: true, greetingType: 'default' }, smsForwarding: { toTelegram: true, toEmail: 'a@b.co', webhookUrl: 'https://x.example/h' }, aiAgent: { enabled: true, agentId: 'ag1' } } }
  const dg = lifecycle.downgradePatch(pro, 'starter')
  await t('downgrade switches off, keeps menu / agent, remembers values', () => {
    assert.strictEqual(dg.set.sipDisabled, true)
    assert.strictEqual(dg.set['features.ivr.enabled'], false)
    assert.strictEqual(dg.set['features.recording'], false)
    assert.strictEqual(dg.set['features.voicemail.enabled'], false)
    assert.strictEqual(dg.set['features.smsForwarding.toEmail'], null)
    assert.ok(!Object.keys(dg.set).some(k => k === 'features.ivr' || k.startsWith('features.aiAgent')), 'menu options and AI agent untouched')
    assert.deepStrictEqual(dg.off.sort(), ['callRecording', 'ivr', 'smsToEmail', 'smsWebhook', 'voicemail'])
    assert.strictEqual(dg.set.downgradeSaved.find(x => x.path === 'features.smsForwarding.toEmail').value, 'a@b.co')
  })
  await t('downgrade to Pro only turns off Business-only bits', () => {
    const d = lifecycle.downgradePatch(pro, 'pro')
    assert.deepStrictEqual(d.off, [])
    assert.strictEqual(d.set.sipDisabled, undefined)
  })
  await t('upgrade brings every saved setting back', () => {
    const after = { ...pro, plan: 'starter', downgradeSaved: dg.set.downgradeSaved }
    const up = lifecycle.upgradePatch(after, 'pro')
    assert.strictEqual(up.sipDisabled, false)
    assert.strictEqual(up['features.ivr.enabled'], true)
    assert.strictEqual(up['features.smsForwarding.webhookUrl'], 'https://x.example/h')
    assert.deepStrictEqual(up.downgradeSaved, [])
    assert.ok(lifecycle.numberSet(up)['val.numbers.$.features.recording'] === true)
  })

  console.log('carrier names')
  await t('scrubProviderNames hides carriers, registrars and their hosts', () => {
    const s = scrubProviderNames('Telnyx error at https://api.telnyx.com/v2/x — Twilio said no; OpenProvider via ns1.openprovider.nl')
    assert.ok(!/telnyx|twilio|openprovider/i.test(s), s)
    assert.strictEqual(scrubProviderNames('Your call ended.'), 'Your call ended.')
  })

  console.log('call engine')
  const CHAT = '6587790422', DEST = '+14155550123', SIPUSER = 'gencredSTART'
  const walletDoc = { _id: CHAT, usdIn: 100, usdOut: 0 }
  const genericColl = (name) => ({
    collectionName: name, findOne: async () => null, insertOne: async () => ({}), updateOne: async () => ({}), deleteOne: async () => ({}), deleteMany: async () => ({}),
    find: () => ({ toArray: async () => [], sort: () => ({ limit: () => ({ toArray: async () => [] }), toArray: async () => [] }) }),
  })
  const db = { collection: (name) => genericColl(name) }
  const walletOf = {
    collectionName: 'walletOf', s: { db },
    findOne: async (q) => (q._id === CHAT ? { ...walletDoc } : null),
    findOneAndUpdate: async (f, u) => { walletDoc.usdOut += u.$inc.usdOut; return { ...walletDoc } },
    updateOne: async (f, u) => { if (u.$inc?.usdOut != null) walletDoc.usdOut += u.$inc.usdOut; return {} },
  }
  const num = { phoneNumber: PHONE, provider: 'telnyx', status: 'active', plan: 'starter', telnyxSipUsername: SIPUSER, sipUsername: SIPUSER, features: {} }
  const phoneDoc = { _id: CHAT, val: { numbers: [num] } }
  const sent = [], tx = { transfer: 0, hangup: 0, outbound: [] }
  const vs = require('../voice-service.js')
  vs.initVoiceService({
    bot: { sendMessage: async (id, text) => { sent.push(text); return true } },
    phoneNumbersOf: { collectionName: 'phoneNumbersOf', find: () => ({ toArray: async () => [phoneDoc] }), findOne: async () => phoneDoc, updateOne: async () => ({}), s: { db } },
    phoneLogs: { insertOne: async () => {} },
    telnyxApi: {
      answerCall: async () => true, hangupCall: async () => { tx.hangup++; return true }, rejectCall: async () => true, speakOnCall: async () => true, listNumbers: async () => [],
      transferCall: async () => { tx.transfer++; return {} }, playbackStart: async () => true,
      createOutboundCall: async (from, to) => { tx.outbound.push(to); return { callControlId: `out-${tx.outbound.length}` } },
    },
    telnyxResources: {}, translation: (k) => `T:${k}`, ivrAnalytics: {}, walletOf, payments: null,
    nanoid: () => 'nid' + Math.random().toString(36).slice(2, 8), selfUrl: 'http://localhost:5000',
  })
  const webhook = (payload) => vs.handleVoiceWebhook({ body: { data: { event_type: payload._evt, payload } } }, { sendStatus: () => {} })
  let n = 0
  const outbound = async (extra = {}) => {
    n++
    const before = { ...tx, outbound: tx.outbound.length }
    await webhook({ _evt: 'call.initiated', direction: 'outgoing', from: SIPUSER, to: DEST.slice(0, -2) + String(10 + n), call_control_id: `cc${n}`, connection_id: 'conn-test', call_leg_id: `leg${n}`, from_sip_uri: `${SIPUSER}@sip.telnyx.com`, ...extra })
    await wait(400)
    return { transferred: tx.transfer - before.transfer, hungUp: tx.hangup - before.hangup }
  }
  await t('Starter: a call from a SIP app / desk phone is refused + one notice', async () => {
    const r = await outbound()
    assert.strictEqual(r.transferred, 0)
    assert.ok(r.hungUp >= 1)
    assert.ok(sent.some(s => s === 'T:vs.sipPlanBlocked'), sent.join(' | '))
  })
  await t('Starter: repeated app retries do not spam notices', async () => {
    const before = sent.filter(s => s === 'T:vs.sipPlanBlocked').length
    await outbound()
    assert.strictEqual(sent.filter(s => s === 'T:vs.sipPlanBlocked').length, before)
  })
  await t('Starter: a forged browser header is refused', async () => {
    const r = await outbound({ custom_headers: [{ name: 'X-Civr-Browser', value: `${Date.now() + 1000}.deadbeefdeadbeefdeadbeefdeadbeef` }] })
    assert.strictEqual(r.transferred, 0)
  })
  await t('Starter: a call from the browser phone goes through', async () => {
    const k = key.mint(PHONE)
    const r = await outbound({ custom_headers: [{ name: k.name, value: k.value }] })
    assert.strictEqual(r.transferred, 1)
  })
  await t('Pro: SIP apps still call without the browser header', async () => {
    num.plan = 'pro'
    try { assert.strictEqual((await outbound()).transferred, 1) } finally { num.plan = 'starter' }
  })

  const ring = require('../relay-call/incoming')
  const inbound = async () => {
    n++
    const before = tx.outbound.length
    await webhook({ _evt: 'call.initiated', direction: 'incoming', from: '+14155550999', to: PHONE, call_control_id: `in${n}`, connection_id: 'app-test', call_leg_id: `inleg${n}` })
    await wait(400)
    return tx.outbound.slice(before)
  }
  await t('Starter: incoming calls do not ring SIP devices when the web app is closed', async () => {
    num.features = { browserRing: { enabled: true } }
    const legs = await inbound()
    assert.ok(!legs.some(x => String(x).startsWith('sip:')), legs.join(','))
  })
  await t('Starter: incoming calls ring the browser phone while the app is open', async () => {
    ring.seen(CHAT)
    const legs = await inbound()
    assert.ok(legs.includes(`sip:${SIPUSER}@sip.telnyx.com`), legs.join(','))
  })
  await t('Starter with browser ring off: no SIP ring even when online', async () => {
    num.features = { browserRing: { enabled: false } }
    const legs = await inbound()
    assert.ok(!legs.some(x => String(x).startsWith('sip:')), legs.join(','))
  })
  await t('Pro: incoming calls ring SIP devices as before', async () => {
    num.plan = 'pro'; num.features = {}
    const legs = await inbound()
    assert.ok(legs.includes(`sip:${SIPUSER}@sip.telnyx.com`), legs.join(','))
  })

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
