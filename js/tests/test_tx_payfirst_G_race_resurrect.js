#!/usr/bin/env node
// Scenario G: race — session closed (sweeper expiry / cancel) WHILE a user answer is being processed.
// handleInput.reply() does replaceOne({_id}) without a status guard → may resurrect a closed (already refunded) session.
const H = require('./tx_payfirst_harness')
const { check } = H
;(async () => {
  await H.connect()
  const U = '990300091'
  try {
    await H.seed(U, 'NL', 'mobile')
    await H.selectAndPay(U)
    await H.walkTo(U, 'country', H.DEFAULT_ANS, false)
    const col = H.db.collection('telnyxRegSessions')
    const s = await H.sess(U)
    const p = H.post(U, { text: 'Netherlands' }) // triggers live address validation (~0.5-1.5s) before saving
    await H.sleep(120)
    const closed = await col.findOneAndUpdate({ _id: s._id, status: 'collecting' }, { $set: { status: 'expired', expiredAt: new Date(), updatedAt: new Date() } })
    console.log('  closed externally while input in-flight:', !!closed)
    await p; await H.sleep(5000)
    const after = await col.findOne({ _id: s._id })
    console.log('  status after in-flight answer saved:', after.status, 'expiredAt' in after ? '(has expiredAt)' : '')
    check('G1 closed session NOT resurrected by concurrent answer', after.status !== 'collecting', `status=${after.status} expiredAt=${after.expiredAt} → a refunded session is collecting again (double-refund risk via later Cancel/expiry)`)
  } catch (e) { console.log('ERROR', e.stack) } finally {
    await H.cleanup(U); H.summaryOut(); await H.close()
  }
})()
