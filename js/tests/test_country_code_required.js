// Owner rule: every number needs its country code (BulkSMS, Bulk IVR, single IVR, web). 10-digit numbers are rejected with the fix.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'), { MongoClient } = require('mongodb'), fs = require('fs')
const B = require('../bulk-esim/core'), ci = require('../contacts-import'), { normPhone } = require('../cloudivr-web/numbers')
const CHAT = 990000114, LOG = '/var/log/supervisor/nodejs.out.log'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
const tg = (text) => axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now(), message: { message_id: Date.now() % 1e6, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }).then(() => new Promise(r => setTimeout(r, 2000)))
const lastOut = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(`[tg-out] {"chat":"${CHAT}"`)).pop() || ''
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME); await B.init({ db, log: () => {} })
  const r = await B.parseContacts('nomadly:1', '+14155550100\n14155550101\n4155550102\n(415) 555-0103\n')
  ok(r.contacts.length === 2 && r.noCode === 2, `BulkSMS upload: 2 kept, 2 flagged "no country code" (${JSON.stringify(r)})`)
  ok(ci.normalizeNumber('4155550100') === null && /no country code/.test(ci.numberIssue('4155550100')), 'Bulk IVR list: 10-digit rejected with fix')
  ok(normPhone('4155550100') === '' && normPhone('+14155550100') === '+14155550100' && normPhone('0044 7911 123456') === '+447911123456', 'Web: 10-digit rejected, +/00 accepted')
  const set = (o) => db.collection('state').updateOne({ _id: String(CHAT) }, { $set: o }, { upsert: true })
  for (const lang of ['en', 'fr']) {
    await set({ action: 'bse-one-to', userLanguage: lang }); await tg('4155550100')
    let s = await db.collection('state').findOne({ _id: String(CHAT) })
    ok(s.action === 'bse-one-to' && lastOut().includes('+14155550100'), `${lang}: BulkSMS single SMS rejects 10-digit and shows +14155550100`)
    await tg('+1 415 555 0100'); s = await db.collection('state').findOne({ _id: String(CHAT) })
    ok(s.action === 'bse-one-text', `${lang}: +1 number accepted`)
    await set({ action: 'ivrObEnterTarget', userLanguage: lang, ivrObData: { callerId: '+13346972125' } }); await tg('2025551234')
    s = await db.collection('state').findOne({ _id: String(CHAT) })
    ok(s.action === 'ivrObEnterTarget' && lastOut().includes('+12025551234') && lastOut().includes(lang === 'fr' ? 'indicatif' : 'country code'), `${lang}: single IVR rejects 10-digit in ${lang} with the fix`)
  }
  await db.collection('state').deleteOne({ _id: String(CHAT) }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
