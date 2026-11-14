'use strict'
const crypto = require('crypto')
const { verifySignature } = require('../cloudivr-web/inbound-email')

let fails = 0
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) fails++ }

const secret = 'whsec_' + crypto.randomBytes(24).toString('base64')
const key = Buffer.from(secret.slice(6), 'base64')
const body = JSON.stringify({ type: 'email.received', data: { email_id: 'abc' } })
const now = Date.now()
const ts = String(Math.floor(now / 1000))
const sign = (b, t = ts, k = key) => 'v1,' + crypto.createHmac('sha256', k).update(`msg_1.${t}.${b}`).digest('base64')
const req = (sig, b = body, t = ts) => ({ headers: { 'svix-id': 'msg_1', 'svix-timestamp': t, 'svix-signature': sig }, rawBody: Buffer.from(b) })

ok('valid signature accepted', verifySignature(req(sign(body)), secret, now))
ok('rotation: second signature valid', verifySignature(req(`v1,AAAA ${sign(body)}`), secret, now))
ok('tampered body rejected', !verifySignature(req(sign(body), body + ' '), secret, now))
ok('wrong secret rejected', !verifySignature(req(sign(body, ts, crypto.randomBytes(24))), secret, now))
const old = String(Math.floor(now / 1000) - 600)
ok('stale timestamp rejected', !verifySignature(req(sign(body, old), body, old), secret, now))
ok('unsigned rejected', !verifySignature({ headers: {}, rawBody: Buffer.from(body) }, secret, now))
ok('no secret configured rejected', !verifySignature(req(sign(body)), undefined, now))

console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
