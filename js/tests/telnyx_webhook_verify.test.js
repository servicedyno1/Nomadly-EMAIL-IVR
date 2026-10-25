// node js/tests/telnyx_webhook_verify.test.js — Ed25519 Telnyx webhook signature checks (no network).
const assert = require('assert')
const crypto = require('crypto')
const V = require('../telnyx-webhook-verify')

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
const key = V.keyFrom(pubB64)
const body = Buffer.from('{"data":{"event_type":"message.received","id":"e1","payload":{"text":"hi"}}}')
const now = Date.now()
const ts = String(Math.floor(now / 1000))
const sign = (t, b) => crypto.sign(null, Buffer.concat([Buffer.from(`${t}|`), b]), privateKey).toString('base64')
const req = (h, b = body) => ({ headers: h, rawBody: b })
const ok = { 'telnyx-signature-ed25519': sign(ts, body), 'telnyx-timestamp': ts }

let n = 0
const t = (name, fn) => { fn(); n++; console.log('PASS', name) }
t('valid signature accepted', () => assert.strictEqual(V.verify(req(ok), key, now), true))
t('tampered body refused', () => assert.strictEqual(V.verify(req(ok, Buffer.from(body.toString().replace('hi', 'ho'))), key, now), false))
t('missing headers refused', () => assert.strictEqual(V.verify(req({}), key, now), false))
t('missing timestamp refused', () => assert.strictEqual(V.verify(req({ 'telnyx-signature-ed25519': ok['telnyx-signature-ed25519'] }), key, now), false))
t('stale timestamp refused', () => {
  const old = String(Math.floor(now / 1000) - V.MAX_SKEW_S - 5)
  assert.strictEqual(V.verify(req({ 'telnyx-signature-ed25519': sign(old, body), 'telnyx-timestamp': old }), key, now), false)
})
t('timestamp swapped after signing refused', () => assert.strictEqual(V.verify(req({ ...ok, 'telnyx-timestamp': String(Number(ts) + 1) }), key, now), false))
t('garbage signature refused', () => assert.strictEqual(V.verify(req({ ...ok, 'telnyx-signature-ed25519': 'not-base64!!' }), key, now), false))
t('empty body refused', () => assert.strictEqual(V.verify(req(ok, Buffer.alloc(0)), key, now), false))
t('other account key refused', () => {
  const other = V.keyFrom(crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'))
  assert.strictEqual(V.verify(req(ok), other, now), false)
})
t('array headers handled', () => assert.strictEqual(V.verify(req({ 'telnyx-signature-ed25519': [ok['telnyx-signature-ed25519']], 'telnyx-timestamp': [ts] }), key, now), true))
t('bad key length throws at boot', () => assert.throws(() => V.keyFrom('c2hvcnQ='), /32 bytes/))
t('middleware refuses forged + passes signed', () => {
  process.env.TELNYX_PUBLIC_KEY = pubB64
  const mw = V.middleware(() => {})
  let status = null, nexted = 0
  const res = { status: (s) => { status = s; return { json: () => {} } } }
  mw({ ...req({}), path: '/telnyx/sms-webhook' }, res, () => nexted++)
  assert.strictEqual(status, 403)
  mw({ ...req({ 'telnyx-signature-ed25519': sign(String(Math.floor(Date.now() / 1000)), body), 'telnyx-timestamp': String(Math.floor(Date.now() / 1000)) }), path: '/x' }, res, () => nexted++)
  assert.strictEqual(nexted, 1)
  delete process.env.TELNYX_PUBLIC_KEY
})
t('middleware is a pass-through without TELNYX_PUBLIC_KEY', () => {
  let nexted = 0
  V.middleware(() => {})(req({}), {}, () => nexted++)
  assert.strictEqual(nexted, 1)
})
console.log(`${n}/${n} PASS`)
