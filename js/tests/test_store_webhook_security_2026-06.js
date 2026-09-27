/* global process */
/**
 * test_store_webhook_security_2026-06.js
 *
 * Integration test for the FORGED DYNOPAY WEBHOOK exploit fix. Drives the REAL
 * /store/crypto-webhook handler (createStoreRoutes) against local MongoDB with
 * an injected/stubbed DynoPay status gateway, and asserts:
 *   - a forged "completed / base_amount:9999" body NEVER credits 9999
 *   - HOLD when the gateway is unreachable/contradicts and the webhook is unsigned
 *   - the credited amount always comes from the authoritative gateway (or the
 *     invoiced order.amountUsd), never from req.body
 *   - an invalid webhook signature is rejected 401
 *   - a valid signature lets a gateway-unreachable webhook fulfill the INVOICED amount
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') })
const express = require('express')
const axios = require('axios')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const { createStoreRoutes } = require('../store-routes')

const MONGO_URL = process.env.MONGO_URL
const DB_NAME = 'store_webhook_sectest'
const SECRET = 'whsec_test_' + crypto.randomBytes(6).toString('hex')

let checks = []
const ck = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`) }

function signV2(rawString, secret) {
  const t = Math.floor(Date.now() / 1000)
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${rawString}`).digest('hex')
  return `t=${t},v1=${sig}`
}

async function main() {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  await db.dropDatabase().catch(() => {})

  // Injectable gateway stub — the test sets `gatewayReply` per scenario.
  let gatewayReply = null // null = unreachable; object = {status, amount_received_base, fee_payer}
  const dynoStatusById = async () => gatewayReply
  const dynoStatusByAddress = async () => gatewayReply

  // Two mounts: one WITHOUT a webhook secret (unsigned world), one WITH.
  const mkApp = (withSecret) => {
    const app = express()
    app.use(express.json({ verify: (req, _res, buf) => { if (buf && buf.length) req.rawBody = buf } }))
    app.use('/store', createStoreRoutes({
      getDb: () => db,
      selfUrl: 'http://localhost/api',
      notifyAdmin: () => {},
      dynoStatusById, dynoStatusByAddress,
      webhookSecret: withSecret ? SECRET : '',
    }))
    return app
  }
  const serverNoSecret = mkApp(false).listen(0)
  const serverSecret = mkApp(true).listen(0)
  const urlNoSecret = `http://127.0.0.1:${serverNoSecret.address().port}/store/crypto-webhook`
  const urlSecret = `http://127.0.0.1:${serverSecret.address().port}/store/crypto-webhook`

  const seedTopup = async (id, amountUsd) => {
    await db.collection('webUsers').updateOne({ _id: 'u1' }, { $set: { _id: 'u1', email: 'u1@t.co', walletUsd: 0 } }, { upsert: true })
    await db.collection('webOrders').insertOne({
      _id: id, webUserId: 'u1', kind: 'wallet_topup', amountUsd, coin: 'USDT-TRC20',
      provider: 'dynopay', status: 'pending', payAddress: 'TADDR' + id, paymentId: 'pay_' + id,
      usdCredited: 0, createdAt: new Date(), updatedAt: new Date(),
    })
  }
  const seedHosting = async (id, amountUsd) => {
    await db.collection('webOrders').insertOne({
      _id: id, webUserId: null, email: 'g@t.co', kind: 'hosting', plan: 'Premium', hostingPrice: 69,
      domain: 'x' + id + '.com', domainMode: 'byo', amountUsd, coin: 'USDT-TRC20',
      provider: 'dynopay', status: 'pending', payAddress: 'TADDR' + id, paymentId: 'pay_' + id,
      createdAt: new Date(), updatedAt: new Date(),
    })
  }
  const wallet = async () => (await db.collection('webUsers').findOne({ _id: 'u1' }))?.walletUsd || 0
  const order = async (id) => db.collection('webOrders').findOne({ _id: id })
  const resetWallet = async () => db.collection('webUsers').updateOne({ _id: 'u1' }, { $set: { walletUsd: 0 } })

  const forged = (refId) => ({ event: 'payment.confirmed', status: 'completed', payment_id: 'pay_' + refId, base_amount: '9999.00', fee_payer: 'customer', meta_data: { refId } })

  // ── 1. EXPLOIT: unsigned + gateway unreachable → HOLD, no credit ──
  await resetWallet(); await seedTopup('o1', 20); gatewayReply = null
  await axios.post(urlNoSecret, forged('o1')).catch(e => e.response)
  ck('exploit_unsigned_unreachable_holds', (await order('o1')).status === 'pending' && (await wallet()) === 0, `status=${(await order('o1')).status} wallet=${await wallet()}`)

  // ── 2. EXPLOIT: gateway CONTRADICTS (waiting) → HOLD, no credit ──
  await resetWallet(); await seedTopup('o2', 20); gatewayReply = { status: 'waiting' }
  await axios.post(urlNoSecret, forged('o2')).catch(e => e.response)
  ck('exploit_gateway_contradicts_holds', (await order('o2')).status === 'pending' && (await wallet()) === 0, `status=${(await order('o2')).status} wallet=${await wallet()}`)

  // ── 3. LEGIT: gateway confirms settled → credit INVOICED $20 (not 9999) ──
  await resetWallet(); await seedTopup('o3', 20); gatewayReply = { status: 'settled', amount_received_base: '20.00', fee_payer: 'company' }
  await axios.post(urlNoSecret, forged('o3')).catch(e => e.response)
  ck('legit_credits_gateway_amount_not_body', (await order('o3')).status === 'credited' && (await wallet()) === 20, `wallet=${await wallet()} (expect 20)`)

  // ── 4. Gateway is source of truth for amount (overpay 25 honored, body 9999 ignored) ──
  await resetWallet(); await seedTopup('o4', 20); gatewayReply = { status: 'settled', amount_received_base: '25.00', fee_payer: 'company' }
  await axios.post(urlNoSecret, forged('o4')).catch(e => e.response)
  ck('amount_from_gateway_25_not_9999', (await wallet()) === 25, `wallet=${await wallet()} (expect 25)`)

  // ── 5a. ENFORCE mode: invalid signature → 401 reject, no credit ──
  process.env.DYNO_PAY_WEBHOOK_SIG_ENFORCE = 'true'
  await resetWallet(); await seedTopup('o5', 20); gatewayReply = { status: 'settled', amount_received_base: '20.00', fee_payer: 'company' }
  let r5 = await axios.post(urlSecret, forged('o5'), { headers: { 'x-dynopay-signature-v2': 't=1,v1=deadbeef' } }).catch(e => e.response)
  ck('enforce_invalid_signature_rejected_401', r5 && r5.status === 401 && (await order('o5')).status === 'pending' && (await wallet()) === 0, `http=${r5 && r5.status} wallet=${await wallet()}`)
  delete process.env.DYNO_PAY_WEBHOOK_SIG_ENFORCE

  // ── 5b. DEFAULT (soft) mode: invalid signature + gateway unreachable → HOLD (no 401, no credit) ──
  await resetWallet(); await seedTopup('o5b', 20); gatewayReply = null
  let r5b = await axios.post(urlSecret, forged('o5b'), { headers: { 'x-dynopay-signature-v2': 't=1,v1=deadbeef' } }).catch(e => e.response)
  ck('soft_invalid_sig_unreachable_holds', r5b && r5b.status === 200 && (await order('o5b')).status === 'pending' && (await wallet()) === 0, `http=${r5b && r5b.status} wallet=${await wallet()}`)

  // ── 6. VALID signature + gateway unreachable → fulfill INVOICED $20 (not body 9999) ──
  await resetWallet(); await seedTopup('o6', 20); gatewayReply = null
  const body6 = JSON.stringify(forged('o6'))
  let r6 = await axios.post(urlSecret, body6, { headers: { 'content-type': 'application/json', 'x-dynopay-signature-v2': signV2(body6, SECRET) } }).catch(e => e.response)
  ck('valid_sig_unreachable_credits_invoiced', (r6 && r6.status === 200) && (await order('o6')).status === 'credited' && (await wallet()) === 20, `http=${r6 && r6.status} wallet=${await wallet()} (expect 20)`)

  // ── 7. HOSTING exploit: unsigned + unreachable + forged 9999 → HOLD, not provisioned ──
  await seedHosting('o7', 69); gatewayReply = null
  await axios.post(urlNoSecret, forged('o7')).catch(e => e.response)
  ck('hosting_exploit_unsigned_holds', (await order('o7')).status === 'pending', `status=${(await order('o7')).status}`)

  // ── 8. failed webhook can't be forged into a credit (definitively unpaid) ──
  await resetWallet(); await seedTopup('o8', 20); gatewayReply = { status: 'settled', amount_received_base: '20.00', fee_payer: 'company' }
  await axios.post(urlNoSecret, { event: 'payment.failed', meta_data: { refId: 'o8' } }).catch(e => e.response)
  ck('failed_event_no_credit', (await wallet()) === 0, `wallet=${await wallet()}`)

  serverNoSecret.close(); serverSecret.close()
  await db.dropDatabase().catch(() => {})
  await client.close()

  const passed = checks.filter(c => c.pass).length
  console.log(`\n${passed}/${checks.length} passed`)
  process.exit(passed === checks.length ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
