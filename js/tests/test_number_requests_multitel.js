'use strict'
// On-request orders are filled by MultiTEL (incl. old Infobip ones), refunded when MultiTEL has nothing.
const path = require('path')
let fails = 0
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) fails++ }

const mtPath = path.join(__dirname, '../multitel/index.js')
let stock = {}, bought = []
require.cache[mtPath] = { id: mtPath, filename: mtPath, loaded: true, exports: {
  selling: () => true, wasNoFunds: () => false, isBlocked: () => false,
  searchNumbers: async (cc, type) => (stock[`${cc}:${type}`] || []).map(p => ({ phone_number: p, _capabilities: { voice: true, sms: false } })),
  buyNumber: async (p) => { bought.push(p); return { id: `mt:${p.slice(1)}`, _provider: 'multitel' } },
} }

const docs = {}
const col = {
  insertOne: async (d) => { docs[d._id] = { ...d } },
  find: (q) => ({ sort: () => ({ limit: () => ({ toArray: async () => Object.values(docs) }) }), limit: () => ({ toArray: async () => Object.values(docs).filter(d => q.status.$in.includes(d.status)) }) }),
  findOneAndUpdate: async (q, u) => { const d = docs[q._id]; if (!d || !q.status.$in.includes(d.status)) return null; Object.assign(d, u.$set); return d },
  updateOne: async (q, u) => { const d = docs[q._id]; if (!d) return { modifiedCount: 0 }; if (q.status && (q.status.$nin ? q.status.$nin.includes(d.status) : d.status !== q.status)) return { modifiedCount: 0 }; Object.assign(d, u.$set || {}); return { modifiedCount: 1 } },
}
const db = { collection: (n) => n === 'numberRequests' ? col : { findOne: async () => ({ email: 'a@b.c' }) } }
const credits = [], purchases = [], admin = []
const walletOps = () => ({ debit: async () => true, credit: async (c, a) => credits.push(a), balance: async () => 0 })
const numbersApi = { purchase: async (a) => { purchases.push(a); return { status: 201 } } }
const nr = require('../cloudivr-web/number-requests').createNumberRequests({ db, h: (f) => f, phoneConfig: {}, numbersApi, walletOps, notify: { push: async () => {} }, notifyAdmin: (m) => admin.push(m), log: () => {} })

;(async () => {
  const old = new Date(Date.now() - 4 * 86400000)
  docs.a = { _id: 'a', chatId: 1, email: 'a@b.c', country: 'DK', countryName: 'Denmark', plan: 'starter', price: 10, status: 'in_review', ibRequestId: 'ib-1', createdAt: new Date() }
  docs.b = { _id: 'b', chatId: 2, email: 'b@b.c', country: 'PY', countryName: 'Paraguay', plan: 'starter', price: 12, status: 'submitted', createdAt: new Date() }
  docs.c = { _id: 'c', chatId: 3, email: 'c@b.c', country: 'CR', countryName: 'Costa Rica', plan: 'starter', price: 15, status: 'submitted', createdAt: new Date() }
  docs.d = { _id: 'd', chatId: 4, email: 'd@b.c', country: 'EC', countryName: 'Ecuador', plan: 'starter', price: 20, status: 'submitted', createdAt: old }
  stock = { 'DK:national': ['+4532000001'] }
  await nr.tick()
  ok('old Infobip DK request filled by MultiTEL', docs.a.status === 'active' && docs.a.phoneNumber === '+4532000001' && docs.a.provider === 'multitel')
  ok('purchase uses MultiTEL order + prepaid', purchases[0]?.presetOrder?._provider === 'multitel' && purchases[0]?.prepaid?.amount === 10 && purchases[0]?.type === 'national')
  ok('PY (no MultiTEL offer) refunded at once', docs.b.status === 'refunded' && credits.includes(12))
  ok('CR with no stock yet waits', docs.c.status === 'submitted' && !credits.includes(15))
  ok('EC with no stock after 3 days refunded', docs.d.status === 'refunded' && credits.includes(20))
  stock['CR:national'] = ['+50640000001']
  await nr.tick()
  ok('CR filled once stock appears', docs.c.status === 'active')
  await nr.tick()
  ok('nothing bought twice', bought.length === 2)
  const cat = require('../number-catalog')
  ok('AT local is an instant pick (not request)', !cat.best('AT', 'local')?.request && ['multitel', 'infobip'].includes(cat.best('AT', 'local')?.provider))
  ok('DK local is a MultiTEL request', cat.best('DK', 'local')?.request && cat.best('DK', 'local')?.provider === 'multitel')
  console.log(fails ? `${fails} failed` : 'all passed')
  process.exit(fails ? 1 : 0)
})()
