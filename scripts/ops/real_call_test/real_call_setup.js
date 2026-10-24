// One-off LIVE test helper (run on the droplet inside /opt/nomadly/current/app-main):
//   node real_call_setup.js setup <webChatId>   → buys a US local Telnyx number, SIP login, Pro number doc, $3 test wallet
//   node real_call_setup.js cleanup <webChatId> → releases the number + SIP login, deletes every doc of the test account
// Prints one JSON line (prefix RESULT=).
require('dotenv').config({ path: 'backend/.env' })
const axios = require('axios')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

const BASE = 'https://api.telnyx.com/v2'
const H = { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const out = (o) => { console.log('RESULT=' + JSON.stringify(o)); process.exit(0) }

async function buy() {
  const q = 'filter[country_code]=US&filter[phone_number_type]=local&filter[features][]=voice&filter[features][]=sms&filter[limit]=5'
  const found = (await axios.get(`${BASE}/available_phone_numbers?${q}`, H)).data.data || []
  if (!found.length) throw new Error('no numbers available')
  const pick = found.sort((a, b) => Number(a.cost_information?.upfront_cost || 9) - Number(b.cost_information?.upfront_cost || 9))[0]
  const order = (await axios.post(`${BASE}/number_orders`, { phone_numbers: [{ phone_number: pick.phone_number }], connection_id: process.env.TELNYX_CALL_CONTROL_APP_ID, messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID }, H)).data.data
  for (let i = 0; i < 20; i++) {
    const o = (await axios.get(`${BASE}/number_orders/${order.id}`, H)).data.data
    if (o.status === 'success') break
    if (o.status === 'failure') throw new Error('number order failed')
    await sleep(3000)
  }
  let pn = null
  for (let i = 0; i < 10 && !pn; i++) { pn = (await axios.get(`${BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(pick.phone_number)}`, H)).data.data?.[0]; if (!pn) await sleep(3000) }
  return { phone: pick.phone_number, orderId: order.id, phoneNumberId: pn?.id || null, cost: pick.cost_information }
}

async function main() {
  const [cmd, chatId] = process.argv.slice(2)
  if (!/^5\d{15}$/.test(String(chatId || ''))) throw new Error('web chat id required')
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const acc = await db.collection('webAccounts').findOne({ _id: Number(chatId) })
  if (!acc || !/^e2e-ring-test/.test(acc.email)) throw new Error('not the e2e test account')

  if (cmd === 'setup') {
    const n = await buy()
    const user = 'test_' + crypto.randomBytes(8).toString('hex'), pass = 'Tt' + crypto.randomBytes(9).toString('hex')
    const cred = (await axios.post(`${BASE}/telephony_credentials`, { connection_id: process.env.TELNYX_SIP_CONNECTION_ID, sip_username: user, sip_password: pass }, H)).data.data
    const exp = new Date(); exp.setMonth(exp.getMonth() + 1)
    const doc = {
      phoneNumber: n.phone, telnyxOrderId: n.orderId, telnyxPhoneNumberId: n.phoneNumberId, provider: 'telnyx', country: 'US', countryName: 'United States', type: 'local',
      plan: 'pro', planPrice: 0, purchaseDate: new Date().toISOString(), expiresAt: exp.toISOString(), autoRenew: false, status: 'active',
      sipUsername: cred.sip_username, sipPassword: cred.sip_password || pass, telnyxSipUsername: cred.sip_username, telnyxSipPassword: cred.sip_password || pass, telnyxCredentialId: cred.id,
      sipDomain: 'sip.cloudivr.net', messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID, connectionId: process.env.TELNYX_SIP_CONNECTION_ID, smsUsed: 0, minutesUsed: 0,
      capabilities: { voice: true, sms: true, fax: false }, channel: 'web', e2eTest: true,
      features: {
        sms: true,
        callForwarding: { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false },
        voicemail: { enabled: false, greetingType: 'default', customGreetingUrl: null, forwardToTelegram: true, forwardToEmail: null, ringTimeout: 25 },
        smsForwarding: { toTelegram: true, toEmail: null, webhookUrl: null },
        browserRing: { enabled: true, answerMode: 'ask', lang: 'en', voice: 'female', announce: true },
      },
    }
    await db.collection('phoneNumbersOf').updateOne({ _id: String(chatId) }, { $push: { 'val.numbers': doc } }, { upsert: true })
    await db.collection('walletOf').updateOne({ _id: String(chatId) }, { $inc: { usdIn: 3 } }, { upsert: true })
    out({ ok: true, phone: n.phone, phoneNumberId: n.phoneNumberId, credentialId: cred.id, sipUser: cred.sip_username, cost: n.cost })
  }

  if (cmd === 'cleanup') {
    const nums = (await db.collection('phoneNumbersOf').findOne({ _id: String(chatId) }))?.val?.numbers || []
    const done = []
    for (const n of nums) {
      if (n.telnyxCredentialId) { await axios.delete(`${BASE}/telephony_credentials/${n.telnyxCredentialId}`, H).catch(() => {}); done.push(`cred ${n.telnyxCredentialId}`) }
      const id = n.telnyxPhoneNumberId || (await axios.get(`${BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(n.phoneNumber)}`, H)).data.data?.[0]?.id
      if (id) { await axios.delete(`${BASE}/phone_numbers/${id}`, H).then(() => done.push(`released ${n.phoneNumber}`)).catch(e => done.push(`release failed ${n.phoneNumber}: ${e.response?.data?.errors?.[0]?.detail || e.message}`)) }
      const r = await db.collection('phoneLogs').deleteMany({ phoneNumber: n.phoneNumber })
      done.push(`phoneLogs ${r.deletedCount}`)
    }
    const ids = [String(chatId), Number(chatId)]
    for (const col of await db.listCollections().toArray()) {
      if (col.type === 'view') continue
      const r = await db.collection(col.name).deleteMany({ $or: [{ _id: { $in: ids } }, { chatId: { $in: ids } }] }).catch(() => ({ deletedCount: 0 }))
      if (r.deletedCount) done.push(`${col.name} ${r.deletedCount}`)
    }
    out({ ok: true, done })
  }
  throw new Error('usage: setup|cleanup <webChatId>')
}
main().catch(e => out({ ok: false, error: e.response?.data?.errors?.[0]?.detail || e.message }))
