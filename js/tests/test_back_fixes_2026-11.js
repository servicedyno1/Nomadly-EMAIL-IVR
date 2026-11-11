// Back works on screens that used to ignore it (2026-11 sweep): wallet confirm, support chat, preset name, address entry,
// first-run email, crashed screens (lost flow data), Persian Back, and BulkSMS with a Back label from another language.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const { makeSim, strip } = require('../../scripts/lib/tg_sim')
const CHAT = '990000203'
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), st = db.collection('state')
  const sim = makeSim(CHAT)
  const at = async (fields, text) => { await st.replaceOne({ _id: CHAT }, { _id: CHAT, userLanguage: 'en', history: [], ...fields }, { upsert: true }); const r = await sim.step({ kind: 'text', v: text }); return { r, s: await st.findOne({ _id: CHAT }), out: r.msgs.map(m => strip(m.text)).join('\n') } }

  let x = await at({ action: 'walletSelectCurrencyConfirm' }, '↩️ Back')
  ok(x.s.action !== 'walletSelectCurrencyConfirm' && !/Confirm\?/.test(x.out), 'wallet confirm: Back leaves the confirm screen')
  x = await at({ action: 'walletSelectCurrencyConfirm' }, 'No')
  ok(x.s.action !== 'walletSelectCurrencyConfirm', 'wallet confirm: No leaves the confirm screen')
  x = await at({ action: 'supportChat' }, '↩️ Back')
  ok(x.s.action === 'none', 'support chat: Back ends the chat')
  x = await at({ action: 'ivrObPresetName', ivrPresets: [] }, '↩️ Back')
  ok(!(x.s.ivrPresets || []).some(p => /Back/.test(p.name)), 'preset name: Back is not saved as a preset name')
  x = await at({ action: 'cpEnterAddress' }, '↩️ Back')
  ok(x.s.action !== 'cpEnterAddress' && !/Address format/.test(x.out), 'address entry: Back exits instead of being read as an address')
  x = await at({ action: 'joinEmail' }, '↩️ Back')
  ok(x.s.action !== 'joinEmail', 'first-run email: Back moves on')
  x = await at({ action: 'manageVpsSub' }, '↩️ Back')
  ok(x.r.msgs.length > 0 && x.s.action === 'none', 'screen with lost flow data: Back still lands on the main menu')
  x = await at({ action: 'confirmSiteOfflineMode' }, '↩️ Back')
  ok(!/t\.selectCorrectOption|select a option/.test(x.out), 'hosting confirm screens: no raw "t.selectCorrectOption" text')
  x = await at({ action: 'bse-contacts', userLanguage: 'fa' }, '↩️ بازگشت')
  ok(x.s.action === 'bse-home', 'fa: Persian Back works in BulkSMS')
  x = await at({ action: 'bse-contacts', userLanguage: 'fr' }, '↩️ Back')
  ok(x.s.action === 'bse-home', 'fr: an English Back label from an old keyboard works in BulkSMS')
  await st.deleteOne({ _id: CHAT }); await cl.close()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
