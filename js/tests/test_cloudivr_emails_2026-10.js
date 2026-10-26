// CloudIVR web emails (2026-10): the scanner turns new records into one email each (welcome, top-up, number live /
// renewed / upgraded, campaign report, voicemail, grouped missed calls, renewal reminder / failed / paused, wallet low /
// empty), honours the on/off switches, never sends twice, and builds the Monday summary. Preview mode records emails.
// Run: node js/tests/test_cloudivr_emails_2026-10.js   (uses the local MongoDB, database cloudivr_emails_test)
'use strict'
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
delete process.env.WEB_EMAILS_LIVE
process.env.WEB_APP_URL = 'https://example.test'
const { MongoClient } = require('mongodb')
const { createEmails } = require('../cloudivr-web/emails.js')
const T = require('../cloudivr-web/email-templates.js')

let pass = 0, fail = 0
const it = (label, cond, detail = '') => { if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}${detail ? `\n     ${detail}` : ''}`) } }
const DAY = 86400000
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const A = 5000000000000101, B = 5000000000000102, OLD = 5000000000000103
const a = String(A), b = String(B), old = String(OLD)

async function main() {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('cloudivr_emails_test')
  await db.dropDatabase()
  const logs = []
  const e = createEmails(db, { log: (m) => logs.push(m) })
  const sent = db.collection('webEmailLog')
  const mine = async (chatId, type) => sent.find({ chatId, type }).toArray()

  // First tick sets the watermark: older records never produce emails.
  await db.collection('webAccounts').insertOne({ _id: OLD, email: 'old@example.com', name: 'Old Timer', createdAt: new Date(Date.now() - 40 * DAY) })
  await db.collection('phoneNumbersOf').insertOne({ _id: old, val: { numbers: [{ phoneNumber: '+15550000003', plan: 'pro', planPrice: 75, status: 'active', autoRenew: true, expiresAt: iso(20 * DAY) }] } })
  await db.collection('walletOf').insertOne({ _id: old, usdIn: 3, usdOut: 0 })
  await e.tick()
  it('watermark: nothing for records from before the first look', (await sent.countDocuments()) === 0)
  it('old account wallet level only remembered (no email)', (await db.collection('webPrefs').findOne({ _id: old }))?.emailState?.wallet === 'low')

  // ── new account A (French) with a Pro number, B (English) with a Starter number
  await db.collection('webAccounts').insertMany([{ _id: A, email: 'alice@example.com', name: 'Alice Martin', createdAt: new Date() }, { _id: B, email: 'bob@example.com', name: '', createdAt: new Date() }])
  await db.collection('webPrefs').insertMany([{ _id: a, lang: 'fr' }, { _id: b, lang: 'en' }])
  await db.collection('walletOf').insertMany([{ _id: a, usdIn: 200, usdOut: 75 }, { _id: b, usdIn: 100, usdOut: 50 }])
  await db.collection('phoneNumbersOf').insertMany([
    { _id: a, val: { numbers: [
      { phoneNumber: '+15550000001', plan: 'pro', planPrice: 75, countryName: 'United States', status: 'active', autoRenew: true, expiresAt: iso(30 * DAY), features: { voicemail: { forwardToEmail: null } } },
      { phoneNumber: '+15550000011', plan: 'business', planPrice: 120, status: 'active', autoRenew: false, expiresAt: iso(2 * DAY) },
      { phoneNumber: '+15550000021', plan: 'pro', planPrice: 75, status: 'active', autoRenew: true, expiresAt: iso(-1 * 3600000), _graceUntil: iso(20 * 3600000) },
      { phoneNumber: '+15550000031', plan: 'pro', planPrice: 75, status: 'suspended', expiresAt: iso(-DAY), _holdUntil: iso(6.5 * DAY) },
    ] } },
    { _id: b, val: { numbers: [{ phoneNumber: '+15550000002', plan: 'starter', planPrice: 50, status: 'active', autoRenew: true, expiresAt: iso(30 * DAY), features: { voicemail: { forwardToEmail: 'bob@example.com' } } }] } },
  ])
  const now = new Date()
  await db.collection('transactions').insertOne({ _id: 'TXN-A1', chatId: a, type: 'wallet-topup', amount: 50, createdAt: now })
  await db.collection('phoneTransactions').insertMany([
    { chatId: a, phoneNumber: '+15550000001', action: 'purchase', plan: 'pro', amount: 75, timestamp: now.toISOString() },
    { chatId: a, phoneNumber: '+15550000001', action: 'auto_renew', plan: 'pro', amount: 75, timestamp: now.toISOString() },
    { chatId: a, phoneNumber: '+15550000001', action: 'upgrade', oldPlan: 'starter', newPlan: 'business', amount: '45.00', timestamp: now.toISOString() },
    { chatId: a, phoneNumber: '+15550000001', action: 'release', plan: 'pro', amount: 0, timestamp: now.toISOString() },
    { chatId: '123456789', phoneNumber: '+19990000000', action: 'purchase', plan: 'pro', amount: 75, timestamp: now.toISOString() },
  ])
  await db.collection('bulkCallCampaigns').insertMany([
    { id: 'camp-1', chatId: a, status: 'completed', callerId: '+15550000001', audioName: 'Spring <b>offer</b>', mode: 'transfer', startedAt: new Date(Date.now() - 600000), completedAt: now, stats: { total: 10, answered: 2, keyPressed: 1, transferred: 1, noAnswer: 6, failed: 2 }, leads: [] },
    { id: 'camp-2', chatId: a, status: 'cancelled', reportPending: true, startedAt: new Date(), completedAt: now, stats: { total: 5 }, leads: [] },
    { id: 'camp-3', chatId: b, status: 'cancelled', startedAt: null, completedAt: now, stats: { total: 5 }, leads: [] },
  ])
  await db.collection('phoneLogs').insertMany([
    { phoneNumber: '+15550000001', from: '+14155550122', type: 'voicemail', duration: 38, transcript: 'Rappelez-moi', timestamp: now.toISOString() },
    { phoneNumber: '+15550000002', from: '+14155550123', type: 'voicemail', duration: 12, timestamp: now.toISOString() },
    { phoneNumber: '+15550000001', from: '+14155550124', type: 'missed', timestamp: now.toISOString() },
    { phoneNumber: '+15550000001', from: '+14155550125', type: 'missed', timestamp: now.toISOString() },
    { phoneNumber: '+15550000001', from: '+14155550126', type: 'forwarded', duration: 60, timestamp: now.toISOString() },
  ])
  await e.tick() // tick #2 → events only (states run every 5th tick)
  for (const t of ['welcome', 'topup', 'numberLive', 'renewed', 'upgraded', 'campaignDone', 'voicemail', 'missed']) it(`A got one "${t}" email`, (await mine(a, t)).length === 1, JSON.stringify(await mine(a, t)))
  it('B got a welcome email too', (await mine(b, 'welcome')).length === 1)
  it('release and Telegram-user purchases send nothing', (await sent.countDocuments({ type: 'numberLive' })) === 1)
  it('campaign still settling (reportPending) and never-started campaign wait / skip', !(await sent.findOne({ _id: 'campaign:camp-2' })) && !(await sent.findOne({ _id: 'campaign:camp-3' })))
  it('two missed calls → one grouped email', (await sent.findOne({ type: 'missed' })).subject.includes('2 appels manqués'), (await sent.findOne({ type: 'missed' })).subject)
  it('voicemail already emailed to the account address (forwardToEmail) is skipped', (await mine(b, 'voicemail')).length === 0)
  const fr = await sent.findOne({ type: 'topup', chatId: a })
  it('A (French) gets French emails with French money format', fr.lang === 'fr' && /^50,00\s\$ sont arrivés/.test(fr.subject), fr.subject)
  it('preview mode stores the HTML and does not send', fr.ok === 'preview' && fr.html.includes('<html lang="fr"'))
  const camp = await sent.findOne({ _id: 'campaign:camp-1' })
  it('campaign name is escaped in the HTML', !camp.html.includes('<b>offer</b>') && camp.html.includes('&lt;b&gt;offer'))
  it('links use WEB_APP_URL + /cloudivr app path', camp.html.includes('https://example.test/cloudivr/app/campaigns/camp-1'))
  it('optional email carries its one-click stop link', camp.html.includes('/api/cloudivr-web/public/email/off?u=5000000000000101&amp;g=campaigns&amp;t='))
  it('receipts have no stop link', !fr.html.includes('public/email/off'))

  await e.tick(); await e.tick(); await e.tick() // ticks 3–5
  const total = await sent.countDocuments()
  await e.tick() // tick #6 → events again + number states + wallet levels
  it('re-scanning the same records sends nothing new (idempotent)', (await sent.countDocuments({ type: { $in: ['welcome', 'topup', 'numberLive', 'renewed', 'upgraded', 'campaignDone', 'voicemail', 'missed'] } })) === 9)
  it('renewal reminder (manual renew) for the number expiring in 2 days', (await sent.findOne({ type: 'renewSoon', chatId: a }))?.subject.includes('+15550000011 expire le'))
  it('failed renewal (grace) email', (await mine(a, 'renewFailed')).length === 1)
  it('paused number email', (await mine(a, 'suspended')).length === 1)
  it('new accounts: wallet level baseline is ok → no wallet email while funded', (await sent.countDocuments({ type: { $in: ['lowBalance', 'walletEmpty'] } })) === 0, `total before ${total}`)

  // Wallet drops: A 125 → 6 (low), then → 0.2 (empty); topping up resets; B turned the low alert up to $60 (B has 50)
  await db.collection('walletOf').updateOne({ _id: a }, { $set: { usdOut: 194 } })
  for (let i = 0; i < 5; i++) await e.tick()
  it('low-balance email once when A drops below $10', (await mine(a, 'lowBalance')).length === 1)
  await db.collection('walletOf').updateOne({ _id: a }, { $set: { usdOut: 199.8 } })
  for (let i = 0; i < 5; i++) await e.tick()
  it('wallet-empty email when A drops under $0.50', (await mine(a, 'walletEmpty')).length === 1)
  for (let i = 0; i < 5; i++) await e.tick()
  it('no repeat while it stays empty', (await mine(a, 'walletEmpty')).length === 1 && (await mine(a, 'lowBalance')).length === 1)
  await db.collection('walletOf').updateOne({ _id: a }, { $set: { usdOut: 0 } })
  for (let i = 0; i < 5; i++) await e.tick()
  await db.collection('walletOf').updateOne({ _id: a }, { $set: { usdOut: 195 } })
  for (let i = 0; i < 5; i++) await e.tick()
  it('after a top-up the low alert can fire again', (await mine(a, 'lowBalance')).length === 2)

  // Switches: B turns weekly + voicemail off; weekly run skips B, sends A
  await db.collection('webPrefs').updateOne({ _id: b }, { $set: { 'emailPrefs.weekly': false } })
  const n = await e.runWeekly()
  it('weekly summary sent to A only (B switched it off; old account included)', n === 2 && (await mine(a, 'weekly')).length === 1 && (await mine(b, 'weekly')).length === 0)
  it('weekly run is once per day', (await e.runWeekly()) === 0)
  const wk = await e.weeklyFor(a, (await db.collection('phoneNumbersOf').findOne({ _id: a })).val.numbers)
  it('weekly counts calls, missed, voicemails and minutes', wk.callsIn === 4 && wk.missed === 2 && wk.voicemails === 1 && wk.minutes === 2, JSON.stringify(wk))
  it('weekly lists numbers renewing within 7 days', wk.renewals.length === 1 && wk.renewals[0].phone === '+15550000011')
  it('weekly picks the highest plan for the tip', wk.plan === 'business' && !wk.quiet)

  // Test email ignores the switches; every type renders in every language
  await e.send(b, 'campaignDone', await e.sample('campaignDone', b), 'test:b:1', { force: true })
  it('test email is sent even with the group off', !!(await sent.findOne({ _id: 'test:b:1' })))
  let bad = []
  for (const type of T.TYPES) for (const lang of ['en', 'fr', 'es']) {
    try { const r = e.render(type, await e.sample(type, a), { acc: { _id: A, email: 'alice@example.com', name: 'Alice' }, lang, email: {} }); if (!r.subject || !r.html.includes(`lang="${lang}"`) || /undefined|NaN|\[object/.test(r.subject + r.html)) bad.push(`${type}/${lang}`) } catch (err) { bad.push(`${type}/${lang}: ${err.message}`) }
  }
  it(`all ${T.TYPES.length} emails render in en/fr/es without undefined/NaN`, !bad.length, bad.join(', '))
  it('no scanner errors logged', !logs.some(l => /failed/.test(l)), logs.filter(l => /failed/.test(l)).join(' | '))

  await db.dropDatabase()
  await client.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
