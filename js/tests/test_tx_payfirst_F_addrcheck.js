#!/usr/bin/env node
// Scenario F: NZ local — Telnyx address validation says invalid → addr_check buttons (Use suggested / Keep / Re-enter), Back
const H = require('./tx_payfirst_harness')
const { check, strip, last, txt } = H
;(async () => {
  await H.connect()
  const U = '990300081'
  try {
    await H.seed(U, 'NZ', 'local')
    await H.selectAndPay(U)
    await H.walkTo(U, 'street', { ...H.DEFAULT_ANS, phone: '+6421123456' }, false)
    await H.sendText(U, 'Xyzzy 99999'); await H.sendText(U, 'Qwerty'); await H.sendText(U, '⏭ Skip')
    let r = await H.sendText(U, '0000', { max: 25000, settle: 2500 })
    let s = await H.sess(U)
    const m = last(r)
    console.log('  step:', s.steps[s.idx], 'addrCheck:', JSON.stringify(s.addrCheck))
    console.log('  msg:', strip(m.text).replace(/\n/g, ' ⏎ ').slice(0, 400), JSON.stringify(m.buttons))
    check('F1 invalid address → addr_check step', s.steps[s.idx] === 'addr_check', s.steps[s.idx])
    check('F2 Keep + Re-enter buttons', (m.buttons || []).includes('➡️ Keep my address') && (m.buttons || []).some(b => /Re-enter/i.test(b)), JSON.stringify(m.buttons))
    const sugBtn = (m.buttons || []).find(b => /suggested/i.test(b))
    check('F3 no "Use suggested" button when Telnyx returns an empty suggestion', !sugBtn, `button shown: ${sugBtn} | text: ${strip(m.text).slice(0, 300)}`)
    r = await H.sendText(U, '⬅️ Back')
    s = await H.sess(U)
    check('F4 Back from addr_check → postal step', s.steps[s.idx] === 'postal', s.steps[s.idx])
    r = await H.sendText(U, '0000', { max: 25000, settle: 2500 })
    r = await H.sendText(U, '➡️ Keep my address')
    s = await H.sess(U)
    check('F5 Keep → advances past addr_check with keptInvalid', s.steps[s.idx] !== 'addr_check' && s.addrCheck?.keptInvalid === true, s.steps[s.idx] + JSON.stringify(s.addrCheck))
    await H.walkTo(U, 'review', H.DEFAULT_ANS, false)
    await H.mtxClear()
    r = await H.sendText(U, '✅ Submit for verification', { max: 30000, settle: 3000 })
    const addr = (await H.mtxCalls()).find(c => c.method === 'POST' && c.path === '/addresses')
    check('F6 kept-invalid address created with validate_address=false', addr && addr.body.validate_address === false, JSON.stringify(addr?.body))
    check('F7 order placed', (await H.anySess(U)).status === 'ordered', (await H.anySess(U)).status)
  } catch (e) { console.log('ERROR', e.stack) } finally {
    await H.cleanup(U); H.summaryOut(); await H.close()
  }
})()
