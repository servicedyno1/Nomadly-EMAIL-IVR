/**
 * tests/test_protection_heartbeat_breaker.js
 * WHM-timeout circuit breaker + outage alert (2026-10-01). Mocks only, no live WHM.
 */
const Module = require('module')
const path = require('path')

const axiosCalls = []
const tgPosts = []
let whmMode = 'timeout'
const origRequire = Module.prototype.require
Module.prototype.require = function (req) {
  if (req === 'axios') {
    return {
      create: () => ({
        get: async (url, opts) => {
          axiosCalls.push({ url, params: opts?.params })
          if (whmMode === 'timeout') { const e = new Error('timeout of 30000ms exceeded'); e.code = 'ECONNABORTED'; throw e }
          const u = opts.params.cpanel_jsonapi_user
          if (opts.params.file === '.user.ini') return { data: { result: { data: { content: `auto_prepend_file = /home/${u}/public_html/.antired-challenge.php` } } } }
          return { data: { result: { data: { content: 'ANTIRED_IP_FIXED CF_CONNECTING_IP FIL212sD' } } } }
        },
      }),
      post: async (url, body) => { tgPosts.push(body); return { data: { ok: true } } },
    }
  }
  if (req === './anti-red-service' || req === path.join(__dirname, '../anti-red-service')) {
    return { deployCFIPFix: async () => ({ ok: true }) }
  }
  return origRequire.apply(this, arguments)
}

process.env.WHM_HOST = 'fake-whm.example.com'
process.env.WHM_TOKEN = 'fake'
process.env.TELEGRAM_BOT_TOKEN = 'fake-token'
process.env.TELEGRAM_ADMIN_CHAT_ID = '1'
delete process.env.SKIP_WEBHOOK_SYNC

const heartbeat = require('../protection-heartbeat.js')

const dbDocs = Array.from({ length: 10 }, (_, i) => ({ _id: `acct${i}`, deleted: false, lastCfIpFixSig: 'sig' }))
const fakeCol = {
  find: () => ({ toArray: async () => dbDocs.filter(d => !d.deleted) }),
  findOne: async (f, o) => dbDocs.find(d => d._id === f._id) || null,
  updateOne: async () => ({ matchedCount: 1 }),
}
heartbeat.init({ collection: () => fakeCol })

;(async () => {
  let allOk = true
  const t0 = Date.now()
  const s1 = await heartbeat.runHeartbeat()
  const secs = (Date.now() - t0) / 1000
  console.log('TEST 1 — breaker aborts after 3 timed-out accounts:', JSON.stringify(s1), `in ${secs.toFixed(1)}s, axios calls=${axiosCalls.length}`)
  const ok1 = s1.aborted === 'whm_api_timeouts' && s1.skipped === 10 && s1.skippedWhmReadUnreliable === 3 && axiosCalls.length === 24
  console.log('  →', ok1 ? '✅ PASS' : '❌ FAIL'); if (!ok1) allOk = false

  await heartbeat.runHeartbeat()
  const beforeAlert = tgPosts.length
  await heartbeat.runHeartbeat()
  console.log('\nTEST 2 — admin paged on 3rd consecutive unusable cycle:', `posts before=${beforeAlert} after=${tgPosts.length}`)
  const ok2 = beforeAlert === 0 && tgPosts.length === 1 && /WHM API unreachable/.test(tgPosts[0].text)
  console.log('  →', ok2 ? '✅ PASS' : '❌ FAIL'); if (!ok2) allOk = false

  await heartbeat.runHeartbeat()
  const ok2b = tgPosts.length === 1
  console.log('TEST 2b — no duplicate page on 4th cycle:', ok2b ? '✅ PASS' : '❌ FAIL'); if (!ok2b) allOk = false

  whmMode = 'ok'
  const s3 = await heartbeat.runHeartbeat()
  console.log('\nTEST 3 — recovery:', JSON.stringify(s3), `posts=${tgPosts.length}`)
  const ok3 = !s3.aborted && s3.ok === 10 && tgPosts.length === 2 && /recovered/.test(tgPosts[1].text)
  console.log('  →', ok3 ? '✅ PASS' : '❌ FAIL'); if (!ok3) allOk = false

  console.log('\n══ FINAL: ' + (allOk ? '✅ ALL TESTS PASS' : '❌ SOMETHING FAILED'))
  process.exit(allOk ? 0 : 1)
})()
