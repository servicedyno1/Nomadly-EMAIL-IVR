// Regression: cpPass self-heal must NOT thrash on a SUSPENDED cPanel account.
// Prod (48h): ghrx51df logged "cpPass rotation FAILED … currently suspended …
// would unsuspend the account" 38×. A rotation can never fix a suspended
// account, so _repairCpPass must (a) recognise the terminal reason, (b) back
// off via cpPassSuspendedAt so the next request skips WHM entirely, and
// _selfHealCpPass must stop logging the generic failure for terminal cases.
const routes = require('../cpanel-routes')
const { _selfHealCpPass, _repairCpPass, _isTerminalPasswdReason } = routes

let pass = 0, fail = 0
function check(n, c) { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n) } }

const ORIG = { env: process.env.BOT_ENVIRONMENT, skip: process.env.SKIP_WEBHOOK_SYNC }
const setProd = () => { process.env.BOT_ENVIRONMENT = 'production'; process.env.SKIP_WEBHOOK_SYNC = 'false' }

;(async () => {
  console.log('\n[1] _isTerminalPasswdReason — suspended/locked/disabled → true')
  check('currently suspended', _isTerminalPasswdReason('the user "ghrx51df" is currently suspended. Changing the user\u2019s password would unsuspend the account'))
  check('would unsuspend', _isTerminalPasswdReason('this would unsuspend the account'))
  check('account is locked', _isTerminalPasswdReason('account is locked'))
  console.log('\n[2] _isTerminalPasswdReason — transient/other → false')
  check('cPHulk brute force', _isTerminalPasswdReason('cPHulk brute-force protection triggered') === false)
  check('generic failure', _isTerminalPasswdReason('WHM /passwd returned failure') === false)
  check('empty', _isTerminalPasswdReason('') === false)

  console.log('\n[3] _repairCpPass — recent cpPassSuspendedAt → suppressed, WHM never called')
  {
    let whmWouldRun = false
    const col = {
      findOne: async () => ({ _id: 'ghrx51df', cpPassSuspendedAt: new Date() }),
      updateOne: async () => { whmWouldRun = true }, // would only be hit on rotate/persist paths
    }
    const r = await _repairCpPass(() => col, 'ghrx51df', 'whm.host')
    check('ok=false', r.ok === false)
    check('terminal=true', r.terminal === true)
    check('suppressed=true', r.suppressed === true)
    check('no rotate/persist write happened', whmWouldRun === false)
  }

  console.log('\n[4] _repairCpPass — stale (expired) suspend marker → NOT suppressed (allows a re-probe)')
  {
    // 7h ago > default 6h window → the suspend cool-down has expired.
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000)
    let proceededPastSuspendGate = false
    const col = {
      findOne: async () => ({ _id: 'ghrx51df', cpPassSuspendedAt: old }),
      // Reaching updateOne means we passed the suspend gate AND the cool-down
      // gate (no cpPassRotatedAt) and hit the WHM path. We stub WHM via env
      // removal so it fails fast with "WHM API unavailable" — that's fine, we
      // only assert we did NOT short-circuit as suppressed.
      updateOne: async () => { proceededPastSuspendGate = true },
    }
    const savedToken = process.env.WHM_TOKEN
    delete process.env.WHM_TOKEN // force _makeWhmApi → null → "WHM API unavailable"
    const r = await _repairCpPass(() => col, 'ghrx51df', null)
    if (savedToken !== undefined) process.env.WHM_TOKEN = savedToken
    check('not suppressed after window expired', r.suppressed !== true)
    check('error surfaced (WHM path reached, not suspend short-circuit)', r.ok === false && /WHM API unavailable|WHM/.test(r.error || ''))
  }

  console.log('\n[5] _selfHealCpPass — terminal repair result is NOT logged as generic failure')
  {
    setProd()
    let captured = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => { captured += String(chunk); return origWrite(chunk, ...rest) }
    const req = { cpUser: 'ghrx51df', cpPass: 'old' }
    const r = await _selfHealCpPass(req, () => ({}), async () => ({ ok: false, terminal: true, suppressed: true, error: 'suspended' }))
    process.stdout.write = origWrite
    check('returns false', r === false)
    check('no "cpPass repair failed" log for terminal', !captured.includes('cpPass repair failed'))
  }

  console.log('\n[6] _selfHealCpPass — NON-terminal failure STILL logs the generic failure')
  {
    setProd()
    let captured = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => { captured += String(chunk); return origWrite(chunk, ...rest) }
    const req = { cpUser: 'someuser', cpPass: 'old' }
    await _selfHealCpPass(req, () => ({}), async () => ({ ok: false, error: 'transient WHM 500' }))
    process.stdout.write = origWrite
    check('logs generic failure for non-terminal', captured.includes('cpPass repair failed'))
  }

  process.env.BOT_ENVIRONMENT = ORIG.env; process.env.SKIP_WEBHOOK_SYNC = ORIG.skip
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.log('FATAL', e); process.exit(1) })
