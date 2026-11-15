// node js/tests/test_sip_repair_2026-11.js
process.env.SIP_SERVER_SECRET = 'x'; process.env.SIP_DOMAIN = 'sip.speechcue.com'; process.env.CLOUDIVR_SIP_DOMAIN = 'sip.cloudivr.net'
const assert = require('assert'), s = require('../sip-logins'), pc = require('../phone-config')
const WEB = 5000000000000001, BOT = 6604316166
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('✅', name) }
t('basic plan now has SIP', () => assert.strictEqual(pc.canAccessFeature('starter', 'sipCredentials'), true))
t('missing login gets created on our SIP server', () => {
  const d = s.repairFields(WEB, { status: 'active', plan: 'business', phoneNumber: '+31970' })
  assert.match(d.sipUsername, /^cv[a-z0-9]{8}$/); assert.strictEqual(d.telnyxSipUsername, d.sipUsername); assert.strictEqual(d.telnyxSipPassword, d.sipPassword)
  assert.strictEqual(d.telnyxCredentialId, `kam:${d.sipUsername}`); assert.strictEqual(d.sipDomain, 'sip.cloudivr.net')
})
t('working login is kept as is (bot)', () => {
  const n = { status: 'active', plan: 'pro', sipUsername: 'cvaaaaaaaa', sipPassword: 'P1', telnyxSipUsername: 'cvaaaaaaaa', telnyxSipPassword: 'P1', telnyxCredentialId: 'kam:cvaaaaaaaa', sipDomain: 'sip.speechcue.com' }
  assert.strictEqual(s.repairFields(BOT, n), null)
})
t('seed-only login (no telnyx pair) is aligned, same user/password', () => {
  const d = s.repairFields(WEB, { status: 'active', plan: 'pro', sipUsername: 'cvbbbbbbbb', sipPassword: 'P2', sipDomain: 'sip.cloudivr.net' })
  assert.deepStrictEqual(d, { telnyxSipUsername: 'cvbbbbbbbb', telnyxSipPassword: 'P2', telnyxCredentialId: 'kam:cvbbbbbbbb' })
})
t('mismatched pairs keep both logins, shown pair wins', () => {
  const d = s.repairFields(WEB, { status: 'active', plan: 'pro', sipUsername: 'tad3', sipPassword: 'A', telnyxSipUsername: 'cvcccccccc', telnyxSipPassword: 'B', telnyxCredentialId: 'kam:cvcccccccc', sipDomain: 'sip.speechcue.com' })
  assert.deepStrictEqual(d, { sipDomain: 'sip.cloudivr.net' })
})
t('inactive / no-voice / fax plan untouched', () => {
  assert.strictEqual(s.repairFields(BOT, { status: 'suspended', plan: 'pro' }), null)
  assert.strictEqual(s.repairFields(BOT, { status: 'active', plan: 'pro', capabilities: { voice: false } }), null)
  assert.strictEqual(s.repairFields(BOT, { status: 'active', plan: 'fax' }), null)
})
t('sipDisabled cleared on plan with SIP', () => assert.strictEqual(s.repairFields(BOT, { status: 'active', plan: 'starter', sipUsername: 'cvd', sipPassword: 'p', telnyxSipUsername: 'cvd', telnyxSipPassword: 'p', telnyxCredentialId: 'kam:cvd', sipDomain: 'sip.speechcue.com', sipDisabled: true }).sipDisabled, false))
t('bot copy offers TLS on 5061 (served by the SIP server since 2026-11-15)', () => {
  const txt = require('fs').readFileSync(require.resolve('../phone-config'), 'utf8')
  assert.ok(/5061 \(TLS\)/.test(txt))
})
console.log(`${pass}/8 passed`); process.exit(0)
