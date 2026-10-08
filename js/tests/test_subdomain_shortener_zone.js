/*global require, process, console */
// ============================================================
// Regression test: subdomain shortener zone resolution (2026-10-08c)
// ============================================================
// Bug: activating a SUBDOMAIN shortener (go.namewords.sbs, whose parent
// namewords.sbs is on our Cloudflare nameservers) failed with
// "Domain go.namewords.sbs is not registered with us" because the DNS path
// looked up the exact host in registered-domains metadata (only the PARENT is
// registered) → activation 'failed' → POST /shortener/links returned 409.
//
// Fix: domain-service.resolveZoneMeta() walks parent suffixes (and falls back to
// a live Cloudflare zone lookup) so a subdomain resolves to the PARENT zone's
// cfZoneId; addShortenerCNAME() uses it, writing the record (name = full host)
// into the correct zone. This read-only test confirms resolution against the
// real Cloudflare zone for the reported domain.
// ============================================================

require('dotenv').config({ path: '/app/backend/.env' })
const assert = require('assert')
const ds = require('../domain-service')

let passed = 0
const ok = (n) => { console.log(`\u2705 ${n}`); passed++ }

async function run() {
  // Subdomain resolves to the PARENT Cloudflare zone (read-only CF lookup).
  const sub = await ds.resolveZoneMeta('go.namewords.sbs', null)
  assert.ok(sub && sub.cfZoneId, 'subdomain must resolve to a parent CF zone id (not "not registered with us")')
  assert.strictEqual(sub.zoneHost, 'namewords.sbs', 'subdomain zoneHost must be the parent apex')
  assert.strictEqual(sub.isSubdomain, true, 'go.namewords.sbs must be flagged as a subdomain')
  ok(`resolveZoneMeta('go.namewords.sbs') → zone ${sub.zoneHost} (${sub.cfZoneId}), isSubdomain=true`)

  // Apex resolves to itself (same zone).
  const apex = await ds.resolveZoneMeta('namewords.sbs', null)
  assert.ok(apex && apex.cfZoneId, 'apex must resolve to its CF zone id')
  assert.strictEqual(apex.isSubdomain, false, 'apex must not be flagged as a subdomain')
  assert.strictEqual(sub.cfZoneId, apex.cfZoneId, 'subdomain and apex must resolve to the SAME CF zone')
  ok(`resolveZoneMeta('namewords.sbs') → same zone ${apex.zoneHost}, isSubdomain=false`)

  // A domain not on our Cloudflare account must NOT resolve to a zone.
  const none = await ds.resolveZoneMeta('not-ours-7f3a2b.example', null)
  assert.ok(!none || !none.cfZoneId, 'an unmanaged domain must not resolve to a CF zone')
  ok('unmanaged domain does not resolve to a CF zone (no false positive)')

  console.log(`\n\u2705 ALL ${passed} assertions passed`)
  process.exit(0)
}
run().catch((e) => { console.error(`\u274C TEST FAILED: ${e.message}`); process.exit(1) })
