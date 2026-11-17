'use strict'
// SIP reset keeps the username; AI support knows "error 57" = turn STUN off; MultiTEL test calls are routed.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const sl = require('../sip-logins')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, '—', e.message) } }
const fakeTelnyx = (ok = true) => { const calls = []; return { calls, setShortSipPassword: async (id, p) => { calls.push(['patch', id, p]); return ok }, deleteSIPCredential: async (id) => { calls.push(['delete', id]) } } }

;(async () => {
  process.env.SIP_SERVER_SECRET = 'x'
  await t('own SIP server: new password, same username', async () => {
    const n = { sipUsername: 'cv5cfyvh68', sipPassword: 'old', telnyxSipUsername: 'cv5cfyvh68', telnyxSipPassword: 'old', telnyxCredentialId: 'kam:cv5cfyvh68' }
    const r = await sl.newPasswordOnly(n, fakeTelnyx())
    assert.strictEqual(r.username, 'cv5cfyvh68')
    assert.notStrictEqual(r.password, 'old')
    assert.strictEqual(r.set.telnyxSipPassword, r.password)
    assert.strictEqual(r.set.sipPassword, r.password)
    assert.strictEqual(r.set.telnyxCredentialId, 'kam:cv5cfyvh68')
  })
  await t('per-number Telnyx login: password changed in place, username kept', async () => {
    const tx = fakeTelnyx()
    const r = await sl.newPasswordOnly({ telnyxSipUsername: 'cvabc23456', telnyxCredentialId: '2734567890123' }, tx)
    assert.strictEqual(r.username, 'cvabc23456')
    assert.deepStrictEqual(tx.calls[0].slice(0, 2), ['patch', '2734567890123'])
    assert.ok(!('telnyxCredentialId' in r.set))
  })
  await t('Telnyx refuses the change → null (caller falls back and warns the username changed)', async () => {
    assert.strictEqual(await sl.newPasswordOnly({ telnyxSipUsername: 'cvabc23456', telnyxCredentialId: '2734567890123' }, fakeTelnyx(false)), null)
  })
  await t('old long Telnyx credential is dropped, the login moves to our SIP server with the same username', async () => {
    const tx = fakeTelnyx()
    const r = await sl.newPasswordOnly({ sipUsername: 'gencred123', telnyxSipUsername: 'gencred123', telnyxCredentialId: 'a1b2c3d4-uuid' }, tx)
    assert.strictEqual(r.username, 'gencred123')
    assert.deepStrictEqual(tx.calls[0], ['delete', 'a1b2c3d4-uuid'])
    assert.strictEqual(r.set.telnyxCredentialId, 'kam:gencred123')
  })
  await t('reset notes in every language', () => {
    for (const l of ['en', 'fr', 'zh', 'hi', 'fa']) { assert.ok(sl.resetNote(l, false)); assert.ok(sl.resetNote(l, true)) }
    assert.ok(/username stays the same/.test(sl.resetNote('en', false)))
    assert.ok(/username changed too/.test(sl.resetNote('en', true)))
  })
  await t('AI support: error 57 → turn STUN off, never a reset', () => {
    const src = fs.readFileSync(path.join(__dirname, '../ai-support.js'), 'utf8')
    assert.ok(/"Error 57"[^\n]*turn STUN <b>off<\/b>[^\n]*Do NOT suggest 🔄 Reset Password for error 57/.test(src))
    assert.ok(/Reset Password — New SIP password \(the username stays the same\)/.test(src))
  })
  await t('voice: MultiTEL / Infobip numbers and free-test logins reach the outbound branch', () => {
    const src = fs.readFileSync(path.join(__dirname, '../voice-service.js'), 'utf8')
    assert.ok(src.includes("const viaTelnyx = num.provider === 'telnyx' || ['multitel', 'infobip'].includes(num.provider) || (!!lookupResult?.isTestCall && num.provider !== 'twilio')"))
    assert.ok(src.includes('if (viaTelnyx || viaEngine) {'))
  })
  await t('bot: group chats get no alerts unless switched on', () => {
    const src = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
    assert.ok(src.includes("if (TELEGRAM_NOTIFY_GROUP_ID && GROUP_ALERTS_ON()) {"))
    assert.ok(src.includes("if (!GROUP_ALERTS_ON()) {"))
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
