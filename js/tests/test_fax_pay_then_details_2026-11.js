// Fax numbers: pay first, details after payment, cancel → refund, 14-day auto refund, reminders (stubbed MultiTEL).
const assert = require('assert')
const { MongoClient } = require('mongodb')
;(async () => {
  process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
  const c = await MongoClient.connect('mongodb://localhost:27017'); const db = c.db('t_fax_paylater'); await db.dropDatabase()
  const acct = require('../multitel/fax'); acct.releaseFax = async () => true
  const pushes = []
  const api = require('../fax-numbers').create(db, { push: (id, t) => pushes.push([id, t]), sweep: false })
  await db.collection('walletOf').insertOne({ _id: '7', usdIn: 500, usdOut: 0 })
  const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: '7' }); return w.usdIn - w.usdOut }
  let ok = 0; const t = async (n, f) => { await f(); ok++; console.log('✅', n) }
  await t('offer hides paperwork while choosing', () => assert.ok(api.offer().countries.every(x => x.types.every(y => y.paperwork === undefined))))
  await t('documents country (DE) is bought without any details → paid, needs details', async () => {
    await db.collection('faxNumberSearch').insertOne({ _id: '7', country: 'DE', type: 'local', results: [{ phoneNumber: '+4930111' }] })
    const r = await api.buy('7', { phoneNumber: '+4930111' })
    assert.equal(r.number.status, 'pending_registration'); assert.equal(r.number.registration.needsDetails, true); assert.equal(r.number.registration.paperwork, 'documents')
    assert.equal(await bal(), 450)
  })
  await t('details without documents are refused with a clear message', async () => {
    await assert.rejects(api.submitDetails('7', '+4930111', { endUser: { type: 'personal', name: 'A B', address: 'x', countryCode: 'DE' }, person: { signature: 'png' } }), /documents/)
  })
  await t('details with documents go to the carrier', async () => {
    await db.collection('numberDocs').insertOne({ _id: '7:DE', files: [{ id: 'f', path: 'p', name: 'id.pdf' }] })
    const n = await api.submitDetails('7', '+4930111', { endUser: { type: 'personal', name: 'A B', address: 'x', countryCode: 'DE' }, person: { signature: 'png' } })
    assert.equal(n.registration.needsDetails, false)
  })
  await t('customer can cancel before approval for a full refund', async () => {
    const r = await api.cancelPending('7', '+4930111'); assert.equal(r.refunded, 50); assert.equal(await bal(), 500)
    await assert.rejects(api.cancelPending('7', '+4930111'))
  })
  await t('reminder after 1 day, refund after 14 days', async () => {
    await db.collection('faxNumbers').insertOne({ _id: '+33100', phoneNumber: '+33100', chatId: '7', country: 'FR', type: 'local', status: 'pending_registration', price: 50, dryRun: true, registration: { status: 'needs_details', level: 2, since: new Date(Date.now() - 1.5 * 864e5) } })
    await db.collection('walletOf').updateOne({ _id: '7' }, { $inc: { usdOut: 50 } })
    await api.chaseDetails(); await api.chaseDetails()
    assert.equal(pushes.filter(p => /reserved/.test(p[1])).length, 1)
    await api.chaseDetails(Date.now() + 13 * 864e5)
    assert.equal((await db.collection('faxNumbers').findOne({ _id: '+33100' })).status, 'released'); assert.equal(await bal(), 500)
  })
  console.log(`${ok}/6 passed`); await db.dropDatabase(); await c.close(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
