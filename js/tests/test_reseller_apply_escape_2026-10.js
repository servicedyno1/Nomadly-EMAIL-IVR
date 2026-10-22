#!/usr/bin/env node
// Probe: escaping the 💼 Reseller form via main-menu buttons / /start, and reseller-pay Back (state not stuck).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
let uid = 9_500_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' :: ' + String(detail).slice(0, 400) : ''}`) }
async function text(chat, t, wait = 1800) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text: t } }, { timeout: 20000 })
  await sleep(wait)
  return (await axios.get(`${MOCK}/_calls?chat_id=${chat}&since=${since}`)).data.filter(c => c.method === 'sendMessage')
}
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const U = '990400060'
  const clean = async () => { for (const c of ['state', 'walletOf']) await db.collection(c).deleteMany({ _id: U }); await db.collection('resellerApplications').deleteMany({ chatId: U }) }
  try {
    await clean()
    await db.collection('state').insertOne({ _id: U, userLanguage: 'en', action: 'none' })
    for (const esc of ['🏠 Main Menu', '/start', '👛 Wallet']) {
      await text(U, '💼 Reseller'); await text(U, '📝 Apply Now'); await text(U, '⏭ Skip')
      const r = await text(U, esc, 2500)
      const d = await db.collection('resellerApplications').findOne({ chatId: U }, { sort: { updatedAt: -1 } })
      const st = await db.collection('state').findOne({ _id: U })
      check(`"${esc}" on brand step escapes form (not saved as brand)`, d.answers.brand !== esc && st.action !== 'rsApply', `brand=${d.answers.brand} action=${st.action} replies=${JSON.stringify(r.map(m => strip(m.text).slice(0, 60)))}`)
      check(`"${esc}" → draft cancelled`, d.status === 'cancelled' && !(await db.collection('resellerApplications').findOne({ chatId: U, status: 'draft' })), `status=${d.status}`)
      await db.collection('state').updateOne({ _id: U }, { $set: { action: 'none' } })
    }
    // Escape on the services step → inline panel buttons removed, stale taps closed
    await text(U, '💼 Reseller'); await text(U, '📝 Apply Now'); await text(U, '⏭ Skip'); await text(U, 'EscBrand')
    for (const o of ['🤖 Own white-label bot', '1–10', '🌐 Website', 'Under 1k']) await text(U, o)
    let dr = await db.collection('resellerApplications').findOne({ chatId: U, status: 'draft' })
    const pmid = dr?.panelMsgId
    check('services step reached + panel message id saved', dr?.idx === 6 && !!pmid, JSON.stringify({ idx: dr?.idx, pmid }))
    const since = Date.now()
    const wr = await text(U, '👛 Wallet', 2500)
    const all = (await axios.get(`${MOCK}/_calls?chat_id=${U}&since=${since}`)).data
    dr = await db.collection('resellerApplications').findOne({ _id: dr?._id })
    let st = await db.collection('state').findOne({ _id: U })
    check('Wallet on services step → draft cancelled + action none', dr?.status === 'cancelled' && st.action !== 'rsApply', `${dr?.status} ${st.action}`)
    check('Wallet on services step → services panel buttons removed', all.some(x => x.method === 'editMessageReplyMarkup' && JSON.stringify(x).includes(String(pmid))), JSON.stringify(all.map(x => x.method)))
    check('Wallet on services step → wallet screen shown', wr.some(m => /Wallet|Balance/i.test(strip(m.text))), JSON.stringify(wr.map(m => strip(m.text).slice(0, 60))))
    const s2 = Date.now(); const n = uid++
    await axios.post(WEBHOOK, { update_id: n, callback_query: { id: String(n), from: { id: Number(U), is_bot: false, first_name: 'Sim' }, message: { message_id: pmid, date: Math.floor(Date.now() / 1000), chat: { id: Number(U), type: 'private' } }, data: 'rsa:t:ivr' } }, { timeout: 20000 })
    await sleep(1500)
    const all2 = (await axios.get(`${MOCK}/_calls?since=${s2}`)).data
    check('stale service tap → "This step is closed." + buttons removed', /This step is closed/.test(JSON.stringify(all2.filter(x => x.method === 'answerCallbackQuery'))) && all2.some(x => x.method === 'editMessageReplyMarkup'), JSON.stringify(all2.map(x => x.method)))
    // ❌ Cancel inside the form still cancels with the form's own message
    await db.collection('state').updateOne({ _id: U }, { $set: { action: 'none' } })
    await text(U, '💼 Reseller'); await text(U, '📝 Apply Now'); await text(U, '⏭ Skip')
    const cr = await text(U, '❌ Cancel')
    st = await db.collection('state').findOne({ _id: U })
    dr = await db.collection('resellerApplications').findOne({ chatId: U }, { sort: { updatedAt: -1 } })
    check('❌ Cancel in form → "Application cancelled" + draft cancelled', cr.some(m => /Application cancelled/.test(strip(m.text))) && dr.status === 'cancelled' && st.action === 'none', `${dr.status} ${st.action} ${JSON.stringify(cr.map(m => strip(m.text).slice(0, 60)))}`)
    await db.collection('state').updateOne({ _id: U }, { $set: { action: 'none' } })
    // reseller-pay Back
    const now = new Date()
    await db.collection('resellerApplications').deleteMany({ chatId: U })
    await db.collection('resellerApplications').insertOne({ _id: 'TESTesc-' + Date.now(), chatId: U, status: 'pending_payment', tier: 'priority', answers: { brand: 'Esc', services: ['ivr'] }, createdAt: now, updatedAt: now, submittedAt: now })
    await text(U, '💼 Reseller'); await text(U, '💳 Complete Payment', 2500)
    let r = await text(U, '⬅️ Back')
    st = await db.collection('state').findOne({ _id: U })
    check('Back on checkout → reseller status screen (rsHome)', st.action === 'rsHome' && /waiting for payment/.test(strip(r.slice(-1)[0]?.text)), `${st.action} ${JSON.stringify(r.map(m => strip(m.text).slice(0, 60)))}`)
    r = await text(U, '🏠 Main Menu')
    st = await db.collection('state').findOne({ _id: U })
    check('Main Menu from rsHome → action none', st.action === 'none', st.action)
  } catch (e) { console.log('ERROR', e.message) } finally {
    await clean(); await mc.close()
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(0)
  }
})()
