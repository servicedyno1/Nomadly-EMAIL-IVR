// Shared harness for Telnyx pay-first verification tests (mock Telegram :5099, mock Telnyx reg :5098, bot webhook :5000)
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const MTX = 'http://127.0.0.1:5098'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
let uid = 9_000_000 + Math.floor(Math.random() * 500000)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 600) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' :: ' + String(detail).slice(0, 600) : ''}`) }
const NAMES = { NL: '🇳🇱 Netherlands', GB: '🇬🇧 United Kingdom', NZ: '🇳🇿 New Zealand', IL: '🇮🇱 Israel', IE: '🇮🇪 Ireland', AU: '🇦🇺 Australia' }
const NUMS = { NL: '+3197000000001', GB: '+447700900001', NZ: '+6490000001', IL: '+972500000001', IE: '+35310000001', AU: '+611800000001' }

let db, mc
async function connect() { mc = await MongoClient.connect(process.env.MONGO_URL); db = mc.db(process.env.DB_NAME); return db }
async function close() { if (mc) await mc.close() }
async function calls(U, since) { return (await axios.get(`${MOCK}/_calls?chat_id=${U}&since=${since}`)).data.filter(c => c.method === 'sendMessage') }
// poll until messages settle
async function waitMsgs(U, since, { min = 1, max = 15000, settle = 1500 } = {}) {
  const t0 = Date.now(); let last = -1; let stableAt = Date.now()
  while (Date.now() - t0 < max) {
    const cs = await calls(U, since)
    if (cs.length !== last) { last = cs.length; stableAt = Date.now() }
    if (cs.length >= min && Date.now() - stableAt >= settle) return cs
    await sleep(300)
  }
  return calls(U, since)
}
const base = U => ({ chat: { id: Number(U), type: 'private', first_name: 'Sim' }, from: { id: Number(U), is_bot: false, first_name: 'Sim', username: 'sim' + U } })
async function post(U, extra) { const n = uid++; await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), ...base(U), ...extra } }, { timeout: 30000 }); return n }
async function sendText(U, text, opt) { const since = Date.now(); await post(U, { text }); return waitMsgs(U, since, opt) }
async function sendPhoto(U, opt) { const since = Date.now(); const n = uid; await post(U, { photo: [{ file_id: 'PH_s', file_size: 100 }, { file_id: 'PH_big_' + n, file_size: 2000 }] }); return waitMsgs(U, since, opt) }
async function sendDoc(U, doc, opt) { const since = Date.now(); await post(U, { document: { file_id: 'DOC_' + uid, ...doc } }); return waitMsgs(U, since, opt) }
const last = cs => cs.slice(-1)[0] || {}
const txt = cs => cs.map(c => strip(c.text)).join('\n---\n')

async function cleanup(U) {
  for (const c of ['state', 'walletOf', 'phoneNumbersOf', 'nameOf', 'userConversion']) await db.collection(c).deleteMany({ _id: U })
  await db.collection('userConversion').deleteMany({ chatId: U })
  await db.collection('telnyxRegSessions').deleteMany({ chatId: U })
  await db.collection('telnyxPendingOrders').deleteMany({ chatId: U })
}
async function seed(U, cc, type, { lang = 'en', wallet = { usdIn: 500, usdOut: 0 }, extra = {} } = {}) {
  await cleanup(U)
  await db.collection('state').insertOne({
    _id: U, userLanguage: lang, action: 'cpSelectNumber', cpPlanKey: 'starter', cpCountryCode: cc, cpCountryName: NAMES[cc],
    cpNumberType: type, cpProvider: 'telnyx', cpIsSubNumber: false, firstSessionIntentDone: true,
    cpSearchResults: [{ phone_number: NUMS[cc], _provider: 'telnyx', _bulkIvrCapable: true, _capabilities: { voice: true, sms: false }, cost_information: { monthly_cost: '3.00', upfront_cost: '2.00' } }],
    ...extra,
  })
  await db.collection('walletOf').insertOne({ _id: U, ...wallet })
}
// select number → summary → pay from wallet. Returns { summary, afterPay, price }
async function selectAndPay(U, payRe = /Pay.*(Wallet|Portefeuille)/i) {
  const r = await sendText(U, '1', { max: 20000, settle: 2000 })
  const summary = last(r)
  const payBtn = (summary.buttons || []).find(b => payRe.test(b))
  const price = (await db.collection('state').findOne({ _id: U })).cpPrice
  if (!payBtn) return { summary, afterPay: [], price, payBtn }
  const afterPay = await sendText(U, payBtn, { max: 25000, settle: 2500 })
  return { summary, afterPay, price, payBtn }
}
const sess = U => db.collection('telnyxRegSessions').findOne({ chatId: U, status: 'collecting' })
const anySess = U => db.collection('telnyxRegSessions').findOne({ chatId: U }, { sort: { updatedAt: -1 } })
const wallet = U => db.collection('walletOf').findOne({ _id: U })
const stateOf = U => db.collection('state').findOne({ _id: U })

const DEFAULT_ANS = { name: 'Maria Jansen', business: '👤 Individual (no company)', phone: '+31612345678', email: 'maria@example.com', street: 'Damrak 1', city: 'Amsterdam', region: '⏭ Skip', postal: '1012 LG', country: 'Netherlands' }
// Walk remaining steps until 'review' (not submitted) or stopAt step
async function walkTo(U, stopAt = 'review', answers = DEFAULT_ANS, log = true) {
  for (let i = 0; i < 30; i++) {
    const s = await sess(U)
    if (!s) return null
    const step = s.steps[s.idx]
    if (step === stopAt) return s
    let reply
    if (answers[step]) reply = await sendText(U, answers[step], { max: 20000 })
    else if (step === 'addr_check') reply = await sendText(U, '➡️ Keep my address')
    else if (step.startsWith('text:')) {
      const req = s.reqs.find(x => x.id === step.slice(5))
      const vals = req?.acceptance_criteria?.acceptable_values || []
      const hasSug = /suggested|Suggested|Utiliser/.test(JSON.stringify((await calls(U, 0)).slice(-1)[0]?.buttons || []))
      reply = await sendText(U, vals[0] || (hasSug ? '✅ Use suggested answer' : (req?.example || 'Voice calls and IVR for my own use only.')))
    } else if (step.startsWith('doc:')) reply = await sendPhoto(U)
    else { console.log('unknown step', step); return s }
    if (log) console.log(`  [${step}] →`, strip(last(reply).text).slice(0, 110).replace(/\n/g, ' ⏎ '))
  }
  return sess(U)
}
async function mtxCalls() { return (await axios.get(`${MTX}/_calls`)).data }
async function mtxClear() { await axios.delete(`${MTX}/_calls`) }
async function mtxConfig(c) { return (await axios.post(`${MTX}/_config`, c)).data }
const MTX_DEFAULT = { order_status: 'pending', order_error: null, phone_status: 'pending', requirements_status: 'requirement-info-under-review' }
function summaryOut() { const p = results.filter(r => r.ok).length; console.log(`\n${p}/${results.length} passed`); return { passed: p, total: results.length, failed: results.filter(r => !r.ok) } }

module.exports = { connect, close, get db() { return db }, sendText, sendPhoto, sendDoc, post, waitMsgs, calls, last, txt, strip, cleanup, seed, selectAndPay, sess, anySess, wallet, stateOf, walkTo, mtxCalls, mtxClear, mtxConfig, MTX_DEFAULT, check, results, summaryOut, sleep, NAMES, NUMS, DEFAULT_ANS }
