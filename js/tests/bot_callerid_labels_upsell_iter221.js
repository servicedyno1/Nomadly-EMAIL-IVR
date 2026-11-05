#!/usr/bin/env node
// iter221: bot caller ID labels ('🎭 Label · +number' buttons, tap applies), last-used-first, and the one-time
// Cloud IVR hub upsell (cidUpsellSent) for Pro/Starter users. REAL bot via mock Telegram (:5099), bot on :5000.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const BIZ = '990221101', MIX = '990221102', STA = '990221103'
const ALL = [BIZ, MIX, STA]
const OFFICE = '+14155552241', PLAIN = '+14155552242'
let uid = 8_100_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok ? ' :: ' + String(d).slice(0, 900) : ''}`) }
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const calls = async (chat, since) => (await axios.get(`${MOCK}/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
async function say(chat, text, wait = 3500) {
  const since = Date.now(), n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
  await sleep(wait)
  return calls(chat, since)
}
const txt = cs => cs.filter(c => c.method === 'sendMessage').map(c => strip(c.text)).join('\n---\n')
const btns = cs => cs.flatMap(c => c.buttons || [])
const exp = new Date(Date.now() + 25 * 864e5).toISOString()
const num = (phoneNumber, plan, planPrice, extra = {}) => ({ phoneNumber, plan, planPrice, provider: 'telnyx', status: 'active', autoRenew: true, purchaseDate: new Date().toISOString(), expiresAt: exp, capabilities: { voice: true, sms: true }, features: {}, ...extra })

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf', 'phoneNumbersOf', 'userConversion']) await db.collection(c).deleteMany({ _id: { $in: ALL } })
    await db.collection('webCallerIds').deleteMany({ _id: { $in: [OFFICE, PLAIN] }, chatId: { $in: ALL } })
    await db.collection('callerIdDefaults').deleteMany({ chatId: { $in: ALL } })
  }
  await cleanup()
  const HUB = require('../phone-config').btn.cloudPhone
  try {
    for (const id of ALL) {
      await db.collection('state').insertOne({ _id: id, userLanguage: 'en', action: 'none' })
      await db.collection('nameOf').insertOne({ _id: id, val: 'sim' + id })
      await db.collection('walletOf').insertOne({ _id: id, usdIn: 100, usdOut: 0 })
    }
    await db.collection('phoneNumbersOf').insertOne({ _id: BIZ, val: { numbers: [num('+18336221101', 'business', 120)] } })
    await db.collection('phoneNumbersOf').insertOne({ _id: MIX, val: { numbers: [num('+18336221102', 'starter', 50), num('+18336221103', 'pro', 75)] } })
    await db.collection('phoneNumbersOf').insertOne({ _id: STA, val: { numbers: [num('+18336221104', 'starter', 50)] } })
    const old = new Date(Date.now() - 864e5)
    await db.collection('webCallerIds').insertOne({ _id: OFFICE, chatId: BIZ, status: 'verified', method: 'attested', attested: true, label: 'Office', charged: 0, createdAt: Date.now() - 2 * 864e5, verifiedAt: old })
    await db.collection('webCallerIds').insertOne({ _id: PLAIN, chatId: BIZ, status: 'verified', method: 'attested', attested: true, charged: 0, createdAt: Date.now() - 864e5, verifiedAt: new Date(Date.now() - 3600e3) })

    // ── 1. Upsell: Business user gets NO nudge on hub ──
    let cs = await say(BIZ, HUB, 4500)
    check('1a.Business user: hub opens, no upsell', !/price difference/.test(txt(cs)) && cs.length > 0, txt(cs))
    check('1b.Business: cidUpsellSent not set', !(await db.collection('state').findOne({ _id: BIZ }))?.cidUpsellSent)

    // ── 2. Upsell: Starter+Pro user gets ONE nudge ──
    cs = await say(MIX, HUB, 4500)
    const t2 = txt(cs)
    console.log('   MIX upsell text:', t2.split('---').filter(x => /Business/.test(x)).join(' | ').replace(/\n/g, ' ').slice(0, 400))
    check('2a.Starter+Pro: one upsell message', (t2.match(/price difference/g) || []).length === 1, t2)
    check('2b.Starter+Pro: upsell names the Pro number at $45 (cheapest gap)', /\+18336221103/.test(t2) && /\$45\.00/.test(t2), t2)
    check('2c.cidUpsellSent true', (await db.collection('state').findOne({ _id: MIX }))?.cidUpsellSent === true)
    await say(MIX, '↩️ Back', 2000)
    cs = await say(MIX, HUB, 4500)
    check('2d.second hub visit: no upsell', !/price difference/.test(txt(cs)), txt(cs))

    // ── 3. Upsell: Starter-only → $70 ──
    cs = await say(STA, HUB, 4500)
    check('3a.Starter-only: upsell with $70.00 + number', /price difference/.test(txt(cs)) && /\$70\.00/.test(txt(cs)) && /\+18336221104/.test(txt(cs)), txt(cs))
    check('3b.no "logged" wording', !/logged/i.test(txt(cs)), txt(cs))

    // ── 4. Business: Quick IVR New Call shows labeled preset buttons, last-used first ──
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'ivrObSelectCallerId' } })
    cs = await say(BIZ, '📞 New Call', 3500)
    let b = btns(cs)
    console.log('   New Call buttons:', JSON.stringify(b))
    const iO = b.indexOf(`🎭 Office · ${OFFICE}`), iP = b.indexOf(`🎭 ${PLAIN}`)
    check('4a.labeled button "🎭 Office · +number"', iO >= 0, JSON.stringify(b))
    check('4b.unlabeled button "🎭 +number"', iP >= 0, JSON.stringify(b))
    check('4c.most recent (PLAIN verified later) listed first', iP >= 0 && iO >= 0 && iP < iO, JSON.stringify(b))
    cs = await say(BIZ, `🎭 Office · ${OFFICE}`, 3500)
    let s = await db.collection('state').findOne({ _id: BIZ })
    check('4d.tap labeled → displayCallerId set to number, action ivrObEnterTarget', s?.ivrObData?.displayCallerId === OFFICE && s?.action === 'ivrObEnterTarget', JSON.stringify({ a: s?.action, d: s?.ivrObData?.displayCallerId, t: txt(cs) }))
    await sleep(800)
    const doc = await db.collection('webCallerIds').findOne({ _id: OFFICE })
    check('4e.touch(): lastUsedAt set on Office', doc?.lastUsedAt && Date.now() - new Date(doc.lastUsedAt).getTime() < 60000, JSON.stringify(doc))
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'ivrObSelectCallerId' } })
    cs = await say(BIZ, '📞 New Call', 3500)
    b = btns(cs)
    check('4f.after use: Office now first', b.indexOf(`🎭 Office · ${OFFICE}`) >= 0 && b.indexOf(`🎭 Office · ${OFFICE}`) < b.indexOf(`🎭 ${PLAIN}`), JSON.stringify(b))

    // ── 5. Bulk caller select shows labeled presets; tap applies showAs ──
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'bulkSelectCaller', bulkCallerIds: [{ phoneNumber: '+18336221101', label: '+18336221101', type: 'owned_telnyx', provider: 'telnyx' }] } })
    cs = await say(BIZ, `🎭 ${PLAIN}`, 3500)
    s = await db.collection('state').findOne({ _id: BIZ })
    check('5a.bulk: tap unlabeled preset → bulkData.showAs', s?.bulkData?.showAs === PLAIN && s?.action === 'bulkUploadLeads', JSON.stringify({ a: s?.action, b: s?.bulkData, t: txt(cs) }))
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'bulkSelectCaller' } })
    cs = await say(BIZ, `🎭 Office · ${OFFICE}`, 3500)
    s = await db.collection('state').findOne({ _id: BIZ })
    check('5b.bulk: tap labeled preset → bulkData.showAs = number', s?.bulkData?.showAs === OFFICE, JSON.stringify({ a: s?.action, b: s?.bulkData, t: txt(cs) }))
    // forged label for a number not saved → not applied
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'bulkSelectCaller', bulkData: {} } })
    cs = await say(BIZ, '🎭 Fake · +14155559999', 3500)
    s = await db.collection('state').findOne({ _id: BIZ })
    check('5c.bulk: unsaved preset text not applied', s?.bulkData?.showAs !== '+14155559999', JSON.stringify({ a: s?.action, b: s?.bulkData }))

    // ── 6. SIP manage 🎭 → preset rows with label; tap sets default ──
    const line = (await db.collection('phoneNumbersOf').findOne({ _id: BIZ })).val.numbers[0]
    await db.collection('state').updateOne({ _id: BIZ }, { $set: { action: 'cpManageNumber', cpActiveNumber: line } })
    cs = await say(BIZ, '🎭 Show Any Caller ID', 3500)
    b = btns(cs)
    console.log('   SIP buttons:', JSON.stringify(b))
    check('6a.SIP ask shows labeled preset rows', b.includes(`🎭 Office · ${OFFICE}`) && b.includes(`🎭 ${PLAIN}`), JSON.stringify(b) + txt(cs))
    cs = await say(BIZ, `🎭 Office · ${OFFICE}`, 3500)
    const def = await db.collection('callerIdDefaults').findOne({ _id: '+18336221101' })
    check('6b.SIP tap labeled → default showAs set', def?.showAs === OFFICE && /Softphone calls from/.test(txt(cs)), JSON.stringify({ def, t: txt(cs) }))
  } catch (e) {
    console.log('ERROR', e.stack || e.message)
    results.push(false)
  } finally {
    await cleanup()
    await mc.close()
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
    process.exit(0)
  }
})()
