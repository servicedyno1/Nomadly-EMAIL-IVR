'use strict'
// CNAM add-on for number lookup: $0.02 per US/Canada number checked, never run elsewhere.
const path = require('path')
const cnamPath = require.resolve(path.join(__dirname, '../cnam-service'))
let cnamCalls = []
require.cache[cnamPath] = { id: cnamPath, filename: cnamPath, loaded: true, exports: { lookupCnam: async (n) => { cnamCalls.push(n); return n.endsWith('0000') ? null : 'JOHN SMITH' } } }
const { createLookup, PRICE } = require('../cloudivr-web/lookup')

const r4 = (n) => Math.round(n * 10000) / 10000
function fakeDb() {
  const cols = {}
  const col = (name) => cols[name] || (cols[name] = {
    rows: [],
    insertOne: async function (d) { this.rows.push(d) }, insertMany: async function (d) { this.rows.push(...d) },
    updateOne: async function (q, u) { const d = this.rows.find(x => Object.keys(q).every(k => x[k] === q[k])); if (!d) return { modifiedCount: 0 }; Object.assign(d, u.$set); return { modifiedCount: 1 } },
    find: function () { return { sort: () => ({ limit: () => ({ toArray: async () => [] }) }), toArray: async () => [] } }, findOne: async () => null,
  })
  return { collection: col, cols }
}
function setup(balance = 10) {
  const db = fakeDb(), wallet = { bal: balance }
  const walletOps = () => ({ debit: async (_, a) => { if (wallet.bal < a) return false; wallet.bal = r4(wallet.bal - a); return true }, credit: async (_, a) => { wallet.bal = r4(wallet.bal + a) } })
  const bird = { lookup: async (n) => ({ valid: true, country: n.startsWith('+1') ? 'US' : 'GB', carrier: 'X', type: 'mobile' }) }
  const routes = {}
  const r = { get: (p, f) => { routes['GET ' + p] = f }, post: (p, f) => { routes['POST ' + p] = f } }
  createLookup({ db, h: (f) => f, walletOps, bird, log: () => {} }).routes(r)
  const call = (p, body) => new Promise((ok) => { const res = { code: 200, status(c) { this.code = c; return this }, json(b) { ok({ code: this.code, body: b }) } }; routes['POST ' + p]({ webChatId: 'u1', body }, res) })
  return { call, wallet, db }
}

let pass = 0, fail = 0
const t = async (name, fn) => { try { cnamCalls = []; await fn(); pass++; console.log('✅', name) } catch (e) { fail++; console.log('❌', name, e.message) } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`) }

;(async () => {
  await t('single without caller name → base price, no CNAM', async () => {
    const { call, wallet } = setup(); const r = await call('/lookup', { number: '+14155550100' })
    eq(r.body.callerName, undefined, 'callerName'); eq(cnamCalls.length, 0, 'cnam calls'); eq(wallet.bal, r4(10 - PRICE), 'balance')
  })
  await t('single US with caller name → name + $0.02 extra', async () => {
    const { call, wallet } = setup(); const r = await call('/lookup', { number: '+14155550100', callerName: true })
    eq(r.body.callerName, 'JOHN SMITH', 'name'); eq(r.body.price, r4(PRICE + 0.02), 'price'); eq(wallet.bal, r4(10 - PRICE - 0.02), 'balance')
  })
  await t('single US, no name found → still charged $0.02', async () => {
    const { call, wallet } = setup(); const r = await call('/lookup', { number: '+14155550000', callerName: true })
    eq(r.body.callerName, null, 'name'); eq(wallet.bal, r4(10 - PRICE - 0.02), 'balance')
  })
  await t('single UK with caller name ticked → CNAM not run, base price', async () => {
    const { call, wallet } = setup(); const r = await call('/lookup', { number: '+447700900123', callerName: true })
    eq(cnamCalls.length, 0, 'cnam calls'); eq(r.body.callerName, undefined, 'callerName'); eq(wallet.bal, r4(10 - PRICE), 'balance')
  })
  await t('bulk mixed with caller name → $0.02 only for US/Canada numbers', async () => {
    const { call, wallet } = setup(); const r = await call('/lookup/bulk', { numbers: ['+14155550100', '+14155550000', '+447700900123'], callerName: true })
    eq(cnamCalls.length, 2, 'cnam calls'); eq(r.body.charged, r4(3 * PRICE + 2 * 0.02), 'charged'); eq(wallet.bal, r4(10 - 3 * PRICE - 2 * 0.02), 'balance')
    eq(r.body.results[0].callerName, 'JOHN SMITH', 'row0'); eq(r.body.results[1].callerName, null, 'row1'); eq(r.body.results[2].callerName, undefined, 'row2')
  })
  await t('bulk without caller name → base price only', async () => {
    const { call, wallet } = setup(); const r = await call('/lookup/bulk', { numbers: ['+14155550100', '+447700900123'] })
    eq(cnamCalls.length, 0, 'cnam calls'); eq(r.body.charged, r4(2 * PRICE), 'charged'); eq(wallet.bal, r4(10 - 2 * PRICE), 'balance')
  })
  await t('not enough balance for caller name → 402, nothing charged', async () => {
    const { call, wallet } = setup(PRICE + 0.01); const r = await call('/lookup', { number: '+14155550100', callerName: true })
    eq(r.code, 402, 'code'); eq(wallet.bal, PRICE + 0.01, 'balance')
  })
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
