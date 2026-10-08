/*global require, process, console */
// ============================================================
// Regression test: shortener domain verification must PASS for a
// Cloudflare-proxied (orange-cloud) record, not just a DNS-only one.
//
// Repro (production, go.namewords.sbs):
//   - A record go.namewords.sbs -> 146.190.238.190 created with proxied:true
//   - public DNS therefore resolves to CF anycast IPs (104.21.x / 172.67.x)
//   - old dnsPointsTo() only did live resolve4() -> never matched the origin
//     -> verify stuck at 409 railway_linked forever.
//
// The fix adds an authoritative Cloudflare-zone fallback. These tests exercise
// that branch with injected (mock) deps so they are deterministic and run with
// no network, plus an optional live read-only check against the real CF zone.
// ============================================================

const assert = require('assert')
const { zoneCandidates, cfZoneRecordMatches, dnsPointsTo } = require('../shortener-verify')

let passed = 0
const ok = (name) => { console.log(`\u2705 ${name}`); passed++ }

async function run() {
  // ---- zoneCandidates ----
  assert.deepStrictEqual(
    zoneCandidates('go.namewords.sbs'),
    ['go.namewords.sbs', 'namewords.sbs'],
    'zoneCandidates should list registrable suffixes most-specific first (never the bare TLD)'
  )
  ok('zoneCandidates derives apex suffixes for a subdomain')

  // Mock Cloudflare: zone namewords.sbs holds the proxied A record at origin.
  const cfMock = {
    getZoneByName: async (name) => (name === 'namewords.sbs' ? { id: 'zone123', name: 'namewords.sbs' } : null),
    listDNSRecords: async (zoneId) => (zoneId === 'zone123' ? [
      { name: 'go.namewords.sbs', type: 'A', content: '146.190.238.190', proxied: true },
      { name: 'namewords.sbs', type: 'CNAME', content: 'x.cfargotunnel.com', proxied: true },
    ] : []),
  }
  // Mock resolver mimics a PROXIED record: public DNS returns CF anycast IPs.
  const dnsProxied = {
    resolveCname: async () => [],
    resolve4: async (h) => {
      if (h === 'go.namewords.sbs') return ['172.67.199.112', '104.21.76.188']
      if (h === '146.190.238.190') return ['146.190.238.190']
      return []
    },
  }

  // ---- proxied record is detected via the authoritative CF zone ----
  assert.strictEqual(
    await cfZoneRecordMatches('go.namewords.sbs', '146.190.238.190', { cfService: cfMock }),
    true,
    'cfZoneRecordMatches must find the proxied A record at the origin IP'
  )
  ok('cfZoneRecordMatches detects a proxied A record (authoritative zone)')

  // ---- THE BUG: live DNS shows CF IPs, but verification must still PASS ----
  assert.strictEqual(
    await dnsPointsTo('go.namewords.sbs', '146.190.238.190', { dns: dnsProxied, cfService: cfMock }),
    true,
    'dnsPointsTo must verify a proxied shortener via the CF-zone fallback'
  )
  ok('dnsPointsTo verifies a Cloudflare-proxied shortener (regression)')

  // ---- negative: wrong origin must NOT verify ----
  assert.strictEqual(
    await cfZoneRecordMatches('go.namewords.sbs', '203.0.113.99', { cfService: cfMock }),
    false,
    'a record pointing elsewhere must not verify'
  )
  assert.strictEqual(
    await dnsPointsTo('go.namewords.sbs', '203.0.113.99', { dns: dnsProxied, cfService: cfMock }),
    false,
    'dnsPointsTo must reject when neither public DNS nor CF zone match the target'
  )
  ok('verification rejects a record that points at the wrong origin')

  // ---- DNS-only path still works (grey-cloud) without any CF lookup ----
  const dnsDirect = {
    resolveCname: async () => [],
    resolve4: async (h) => (h === 'direct.example.com' || h === '146.190.238.190') ? ['146.190.238.190'] : [],
  }
  const cfNever = { getZoneByName: async () => { throw new Error('CF must not be called for DNS-only match') }, listDNSRecords: async () => [] }
  assert.strictEqual(
    await dnsPointsTo('direct.example.com', '146.190.238.190', { dns: dnsDirect, cfService: cfNever }),
    true,
    'DNS-only (grey-cloud) direct A match must verify via public DNS alone'
  )
  ok('dnsPointsTo still verifies a DNS-only direct A record')

  // ---- CNAME DNS-only path ----
  const dnsCname = { resolveCname: async (h) => (h === 'go.site.com' ? ['app.up.railway.app'] : []), resolve4: async () => [] }
  assert.strictEqual(
    await dnsPointsTo('go.site.com', 'app.up.railway.app', { dns: dnsCname, cfService: cfNever }),
    true,
    'DNS-only CNAME match must verify via public DNS alone'
  )
  ok('dnsPointsTo still verifies a DNS-only CNAME record')

  // ---- OPTIONAL live, read-only check against the real CF zone ----
  // Only runs when CF creds are present. Confirms the exact production case.
  if (process.env.CLOUDFLARE_API_KEY || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) {
    try {
      const live = await cfZoneRecordMatches('go.namewords.sbs', '146.190.238.190')
      if (live === true) ok('LIVE: real CF zone confirms go.namewords.sbs -> 146.190.238.190 (proxied)')
      else console.log('\u26A0\uFE0F  LIVE check did not confirm (record may have changed / token scope) — mock tests still authoritative')
    } catch (e) {
      console.log(`\u26A0\uFE0F  LIVE check skipped (CF error: ${e.message})`)
    }
  } else {
    console.log('\u2139\uFE0F  LIVE CF check skipped (no Cloudflare credentials in env)')
  }

  console.log(`\n\u2705 ALL ${passed} assertions passed`)
}

run().catch((e) => { console.error(`\u274C TEST FAILED: ${e.message}`); process.exit(1) })
