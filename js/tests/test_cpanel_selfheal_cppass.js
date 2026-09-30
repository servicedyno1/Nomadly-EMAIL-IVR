// Unit tests for the cpPass self-heal wiring (production-gated rotation +
// retry-once). Control-flow only — repairFn is injected so NO real WHM /passwd
// call or Mongo write happens. Verifies the dev/sandbox production gate never
// rotates a real cPanel password.
const routes = require('../cpanel-routes')
const { _selfHealCpPass, _userCallWithHeal } = routes

let pass = 0, fail = 0
function check(n, c) { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n) } }

const ORIG = { env: process.env.BOT_ENVIRONMENT, skip: process.env.SKIP_WEBHOOK_SYNC }
const setProd = () => { process.env.BOT_ENVIRONMENT = 'production'; process.env.SKIP_WEBHOOK_SYNC = 'false' }
const setDev = () => { process.env.BOT_ENVIRONMENT = 'development'; process.env.SKIP_WEBHOOK_SYNC = 'true' }

;(async () => {
  console.log('\n[1] Production gate — dev/sandbox NEVER rotates')
  {
    setDev()
    let repairCalled = false
    const req = { cpUser: 'u1', cpPass: 'old', whmHost: null }
    const r = await _selfHealCpPass(req, () => ({}), async () => { repairCalled = true; return { ok: true, rotated: true, cpPass: 'new' } })
    check('returns false in dev', r === false)
    check('repairFn NOT called in dev', repairCalled === false)
    check('cpPass unchanged in dev', req.cpPass === 'old')
  }

  console.log('\n[2] SKIP_WEBHOOK_SYNC=true gates off even when BOT_ENVIRONMENT=production')
  {
    process.env.BOT_ENVIRONMENT = 'production'; process.env.SKIP_WEBHOOK_SYNC = 'true'
    let repairCalled = false
    const req = { cpUser: 'u2', cpPass: 'old' }
    const r = await _selfHealCpPass(req, () => ({}), async () => { repairCalled = true; return { ok: true, rotated: true, cpPass: 'new' } })
    check('returns false when SKIP flag set', r === false)
    check('repairFn NOT called', repairCalled === false)
  }

  console.log('\n[3] Prod + rotation success → updates req.cpPass, returns true')
  {
    setProd()
    const req = { cpUser: 'u3', cpPass: 'old', whmHost: 'whm.host' }
    const r = await _selfHealCpPass(req, () => ({}), async (col, user, host) => {
      check('repair called with cpUser', user === 'u3')
      check('repair called with whmHost', host === 'whm.host')
      return { ok: true, rotated: true, cpPass: 'NEWPASS' }
    })
    check('returns true on rotation', r === true)
    check('cpPass updated to new', req.cpPass === 'NEWPASS')
  }

  console.log('\n[4] Prod + cool-down (ok, rotated:false) → returns false, adopts cached pass')
  {
    setProd()
    const req = { cpUser: 'u4', cpPass: 'old' }
    const r = await _selfHealCpPass(req, () => ({}), async () => ({ ok: true, rotated: false, cpPass: 'cached', reason: 'cool-down' }))
    check('returns false during cool-down', r === false)
    check('cpPass set to cached', req.cpPass === 'cached')
  }

  console.log('\n[5] Prod + repair fail → returns false, cpPass unchanged')
  {
    setProd()
    const req = { cpUser: 'u5', cpPass: 'old' }
    const r = await _selfHealCpPass(req, () => ({}), async () => ({ ok: false, error: 'WHM /passwd failure' }))
    check('returns false on repair fail', r === false)
    check('cpPass unchanged on fail', req.cpPass === 'old')
  }

  console.log('\n[6] Idempotent per request — second call does not re-attempt')
  {
    setProd()
    const req = { cpUser: 'u6', cpPass: 'old' }
    let n = 0
    const heal = async () => { n++; return { ok: true, rotated: true, cpPass: 'p' + n } }
    const r1 = await _selfHealCpPass(req, () => ({}), heal)
    const r2 = await _selfHealCpPass(req, () => ({}), heal)
    check('repairFn called only once', n === 1)
    check('second call returns same cached result', r2 === r1)
  }

  console.log('\n[7] _userCallWithHeal — success on first call, no heal')
  {
    let healCalls = 0, calls = 0
    const req = { cpPass: 'p' }
    const result = await _userCallWithHeal(req, () => { calls++; return { status: 1, data: 'ok' } }, async () => { healCalls++; return true })
    check('doCall once', calls === 1)
    check('heal not called', healCalls === 0)
    check('returns success', result.status === 1)
  }

  console.log('\n[8] _userCallWithHeal — non-auth error → no heal, returns result')
  {
    let healCalls = 0
    const req = { cpPass: 'p' }
    const result = await _userCallWithHeal(req, () => ({ status: 0, errors: ['already exists'] }), async () => { healCalls++; return true })
    check('heal not called for non-auth error', healCalls === 0)
    check('returns original error result', result.status === 0)
  }

  console.log('\n[9] _userCallWithHeal — auth broken + heal success → retry once → success')
  {
    const req = { cpPass: 'old' }
    let calls = 0
    const doCall = () => { calls++; return calls === 1 ? { status: 0, code: 'CPANEL_AUTH_FAILURE' } : { status: 1, data: 'healed' } }
    const result = await _userCallWithHeal(req, doCall, async () => { req.cpPass = 'new'; return true })
    check('doCall called twice (retry)', calls === 2)
    check('retry succeeded', result.status === 1)
  }

  console.log('\n[10] _userCallWithHeal — auth broken + heal fail → returns broken result (caller falls back)')
  {
    const req = { cpPass: 'old' }
    let calls = 0
    const result = await _userCallWithHeal(req, () => { calls++; return { status: 0, code: 'CPANEL_AUTH_FAILURE' } }, async () => false)
    check('doCall called once (no retry)', calls === 1)
    check('returns broken result', result.code === 'CPANEL_AUTH_FAILURE')
  }

  process.env.BOT_ENVIRONMENT = ORIG.env; process.env.SKIP_WEBHOOK_SYNC = ORIG.skip
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
  process.exit(fail === 0 ? 0 : 1)
})()
