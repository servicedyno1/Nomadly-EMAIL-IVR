// Phase 3 sandbox harness — purchase → `transactions` record accuracy (JRN-23..JRN-32).
// SANDBOX MONGO ONLY (refuses anything but 127.0.0.1:27999). Run:
//   P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 WL_SALES=/root/wl/js/routes/sales.js node js/tests/test_purchase_txn_records_2026-10.js
// RUNTIME: real logTransaction, hostingTxnRecord (cr-register), atomicIncrement/getBalance, phone-scheduler
//          attemptAutoRenew, tx-history-purchases, WhiteLabel sales.js overview.
// MIRROR:  the _index.js money steps (balance check → provision → debit) are reproduced step-for-step;
// SOURCE:  guards pin those steps to the real _index.js code so the mirror cannot drift.
const fs = require('fs')
const path = require('path')
const Module = require('module')
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p3_sandbox'
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'sandbox-only'
const sp = require.resolve('node-schedule')
require.cache[sp] = Object.assign(new Module(sp), { filename: sp, loaded: true, exports: { scheduleJob: () => null } })
// Hosting scheduler runs for real against the sandbox; its outbound side effects are stubbed.
for (const [mod, exp] of [['../anti-red-service.js', { deployFullProtection: async () => ({}) }], ['../reseller-webhooks.js', new Proxy({}, { get: () => async () => ({}) })]]) {
  const p = require.resolve(mod)
  require.cache[p] = Object.assign(new Module(p), { filename: p, loaded: true, exports: exp })
}
delete process.env.SKIP_WEBHOOK_SYNC

const { MongoClient } = require('mongodb')
const { logTransaction } = require('../transaction-id.js')
const { hostingTxnRecord } = require('../cr-register-domain-&-create-cpanel.js')
const { atomicIncrement, set } = require('../db.js')
const { getBalance } = require('../utils.js')
const phoneScheduler = require('../phone-scheduler.js')
const { purchaseEntry, dropDuplicatePurchases } = require('../tx-history-purchases.js')

const SALE = ['hosting', 'hosting-renewal', 'hosting-upgrade', 'domain', 'phone-number', 'phone-sub-number', 'cloudphone-subscription', 'cloudphone-upgrade']
const r2 = (n) => Math.round(n * 100) / 100
const results = []
let db, col

async function wallet(chatId) { const w = await col.walletOf.findOne({ _id: String(chatId) }); return { usdIn: w?.usdIn || 0, usdOut: w?.usdOut || 0 } }
async function rows(chatId) { return col.transactions.find({ chatId: String(chatId), type: { $in: SALE } }).toArray() }
const ht = (chatId, d) => col.hostingTransactions.insertOne({ chatId: String(chatId), timestamp: new Date(), currency: 'USD', ...d })
const pay = (val) => set(col.payments, `p${Math.random().toString(36).slice(2)}`, val)

// cr-register success path: the single hosting row (inside `if (pin)`), exactly as the module writes it.
const provisionOk = async (info) => { await logTransaction(db, { chatId: info._id, ...hostingTxnRecord(info, info.website_name, 'cpu' + info._id.slice(-4)) }); return { success: true } }
const provisionFail = (domainRegistered) => async () => ({ success: false, domainRegistered })

// Mirror of _index.js walletOk['hosting-pay'].
async function walletHosting(info, provision) {
  const chatId = info._id
  const price = info.couponApplied ? info.newPrice : info.totalPrice
  const { usdBal } = await getBalance(col.walletOf, chatId)
  const priceUsd = price
  if (usdBal < priceUsd) return 'insufficient'
  info.chargedUsd = priceUsd
  info.chargedVia = { paymentMethod: 'wallet_usd' }
  const res = await provision(info)
  const base = { domain: info.website_name, plan: info.plan, priceUsd, paymentMethod: 'wallet_usd' }
  if (!res.success) {
    const domainPrice = info.domainPrice ?? (info.totalPrice && info.hostingPrice ? Math.max(0, info.totalPrice - info.hostingPrice) : 0)
    if (!info.existingDomain && domainPrice > 0 && res.domainRegistered === true) {
      await pay(`Wallet,Domain,${info.website_name},$${domainPrice},${chatId},${new Date()}`)
      await atomicIncrement(col.walletOf, chatId, 'usdOut', domainPrice)
      await ht(chatId, { ...base, outcome: 'domain_only' })
      return 'domain_only'
    }
    await ht(chatId, { ...base, outcome: 'failed' })
    return 'failed'
  }
  await pay(`Wallet,Hosting,${info.website_name},$${priceUsd},${chatId},${new Date()}`)
  await atomicIncrement(col.walletOf, chatId, 'usdOut', priceUsd)
  await ht(chatId, { ...base, outcome: 'success' })
  return 'success'
}

// Mirror of _index.js /dynopay/crypto-pay-hosting (auditCryptoTx 'hosting' removed by the fix).
async function cryptoHosting(info, usdIn, provision) {
  const chatId = info._id
  const price = info.couponApplied ? info.newPrice : info.totalPrice
  const base = { domain: info.website_name, plan: info.plan, priceUsd: price, paymentMethod: 'dynopay' }
  if (usdIn < price) { await atomicIncrement(col.walletOf, chatId, 'usdIn', usdIn); await ht(chatId, { ...base, outcome: 'failed' }); return 'underpaid' }
  if (usdIn > price) await atomicIncrement(col.walletOf, chatId, 'usdIn', usdIn - price)
  info.chargedUsd = Number(price)
  info.chargedVia = { paymentMethod: 'dynopay', coin: 'LTC', value: 1.23, ref: 'r' + chatId, psp: 'dynopay' }
  const res = await provision(info)
  if (!res.success) {
    await atomicIncrement(col.walletOf, chatId, 'usdIn', usdIn)
    await ht(chatId, { ...base, outcome: 'full_refund', refundAmount: usdIn, refundCurrency: 'USD' })
    return 'refunded'
  }
  await ht(chatId, { ...base, outcome: 'success' })
  return 'success'
}

// Mirror of _index.js walletOk['phone-pay'] + completion (Telnyx inline, or Twilio via executeTwilioPurchase).
async function walletPhone(chatId, price, { sub = false, provider = 'telnyx', debitAgoMs = 0 } = {}) {
  const { usdBal } = await getBalance(col.walletOf, chatId)
  if (usdBal < price) return 'insufficient'
  const deducted = await atomicIncrement(col.walletOf, chatId, 'usdOut', price)
  if (!deducted) return 'insufficient'
  await pay(`Wallet,CloudPhone,$${price},${chatId},sandbox,${new Date(Date.now() - debitAgoMs)}`)
  await logTransaction(db, {
    chatId, type: sub ? 'phone-sub-number' : 'phone-number', amount: provider === 'twilio' ? Number(price) : price, currency: 'USD', status: 'completed',
    metadata: { phoneNumber: '+1555' + chatId.slice(-7), plan: 'pro', provider, paymentMethod: 'wallet_usd' },
  })
  return 'success'
}

// Mirror of _index.js hosting "Renew Now" (wallet): balance check → atomic debit → CAS on expiry
// (lost race → debit reversed) → payments HostingRenew + hosting-renewal row.
async function manualHostingRenew(chatId, price, { raceLost = false } = {}) {
  const plan = { _id: 'cp' + chatId, chatId, domain: `renew${chatId.slice(-2)}.org`, cpUser: 'cpu' + chatId.slice(-4), plan: 'Premium Anti-Red HostPanel (1-Month)', expiryDate: new Date(Date.now() + 86400000) }
  await db.collection('cpanelAccounts').insertOne(plan)
  const { usdBal } = await getBalance(col.walletOf, chatId)
  if (usdBal < price) return 'insufficient'
  const debited = await atomicIncrement(col.walletOf, chatId, 'usdOut', price)
  if (!debited) return 'insufficient'
  const newExpiry = new Date(plan.expiryDate.getTime() + 30 * 86400000)
  const renewUpd = await db.collection('cpanelAccounts').updateOne({ _id: plan._id, expiryDate: raceLost ? new Date(0) : plan.expiryDate, plan: plan.plan }, { $set: { expiryDate: newExpiry } })
  if (!renewUpd || renewUpd.matchedCount === 0) { await atomicIncrement(col.walletOf, chatId, 'usdOut', -price); return 'already_applied' }
  const domain = plan.domain
  await pay(`Wallet,HostingRenew,${domain},$${price},${chatId},${new Date()}`)
  await logTransaction(db, { chatId, type: 'hosting-renewal', amount: Number(price), currency: 'USD', status: 'completed', metadata: { domain, plan: plan.plan, cpUser: plan.cpUser, paymentMethod: 'wallet_usd', action: 'manual_renew', newExpiry: newExpiry.toISOString() } })
  return 'renewed'
}

// Mirror of _index.js hosting plan upgrade (wallet): balance check → debit → WHM changePackage (fail → refund) → row.
async function hostingUpgrade(chatId, { listPrice, creditApplied }, whmOk = true) {
  const plan = { cpUser: 'cpu' + chatId.slice(-4), plan: 'Premium Anti-Red (1-Week)' }
  const selected = { name: 'Golden Anti-Red HostPanel (1-Month)', price: listPrice, creditApplied, chargeAmount: r2(listPrice - creditApplied) }
  const originalPrice = selected.price
  const upgradePrice = (typeof selected.chargeAmount === 'number') ? selected.chargeAmount : selected.price
  const { usdBal } = await getBalance(col.walletOf, chatId)
  if (usdBal < upgradePrice) return 'insufficient'
  const upgradeDebited = await atomicIncrement(col.walletOf, chatId, 'usdOut', upgradePrice)
  if (!upgradeDebited) return 'insufficient'
  if (!whmOk) { await atomicIncrement(col.walletOf, chatId, 'usdIn', upgradePrice); return 'refunded' }
  const domain = `upg${chatId.slice(-2)}.org`
  await pay(`Wallet,HostingUpgrade,${domain},$${upgradePrice.toFixed(2)},${chatId},${new Date()}`)
  await logTransaction(db, { chatId, type: 'hosting-upgrade', amount: Number(upgradePrice.toFixed(2)), currency: 'USD', status: 'completed', metadata: { domain, cpUser: plan.cpUser, fromPlan: plan.plan, toPlan: selected.name, listPrice: originalPrice, creditApplied, paymentMethod: 'wallet_usd' } })
  return 'upgraded'
}

// Mirror of _index.js Cloud Phone upgrade: wallet (balance check → debit) or crypto (paid + payments row) → applyPhonePlanUpgrade row.
async function phoneUpgrade(chatId, { newPrice, credit, method = 'wallet' }) {
  const chargeAmount = r2(newPrice - credit)
  if (method === 'wallet' && chargeAmount > 0) {
    const { usdBal } = await getBalance(col.walletOf, chatId)
    if (usdBal < chargeAmount) return 'insufficient'
    await atomicIncrement(col.walletOf, chatId, 'usdOut', chargeAmount)
  }
  if (method === 'crypto') await pay(`Crypto,PhoneUpgrade,+1555${chatId.slice(-7)},$${chargeAmount},${chatId},name,${new Date()},0.5 LTC`)
  const paymentMethod = method === 'wallet' ? 'wallet' : '🪙 Crypto (LTC)'
  if (chargeAmount > 0) {
    await logTransaction(db, { chatId, type: 'cloudphone-upgrade', amount: Number(chargeAmount.toFixed(2)), currency: 'USD', status: 'completed', metadata: { phoneNumber: '+1555' + chatId.slice(-7), oldPlan: 'starter', newPlan: 'pro', listPrice: newPrice, credit: Number(credit.toFixed(2)), eligibleForCredit: credit > 0, paymentMethod } })
  }
  return 'upgraded'
}

// The bot's /history view: legacy payments debits + structured rows via tx-history-purchases (same as txHistory).
async function history(chatId) {
  const parsed = []
  for (const txn of await col.transactions.find({ chatId: String(chatId) }).toArray()) {
    const p = purchaseEntry(txn)
    if (p) { if (!p.skip) parsed.push(p); continue }
    parsed.push({ isCredit: true, amount: txn.amount, dateObj: txn.createdAt })
  }
  for (const d of await col.payments.find({ val: { $regex: String(chatId) } }).toArray()) {
    const parts = String(d.val).split(',')
    if ((parts[0] === 'Bank' || parts[0] === 'Crypto') && parts[1] === 'Wallet') continue
    const m = parts.map((s) => s.trim().match(/^\$(\d+\.?\d*)/)).find(Boolean)
    parsed.push({ isCredit: false, amount: m ? parseFloat(m[1]) : 0, dateObj: new Date(parts.find((s) => /GMT/.test(s))), desc: parts[1] })
  }
  return dropDuplicatePurchases(parsed).filter((p) => !p.isCredit).map((p) => r2(p.amount))
}

async function scenario(id, title, fn) {
  try { const r = await fn(); results.push({ id, title, ...r }) } catch (e) { results.push({ id, title, pass: false, note: 'ERROR ' + e.message }) }
}
async function check(chatId, w0, { paid, expectRows, outcome, expectedOutcome }) {
  const w1 = await wallet(chatId)
  const rs = await rows(chatId)
  const debit = r2((w1.usdOut - w0.usdOut) - (w1.usdIn - w0.usdIn) + (paid || 0))
  const recorded = r2(rs.reduce((a, t) => a + (Number(t.amount) || 0), 0))
  const hist = await history(chatId)
  const histSum = r2(hist.reduce((a, b) => a + b, 0))
  const pass = outcome === expectedOutcome && rs.length === expectRows && r2(debit - recorded) === 0 && (expectRows === 0 || histSum === recorded)
  return { pass, outcome, debit, recorded, diff: r2(debit - recorded), rows: rs.map((t) => `${t.type}:${t.amount}`).join(' ') || '—', history: hist.join(' / ') || '—' }
}

function sourceGuards() {
  const idx = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
  const cr = fs.readFileSync(path.join(__dirname, '../cr-register-domain-&-create-cpanel.js'), 'utf8')
  const ps = fs.readFileSync(path.join(__dirname, '../phone-scheduler.js'), 'utf8')
  const g = []
  const ok = (name, cond) => g.push({ name, pass: !!cond })
  ok('no auditCryptoTx hosting row (BlockBee/DynoPay) — single row comes from cr-register', !/auditCryptoTx\(chatId, 'hosting'/.test(idx))
  const walletBlock = idx.slice(idx.indexOf("'hosting-pay': async coin =>"), idx.indexOf("'hosting-pay': async coin =>") + 6000)
  ok('wallet hosting: balance check → chargedUsd=priceUsd → provision → debit priceUsd', /if \(usdBal < priceUsd\)[\s\S]*info\.chargedUsd = priceUsd[\s\S]*registerDomainAndCreateCpanel[\s\S]*Wallet,Hosting,\$\{info\.domain\},\$\$\{priceUsd\}[\s\S]*atomicIncrement\(walletOf, chatId, 'usdOut', priceUsd\)/.test(walletBlock))
  for (const p of ['blockbee', 'dynopay', 'bank_ngn']) ok(`${p} hosting: chargedUsd set right before registerDomainAndCreateCpanel`, new RegExp(`info\\.chargedUsd = Number\\(price\\)\\n\\s*info\\.chargedVia = \\{ paymentMethod: '${p}'[^\\n]*\\n\\s*const hostingResult = await registerDomainAndCreateCpanel`).test(idx))
  ok('cr-register: hosting row only on success (inside if (pin)) via hostingTxnRecord', /if \(pin\) \{[\s\S]{0,900}hostingTxnRecord\(info, domain, result\.username\)/.test(cr))
  const tw = idx.slice(idx.indexOf('async function executeTwilioPurchase('), idx.indexOf('async function getCachedTwilioAddress('))
  ok('executeTwilioPurchase writes one phone-number/phone-sub-number row (all payment methods)', /logTransaction\(db, \{[\s\S]*type: subOpts\?\.isSubNumber \? 'phone-sub-number' : 'phone-number'[\s\S]*amount: Number\(price\)/.test(tw))
  ok('wallet Telnyx phone purchase keeps its single row (phone-number / phone-sub-number)', /type: isSubNumber \? 'phone-sub-number' : 'phone-number',\n\s*amount: price,/.test(idx))
  ok('phone auto-renew writes cloudphone-subscription only after the atomic claim', /if \(!claimResult\) \{[\s\S]*return \{ outcome: 'duplicate_prevented'[\s\S]*type: 'cloudphone-subscription'/.test(ps))
  ok('initPhoneScheduler receives db', /initPhoneScheduler\(\{\n\s*bot,\n\s*db,/.test(idx))
  ok('/history uses purchaseEntry + dropDuplicatePurchases', /purchaseEntry\(txn\)/.test(idx) && /parsed = dropDuplicatePurchases\(parsed\)/.test(idx))
  ok('manual hosting renew: hosting-renewal row only after debit + CAS success', /if \(!renewUpd \|\| renewUpd\.matchedCount === 0\)[\s\S]*Wallet,HostingRenew[^\n]*\n\s*await logTransaction\(db, \{ chatId, type: 'hosting-renewal', amount: Number\(price\)/.test(idx))
  ok('hosting upgrade: hosting-upgrade row only after WHM changePackage success', /if \(!changeResult\.success\)[\s\S]*Wallet,HostingUpgrade[^\n]*\n\s*await logTransaction\(db, \{ chatId, type: 'hosting-upgrade', amount: Number\(upgradePrice\.toFixed\(2\)\)/.test(idx))
  const hs = fs.readFileSync(path.join(__dirname, '../hosting-scheduler.js'), 'utf8')
  ok('hosting auto-renew (hourly + startup): row only after the atomic claim', (hs.match(/continue\n\s*\}\n\s*await logRenewalTxn\(account, price, newExpiry\)/g) || []).length === 2)
  const up = idx.slice(idx.indexOf('async function applyPhonePlanUpgrade('), idx.indexOf('async function applyPhonePlanUpgrade(') + 5000)
  ok('applyPhonePlanUpgrade: one cloudphone-upgrade row with chargeAmount (after credit), all payment methods', /if \(chargeAmount > 0\) \{\n\s*await logTransaction\(db, \{ chatId, type: 'cloudphone-upgrade', amount: Number\(chargeAmount\.toFixed\(2\)\)/.test(up))
  ok('wallet phone upgrade: balance check + debit of chargeAmount before applyPhonePlanUpgrade', /if \(walletBal < chargeAmount\)[\s\S]{0,200}atomicIncrement\(walletOf, chatId, 'usdOut', chargeAmount\)[\s\S]{0,200}applyPhonePlanUpgrade\(chatId, num, upgNewPlan/.test(idx))
  return g
}

async function dashboard() {
  const express = require('express')
  const app = express(); app.use(express.json())
  process.env.SALES_DASHBOARD_PASSWORD = 'sandbox'; process.env.SALES_FLAT_MARGIN_PCT = '30'
  require(process.env.WL_SALES || '/root/wl/js/routes/sales.js').install(app, { getDb: () => db, log: () => {} })
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}/admin/sales`
  const { token } = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sandbox' }) }).then((r) => r.json())
  const o = await fetch(base + '/overview?range=all', { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json())
  srv.close()
  return o
}

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  db = client.db('p3_sandbox'); await db.dropDatabase()
  col = Object.fromEntries(['walletOf', 'transactions', 'hostingTransactions', 'payments', 'phoneNumbersOf', 'phoneTransactions', 'nameOf', 'walletLedger'].map((n) => [n, db.collection(n)]))
  const truth = []
  const fund = async (chatId, usd) => { await col.walletOf.insertOne({ _id: chatId, usdIn: usd, usdOut: 0 }); return wallet(chatId) }

  await scenario('JRN-23', 'Wallet $75 hosting, existing domain', async () => {
    const c = '9000000023', w0 = await fund(c, 200)
    const out = await walletHosting({ _id: c, website_name: 'site23.org', plan: 'Premium Anti-Red HostPanel (1-Month)', totalPrice: 75, hostingPrice: 75, existingDomain: true, price: 0 }, provisionOk)
    truth.push(75); return check(c, w0, { outcome: out, expectedOutcome: 'success', expectRows: 1 })
  })
  await scenario('JRN-24', 'Silver loyalty: $105 list → $99.75 debited (stale info.price $30)', async () => {
    const c = '9000000024', w0 = await fund(c, 200)
    const out = await walletHosting({ _id: c, website_name: 'site24.org', plan: 'Premium Anti-Red HostPanel (1-Month)', totalPrice: 99.75, hostingPrice: 99.75, existingDomain: true, price: 30 }, provisionOk)
    truth.push(99.75); return check(c, w0, { outcome: out, expectedOutcome: 'success', expectRows: 1 })
  })
  await scenario('JRN-25', 'Wallet hosting $75 + new domain $30 (total $105)', async () => {
    const c = '9000000025', w0 = await fund(c, 200)
    const out = await walletHosting({ _id: c, website_name: 'site25.com', plan: 'Premium Anti-Red HostPanel (1-Month)', totalPrice: 105, hostingPrice: 75, domainPrice: 30, price: 30 }, provisionOk)
    const r = await check(c, w0, { outcome: out, expectedOutcome: 'success', expectRows: 1 })
    const m = (await rows(c))[0]?.metadata || {}
    r.note = `one row, parts hosting $${m.hostingPrice} + domain $${m.domainPrice} = $${m.hostingPrice + m.domainPrice}`
    r.pass = r.pass && m.hostingPrice + m.domainPrice === r.recorded
    truth.push(105); return r
  })
  await scenario('JRN-26', 'Crypto (DynoPay) $105 hosting', async () => {
    const c = '9000000026', w0 = await fund(c, 0)
    const out = await cryptoHosting({ _id: c, website_name: 'site26.org', plan: 'Premium Anti-Red HostPanel (1-Month)', totalPrice: 105, hostingPrice: 105, existingDomain: true, price: 30 }, 105, provisionOk)
    const r = await check(c, w0, { paid: 105, outcome: out, expectedOutcome: 'success', expectRows: 1 })
    r.note = 'psp=' + (await rows(c))[0]?.metadata?.psp
    truth.push(105); return r
  })
  await scenario('JRN-27', 'Crypto $75 paid, provisioning fails → full refund', async () => {
    const c = '9000000027', w0 = await fund(c, 0)
    const out = await cryptoHosting({ _id: c, website_name: 'site27.org', plan: 'Premium Anti-Red HostPanel (1-Month)', totalPrice: 75, hostingPrice: 75, existingDomain: true }, 75, provisionFail(false))
    const r = await check(c, w0, { paid: 75, outcome: out, expectedOutcome: 'refunded', expectRows: 0 })
    r.note = 'refund recorded as today: hostingTransactions ' + (await col.hostingTransactions.findOne({ chatId: c }))?.outcome
    return r
  })
  await scenario('JRN-27b', 'Wallet hosting fails before domain registered → not charged', async () => {
    const c = '9000000127', w0 = await fund(c, 200)
    const out = await walletHosting({ _id: c, website_name: 'site27b.com', plan: 'P', totalPrice: 105, hostingPrice: 75, domainPrice: 30 }, provisionFail(false))
    return check(c, w0, { outcome: out, expectedOutcome: 'failed', expectRows: 0 })
  })
  await scenario('JRN-28', 'Wallet $120 Cloud Phone plan (Telnyx)', async () => {
    const c = '9000000028', w0 = await fund(c, 200)
    const out = await walletPhone(c, 120)
    truth.push(120); return check(c, w0, { outcome: out, expectedOutcome: 'success', expectRows: 1 })
  })
  await scenario('JRN-28b', 'Wallet $120 Cloud Phone plan (Twilio address flow, number bought 2 days after debit)', async () => {
    const c = '9000000128', w0 = await fund(c, 200)
    const out = await walletPhone(c, 120, { provider: 'twilio', debitAgoMs: 2 * 86400000 })
    truth.push(120); return check(c, w0, { outcome: out, expectedOutcome: 'success', expectRows: 1 })
  })
  await scenario('JRN-29', '➕ Add Number to Plan ($37.50 sub-number, wallet)', async () => {
    const c = '9000000029', w0 = await fund(c, 100)
    const out = await walletPhone(c, 37.5, { sub: true })
    const r = await check(c, w0, { outcome: out, expectedOutcome: 'success', expectRows: 1 })
    r.pass = r.pass && (await rows(c))[0]?.type === 'phone-sub-number'
    truth.push(37.5); return r
  })
  phoneScheduler.initPhoneScheduler({
    bot: { sendMessage: async () => ({}) }, db, phoneNumbersOf: col.phoneNumbersOf, phoneTransactions: col.phoneTransactions, phoneLogs: db.collection('phoneLogs'),
    walletOf: col.walletOf, payments: col.payments, nameOf: col.nameOf, stateOf: db.collection('state'), notifyGroup: () => {}, maskName: (x) => x, nanoid: () => 'ar' + Math.random().toString(36).slice(2),
  })
  const renew = async (c, usd) => {
    const w0 = await fund(c, usd)
    const num = { phoneNumber: '+15550' + c.slice(-6), plan: 'pro', planPrice: 75, status: 'active', autoRenew: true, expiresAt: new Date(Date.now() - 3600000).toISOString() }
    await col.phoneNumbersOf.insertOne({ _id: c, val: { numbers: [num] } })
    const res = await phoneScheduler.attemptAutoRenew(c, { ...num }, 0, [{ ...num }])
    return { w0, out: res.outcome }
  }
  await scenario('JRN-30', 'Cloud Phone Pro plan auto-renews from wallet ($75, real attemptAutoRenew)', async () => {
    const c = '9000000030'; const { w0, out } = await renew(c, 100)
    const r = await check(c, w0, { outcome: out, expectedOutcome: 'renewed', expectRows: 1 })
    r.pass = r.pass && (await rows(c))[0]?.type === 'cloudphone-subscription'
    truth.push(75); return r
  })
  await scenario('JRN-31', '$10 wallet tries $75 hosting → refused', async () => {
    const c = '9000000031', w0 = await fund(c, 10)
    const out = await walletHosting({ _id: c, website_name: 'site31.org', plan: 'P', totalPrice: 75, existingDomain: true }, provisionOk)
    return check(c, w0, { outcome: out, expectedOutcome: 'insufficient', expectRows: 0 })
  })
  await scenario('JRN-31b', '$10 wallet, $75 auto-renew → insufficient_funds (real attemptAutoRenew)', async () => {
    const c = '9000000131'; const { w0, out } = await renew(c, 10)
    return check(c, w0, { outcome: out, expectedOutcome: 'insufficient_funds', expectRows: 0 })
  })

  // ── REQ-56..61: renewals and upgrades ──
  await scenario('JRN-34a', 'Hosting "Renew Now" from wallet ($75)', async () => {
    const c = '9000000341', w0 = await fund(c, 100)
    const out = await manualHostingRenew(c, 75)
    truth.push(75); return check(c, w0, { outcome: out, expectedOutcome: 'renewed', expectRows: 1 })
  })
  // Real hosting-scheduler startupEnforcement: one funded and one short expired account.
  const expired = (c) => ({ _id: 'cp' + c, chatId: c, domain: `auto${c.slice(-2)}.org`, cpUser: 'cpu' + c.slice(-4), plan: 'Premium Anti-Red HostPanel (1-Month)', renewalPriceUsd: 75, autoRenew: true, expiryDate: new Date(Date.now() - 3600000) })
  const wAuto = await fund('9000000342', 100), wAutoShort = await fund('9000000351', 10)
  await db.collection('cpanelAccounts').insertMany([expired('9000000342'), expired('9000000351')])
  const whmMock = { suspendAccount: async () => true, unsuspendAccount: async () => true, terminateAccount: async () => ({ success: true }), getAccountInfo: async () => ({ success: true, data: {} }) }
  require('../hosting-scheduler.js').initScheduler({ bot: { sendMessage: async () => ({}) }, db, whmService: whmMock })
  await new Promise((r) => setTimeout(r, 13000))
  await scenario('JRN-34b', 'Hosting auto-renew from wallet ($75, real hosting-scheduler)', async () => {
    const c = '9000000342'
    const acct = await db.collection('cpanelAccounts').findOne({ _id: 'cp' + c })
    const r = await check(c, wAuto, { outcome: new Date(acct.expiryDate) > new Date() ? 'renewed' : 'not renewed', expectedOutcome: 'renewed', expectRows: 1 })
    r.pass = r.pass && (await rows(c))[0]?.type === 'hosting-renewal'
    truth.push(75); return r
  })
  await scenario('JRN-35a', '$10 wallet, "Renew Now" $75 → refused', async () => {
    const c = '9000000350', w0 = await fund(c, 10)
    return check(c, w0, { outcome: await manualHostingRenew(c, 75), expectedOutcome: 'insufficient', expectRows: 0 })
  })
  await scenario('JRN-35b', '$10 wallet, hosting auto-renew $75 (real hosting-scheduler) → not renewed', async () => {
    const c = '9000000351'
    const acct = await db.collection('cpanelAccounts').findOne({ _id: 'cp' + c })
    return check(c, wAutoShort, { outcome: new Date(acct.expiryDate) > new Date() ? 'renewed' : 'not renewed', expectedOutcome: 'not renewed', expectRows: 0 })
  })
  await scenario('JRN-35c', 'Renew Now double-tap: renewal already applied → debit reversed', async () => {
    const c = '9000000352', w0 = await fund(c, 100)
    return check(c, w0, { outcome: await manualHostingRenew(c, 75, { raceLost: true }), expectedOutcome: 'already_applied', expectRows: 0 })
  })
  await scenario('JRN-36a', 'Cloud Phone Starter → Pro, no upgrade credit (wallet $75)', async () => {
    const c = '9000000361', w0 = await fund(c, 100)
    const out = await phoneUpgrade(c, { newPrice: 75, credit: 0 })
    truth.push(75); return check(c, w0, { outcome: out, expectedOutcome: 'upgraded', expectRows: 1 })
  })
  await scenario('JRN-36b', 'Cloud Phone Starter → Pro within 14 days (25% credit $12.50 → wallet $62.50)', async () => {
    const c = '9000000362', w0 = await fund(c, 100)
    const out = await phoneUpgrade(c, { newPrice: 75, credit: 12.5 })
    truth.push(62.5); return check(c, w0, { outcome: out, expectedOutcome: 'upgraded', expectRows: 1 })
  })
  await scenario('JRN-36c', 'Cloud Phone upgrade paid in crypto ($62.50, legacy Crypto,PhoneUpgrade row too)', async () => {
    const c = '9000000363', w0 = await fund(c, 0)
    const out = await phoneUpgrade(c, { newPrice: 75, credit: 12.5, method: 'crypto' })
    truth.push(62.5); return check(c, w0, { paid: 62.5, outcome: out, expectedOutcome: 'upgraded', expectRows: 1 })
  })
  await scenario('JRN-37a', 'Hosting plan upgrade from wallet (list $105 − credit $26.25 = $78.75)', async () => {
    const c = '9000000371', w0 = await fund(c, 100)
    const out = await hostingUpgrade(c, { listPrice: 105, creditApplied: 26.25 })
    truth.push(78.75); return check(c, w0, { outcome: out, expectedOutcome: 'upgraded', expectRows: 1 })
  })
  await scenario('JRN-37b', 'Hosting plan upgrade, WHM changePackage fails → refunded', async () => {
    const c = '9000000372', w0 = await fund(c, 200)
    return check(c, w0, { outcome: await hostingUpgrade(c, { listPrice: 105, creditApplied: 0 }, false), expectedOutcome: 'refunded', expectRows: 0 })
  })

  // JRN-32: add pre-fix-shaped orders (as found on Smadav/Voodoo), then run the WhiteLabel dashboard.
  await scenario('JRN-32+38', 'WhiteLabel sales.js over old-style + new-style orders incl. renewals/upgrades: each counted once', async () => {
    const t = new Date(Date.now() - 5 * 86400000)
    const old = [
      // wallet hosting, existing domain: $0 provisioning row + hostingTransactions $75
      async () => { await col.transactions.insertOne({ _id: 'OLD-1', chatId: '8000000001', type: 'hosting', amount: 0, status: 'completed', createdAt: t, metadata: { domain: 'old1.org', plan: 'P', cpUser: 'old1' } }); await col.hostingTransactions.insertOne({ chatId: '8000000001', domain: 'old1.org', plan: 'P', priceUsd: 75, paymentMethod: 'wallet_usd', outcome: 'success', timestamp: t }); truth.push(75) },
      // silver wallet hosting: $30 placeholder + hostingTransactions $99.75
      async () => { await col.transactions.insertOne({ _id: 'OLD-2', chatId: '8000000002', type: 'hosting', amount: 30, status: 'completed', createdAt: t, metadata: { domain: 'old2.org', plan: 'P', cpUser: 'old2' } }); await col.hostingTransactions.insertOne({ chatId: '8000000002', domain: 'old2.org', plan: 'P', priceUsd: 99.75, paymentMethod: 'wallet_usd', outcome: 'success', timestamp: t }); truth.push(99.75) },
      // crypto hosting: $30 provisioning row + $105 psp row + hostingTransactions $105
      async () => { await col.transactions.insertMany([{ _id: 'OLD-3a', chatId: '8000000003', type: 'hosting', amount: 30, status: 'completed', createdAt: t, metadata: { domain: 'old3.org', cpUser: 'old3' } }, { _id: 'OLD-3b', chatId: '8000000003', type: 'hosting', amount: 105, status: 'completed', createdAt: t, metadata: { domain: 'old3.org', psp: 'dynopay', coin: 'LTC' } }]); await col.hostingTransactions.insertOne({ chatId: '8000000003', domain: 'old3.org', priceUsd: 105, paymentMethod: 'dynopay', outcome: 'success', timestamp: t }); truth.push(105) },
      // wallet Cloud Phone with only the legacy payments row
      async () => { await pay(`Wallet,CloudPhone,$120,8000000004,old,${t}`); truth.push(120) },
    ]
    for (const f of old) await f()
    const o = await dashboard()
    const S = o.summary || o
    const rev = r2(S.grossRevenue ?? S.revenue)
    const exp = r2(truth.reduce((a, b) => a + b, 0))
    const cat = (re) => r2((o.categories || o.byCategory || []).filter((x) => re.test(x.category)).reduce((a, x) => a + (x.revenue || 0), 0))
    return { pass: Math.abs(rev - exp) <= 0.01 && S.orders === truth.length, outcome: `orders ${S.orders}/${truth.length}`, debit: exp, recorded: rev, diff: r2(exp - rev), rows: `hosting ${cat(/Hosting/)} · cloud phone ${cat(/Cloud Phone/)}`, history: '—', note: 'old: $0 row, $30 placeholder, $30+$105 crypto pair, payments-only CloudPhone; new: JRN-23..30 + renewals/upgrades JRN-34..37' }
  })

  const guards = sourceGuards()
  console.log('\n| Journey | Scenario | Outcome | Debit/paid | Recorded | Diff | Rows | /history shows | Pass |\n|---|---|---|---|---|---|---|---|---|')
  for (const r of results) console.log(`| ${r.id} | ${r.title}${r.note ? ` (${r.note})` : ''} | ${r.outcome} | ${r.debit} | ${r.recorded} | ${r.diff} | ${r.rows} | ${r.history} | ${r.pass ? 'PASS' : 'FAIL'} |`)
  console.log('\nSOURCE guards:'); for (const g of guards) console.log(` ${g.pass ? 'PASS' : 'FAIL'}  ${g.name}`)
  const pass = results.filter((r) => r.pass).length + guards.filter((g) => g.pass).length
  const total = results.length + guards.length
  console.log(`\nRESULT ${pass}/${total}`)
  await db.dropDatabase(); await client.close()
  process.exit(pass === total ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
