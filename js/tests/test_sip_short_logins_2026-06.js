// Short SIP logins (2026-06): per-number credential connection with a 10-char user / 12-char password, behind SIP_SHORT_LOGINS.
// Run: node js/tests/test_sip_short_logins_2026-06.js
const assert = require('assert')
const path = require('path')

const calls = []
let postPlan = []
const MAIN = { id: '111111111', user_name: 'mainuser', password: 'mainsecret', webhook_event_url: 'https://x.test/telnyx/voice', webhook_api_version: '2',
  sip_uri_calling_preference: 'internal', inbound: { codecs: ['G722', 'PCMU'] }, outbound: { outbound_voice_profile_id: 'ovp-1', ani_override: '+15550000000', ani_override_type: 'always' } }
const fakeAxios = {
  get: async (url) => { calls.push(['get', url]); return { data: { data: MAIN } } },
  post: async (url, body) => {
    calls.push(['post', url, body])
    const next = postPlan.shift()
    if (next instanceof Error) throw next
    return { data: { data: next || { id: 'a1b2c3d4-0000-1111-2222-333344445555', sip_username: 'gencred' + 'x'.repeat(42), sip_password: 'p'.repeat(32) } } }
  },
  delete: async (url) => { calls.push(['delete', url]); return {} },
}
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] })
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: fakeAxios }
process.env.TELNYX_SIP_CONNECTION_ID = MAIN.id

const tx = require('../telnyx-service.js')
const sipLogins = require('../sip-logins.js')
const pc = require('../phone-config.js')
const apiErr = (detail) => Object.assign(new Error('422'), { response: { data: { errors: [{ detail }] } } })
let pass = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('  ✓', msg) }

;(async () => {
  // Generators
  for (let i = 0; i < 50; i++) {
    const u = pc.generateSipUsername(), p = pc.generateSipPassword()
    assert.ok(/^cv[a-z0-9]{8}$/.test(u), `user ${u}`)
    assert.ok(p.length === 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /^[A-Za-z0-9]+$/.test(p), `pass ${p}`)
  }
  ok(true, 'generators: 10-char letter-first username, 12-char mixed password (50 samples)')

  // Flag off → old telephony credential
  delete process.env.SIP_SHORT_LOGINS
  calls.length = 0
  let r = await tx.createSIPCredential(MAIN.id, 'cvseed0000', 'Seed1234abcd', '+15551112222')
  ok(calls.length === 1 && calls[0][1].endsWith('/telephony_credentials') && r.sip_username.startsWith('gencred'), 'flag off: telephony credential as before')

  // Flag on → per-number connection cloned from the main one
  process.env.SIP_SHORT_LOGINS = 'true'
  calls.length = 0; postPlan = [{ id: '2222222222' }]
  r = await tx.createSIPCredential(MAIN.id, 'cvseed0000', 'Seed1234abcd', '+15551112222')
  const post = calls.find(c => c[0] === 'post')
  ok(calls[0][0] === 'get' && calls[0][1].endsWith(`/credential_connections/${MAIN.id}`), 'flag on: reads the main SIP connection')
  ok(post[1].endsWith('/credential_connections'), 'flag on: creates a credential connection')
  ok(post[2].webhook_event_url === MAIN.webhook_event_url && post[2].outbound.outbound_voice_profile_id === 'ovp-1' && post[2].inbound.codecs.length === 2 && post[2].sip_uri_calling_preference === 'internal', 'clones webhook, outbound profile, codecs, SIP URI calling')
  ok(post[2].outbound.ani_override === '+15551112222' && post[2].outbound.ani_override_type === 'always', 'caller ID fixed to the number itself')
  ok(post[2].user_name !== MAIN.user_name && post[2].password !== MAIN.password && /^cv[a-z0-9]{8}$/.test(post[2].user_name) && post[2].password.length === 12, 'own short login, main login not copied')
  ok(r.id === '2222222222' && r.sip_username === post[2].user_name && r.sip_password === post[2].password && r.kind === 'connection', 'returns telephony-credential shape with the short login')
  ok(sipLogins.isSipConnection('2222222222') && sipLogins.userForConnection('2222222222') === r.sip_username && sipLogins.isSipConnection(MAIN.id), 'new connection recognised as a SIP connection')

  // Username taken → retry with another username
  calls.length = 0; postPlan = [apiErr('user_name has already been taken'), { id: '3333333333' }]
  r = await tx.createSIPCredential(MAIN.id, 'a', 'b', '+15553334444')
  const posts = calls.filter(c => c[0] === 'post')
  ok(posts.length === 2 && posts[0][2].user_name !== posts[1][2].user_name && r.id === '3333333333', 'username clash → retried with a new username')

  // Other Telnyx error → falls back to the long telephony credential (purchase never breaks)
  calls.length = 0; postPlan = [apiErr('Connection limit reached')]
  r = await tx.createSIPCredential(MAIN.id, 'a', 'b', '+15553334444')
  ok(calls.filter(c => c[0] === 'post').map(c => c[1].split('/').pop()).join(',') === 'credential_connections,telephony_credentials' && r.sip_username.startsWith('gencred'), 'other error → falls back to telephony credential')

  // Delete: connection id vs credential UUID
  calls.length = 0
  await tx.deleteSIPCredential('2222222222')
  await tx.deleteSIPCredential('a1b2c3d4-0000-1111-2222-333344445555')
  ok(calls[0][1].endsWith('/credential_connections/2222222222') && calls[1][1].endsWith('/telephony_credentials/a1b2c3d4-0000-1111-2222-333344445555') && !sipLogins.isSipConnection('2222222222'), 'delete: short login removes its connection, old credential deleted as before')

  // Startup load from Mongo-like collection
  const fakeCol = { find: () => ({ toArray: async () => [{ val: { numbers: [{ telnyxCredentialId: '4444444444', telnyxSipUsername: 'cvloaded01' }, { telnyxCredentialId: 'a1b2c3d4-0000-1111-2222-333344445555' }] } }] }) }
  await sipLogins.loadKnown(fakeCol, () => {})
  ok(sipLogins.userForConnection('4444444444') === 'cvloaded01' && !sipLogins.isSipConnection('a1b2c3d4-0000-1111-2222-333344445555'), 'startup: per-number connections loaded from the numbers collection')
  ok(sipLogins.isShortLogin('sip:cvloaded01@sip.telnyx.com') && !sipLogins.isShortLogin('gencredabc') && !sipLogins.isShortLogin('+14155550100'), 'short-login detection for delivery legs')

  console.log(`\nALL ${pass} PASSED`)
})().catch(e => { console.error('FAIL', e); process.exit(1) })
