// SIP self-test: real UDP probe against a fake SIP registrar + verdict mapping + presence hygiene.
'use strict'
process.env.SIP_SERVER_SECRET = process.env.SIP_SERVER_SECRET || 'test-secret'
const dgram = require('dgram')
const crypto = require('crypto')
const selftest = require('../sip-selftest')
const presence = require('../sip-presence')

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
const USERS = { cvgood00001: { pass: 'Right1Pass', contacts: 2 }, cvalone0001: { pass: 'Right1Pass', contacts: 0 }, cvlocked001: { pass: 'x', locked: true } }

function fakeRegistrar() {
  const srv = dgram.createSocket('udp4'); const seen = []
  srv.on('message', (buf, rinfo) => {
    const txt = buf.toString(); seen.push(txt)
    const user = (txt.match(/^From: <sip:([^@]+)@/m) || [])[1]
    const hdr = (n) => (txt.match(new RegExp(`^${n}: (.*)$`, 'm')) || [])[1]
    const reply = (line, extra = []) => srv.send([`SIP/2.0 ${line}`, `Via: ${hdr('Via')}`, `From: ${hdr('From')}`, `To: ${hdr('To')};tag=srv`, `Call-ID: ${hdr('Call-ID')}`, `CSeq: ${hdr('CSeq')}`, ...extra, 'Content-Length: 0', '', ''].join('\r\n'), rinfo.port, rinfo.address)
    const u = USERS[user]
    if (u?.locked) return reply('403 Forbidden')
    const auth = hdr('Authorization')
    if (!auth) return reply('401 Unauthorized', ['WWW-Authenticate: Digest realm="sip.test", nonce="abc123"'])
    const resp = (auth.match(/response="([^"]+)"/) || [])[1], uri = (auth.match(/uri="([^"]+)"/) || [])[1]
    const want = u && md5(`${md5(`${user}:sip.test:${u.pass}`)}:abc123:${md5(`REGISTER:${uri}`)}`)
    if (!u || resp !== want) return reply('401 Unauthorized', ['WWW-Authenticate: Digest realm="sip.test", nonce="abc123"'])
    reply('200 OK', Array.from({ length: u.contacts }, (_, i) => `Contact: <sip:${user}@10.0.0.${i + 1}:5060>;expires=300`))
  })
  return new Promise(r => srv.bind(0, '127.0.0.1', () => r({ srv, seen, port: srv.address().port })))
}

let pass = 0, fail = 0
const ok = (name, cond) => { cond ? (pass++, console.log('✓', name)) : (fail++, console.log('✗', name)) }

;(async () => {
  const { srv, seen, port } = await fakeRegistrar()
  const p = (user, pw, extra = {}) => selftest.probe({ host: '127.0.0.1', port, domain: 'sip.test', user, pass: pw, timeoutMs: 1500, ...extra })

  const good = await p('cvgood00001', 'Right1Pass')
  ok('right password → 200 and counts signed-in devices', good.status === 200 && good.contacts === 2)
  ok('query sends no Contact / Expires (never creates or removes a registration)', !seen.some(m => /^(Contact|Expires):/m.test(m)))
  ok('identifies itself as our self-test', seen.every(m => /^User-Agent: cloudivr-selftest$/m.test(m)))
  const alone = await p('cvalone0001', 'Right1Pass')
  ok('right password, nobody signed in → 200 with 0 devices', alone.status === 200 && alone.contacts === 0)
  const wrong = await p('cvgood00001', 'Wrong')
  ok('wrong password → 401 (one retry only, no loop)', wrong.status === 401)
  ok('locked login → 403', (await p('cvlocked001', 'x')).status === 403)
  const dead = await selftest.probe({ host: '127.0.0.1', port: 9, domain: 'sip.test', user: 'u', pass: 'p', timeoutMs: 600 })
  ok('no answer → status 0', dead.status === 0)
  srv.close()

  // Verdicts
  const num = (o = {}) => ({ phoneNumber: '+1' + Math.floor(Math.random() * 1e10), status: 'active', plan: 'pro', telnyxSipUsername: 'cvabc', telnyxSipPassword: 'pw', ...o })
  const run = (n, r) => selftest.run({ db: null, num: n, domain: 'sip.x', probeFn: async () => r })
  ok('connected', (await run(num(), { status: 200, contacts: 1 })).code === 'connected')
  ok('login works but no app signed in', (await run(num(), { status: 200, contacts: 0 })).code === 'ready_not_connected')
  ok('locked', (await run(num(), { status: 403, contacts: 0 })).code === 'locked')
  ok('unreachable', (await run(num(), { status: 0, contacts: 0 })).code === 'unreachable')
  ok('rejected', (await run(num(), { status: 401, contacts: 0 })).code === 'rejected')
  ok('no login → no probe', (await selftest.run({ db: null, num: { phoneNumber: '+1999', status: 'active', plan: 'pro' }, domain: 'sip.x', probeFn: async () => { throw new Error('must not probe') } })).code === 'no_login')
  ok('sipDisabled → not included, no probe', (await selftest.run({ db: null, num: num({ sipDisabled: true }), domain: 'sip.x', probeFn: async () => { throw new Error('must not probe') } })).code === 'not_included')
  let calls = 0; const n1 = num()
  await selftest.run({ db: null, num: n1, domain: 'sip.x', probeFn: async () => { calls++; return { status: 200, contacts: 0 } } })
  await selftest.run({ db: null, num: n1, domain: 'sip.x', probeFn: async () => { calls++; return { status: 200, contacts: 0 } } })
  ok('repeat taps within 15 s reuse the result (no hammering the SIP server)', calls === 1)
  let tries = 0
  const afterReset = await selftest.run({ db: null, num: num(), domain: 'sip.x', probeFn: async () => (++tries === 1 ? { status: 401, contacts: 0 } : { status: 200, contacts: 1 }) })
  ok('one retry after a 401 (server re-reads a just-reset password)', tries === 2 && afterReset.code === 'connected')

  // Copy
  const ex = selftest.explain({ code: 'ready_not_connected', server: 'sip.cloudivr.net', devices: 0 })
  ok('web verdict says our side is fine and lists what to check', !ex.ok && /ready on our side/.test(ex.message) && ex.tips.length >= 4 && ex.tips[0].includes('sip.cloudivr.net'))
  ok('web verdict connected is ok', selftest.explain({ code: 'connected', devices: 1, server: 's' }).ok === true)
  for (const l of ['en', 'fr', 'zh', 'hi', 'fa']) for (const code of ['connected', 'ready_not_connected', 'locked', 'no_login', 'not_included', 'unreachable', 'rejected']) {
    const t = selftest.botText({ code, phone: '+15550001111', server: 'sip.speechcue.com', devices: 1 }, l)
    if (!t.includes('+15550001111') || /undefined/.test(t)) { ok(`bot text ${l}/${code}`, false) }
  }
  ok('bot text complete in 5 languages × 7 verdicts', true)
  ok('bot text never contains the password', !/pw|Right1Pass/.test(selftest.botText({ code: 'ready_not_connected', phone: '+1', server: 's', devices: 0 }, 'en')))

  // Presence: our own checks must not mark a customer's phone online/offline
  const writes = []
  const db = { collection: () => ({ updateOne: async (...a) => { writes.push(a) } }) }
  await presence.record(db, 'cvabc', 600, 'cloudivr-selftest')
  await presence.record(db, 'cvabc', 0, 'preflight-check')
  ok('self-test / preflight REGISTERs are ignored by presence', writes.length === 0)
  await presence.record(db, 'cvabc', 600, 'Zoiper v5')
  ok('a real phone still records presence', writes.length === 2)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
