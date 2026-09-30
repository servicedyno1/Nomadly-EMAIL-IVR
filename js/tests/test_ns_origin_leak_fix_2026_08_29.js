/**
 * Regression test for 2026-08-29 origin-IP-leak / broken-nameservers-display fix.
 *
 * Before the fix:
 *   1. `whm-service.createAccount` returned `nameservers: { ns1: 'ns1.<WHM_HOST>',
 *      ns2: 'ns2.<WHM_HOST>' }` — the origin hostname. Meaningless AND an
 *      origin-IP-leak vector to any browser that fetched /api/store/order/:orderId.
 *   2. `cr-register-domain-&-create-cpanel.js` propagated `result.nameservers`
 *      (that object) into `webOrders.nameservers` and its own success payload.
 *   3. Storefront React's `result.nameservers?.length > 0` silently suppressed
 *      the render (objects have no `.length`), so the nameservers section
 *      NEVER appeared for the user after a web-storefront hosting purchase.
 *
 * After the fix:
 *   1. `whm-service.createAccount` no longer includes any `nameservers` field.
 *   2. `cr-register-domain-&-create-cpanel.js` returns `nameservers: cfNameservers`
 *      (a real array of CF NS hostnames like ['anderson.ns.cloudflare.com',
 *      'leanna.ns.cloudflare.com']).
 *   3. Storefront React (`Array.isArray && .length >= 2`) renders the
 *      nameservers callout properly.
 *
 * We test:
 *   (A) whm-service.js source text no longer contains the origin-IP `nameservers`
 *       object literal (static guard against regression).
 *   (B) cr-register-domain-&-create-cpanel.js returns an ARRAY of CF nameservers
 *       (asserted via source-level static check on the two return statements).
 *   (C) Storefront.js source guards nameservers with `Array.isArray` so a
 *       future accidental object shape can't leak the origin IP.
 *
 * This is a source-static test (no live process) because driving the full
 * checkout end-to-end from the dev pod would provision a real cPanel on the
 * live WHM host and register/mutate a real domain — we do not want side
 * effects on production.
 */
const fs = require('fs')
const path = require('path')

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++ }
  else { console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); fail++ }
}

function slurp(rel) { return fs.readFileSync(path.join('/app', rel), 'utf8') }

console.log('=== (A) whm-service.js — origin-IP nameservers removed ===')
const whm = slurp('js/whm-service.js')
ok('createAccount return no longer contains `ns1: `ns1.${WHM_HOST}``',
  !/ns1:\s*`ns1\.\$\{WHM_HOST\}`/.test(whm))
ok('createAccount return no longer contains `nameservers: {` object literal',
  !/return\s*\{[\s\S]{0,400}nameservers:\s*\{[\s\S]*?ns1:[\s\S]*?ns2:/.test(whm))
ok('JSDoc return typedef no longer advertises `nameservers` field',
  !/@returns \{\{ success, username, password, domain, url, nameservers/.test(whm))
ok('createAccount still returns success/username/password/domain/url',
  /success:\s*true[\s\S]{0,80}username[\s\S]{0,60}password[\s\S]{0,60}domain[\s\S]{0,60}url:/.test(whm))
ok('warning comment about origin-IP-leak retained (documents WHY not returned)',
  /origin-IP leak/i.test(whm))

console.log('\n=== (B) cr-register-domain-&-create-cpanel.js — returns real CF NS array ===')
const reg = slurp('js/cr-register-domain-&-create-cpanel.js')
ok('final success return uses cfNameservers (real CF NS array)',
  /return \{ success: true,[^}]*nameservers: Array\.isArray\(cfNameservers\)/.test(reg))
ok('final success return does NOT use `result.nameservers` (WHM origin-IP object)',
  !/success:\s*true[\s\S]{0,300}nameservers:\s*result\.nameservers/.test(reg))
ok('email `response` object uses cfNameservers, not result.nameservers',
  /const response = \{[\s\S]{0,700}nameservers: Array\.isArray\(cfNameservers\)/.test(reg))
ok('cfNameservers is still populated in every relevant branch (existing/new/queue)',
  /cfNameservers = reg\.val\.nameservers/.test(reg) &&
  /cfNameservers = liveZone\.name_servers/.test(reg) &&
  /cfNameservers = zone\.nameservers/.test(reg))

console.log('\n=== (C) Storefront.js — Array.isArray guard + prominent callout ===')
const sf = slurp('frontend/src/pages/Storefront.js')
ok('guest-crypto path uses Array.isArray guard on nameservers',
  /Array\.isArray\(creds\.nameservers\) && creds\.nameservers\.length >= 2/.test(sf))
ok('logged-in purchase path uses Array.isArray guard on nameservers',
  /Array\.isArray\(result\.nameservers\) && result\.nameservers\.length >= 2/.test(sf))
ok('guest-crypto renders a data-testid callout',
  /data-testid="store-crypto-ns-callout"/.test(sf))
ok('logged-in purchase renders a data-testid callout',
  /data-testid="store-purchase-ns-callout"/.test(sf))
ok('each NS row has an indexed data-testid so tests can grab NS1/NS2 individually',
  /data-testid=\{`store-crypto-ns-\$\{i \+ 1\}`\}/.test(sf) &&
  /data-testid=\{`store-purchase-ns-\$\{i \+ 1\}`\}/.test(sf))
ok('deprecated one-line "Point your domain nameservers to:" fallback is gone',
  !/Point your domain nameservers to:.*nameservers\.join/.test(sf))

console.log('\n=== summary ===')
console.log(`  PASS: ${pass}`)
console.log(`  FAIL: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
