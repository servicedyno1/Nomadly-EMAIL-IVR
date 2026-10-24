// Iter127: Telegram bot Backup Numbers (Call Forwarding) — unit tests for js/backup-numbers.js + fake-update sim
const assert = require('assert')
const { MongoClient } = require('/app/node_modules/mongodb')
const bk = require('/app/js/backup-numbers.js')
const { makeSim, strip } = require('/app/scripts/lib/tg_sim.js')

const CHAT = 990107001
const NUM = '+18885550107'
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, '-', e.message) } }

;(async () => {
  // ---- unit: parse / format ----
  await t('parse 10-digit + E164 + dedupe', () => assert.deepStrictEqual(bk.parse('4155550101, +14155550102, 4155550101').list, ['+14155550101', '+14155550102']))
  await t('parse excludes main', () => assert.deepStrictEqual(bk.parse('+14155550100, +14155550103', ['+14155550100']).list, ['+14155550103']))
  await t('parse >4 error', () => assert.match(bk.parse('+14155550101,+14155550102,+14155550103,+14155550104,+14155550105').error, /up to 4/))
  await t('parse junk error', () => assert.match(bk.parse('hello').error, /not a phone number/))
  await t('parse only main → error', () => assert.match(bk.parse('+14155550100', ['+14155550100']).error, /at least one/))
  await t('parse space-separated +', () => assert.deepStrictEqual(bk.parse('+14155550101 +447700900123').list, ['+14155550101', '+447700900123']))
  await t('saved text', () => assert.match(strip(bk.saved('en', ['+14155550101'])), /✅ Backup numbers saved: /))
  await t('fr button', () => assert.ok(bk.isBtn('manage', '🔁 Numéros de secours') && bk.isBtn('skip', '⏭ Skip')))

  // ---- sim ----
  const cli = await MongoClient.connect('mongodb://localhost:27017'); const db = cli.db('test')
  const seed = async (enabled) => {
    await db.collection('phoneNumbersOf').updateOne({ _id: String(CHAT) }, { $set: { val: { numbers: [{ phoneNumber: NUM, plan: 'pro', status: 'active', dryRun: true, features: { callForwarding: { enabled, mode: enabled ? 'always' : 'disabled', forwardTo: enabled ? '+14155550100' : null } } }] } } }, { upsert: true })
    const doc = await db.collection('phoneNumbersOf').findOne({ _id: String(CHAT) })
    await db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: 'en', action: 'cpCallForwarding', cpActiveNumber: doc.val.numbers[0] } }, { upsert: true })
  }
  try {
    const sim = makeSim(CHAT)
    await seed(true)
    let r = await sim.step({ kind: 'text', v: '🔁 Backup Numbers' })
    const txt1 = r.msgs.map(m => strip(m.text)).join(' | ')
    console.log('  bot:', txt1.slice(0, 200), r.errors)
    await t('bot shows backup prompt', () => assert.match(txt1, /Backup numbers/))
    r = await sim.step({ kind: 'text', v: '4155550101, +14155550102' })
    const txt2 = r.msgs.map(m => strip(m.text)).join(' | ')
    console.log('  bot:', txt2.slice(0, 250), r.errors)
    await t('bot saved reply', () => assert.match(txt2, /Backup numbers saved/))
    const doc = await db.collection('phoneNumbersOf').findOne({ _id: String(CHAT) })
    await t('backups persisted', () => assert.deepStrictEqual(doc.val.numbers[0].features.callForwarding.backups, ['+14155550101', '+14155550102']))
    r = await sim.step({ kind: 'text', v: '🔁 Backup Numbers' })
    const kb = JSON.stringify(r.msgs.map(m => m.kb))
    await t('Remove Backups button shown', () => assert.ok(kb.includes('🗑 Remove Backups'), kb))
    r = await sim.step({ kind: 'text', v: '🗑 Remove Backups' })
    const txt3 = r.msgs.map(m => strip(m.text)).join(' | ')
    console.log('  bot:', txt3.slice(0, 200))
    const doc2 = await db.collection('phoneNumbersOf').findOne({ _id: String(CHAT) })
    await t('backups removed', () => assert.deepStrictEqual(doc2.val.numbers[0].features.callForwarding.backups || [], []))
    // forwarding off → warning
    await seed(false)
    r = await sim.step({ kind: 'text', v: '🔁 Backup Numbers' })
    const txt4 = r.msgs.map(m => strip(m.text)).join(' | ')
    console.log('  bot:', txt4.slice(0, 200))
    await t('needs forwarding warning', () => assert.match(txt4, /Turn on call forwarding first/))
  } finally {
    await db.collection('phoneNumbersOf').deleteOne({ _id: String(CHAT) })
    await db.collection('state').deleteOne({ _id: String(CHAT) })
    await cli.close()
  }
  console.log(`RESULT pass=${pass} fail=${fail}`)
  process.exit(0)
})()
