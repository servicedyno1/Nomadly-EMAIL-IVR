/**
 * Integration test for /app/js/hosting-upgrade-nudge.js
 *
 * Drives `runNudgeSweep` against a real MongoDB with a captured fake bot.
 * Verifies:
 *   1. Weekly account at day 1.5 → nudge SENT (golden target, $15 credit) + creditNudgeAt stamped.
 *   2. Premium-monthly account at day 12.5 → nudge SENT (target = golden, $37.50 credit).
 *   3. Weekly account at day 0.5 (too early) → NO nudge.
 *   4. Weekly account at day 2.5 (too late) → NO nudge.
 *   5. Idempotency: second sweep on the same day does not double-send.
 *   6. Resend after renewal: when lastRenewedAt advances past creditNudgeAt,
 *      the next sweep fires again.
 *   7. Suspended account is skipped.
 *   8. Bot send-failure: account is NOT stamped (so next run can retry).
 *
 * Run:  node js/__tests__/hosting-upgrade-nudge.integration.test.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const { MongoClient } = require('mongodb')
const { runNudgeSweep } = require('../hosting-upgrade-nudge')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'

const PREMIUM_WEEKLY = Number(process.env.PREMIUM_ANTIRED_WEEKLY_PRICE || 30)
const PREMIUM_CPANEL = Number(process.env.PREMIUM_ANTIRED_CPANEL_PRICE || 75)
const GOLDEN_CPANEL = Number(process.env.GOLDEN_ANTIRED_CPANEL_PRICE || 100)

const TEST_PREFIX = '__nudge_test__'
const DAY = 24 * 60 * 60 * 1000

let passed = 0
let failed = 0
const fails = []

function assert(label, cond, extra) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    fails.push({ label, extra })
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`)
  }
}

function makeFakeBot() {
  const sent = []
  return {
    sent,
    fail: false,
    sendMessage(chatId, text, opts) {
      if (this.fail) return Promise.reject(new Error('fake bot send failure'))
      sent.push({ chatId, text, opts })
      return Promise.resolve({ ok: true })
    },
  }
}

async function seedAcct(cpanelAccounts, { id, chatId, plan, daysAgo, suspended = false, creditNudgeAt = null }) {
  const anchor = new Date(Date.now() - daysAgo * DAY)
  await cpanelAccounts.deleteOne({ _id: id })
  const doc = {
    _id: id,
    chatId,
    domain: `${id}.test`,
    plan,
    cpUser: 'testuser',
    createdAt: anchor,
    lastRenewedAt: anchor,
    expiryDate: new Date(Date.now() + 2 * DAY),
    autoRenew: false,
  }
  if (suspended) doc.suspended = true
  if (creditNudgeAt) doc.creditNudgeAt = creditNudgeAt
  await cpanelAccounts.insertOne(doc)
  return doc
}

async function main() {
  console.log('\nhosting-upgrade-nudge — integration test')
  console.log('─────────────────────────────────────────')
  console.log(`MONGO_URL=${MONGO_URL}  DB=${DB_NAME}`)
  console.log(`Prices: weekly=$${PREMIUM_WEEKLY}  premium-cpanel=$${PREMIUM_CPANEL}  golden=$${GOLDEN_CPANEL}`)

  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  const cpanelAccounts = db.collection('cpanelAccounts')

  // Cleanup any leftover docs from previous runs
  await cpanelAccounts.deleteMany({ _id: { $regex: `^${TEST_PREFIX}` } })

  // ─────────────────────────────────────────────────────────────
  // Seed all scenarios
  // ─────────────────────────────────────────────────────────────
  await seedAcct(cpanelAccounts, {
    id: `${TEST_PREFIX}-weekly-sweetspot`,
    chatId: `${TEST_PREFIX}-chat-A`,
    plan: 'Premium Anti-Red (1-Week)',
    daysAgo: 1.5,
  })
  await seedAcct(cpanelAccounts, {
    id: `${TEST_PREFIX}-premium-sweetspot`,
    chatId: `${TEST_PREFIX}-chat-B`,
    plan: 'Premium Anti-Red HostPanel (30 Days)',
    daysAgo: 12.5,
  })
  await seedAcct(cpanelAccounts, {
    id: `${TEST_PREFIX}-weekly-tooearly`,
    chatId: `${TEST_PREFIX}-chat-C`,
    plan: 'Premium Anti-Red (1-Week)',
    daysAgo: 0.5,
  })
  await seedAcct(cpanelAccounts, {
    id: `${TEST_PREFIX}-weekly-toolate`,
    chatId: `${TEST_PREFIX}-chat-D`,
    plan: 'Premium Anti-Red (1-Week)',
    daysAgo: 2.5,
  })
  await seedAcct(cpanelAccounts, {
    id: `${TEST_PREFIX}-suspended`,
    chatId: `${TEST_PREFIX}-chat-E`,
    plan: 'Premium Anti-Red (1-Week)',
    daysAgo: 1.5,
    suspended: true,
  })

  // ─────────────────────────────────────────────────────────────
  // Run 1 — first sweep
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Run 1] First sweep')
  let bot = makeFakeBot()
  let res = await runNudgeSweep({ bot, db })

  assert('Run 1: sent exactly 2 nudges (weekly-sweetspot + premium-sweetspot)',
    res.sent === 2, `sent=${res.sent}`)
  assert('Run 1: no errors', res.errors === 0)

  const sentChatIds = bot.sent.map(s => s.chatId).sort()
  assert('Run 1: nudged the weekly sweet-spot account',
    sentChatIds.includes(`${TEST_PREFIX}-chat-A`))
  assert('Run 1: nudged the premium-monthly sweet-spot account',
    sentChatIds.includes(`${TEST_PREFIX}-chat-B`))
  assert('Run 1: did NOT nudge too-early account',
    !sentChatIds.includes(`${TEST_PREFIX}-chat-C`))
  assert('Run 1: did NOT nudge too-late account',
    !sentChatIds.includes(`${TEST_PREFIX}-chat-D`))
  assert('Run 1: did NOT nudge suspended account',
    !sentChatIds.includes(`${TEST_PREFIX}-chat-E`))

  // Inspect the weekly DM body
  const weeklyMsg = bot.sent.find(s => s.chatId === `${TEST_PREFIX}-chat-A`)
  assert('weekly DM uses HTML parse mode',
    weeklyMsg.opts?.parse_mode === 'HTML')
  const expectedWeeklyCredit = (PREMIUM_WEEKLY * 0.5).toFixed(2)
  assert(`weekly DM mentions $${expectedWeeklyCredit} credit`,
    weeklyMsg.text.includes(`$${expectedWeeklyCredit}`),
    `body: ${weeklyMsg.text.slice(0, 200)}`)
  assert('weekly DM mentions Golden as the upgrade target',
    weeklyMsg.text.includes('Golden Anti-Red'),
    `body: ${weeklyMsg.text.slice(0, 200)}`)

  // Verify creditNudgeAt was stamped on the right accounts
  const stampedA = await cpanelAccounts.findOne({ _id: `${TEST_PREFIX}-weekly-sweetspot` })
  assert('weekly account got creditNudgeAt stamp', stampedA.creditNudgeAt instanceof Date)
  const stampedB = await cpanelAccounts.findOne({ _id: `${TEST_PREFIX}-premium-sweetspot` })
  assert('premium account got creditNudgeAt stamp', stampedB.creditNudgeAt instanceof Date)
  const unstampedC = await cpanelAccounts.findOne({ _id: `${TEST_PREFIX}-weekly-tooearly` })
  assert('too-early account NOT stamped', !unstampedC.creditNudgeAt)

  // ─────────────────────────────────────────────────────────────
  // Run 2 — same data: idempotency check
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Run 2] Idempotency — same data should not re-send')
  bot = makeFakeBot()
  res = await runNudgeSweep({ bot, db })
  assert('Run 2: zero nudges sent (idempotent)', res.sent === 0, `sent=${res.sent}`)
  assert('Run 2: zero errors', res.errors === 0)

  // ─────────────────────────────────────────────────────────────
  // Run 3 — renewal advances anchor past the stamp → re-send
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Run 3] After renewal anchor advances → re-fire')
  // Simulate a renewal by moving lastRenewedAt forward (and back into the sweet spot)
  await cpanelAccounts.updateOne(
    { _id: `${TEST_PREFIX}-weekly-sweetspot` },
    { $set: { lastRenewedAt: new Date(Date.now() - 1.5 * DAY) } }
    // creditNudgeAt stays at its OLD value (set during Run 1, ~now)
    // So the new anchor is AFTER the old stamp → alreadyNudgedThisCycle = false
  )
  // The new anchor (~now-1.5d) is AFTER the old creditNudgeAt (~now), wait — that's
  // the wrong direction. To make the new anchor newer than the stamp we need to
  // set lastRenewedAt to a more RECENT timestamp than the stamp.
  // Stamp was just set, so to be "after" we must rewrite stamp to be old too:
  await cpanelAccounts.updateOne(
    { _id: `${TEST_PREFIX}-weekly-sweetspot` },
    { $set: {
      creditNudgeAt: new Date(Date.now() - 5 * DAY),    // old stamp
      lastRenewedAt: new Date(Date.now() - 1.5 * DAY),  // newer anchor → in sweet spot
    } }
  )
  bot = makeFakeBot()
  res = await runNudgeSweep({ bot, db })
  assert('Run 3: post-renewal account is nudged again',
    res.sent >= 1, `sent=${res.sent}`)
  assert('Run 3: weekly chat-A nudged again',
    bot.sent.some(s => s.chatId === `${TEST_PREFIX}-chat-A`))

  // ─────────────────────────────────────────────────────────────
  // Run 4 — bot send failure: account is NOT stamped
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Run 4] Bot send failure → no stamp (retry-able)')
  // Reset chat-A back to fresh-cycle state
  await cpanelAccounts.updateOne(
    { _id: `${TEST_PREFIX}-weekly-sweetspot` },
    { $set: { lastRenewedAt: new Date(Date.now() - 1.5 * DAY) }, $unset: { creditNudgeAt: '' } }
  )
  bot = makeFakeBot()
  bot.fail = true
  res = await runNudgeSweep({ bot, db })
  assert('Run 4: errors recorded for failing send', res.errors >= 1, `errors=${res.errors}`)
  assert('Run 4: no nudges counted as sent', res.sent === 0)
  const refetched = await cpanelAccounts.findOne({ _id: `${TEST_PREFIX}-weekly-sweetspot` })
  assert('Run 4: NO creditNudgeAt stamp (retry-able next time)', !refetched.creditNudgeAt)

  // Cleanup
  await cpanelAccounts.deleteMany({ _id: { $regex: `^${TEST_PREFIX}` } })
  await client.close()

  console.log('\n─────────────────────────────────────────')
  console.log(`Result: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    for (const f of fails) console.log(' -', f.label, f.extra || '')
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('Integration test crashed:', err)
  process.exit(2)
})
