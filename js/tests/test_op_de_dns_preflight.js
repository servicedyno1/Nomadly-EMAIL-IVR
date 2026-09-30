/**
 * Smoke test for the new OP NAST pre-flight + syncDomain + healer auto-sync.
 *
 * Tests:
 *   T1. opService.checkNsAuthoritative() with known-good CF zone returns ready=true
 *   T2. opService.checkNsAuthoritative() with bogus NS returns ready=false
 *   T3. opService.syncDomain() with non-existent domain returns clean error
 *   T4. opService.syncDomain() on a real ACT domain returns success
 *   T5. dnsHealer.PRE_DELEGATION_TLDS still contains .de (and exports correctly)
 *
 * No mutations except T4 (which is an idempotent re-push).
 */
'use strict'

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') })

const opService = require('../op-service')
const dnsHealer = require('../dns-healer')

const log = (...a) => console.log(...a)

let passed = 0
let failed = 0
const assert = (cond, label) => {
  if (cond) { log(`  ✅ ${label}`); passed++ }
  else      { log(`  ❌ ${label}`); failed++ }
}

const main = async () => {
  // ── T1: NAST pre-flight on a known-good CF zone ────────────────────────
  log('\nT1: NAST pre-flight on rsvpcrumelbell.de (CF NS already authoritative)')
  const t1 = await opService.checkNsAuthoritative(
    'rsvpcrumelbell.de',
    ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com'],
    15000
  )
  assert(t1.ready === true, 'ready === true')
  assert(t1.authoritativeCount === 2, 'both NS authoritative')
  assert(t1.elapsedMs < 5000, `elapsed ${t1.elapsedMs}ms (fast, <5s)`)
  log(`     elapsedMs=${t1.elapsedMs} perNs=${JSON.stringify(t1.perNs)}`)

  // ── T2: NAST pre-flight with bogus NS ─────────────────────────────────
  log('\nT2: NAST pre-flight with bogus NS (should fail fast)')
  const t2 = await opService.checkNsAuthoritative(
    'rsvpcrumelbell.de',
    ['this-ns-does-not-exist-12345.example', 'another-fake-ns-67890.example'],
    8000
  )
  assert(t2.ready === false, 'ready === false')
  assert(t2.authoritativeCount === 0, 'no NS authoritative')

  // ── T3: syncDomain with non-existent domain ──────────────────────────
  log('\nT3: syncDomain on bogus domain')
  const t3 = await opService.syncDomain('not-a-real-domain-xyz-12345.de')
  assert(typeof t3.error === 'string' && t3.error.length > 0, `clean error: "${t3.error}"`)

  // ── T4: syncDomain on a real ACT domain (idempotent re-push) ──────────
  log('\nT4: syncDomain on rsvpcrumelbell.de (should accept code:0)')
  const t4 = await opService.syncDomain('rsvpcrumelbell.de')
  assert(t4.success === true, `success: ${JSON.stringify(t4)}`)
  assert(t4.opStatus === 'ACT', `opStatus === ACT (got: ${t4.opStatus})`)

  // ── T5: dnsHealer exports ─────────────────────────────────────────────
  log('\nT5: dnsHealer.PRE_DELEGATION_TLDS export')
  assert(dnsHealer.PRE_DELEGATION_TLDS.has('de'), '.de in PRE_DELEGATION_TLDS')
  assert(dnsHealer.PRE_DELEGATION_TLDS.has('nl'), '.nl in PRE_DELEGATION_TLDS')
  assert(typeof dnsHealer.verifyDelegationOrQueue === 'function', 'verifyDelegationOrQueue exported')

  log(`\n═══ ${passed} passed, ${failed} failed ═══`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL:', e?.stack || e); process.exit(2) })
