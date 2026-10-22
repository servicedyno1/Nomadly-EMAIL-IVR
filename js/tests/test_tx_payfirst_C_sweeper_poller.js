#!/usr/bin/env node
// Scenario C: abandonment sweeper (6h reminder once, 48h expiry+refund) + review poller rejection → refund
// Waits for the in-bot 5-min poller (TELNYX_REVIEW_POLLER=true). Optional argv[2] = chatId of an existing under_review pending order.
const H = require('./tx_payfirst_harness')
const { check, strip, txt } = H
const near = (a, b) => Math.abs(a - b) < 0.01
;(async () => {
  await H.connect()
  const R = '990300051', E = '990300052', P = process.argv[2] || null
  try {
    for (const U of [R, E]) { await H.seed(U, 'NL', 'mobile'); await H.selectAndPay(U) }
    const priceR = (await H.sess(R)).payment.refund.amount, priceE = (await H.sess(E)).payment.refund.amount
    const col = H.db.collection('telnyxRegSessions')
    await col.updateOne({ chatId: R, status: 'collecting' }, { $set: { updatedAt: new Date(Date.now() - 7 * 3600e3) } })
    await col.updateOne({ chatId: E, status: 'collecting' }, { $set: { updatedAt: new Date(Date.now() - 49 * 3600e3) } })
    let pend = null, pW0 = null
    if (P) {
      pend = await H.db.collection('telnyxPendingOrders').findOne({ chatId: P, status: 'under_review' })
      pW0 = await H.wallet(P)
      if (pend) {
        await H.mtxConfig({ order_status: 'failure', phone_status: 'failure', requirements_status: 'rejected', order_error: null })
        await H.db.collection('telnyxPendingOrders').updateOne({ _id: pend._id }, { $set: { nextCheckAt: new Date(Date.now() - 60000) } })
      } else console.log('  no under_review pending order for', P)
    }
    const since = Date.now()
    const t0 = Date.now()
    while (Date.now() - t0 < 345000) {
      const sE = await col.findOne({ chatId: E }, { sort: { updatedAt: -1 } }), sR = await col.findOne({ chatId: R, status: 'collecting' })
      const pd = pend ? await H.db.collection('telnyxPendingOrders').findOne({ _id: pend._id }) : null
      if (sE?.status === 'expired' && sR?.reminded && (!pend || pd?.status !== 'under_review')) break
      await H.sleep(10000)
    }
    console.log(`  waited ${Math.round((Date.now() - t0) / 1000)}s`)
    const mR = await H.calls(R, since), mE = await H.calls(E, since)
    const sR = await col.findOne({ chatId: R, status: 'collecting' }), sE = await col.findOne({ chatId: E }, { sort: { updatedAt: -1 } })
    check('C1 6h idle → reminded flag set, still collecting', sR?.reminded === true, JSON.stringify({ st: sR?.status, rem: sR?.reminded }))
    check('C2 6h idle → exactly one reminder message', mR.length === 1, mR.length + ' ' + txt(mR))
    check('C3 6h idle → no refund', near((await H.wallet(R)).usdIn, 500))
    check('C4 48h idle → expired', sE?.status === 'expired', sE?.status)
    check('C5 48h idle → refunded', near((await H.wallet(E)).usdIn, 500 + priceE), JSON.stringify(await H.wallet(E)))
    check('C6 48h idle → "Verification not completed" msg', /Verification not completed/.test(txt(mE)), txt(mE))
    check('C7 48h idle → action reset', (await H.stateOf(E)).action !== 'cpTxReg', (await H.stateOf(E)).action)
    if (pend) {
      const pd = await H.db.collection('telnyxPendingOrders').findOne({ _id: pend._id })
      const mP = await H.calls(P, since)
      check('C8 poller: failure → status rejected', pd?.status === 'rejected', pd?.status + ' ' + (pd?.lastError || ''))
      check('C9 poller: refunded once', near((await H.wallet(P)).usdIn, (pW0.usdIn || 0) + pend.refund.amount), JSON.stringify(await H.wallet(P)))
      check('C10 poller: "Verification not approved" msg', /Verification not approved/.test(txt(mP)), txt(mP))
    }
    // second sweep window must not double anything: wait for another pass only if requested
    if (process.env.SECOND_PASS) {
      await H.sleep(310000)
      check('C11 no second reminder', (await H.calls(R, since)).length === 1)
      check('C12 no second expiry refund', near((await H.wallet(E)).usdIn, 500 + priceE))
    }
    void priceR; void strip
  } catch (e) { console.log('ERROR', e.stack) } finally {
    await H.mtxConfig(H.MTX_DEFAULT)
    if (!process.env.KEEP) { await H.cleanup(R); await H.cleanup(E); if (P) await H.cleanup(P) }
    H.summaryOut(); await H.close()
  }
})()
