/**
 * Regression tests for the "hosting order failed — domain already exists in the
 * userdata" bug class. RCA @smsbeast_real (5976060042), 2026-10-11:
 *
 *   The user bought a NEW Premium Anti-Red plan with `luxelitecasinoreviews.com`
 *   as the PRIMARY domain. That domain was already an ADDON on their own
 *   suspended `eliteescapesau.com` cPanel account (elitda5b), so WHM `createacct`
 *   failed with "The domain … already exists in the userdata." Three compounding
 *   defects fixed and covered here:
 *
 *     (B) whm-service.isRetryableError treated "already exists in the userdata"
 *         as a USERNAME conflict → burned MAX_RETRIES createacct calls.
 *     (A) cr-register pre-flight guard only matched the primary `domain` field,
 *         not `addonDomains` → never caught the conflict before createAccount.
 *     (C) the primary provisioning path had no userdata self-heal (unlike
 *         addon-flow / change-primary / reseller-hosting-mgmt).
 *
 * (B) is a true unit test (exported pure fn). (A) + (C) are static source
 * wiring guards — the provisioning fn opens a real MongoClient, so we assert the
 * code shape rather than booting a DB.
 */

const fs = require('fs')
const path = require('path')

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++ }
  else { console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); fail++ }
}

console.log('=== (B) whm-service.isRetryableError no longer retries domain-userdata conflicts ===')
const whm = require('../whm-service')
ok('exported for tests', typeof whm.isRetryableError === 'function')
ok('domain-in-userdata conflict is NOT retryable (the @smsbeast_real string)',
  whm.isRetryableError('(XID hqaxgc) The domain “luxelitecasinoreviews.com” already exists in the userdata.') === false)
ok('lowercase "already exists in the userdata" NOT retryable',
  whm.isRetryableError('domain already exists in the userdata') === false)
ok('generic "the domain X already exists" NOT retryable',
  whm.isRetryableError('The domain example.com already exists') === false)
// USERNAME conflicts MUST still retry (that is the whole point of the loop).
ok('"reserved username" IS retryable', whm.isRetryableError('reserved username') === true)
ok('"username ... already exists" IS retryable', whm.isRetryableError('The username luxe44a0 already exists') === true)
ok('"account already exists" IS retryable', whm.isRetryableError('account already exists') === true)
ok('"not a valid username" IS retryable', whm.isRetryableError('not a valid username') === true)
ok('unrelated error NOT retryable', whm.isRetryableError('WHM unreachable') === false)
ok('empty/null safe', whm.isRetryableError('') === false && whm.isRetryableError(null) === false)

console.log('\n=== (A) cr-register pre-flight guard matches addonDomains + blocks ===')
const src = fs.readFileSync(path.join('/app', 'js/cr-register-domain-&-create-cpanel.js'), 'utf8')
ok('idempotency guard query matches primary OR addon ($or domain/addonDomains)',
  /findOne\(\{[\s\S]{0,400}\$or:\s*\[\{\s*domain:\s*domain\s*\},\s*\{\s*addonDomains:\s*domain\s*\}\]/.test(src))
ok('detects addon conflict (requested domain is an addon, not the primary)',
  /isAddonConflict\s*=\s*existingAccount\.domain\s*!==\s*domain[\s\S]{0,160}addonDomains\.includes\(domain\)/.test(src))
ok('addon conflict aborts BEFORE createAccount with addonConflict flag',
  /return \{ success: false, error: 'domain_is_addon_on_existing_plan', duplicate: true, addonConflict: true \}/.test(src) &&
  src.indexOf('if (isAddonConflict)') < src.indexOf("error: 'domain_is_addon_on_existing_plan'") &&
  src.indexOf("error: 'domain_is_addon_on_existing_plan'") < src.indexOf('⚙️ Creating hosting account'))
ok('same-owner message names the owning (primary) plan',
  /sameOwner[\s\S]{0,600}already part of your hosting plan for/.test(src))

console.log('\n=== (C) cr-register self-heal wired into the createAccount failure path ===')
ok('imports whm-userdata-heal in the provisioning failure path',
  /WHM createAccount failed[\s\S]{0,40}/.test(src) && /require\('\.\/whm-userdata-heal'\)/.test(src))
ok('uses isStaleUserdataError on the createAccount error',
  /heal\.isStaleUserdataError\(result\.error\)/.test(src))
ok('calls attemptUserdataRelease with the SAME owner chatId (never cross-user)',
  /heal\.attemptUserdataRelease\(\{[\s\S]{0,220}chatId:\s*ownerChatId,/.test(src))
ok('retries createAccount once after a successful release',
  /if \(release\.released\)[\s\S]{0,400}result = await whm\.createAccount\(/.test(src))
ok('self-heal retry runs BEFORE the final "Hosting setup failed" return',
  src.indexOf("heal.attemptUserdataRelease") < src.indexOf("[Hosting] WHM createAccount failed"))

console.log('\n=== summary ===')
console.log(`  PASS: ${pass}`)
console.log(`  FAIL: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
