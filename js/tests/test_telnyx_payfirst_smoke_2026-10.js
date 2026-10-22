#!/usr/bin/env node
// Smoke: Telnyx intl pay-first verification (NL mobile) through the REAL bot + mock Telegram (:5099) + mock Telnyx reg (:5098).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const MTX = 'http://127.0.0.1:5098'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const U = '990300001'
let uid = 8_000_000 + Math.floor(Math.random() * 100000)
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' :: ' + detail : ''}`) }
async function sendText(text, wait = 3000) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(U), type: 'private', first_name: 'Sim' }, from: { id: Number(U), is_bot: false, first_name: 'Sim', username: 'sim' + U }, text } }, { timeout: 20000 })
  await sleep(wait)
  return (await axios.get(`${MOCK}/_calls?chat_id=${U}&since=${since}`)).data.filter(c => c.method === 'sendMessage')
}
async function sendPhoto(wait = 3000) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(U), type: 'private' }, from: { id: Number(U), is_bot: false, first_name: 'Sim' }, photo: [{ file_id: 'PH_small', file_size: 100 }, { file_id: 'PH_big_' + n, file_size: 2000 }] } }, { timeout: 20000 })
  await sleep(wait)
  return (await axios.get(`${MOCK}/_calls?chat_id=${U}&since=${since}`)).data.filter(c => c.method === 'sendMessage')
}
const last = cs => cs.slice(-1)[0] || {}
const txt = cs => cs.map(c => strip(c.text)).join('\n---\n')

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const COUNTRY = process.argv[2] || 'NL'
  const TYPE = process.argv[3] || 'mobile'
  const NAME = { NL: '🇳🇱 Netherlands', GB: '🇬🇧 United Kingdom', NZ: '🇳🇿 New Zealand' }[COUNTRY]
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'phoneNumbersOf', 'nameOf', 'userConversion']) await db.collection(c).deleteMany({ _id: U })
    await db.collection('telnyxRegSessions').deleteMany({ chatId: U })
    await db.collection('telnyxPendingOrders').deleteMany({ chatId: U })
  }
  try {
    await cleanup()
    await axios.delete(`${MTX}/_calls`)
    await db.collection('state').insertOne({
      _id: U, userLanguage: 'en', action: 'cpSelectNumber', cpPlanKey: 'starter', cpCountryCode: COUNTRY, cpCountryName: NAME,
      cpNumberType: TYPE, cpProvider: 'telnyx', cpIsSubNumber: false,
      cpSearchResults: [{ phone_number: '+3197000000001', _provider: 'telnyx', _bulkIvrCapable: true, _capabilities: { voice: true, sms: false }, cost_information: { monthly_cost: '3.00', upfront_cost: '2.00' } }],
    })
    await db.collection('walletOf').insertOne({ _id: U, usdIn: 500, usdOut: 0 })
    let r = await sendText('1', 5000)
    const summary = last(r)
    check('summary shows verification-after-payment note', /Verification after payment/.test(strip(summary.text)), txt(r))
    const payBtn = (summary.buttons || []).find(b => /Pay .*Wallet/i.test(b))
    check('wallet pay button present', !!payBtn, JSON.stringify(summary.buttons))
    const st0 = await db.collection('state').findOne({ _id: U })
    const price = st0.cpPrice
    r = await sendText(payBtn, 8000)
    console.log('  after pay:', txt(r).slice(0, 600).replace(/\n/g, ' ⏎ '))
    let w = await db.collection('walletOf').findOne({ _id: U })
    check('wallet charged before verification', Math.abs((w.usdOut || 0) - price) < 0.01, JSON.stringify(w))
    check('payment received + step 2 intro', /Payment received/.test(txt(r)) && /Step 2 of 2/.test(txt(r)), txt(r))
    const sess = await db.collection('telnyxRegSessions').findOne({ chatId: U, status: 'collecting' })
    check('paid session stored with refund', sess && sess.payment?.refund?.amount === price, JSON.stringify(sess?.payment))
    const st1 = await db.collection('state').findOne({ _id: U })
    check('state action = cpTxReg', st1.action === 'cpTxReg', st1.action)
    // Walk the steps
    const answers = { name: 'Maria Jansen', business: '👤 Individual (no company)', phone: '+31612345678', email: 'maria@example.com', street: 'Damrak 1', city: 'Amsterdam', region: '⏭ Skip', postal: '1012 LG', country: 'Netherlands' }
    for (let i = 0; i < 25; i++) {
      const s = await db.collection('telnyxRegSessions').findOne({ chatId: U, status: 'collecting' })
      if (!s) break
      const step = s.steps[s.idx]
      let reply
      if (answers[step]) reply = await sendText(answers[step], step === 'country' || step === 'postal' ? 6000 : 2500)
      else if (step === 'addr_check') reply = await sendText('➡️ Keep my address')
      else if (step.startsWith('text:')) {
        const req = s.reqs.find(x => x.id === step.slice(5))
        const vals = req?.acceptance_criteria?.acceptable_values || []
        const prompt = last(await sendText('🔁', 1500))
        const hasSug = (prompt.buttons || []).includes('✅ Use suggested answer')
        console.log(`    text req: ${req?.name} vals=${JSON.stringify(vals).slice(0, 80)} suggested=${hasSug}`)
        reply = await sendText(vals[0] || (hasSug ? '✅ Use suggested answer' : (req?.example || 'Voice calls and IVR for my own use only.')))
      } else if (step.startsWith('doc:')) reply = await sendPhoto(3500)
      else if (step === 'review') { console.log('  review:', strip(last(await sendText('noop', 1500)).text).replace(/\n/g, ' ⏎ ').slice(0, 500)); reply = await sendText('✅ Submit for verification', 9000) }
      else { console.log('unknown step', step); break }
      console.log(`  [${step}] →`, strip(last(reply).text).slice(0, 140).replace(/\n/g, ' ⏎ '))
    }
    const done = await db.collection('telnyxRegSessions').findOne({ chatId: U }, { sort: { updatedAt: -1 } })
    check('session ordered', done?.status === 'ordered', done?.status + ' ' + (done?.lastError || ''))
    const pend = await db.collection('telnyxPendingOrders').findOne({ chatId: U })
    check('pending order tracked (under_review) with refund', pend?.status === 'under_review' && pend?.refund?.amount === price, JSON.stringify(pend))
    const tcalls = (await axios.get(`${MTX}/_calls`)).data
    const order = tcalls.find(c => c.method === 'POST' && c.path === '/number_orders')
    check('number order carries regulatory_requirements', order && (order.body.phone_numbers?.[0]?.regulatory_requirements?.length > 0 || order.body.phone_numbers?.[0]?.requirement_group_id), JSON.stringify(order?.body))
    check('voice-only number ordered without messaging profile', order && !order.body.messaging_profile_id, JSON.stringify(order?.body))
    const msgs = (await axios.get(`${MOCK}/_calls?chat_id=${U}&since=0&method=sendMessage`)).data
    check('user told number is under review', msgs.some(m => /verification in progress/i.test(strip(m.text))))
    w = await db.collection('walletOf').findOne({ _id: U })
    check('no refund on successful submit', Math.abs((w.usdIn || 0) - 500) < 0.01, JSON.stringify(w))
  } catch (e) { console.log('ERROR', e.message, e.stack) } finally {
    if (!process.env.KEEP) await cleanup()
    await mc.close()
    console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`)
  }
})()
