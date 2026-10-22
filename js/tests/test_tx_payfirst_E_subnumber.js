#!/usr/bin/env node
// Scenario E: sub-number (extra number on an existing plan) for a verify:true Telnyx country via wallet pay → blocked + refunded, no session
const H = require('./tx_payfirst_harness')
const { check, txt } = H
;(async () => {
  await H.connect()
  const U = '990300071'
  try {
    await H.seed(U, 'NL', 'mobile', { extra: { cpIsSubNumber: true, cpSubParentNumber: '+15550001111' } })
    const { summary, afterPay, price, payBtn } = await H.selectAndPay(U)
    console.log('  pay btn:', payBtn, 'price', price)
    console.log('  after pay:', txt(afterPay).slice(0, 500).replace(/\n/g, ' ⏎ '))
    check('E1 sub summary hides verification note', !/Verification after payment/.test(H.strip(summary.text)))
    check('E2 sub-number blocked message', /can.t be added as an extra number/.test(txt(afterPay)), txt(afterPay))
    check('E3 no verification session created', !(await H.anySess(U)))
    const w = await H.wallet(U)
    check('E4 wallet net zero (refunded)', Math.abs((w.usdIn || 0) - (w.usdOut || 0) - 500) < 0.01, JSON.stringify(w))
  } catch (e) { console.log('ERROR', e.stack) } finally {
    await H.cleanup(U); H.summaryOut(); await H.close()
  }
})()
