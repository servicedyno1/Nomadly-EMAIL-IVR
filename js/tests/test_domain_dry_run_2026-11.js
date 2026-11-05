// Domain registration must never reach a registrar outside production. Run: node js/tests/test_domain_dry_run_2026-11.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
const assert = require('assert')
const axios = require('axios')

const calls = []
for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
  axios[m] = async (url) => { calls.push(`${m} ${url}`); throw new Error('network blocked in test') }
}
process.env.BOT_ENVIRONMENT = 'development'
delete process.env.DOMAIN_DRY_RUN

const { isDomainDryRun } = require('../domain-dry-run')
const op = require('../op-service')
const { buyDomainOnline } = require('../cr-domain-register')
const domainService = require('../domain-service')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, e.message) } }

;(async () => {
  await t('dry run on in development', () => assert.strictEqual(isDomainDryRun(), true))
  await t('DOMAIN_DRY_RUN=true forces dry run in production', () => {
    process.env.BOT_ENVIRONMENT = 'production'; process.env.DOMAIN_DRY_RUN = 'true'
    assert.strictEqual(isDomainDryRun(), true)
    delete process.env.DOMAIN_DRY_RUN
    assert.strictEqual(isDomainDryRun(), false)
    process.env.BOT_ENVIRONMENT = 'development'
  })
  await t('missing BOT_ENVIRONMENT is dry run', () => {
    const v = process.env.BOT_ENVIRONMENT; delete process.env.BOT_ENVIRONMENT
    assert.strictEqual(isDomainDryRun(), true); process.env.BOT_ENVIRONMENT = v
  })
  for (const nsChoice of ['provider_default', 'cloudflare', 'custom']) {
    for (const registrar of ['OpenProvider', 'ConnectReseller']) {
      await t(`domain-service ${registrar}/${nsChoice} simulated, no network`, async () => {
        calls.length = 0
        const r = await domainService.registerDomain('dryrun-test-example.com', registrar, nsChoice, null, '1', ['ns1.x.com', 'ns2.x.com'])
        assert.strictEqual(r.success, true); assert.strictEqual(r.dryRun, true)
        assert.deepStrictEqual(calls, [])
      })
    }
  }
  await t('op.registerDomain refuses, no network', async () => {
    calls.length = 0
    const r = await op.registerDomain('dryrun-test-example.com', [])
    assert.ok(r.error); assert.deepStrictEqual(calls, [])
  })
  await t('op.renewDomain refuses, no network', async () => {
    calls.length = 0
    const r = await op.renewDomain('dryrun-test-example.com', 1)
    assert.ok(r.error); assert.deepStrictEqual(calls, [])
  })
  await t('ConnectReseller buyDomainOnline refuses, no network', async () => {
    calls.length = 0
    const r = await buyDomainOnline('dryrun-test-example.com')
    assert.ok(r.error); assert.deepStrictEqual(calls, [])
  })
  await t('postRegistrationNSUpdate no-op in dry run', async () => {
    calls.length = 0
    const r = await domainService.postRegistrationNSUpdate('dryrun-test-example.com', 'OpenProvider', 'cloudflare', ['a.x', 'b.x'], null)
    assert.strictEqual(r.success, true); assert.deepStrictEqual(calls, [])
  })
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
