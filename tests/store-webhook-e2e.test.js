/* global describe, test, expect, jest, beforeAll, afterAll */
/**
 * store-webhook-e2e.test.js — drives the REAL POST /store/crypto-webhook route
 * end-to-end with an in-memory DB and the provisioner + DynoPay gateway MOCKED
 * (no real domain registration / cPanel creation). Proves the storefront now
 * confirms payment and provisions with parity to the bot's wallet path.
 *
 * Reproduces order 9fd5da6a (lloyd-support.com): a guest ERC20 order whose
 * DynoPay status re-verify is UNREACHABLE. Previously dropped; now provisions.
 */

// Mock the shared provisioner so NOTHING real is registered/created.
jest.mock('../js/cr-register-domain-&-create-cpanel.js', () => ({
  registerDomainAndCreateCpanel: jest.fn(async () => ({
    success: true, username: 'testcpuser', pin: '1357', nameservers: ['ns1.test', 'ns2.test'],
  })),
}))
// Mock DynoPay: gateway status endpoint UNREACHABLE (the lloyd failure condition).
jest.mock('../js/pay-dynopay', () => ({
  getDynopayCryptoAddress: jest.fn(async () => ({ address: '0xTEST', payment_id: 'pid-test' })),
  getDynopayCryptoPaymentStatus: jest.fn(async () => false),
}))
// Mock BlockBee so no network is touched.
jest.mock('../js/pay-blockbee', () => ({
  getCryptoDepositAddress: jest.fn(async () => ({ address: null })),
  convert: jest.fn(async () => 0),
}))

const express = require('express')
const { createStoreRoutes } = require('../js/store-routes')
const { registerDomainAndCreateCpanel } = require('../js/cr-register-domain-&-create-cpanel.js')

function makeDb(seedOrders) {
  const orders = new Map(seedOrders.map(o => [o._id, { ...o }]))
  const cpanel = new Map()
  const txns = []
  const collection = (name) => {
    if (name === 'webOrders') return {
      async findOne(q) {
        if (q._id != null) { const o = orders.get(q._id); if (!o) return null; if (q.status && o.status !== q.status) return null; return { ...o } }
        if (q.paymentId != null) { for (const o of orders.values()) if (o.paymentId === q.paymentId) return { ...o }; return null }
        return null
      },
      async updateOne(q, upd) { const o = orders.get(q._id); if (!o) return { matchedCount: 0 }; if (q.status && o.status !== q.status) return { matchedCount: 0 }; Object.assign(o, upd.$set || {}); return { matchedCount: 1 } },
      async findOneAndUpdate(q, upd) { const o = orders.get(q._id); if (!o) return null; if (q.status && o.status !== q.status) return null; Object.assign(o, upd.$set || {}); return { ...o } },
      async insertOne(doc) { orders.set(doc._id, { ...doc }); return { insertedId: doc._id } },
    }
    if (name === 'cpanelAccounts') return {
      async findOne(q) { return cpanel.get(q._id) || null },
      async updateOne(q, upd) { const cur = cpanel.get(q._id) || { _id: q._id }; Object.assign(cur, upd.$set || {}); cpanel.set(q._id, cur); return { matchedCount: 1 } },
    }
    if (name === 'webUsers') return {
      async findOne(q) { return null },
      async updateOne() { return { matchedCount: 1 } },
      async findOneAndUpdate() { return null },
    }
    if (name === 'webWalletTxns') return { async insertOne(d) { txns.push(d); return { insertedId: d._id } } }
    return { async findOne() { return null }, async updateOne() { return { matchedCount: 0 } }, async insertOne() { return {} }, async findOneAndUpdate() { return null } }
  }
  return { db: { collection }, orders, cpanel, txns }
}

function guestOrder(id, extra = {}) {
  return {
    _id: id, kind: 'hosting', status: 'pending', webUserId: null, email: 'triborg799@protonmail.com',
    plan: 'Premium Anti-Red (1-Week)', hostingPrice: 30, domainPrice: 39, amountUsd: 69,
    coin: 'USDT-ERC20', provider: 'dynopay', payAddress: '0xe8c0', paymentId: 'pid-test',
    domain: `e2e-${id}.com`, domainMode: 'buy', registrar: 'OpenProvider', ...extra,
  }
}

let server, base, dbh
function startServer(seed) {
  dbh = makeDb(seed)
  const app = express()
  app.use(express.json())
  app.use('/store', createStoreRoutes({ getDb: () => dbh.db, notifyAdmin: () => {} }))
  return new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve() }) })
}
async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, text: await r.text() }
}

afterAll((done) => { if (server) server.close(done); else done() })

describe('POST /store/crypto-webhook — end-to-end payment confirmation & provisioning', () => {
  test('REGRESSION lloyd: confirmed webhook + gateway unreachable → order PROVISIONED (was dropped)', async () => {
    await startServer([guestOrder('ord-confirmed')])
    registerDomainAndCreateCpanel.mockClear()

    const res = await post('/store/crypto-webhook', {
      event: 'payment.confirmed', payment_id: 'pid-test', base_amount: 69, fee_payer: 'company',
      meta_data: { refId: 'ord-confirmed' },
    })
    expect(res.status).toBe(200)

    // Provisioner invoked exactly once with the guest owner + correct domain/plan
    expect(registerDomainAndCreateCpanel).toHaveBeenCalledTimes(1)
    const info = registerDomainAndCreateCpanel.mock.calls[0][1]
    expect(info._id).toBe('guest_ord-confirmed')
    expect(info.website_name).toBe('e2e-ord-confirmed.com')
    expect(info.source).toBe('web')

    // Order transitioned to provisioned with credentials
    const o = dbh.orders.get('ord-confirmed')
    expect(o.status).toBe('provisioned')
    expect(o.username).toBe('testcpuser')
    expect(o.pin).toBe('1357')
    expect(o.usdCredited).toBe(69)
    server.close(); server = null
  })

  test('materially underpaid ($10 of $69) → FAILED, provisioner NOT called', async () => {
    await startServer([guestOrder('ord-underpaid')])
    registerDomainAndCreateCpanel.mockClear()

    const res = await post('/store/crypto-webhook', {
      event: 'payment.confirmed', payment_id: 'pid-test', base_amount: 10, fee_payer: 'company',
      meta_data: { refId: 'ord-underpaid' },
    })
    expect(res.status).toBe(200)
    expect(registerDomainAndCreateCpanel).not.toHaveBeenCalled()
    const o = dbh.orders.get('ord-underpaid')
    expect(o.status).toBe('failed')
    expect(o.note).toBe('underpaid')
    server.close(); server = null
  })

  test('pending webhook → order stays pending, provisioner NOT called', async () => {
    await startServer([guestOrder('ord-pending', { paymentId: null })])
    registerDomainAndCreateCpanel.mockClear()

    const res = await post('/store/crypto-webhook', {
      event: 'payment.pending', payment_id: 'pid-test',
      meta_data: { refId: 'ord-pending' },
    })
    expect(res.status).toBe(200)
    expect(registerDomainAndCreateCpanel).not.toHaveBeenCalled()
    const o = dbh.orders.get('ord-pending')
    expect(o.status).toBe('pending')
    expect(o.paymentId).toBe('pid-test') // pending mapping recorded
    server.close(); server = null
  })

  test('duplicate confirmed webhook → provisioner called only ONCE (idempotent)', async () => {
    await startServer([guestOrder('ord-dup')])
    registerDomainAndCreateCpanel.mockClear()

    const body = { event: 'payment.confirmed', payment_id: 'pid-test', base_amount: 69, fee_payer: 'company', meta_data: { refId: 'ord-dup' } }
    await post('/store/crypto-webhook', body)
    await post('/store/crypto-webhook', body) // retry
    expect(registerDomainAndCreateCpanel).toHaveBeenCalledTimes(1)
    expect(dbh.orders.get('ord-dup').status).toBe('provisioned')
    server.close(); server = null
  })
})
