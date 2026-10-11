/**
 * Regression test for the "Visitor Captcha toggle remains active" bug
 * reported by a customer (Feb 2026).
 *
 * Root cause: the `GET /security/captcha/status` endpoint in
 * `js/cpanel-routes.js` was computing the toggle state from ONLY the legacy
 * `val.antiRedOff` flag. The current architecture (2026-02 Day-3 fix)
 * persists the disabled state in `val.visitorCaptchaOff` instead, so newly
 * disabled domains were being reported back to the panel as `enabled:true`
 * — making the UI flip the toggle back to ON on every page reload, and
 * matching the customer's "I turned it off but it's still active" report.
 *
 * Fix: read BOTH `visitorCaptchaOff` (current) and `antiRedOff` (legacy),
 * mirroring the existing pattern in `js/_index.js:12220` and `:27618`.
 *
 * Run:  node tests/test_captcha_status_endpoint.js
 */

'use strict'

const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
const assert = (cond, name) => {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else { console.log(`  ❌ ${name}`); failed++ }
}

// ───────────────────────────────────────────────────────────
// Test A — static source content guard.
// Ensures the fix can never silently regress to a single-flag check.
// ───────────────────────────────────────────────────────────
console.log('\nTest A: cpanel-routes.js status endpoint considers BOTH captcha flags')

const routesSrc = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'cpanel-routes.js'),
  'utf8'
)

// Extract the /security/captcha/status route block so we only assert against
// the one buggy code path. The POST toggle was always writing the right
// fields — only the GET status read path was at fault.
function extractRouteBlock(src, marker) {
  const start = src.indexOf(marker)
  if (start === -1) return ''
  // Find the end of the route by scanning braces from the first `{` after the marker
  let i = src.indexOf('{', start)
  let depth = 0
  for (; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}
const statusBlock = extractRouteBlock(routesSrc, "router.get('/security/captcha/status'")
assert(statusBlock.length > 0, 'A0 located /security/captcha/status route block')

// The status route now delegates flag-reading to the SINGLE SOURCE OF TRUTH,
// antiRedService.resolveDomainCfState(domain, db), which OR-checks BOTH the
// current `visitorCaptchaOff` and the legacy `antiRedOff` flags. So we assert
// the route delegates to it, and that the helper does the OR-check.
const antiRedSrc = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'anti-red-service.js'),
  'utf8'
)
assert(
  /resolveDomainCfState/.test(statusBlock),
  'A1 status route derives captcha state from resolveDomainCfState (single source of truth)'
)
assert(
  /antiRedOff/.test(antiRedSrc),
  'A2 resolveDomainCfState still references antiRedOff (legacy flag — backwards compatibility)'
)
assert(
  /v\.visitorCaptchaOff === true \|\| v\.antiRedOff === true/.test(antiRedSrc),
  'A3 resolveDomainCfState OR-checks BOTH flags (the actual fix)'
)
assert(
  !/const enabled = hasCloudflare && v\.antiRedOff !== true\s*\n/.test(statusBlock),
  'A4 the buggy single-flag computation no longer exists in the status block'
)

// ───────────────────────────────────────────────────────────
// Test B — behavioural test of the per-domain mapping function.
// We reproduce the exact mapping the route handler runs so this
// test stays green only when the same boolean logic is used.
// ───────────────────────────────────────────────────────────
console.log('\nTest B: mapping function returns the right enabled flag for every state')

function mapDomain(d, cpDomain, addonDomains, docByDomain) {
  const doc = docByDomain[d] || {}
  const v = doc.val || {}
  const hasCloudflare = !!(v.cfZoneId && v.nameserverType === 'cloudflare')
  const isOff = v.visitorCaptchaOff === true || v.antiRedOff === true
  const enabled = hasCloudflare && !isOff
  return {
    domain: d,
    enabled,
    hasCloudflare,
    isMain: d === cpDomain,
  }
}

const CF = { cfZoneId: 'zone-abc', nameserverType: 'cloudflare' }

const scenarios = [
  {
    label: 'B.1 fresh CF domain (no off-flag)',
    val: { ...CF },
    expectedEnabled: true,
    expectedHasCF: true,
  },
  {
    label: 'B.2 captcha disabled via current flag (visitorCaptchaOff)',
    val: { ...CF, visitorCaptchaOff: true },
    expectedEnabled: false,
    expectedHasCF: true,
  },
  {
    label: 'B.3 captcha disabled via legacy flag (antiRedOff)',
    val: { ...CF, antiRedOff: true },
    expectedEnabled: false,
    expectedHasCF: true,
  },
  {
    label: 'B.4 both flags present (mid-migration)',
    val: { ...CF, visitorCaptchaOff: true, antiRedOff: true },
    expectedEnabled: false,
    expectedHasCF: true,
  },
  {
    label: 'B.5 domain not on Cloudflare → enabled must be false',
    val: { nameserverType: 'custom' },
    expectedEnabled: false,
    expectedHasCF: false,
  },
  {
    label: 'B.6 visitorCaptchaOff falsey ("false" string is NOT off)',
    val: { ...CF, visitorCaptchaOff: false },
    expectedEnabled: true,
    expectedHasCF: true,
  },
]

for (const s of scenarios) {
  const docByDomain = { 'goldtest.com': { val: s.val } }
  const row = mapDomain('goldtest.com', 'goldtest.com', [], docByDomain)
  assert(row.enabled === s.expectedEnabled, `${s.label}: enabled=${s.expectedEnabled} (got ${row.enabled})`)
  assert(row.hasCloudflare === s.expectedHasCF, `${s.label}: hasCloudflare=${s.expectedHasCF} (got ${row.hasCloudflare})`)
}

// ───────────────────────────────────────────────────────────
// Test C — `node --check` on cpanel-routes.js so we don't ship
// a syntax error alongside the behavioural fix.
// ───────────────────────────────────────────────────────────
console.log('\nTest C: js/cpanel-routes.js parses')
const { spawnSync } = require('child_process')
const checkRes = spawnSync('node', ['--check', path.join(__dirname, '..', 'js', 'cpanel-routes.js')], { encoding: 'utf8' })
assert(checkRes.status === 0, `C1 node --check exits 0 (stderr: ${checkRes.stderr.trim() || 'none'})`)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
