/* global process */
/**
 * Unit tests for js/whm-account-digest.js
 * Run: node js/tests/test_whm_account_digest_2026-06.js
 */
const assert = require('assert')
const { MongoClient } = require('mongodb')
const D = require('../whm-account-digest')

let pass = 0
let fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

function testMsUntilNextRun() {
  console.log('msUntilNextRun:')
  // 06:00 UTC now, target 08:00 → 2h
  let now = new Date('2026-06-01T06:00:00.000Z')
  ok('before target same day → 2h', D.msUntilNextRun(8, 0, now) === 2 * 3600000)
  // 09:00 UTC now, target 08:00 → next day 23h
  now = new Date('2026-06-01T09:00:00.000Z')
  ok('after target → next day 23h', D.msUntilNextRun(8, 0, now) === 23 * 3600000)
  // exactly at target → rolls to next day (24h)
  now = new Date('2026-06-01T08:00:00.000Z')
  ok('exactly at target → 24h', D.msUntilNextRun(8, 0, now) === 24 * 3600000)
  // always strictly positive
  ok('always > 0', D.msUntilNextRun(8, 0, new Date()) > 0)
}

function testComputeStats() {
  console.log('computeStats:')
  const whm = [
    { user: 'aaa1', suspended: 0 },
    { user: 'Bbb2', suspended: 1 },   // suspended + mixed-case
    { user: 'ccc3', suspended: 0 },
    { user: 'ddd4', suspended: 0 },
  ]
  const brand = new Set(['aaa1', 'bbb2']) // brand owns 2 of them (case-insensitive)
  const s = D.computeStats(whm, brand, { licenseLimit: 30, warnAt: 27 })
  ok('total', s.total === 4)
  ok('suspended', s.suspended === 1)
  ok('active', s.active === 3)
  ok('brandCount (case-insensitive)', s.brandCount === 2)
  ok('otherCount', s.otherCount === 2)
  ok('remaining', s.remaining === 26)
  ok('not near limit', s.nearLimit === false && s.atOrOverLimit === false)

  // brand as array (not Set) also works
  const s2 = D.computeStats(whm, ['ccc3'], { licenseLimit: 30 })
  ok('array brandCpUsers works', s2.brandCount === 1)

  // near-limit threshold
  const many = Array.from({ length: 27 }, (_, i) => ({ user: 'u' + i, suspended: 0 }))
  const near = D.computeStats(many, [], { licenseLimit: 30, warnAt: 27 })
  ok('nearLimit at 27/30', near.nearLimit === true && near.atOrOverLimit === false)

  // at/over limit
  const full = Array.from({ length: 30 }, (_, i) => ({ user: 'u' + i, suspended: 0 }))
  const atLimit = D.computeStats(full, [], { licenseLimit: 30, warnAt: 27 })
  ok('atOrOverLimit at 30/30', atLimit.atOrOverLimit === true)

  // default limit = 30 when not provided
  ok('default licenseLimit 30', D.computeStats([], []).licenseLimit === 30)
  // default warnAt = limit - 3
  ok('default warnAt = limit-3', D.computeStats([], [], { licenseLimit: 100 }).warnAt === 97)
}

function testBuildDigestMessage() {
  console.log('buildDigestMessage:')
  const base = D.computeStats(
    [{ user: 'a', suspended: 0 }, { user: 'b', suspended: 1 }],
    ['a'], { licenseLimit: 30, warnAt: 27 }
  )
  const msg = D.buildDigestMessage(base, { brandName: 'Nomadly', whmHost: 'whm2-fra1' })
  ok('has brand header', msg.includes('Daily cPanel Report — Nomadly'))
  ok('has host', msg.includes('whm2-fra1'))
  ok('has total/license', msg.includes('2 / 30'))
  ok('has suspended line', msg.includes('Suspended: 1'))
  ok('has active line', msg.includes('Active: 1'))
  ok('has brand breakdown', msg.includes('Nomadly (this brand): <b>1</b>'))
  ok('has other/shared', msg.includes('Other / shared: 1'))
  ok('no warning when safe', !msg.includes('Near license limit') && !msg.includes('License limit reached'))

  // near-limit warning present
  const near = D.computeStats(Array.from({ length: 28 }, (_, i) => ({ user: 'u' + i })), [], { licenseLimit: 30, warnAt: 27 })
  const nearMsg = D.buildDigestMessage(near, { brandName: 'Smadav', whmHost: 'whm2-fra1' })
  ok('near-limit warning shown', nearMsg.includes('Near license limit') && nearMsg.includes('2 slots left'))

  // 1 slot left → singular
  const one = D.computeStats(Array.from({ length: 29 }, (_, i) => ({ user: 'u' + i })), [], { licenseLimit: 30, warnAt: 27 })
  ok('singular "1 slot left"', D.buildDigestMessage(one, {}).includes('1 slot left'))

  // over-limit message
  const full = D.computeStats(Array.from({ length: 30 }, (_, i) => ({ user: 'u' + i })), [], { licenseLimit: 30, warnAt: 27 })
  ok('over-limit message shown', D.buildDigestMessage(full, {}).includes('License limit reached'))

  // HTML escaping of brand name
  ok('escapes brand name', D.buildDigestMessage(base, { brandName: 'A&B<x>' }).includes('A&amp;B&lt;x&gt;'))
}

async function testRunDigestWithMongo() {
  console.log('runDigest (fake WHM + local Mongo):')
  const uri = process.env.MONGO_URL || 'mongodb://localhost:27017'
  const dbName = 'test_whm_digest_' + Date.now()
  const client = new MongoClient(uri)
  try {
    await client.connect()
  } catch (e) {
    console.log('  ⚠ SKIP Mongo tests — no local MongoDB:', e.message)
    return
  }
  const db = client.db(dbName)
  const prevBrand = process.env.CHAT_BOT_NAME
  const prevLimit = process.env.WHM_LICENSE_LIMIT
  const prevWarn = process.env.WHM_LICENSE_WARN_AT
  try {
    process.env.CHAT_BOT_NAME = 'Nomadly'
    process.env.WHM_LICENSE_LIMIT = '30'
    process.env.WHM_LICENSE_WARN_AT = '27'

    await db.collection('cpanelAccounts').insertMany([
      { cpUser: 'aaa1', domain: 'a.com' },                              // active, on WHM
      { cpUser: 'bbb2', domain: 'b.com', suspended: true },            // active record, on WHM (suspended on WHM)
      { cpUser: 'gone9', domain: 'g.com', deleted: true },            // deleted → excluded
      { cpUser: 'term8', domain: 't.com', terminatedOnWhm: true },    // terminated → excluded
      { cpUser: 'arch7', domain: 'r.com', archived: true },          // archived → excluded
    ])

    // brand cpUsers loader excludes deleted/terminated/archived
    const brandUsers = await D.loadBrandCpUsers(db)
    ok('loadBrandCpUsers active only', brandUsers.size === 2 && brandUsers.has('aaa1') && brandUsers.has('bbb2'))
    ok('loadBrandCpUsers excludes deleted/term/archived', !brandUsers.has('gone9') && !brandUsers.has('term8') && !brandUsers.has('arch7'))

    // fake WHM: 4 accounts total (2 belong to this brand), 1 suspended
    const fakeWhm = {
      _whmApi: {
        get: async () => ({
          status: 200,
          data: {
            metadata: { result: 1 },
            data: { acct: [
              { user: 'aaa1', suspended: 0 },
              { user: 'bbb2', suspended: 1 },
              { user: 'zzz5', suspended: 0 },   // other brand / shared
              { user: 'zzz6', suspended: 0 },   // other brand / shared
            ] },
          },
        }),
      },
    }
    let captured = null
    const notifyAdmin = (m) => { captured = m }
    const r = await D.runDigest({ db, whmService: fakeWhm, notifyAdmin })
    ok('runDigest ok', r.ok === true && r.sent === true)
    ok('stats total 4', r.stats.total === 4)
    ok('stats suspended 1', r.stats.suspended === 1)
    ok('stats brandCount 2', r.stats.brandCount === 2)
    ok('stats otherCount 2', r.stats.otherCount === 2)
    ok('message captured', !!captured && captured.includes('Daily cPanel Report — Nomadly'))
    ok('message total/license 4/30', captured.includes('4 / 30'))

    // WHM unreachable → failure note, no crash
    const downWhm = { _whmApi: { get: async () => { const e = new Error('ECONNREFUSED'); e.response = { status: 0 }; throw e } } }
    let downMsg = null
    const r2 = await D.runDigest({ db, whmService: downWhm, notifyAdmin: (m) => { downMsg = m } })
    ok('runDigest handles WHM down', r2.sent === true && r2.ok === false)
    ok('failure note sent', !!downMsg && downMsg.includes("Couldn't reach WHM"))

    // metadata.result != 1 also treated as not-ok
    const badMeta = { _whmApi: { get: async () => ({ status: 200, data: { metadata: { result: 0, reason: 'access denied' }, data: { acct: [] } } }) } }
    const r3 = await D.runDigest({ db, whmService: badMeta, notifyAdmin: () => {} })
    ok('metadata.result!=1 → not ok', r3.ok === false)
  } finally {
    await db.dropDatabase().catch(() => {})
    await client.close()
    if (prevBrand === undefined) delete process.env.CHAT_BOT_NAME; else process.env.CHAT_BOT_NAME = prevBrand
    if (prevLimit === undefined) delete process.env.WHM_LICENSE_LIMIT; else process.env.WHM_LICENSE_LIMIT = prevLimit
    if (prevWarn === undefined) delete process.env.WHM_LICENSE_WARN_AT; else process.env.WHM_LICENSE_WARN_AT = prevWarn
  }
}

function testInitSchedulerGuards() {
  console.log('initScheduler guards:')
  const prevEnv = process.env.BOT_ENVIRONMENT
  const prevSkip = process.env.SKIP_WEBHOOK_SYNC
  try {
    // dev sandbox → returns null (no scheduler)
    process.env.BOT_ENVIRONMENT = 'development'
    delete process.env.SKIP_WEBHOOK_SYNC
    ok('skips when not production', D.initScheduler({ db: {}, whmService: { _whmApi: {} }, notifyAdmin: () => {} }) === null)

    // production but SKIP_WEBHOOK_SYNC=true → still skip
    process.env.BOT_ENVIRONMENT = 'production'
    process.env.SKIP_WEBHOOK_SYNC = 'true'
    ok('skips when SKIP_WEBHOOK_SYNC=true', D.initScheduler({ db: {}, whmService: { _whmApi: {} }, notifyAdmin: () => {} }) === null)

    // production, no skip, but missing deps → null
    delete process.env.SKIP_WEBHOOK_SYNC
    ok('skips when deps missing', D.initScheduler({ db: null, whmService: null, notifyAdmin: null }) === null)

    // production, valid deps → returns handle with stop()
    const h = D.initScheduler({ db: {}, whmService: { _whmApi: {} }, notifyAdmin: () => {} })
    ok('arms scheduler when valid', h && typeof h.stop === 'function')
    if (h) h.stop()
  } finally {
    if (prevEnv === undefined) delete process.env.BOT_ENVIRONMENT; else process.env.BOT_ENVIRONMENT = prevEnv
    if (prevSkip === undefined) delete process.env.SKIP_WEBHOOK_SYNC; else process.env.SKIP_WEBHOOK_SYNC = prevSkip
  }
}

;(async () => {
  testMsUntilNextRun()
  testComputeStats()
  testBuildDigestMessage()
  await testRunDigestWithMongo()
  testInitSchedulerGuards()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})()
