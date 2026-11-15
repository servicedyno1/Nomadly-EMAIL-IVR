// Fax-number carrier registration: approved → active, rejected → released + full refund (stubbed MultiTEL).
const assert = require('assert')
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect('mongodb://localhost:27017'); const db = c.db('t_fax_reg'); await db.dropDatabase()
  const mt = require('../multitel'), mtFax = require('../multitel/fax')
  const states = { '+31700000001': 'active', '+31700000002': 'rejected', '+31700000003': 'pending' }
  mt.registrationStatus = async (n) => ({ state: states[n], raw: 'stub' })
  mtFax.releaseFax = async () => true
  const pushes = []
  const api = require('../fax-numbers').create(db, { push: (id, t) => pushes.push([id, t]), sweep: false })
  for (const p of Object.keys(states)) await db.collection('faxNumbers').insertOne({ _id: p, phoneNumber: p, chatId: '42', country: 'NL', type: 'local', status: 'pending_registration', price: 50, faxOnly: true, provider: 'multitel_fax', expiresAt: new Date().toISOString() })
  await db.collection('walletOf').insertOne({ _id: '42', usdIn: 150, usdOut: 150 })
  await api.checkRegistrations(); await api.checkRegistrations()
  const get = (p) => db.collection('faxNumbers').findOne({ _id: p })
  assert.equal((await get('+31700000001')).status, 'active')
  assert.ok(new Date((await get('+31700000001')).expiresAt) > new Date(Date.now() + 25 * 864e5))
  assert.equal((await get('+31700000002')).status, 'released')
  assert.equal((await get('+31700000003')).status, 'pending_registration')
  const w = await db.collection('walletOf').findOne({ _id: '42' })
  assert.equal(w.usdIn - w.usdOut, 50, 'refunded exactly once')
  assert.equal(pushes.length, 2)
  // Paperwork rules
  const { paperworkIssue, COUNTRIES } = require('../fax-numbers')
  assert.ok(paperworkIssue('NL', 'local', null))
  assert.equal(paperworkIssue('NL', 'mobile', null), null)
  assert.ok(paperworkIssue('IE', 'local', { type: 'personal', name: 'A B', address: '1 Main St' }))
  assert.equal(paperworkIssue('IE', 'local', { type: 'business', name: 'Acme', address: '1 Main St', countryCode: 'IE' }), null)
  assert.ok(COUNTRIES.length >= 15); assert.equal(COUNTRIES[0].code, 'US')
  assert.ok(['DE', 'FR', 'IT'].every(c => COUNTRIES.some(x => x.code === c)), 'document countries are sold first, details collected after payment')
  console.log('fax registration tests: OK'); await db.dropDatabase(); await c.close(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
