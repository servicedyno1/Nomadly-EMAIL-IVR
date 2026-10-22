#!/usr/bin/env node
// Scenario D: instant Telnyx countries (PR local, CO mobile) — summary has NO verification line. Does NOT pay (no real buy).
const H = require('./tx_payfirst_harness')
const { check, strip, last } = H
H.NAMES.PR = '🇵🇷 Puerto Rico'; H.NAMES.CO = '🇨🇴 Colombia'; H.NUMS.PR = '+17875550001'; H.NUMS.CO = '+573000000001'
;(async () => {
  await H.connect()
  const users = []
  try {
    for (const [cc, type, U] of [['PR', 'local', '990300061'], ['CO', 'mobile', '990300062']]) {
      users.push(U)
      await H.seed(U, cc, type)
      const r = await H.sendText(U, '1', { max: 20000, settle: 2000 })
      const sm = last(r)
      check(`D ${cc} summary shown with pay button`, (sm.buttons || []).some(b => /Wallet/.test(b)), strip(sm.text).slice(0, 200))
      check(`D ${cc} summary has NO verification line`, !/Verification after payment/.test(strip(sm.text)), strip(sm.text))
      check(`D ${cc} cpVerifyNote null`, !(await H.stateOf(U)).cpVerifyNote, (await H.stateOf(U)).cpVerifyNote)
    }
  } catch (e) { console.log('ERROR', e.stack) } finally {
    for (const u of users) await H.cleanup(u)
    H.summaryOut(); await H.close()
  }
})()
