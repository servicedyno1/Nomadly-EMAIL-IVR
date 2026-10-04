/* global describe, test, expect, jest, afterAll */
/**
 * store-webhook-e2e.test.js — drives the REAL POST /store/crypto-webhook route
 * end-to-end with an in-memory DB and the provisioner + DynoPay gateway MOCKED
 * (no real domain registration / cPanel creation).
 *
 * Two anchors:
 *  - order 9fd5da6a (lloyd-support.com): a guest ERC20 order whose DynoPay status
 *    re-verify is UNREACHABLE. A paid order must never be silently dropped — a
 *    webhook carrying a VALID DynoPay HMAC signature fulfills on its own.
 *  - forged-webhook exploit (2026-06): an UNSIGNED body claiming "confirmed" with
 *    the gateway unreachable must be HELD, and the credited amount is NEVER taken
 *    from the webhook body (gateway amount or invoiced total only).
 */

// Mock the shared provisioner so NOTHING real is registered/created.
jest.mock('../js/cr-register-domain-&-create-cpanel.js', () => ({
  registerDomainAndCreateCpanel: jest.fn(async () => ({
    success: true, username: 'testcpuser', pin: '1357', nameservers: ['ns1.test', 'ns2.test'],
  })),
}))
// Mock DynoPay: gateway status endpoint UNREACHABLE by default (the lloyd failure condition).
jest.mock('../js/pay-dynopay', () => ({
  getDynopayCryptoAddress: jest.fn(async () => ({ address: '0xTEST', payment_id: 'pid-test' })),
  getDynopayCryptoPaymentStatus: jest.fn(async () => false),
  getDynopayPaymentStatusById: jest.fn(async () => false),
}))
// Mock BlockBee so no network is touched.
jest.mock('../js/pay-blockbee', () => ({
  getCryptoDepositAddress: jest.fn(async () => ({ address: null })),
  convert: jest.fn(async () => 0),
}))

const crypto = require('crypto')
const express = require('express')
const { createStoreRoutes } = require('../js/store-routes')
const { registerDomainAndCreateCpanel } = require('../js/cr-register-domain-&-create-cpanel.js')

const WEBHOOK_SECRET = 'whsec_e2e_test_secret'

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

let server, base, dbh, adminNotes
// `deps` lets a test inject a REACHABLE gateway (dynoStatusById) for the underpaid case.
function startServer(seed, deps = {}) {
  dbh = makeDb(seed)
  adminNotes = []
  const app = express()
  // Mirror production: keep the raw bytes so the V2 HMAC ("<t>.<rawBody>") can be verified.
  app.use(express.json({ verify: (req, _res, buf) => { if (buf && buf.length) req.rawBody = buf } }))
  app.use('/store', createStoreRoutes({ getDb: () => dbh.db, notifyAdmin: (m) => { adminNotes.push(String(m)) }, webhookSecret: WEBHOOK_SECRET, ...deps }))
  return new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve() }) })
}

// Sign exactly like DynoPay: X-Dynopay-Signature-V2 = "t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>"
function signV2(raw, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${v1}`
}

async function post(path, body, { signed = true, secret } = {}) {
  const raw = JSON.stringify(body)
  const headers = { 'Content-Type': 'application/json' }
  if (signed) headers['X-Dynopay-Signature-V2'] = signV2(raw, secret)
  const r = await fetch(base + path, { method: 'POST', headers, body: raw })
  return { status: r.status, text: await r.text() }
}

afterAll((done) => { if (server) server.close(done); else done() })

describe('POST /store/crypto-webhook — end-to-end payment confirmation & provisioning', () => {
  test('REGRESSION lloyd: SIGNED confirmed webhook + gateway unreachable → order PROVISIONED (was dropped)', async () => {
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

    // Order transitioned to provisioned with credentials; credited the INVOICED total
    const o = dbh.orders.get('ord-confirmed')
    expect(o.status).toBe('provisioned')
    expect(o.username).toBe('testcpuser')
    expect(o.pin).toBe('1357')
    expect(o.usdCredited).toBe(69)
    // Admin is told it fulfilled on signature alone (gateway was down)
    expect(adminNotes.some(m => /SIGNED webhook/.test(m))).toBe(true)
    server.close(); server = null
  })

  test('EXPLOIT: UNSIGNED "confirmed" webhook + gateway unreachable → HELD, provisioner NOT called', async () => {
    await startServer([guestOrder('ord-forged')])
    registerDomainAndCreateCpanel.mockClear()

    const res = await post('/store/crypto-webhook', {
      event: 'payment.confirmed', payment_id: 'pid-test', base_amount: 9999, fee_payer: 'company',
      meta_data: { refId: 'ord-forged' },
    }, { signed: false })
    expect(res.status).toBe(200) // never make the gateway retry-storm
    expect(registerDomainAndCreateCpanel).not.toHaveBeenCalled()
    const o = dbh.orders.get('ord-forged')
    expect(o.status).toBe('pending')
    expect(o.usdCredited).toBeUndefined()
    expect(adminNotes.some(m => /HELD/.test(m))).toBe(true)
    server.close(); server = null
  })

  test('TAMPERED signature (wrong secret) → treated as invalid, order HELD, provisioner NOT called', async () => {
    await startServer([guestOrder('ord-badsig')])
    registerDomainAndCreateCpanel.mockClear()

    await post('/store/crypto-webhook', {
      event: 'payment.confirmed', payment_id: 'pid-test', base_amount: 69, fee_payer: 'company',
      meta_data: { refId: 'ord-badsig' },
    }, { secret: 'whsec_attacker' })
    expect(registerDomainAndCreateCpanel).not.toHaveBeenCalled()
    expect(dbh.orders.get('ord-badsig').status).toBe('pending')
    expect(adminNotes.some(m => /INVALID signature/.test(m))).toBe(true)
    server.close(); server = null
  })

  test('materially underpaid ($10 of $69, per the GATEWAY) → FAILED, provisioner NOT called', async () => {
    // The amount comes from the authoritative gateway status, never the webhook body —
    // so the body claims the full $69 while DynoPay reports only $10 received.
    await startServer([guestOrder('ord-underpaid')], {
      dynoStatusById: async () => ({ status: 'confirmed', amount_received_base: 10, base_amount: 69, fee_payer: 'company' }),
    })
    registerDomainAndCreateCpanel.mockClear()

    const res = await post('/store/crypto-webhook', {
      event: 'payment.confirmed', payment_id: 'pid-test', base_amount: 69, fee_payer: 'company',
      meta_data: { refId: 'ord-underpaid' },
    })
    expect(res.status).toBe(200)
    expect(registerDomainAndCreateCpanel).not.toHaveBeenCalled()
    const o = dbh.orders.get('ord-underpaid')
    expect(o.status).toBe('failed')
    expect(o.note).toBe('underpaid')
    expect(o.usdCredited).toBe(10)
    server.close(); server = null
  })

  test('gateway CONFIRMS payment → provisions even when the webhook is unsigned (gateway is authoritative)', async () => {
    await startServer([guestOrder('ord-gw-ok')], {
      dynoStatusById: async () => ({ status: 'confirmed', amount_received_base: 69, fee_payer: 'company' }),
    })
    registerDomainAndCreateCpanel.mockClear()

    await post('/store/crypto-webhook', {
      event: 'payment.confirmed', payment_id: 'pid-test', meta_data: { refId: 'ord-gw-ok' },
    }, { signed: false })
    expect(registerDomainAndCreateCpanel).toHaveBeenCalledTimes(1)
    expect(dbh.orders.get('ord-gw-ok').status).toBe('provisioned')
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

  test('duplicate SIGNED confirmed webhook → provisioner called only ONCE (idempotent)', async () => {
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
