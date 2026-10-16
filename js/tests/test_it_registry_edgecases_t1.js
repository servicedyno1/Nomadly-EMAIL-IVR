// T1 edge-case checks for the .it registry gate (read-only; OP endpoints stubbed)
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const op = require('/app/js/op-service.js')
let pass = 0, fail = 0
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m, extra !== undefined ? JSON.stringify(extra) : '') } }

const realPost = axios.post
const opFree = (reason) => async (url, body) => {
  if (url.includes('/auth/login')) return { data: { code: 0, data: { token: 'x' } } }
  if (url.includes('/domains/check')) return { data: { code: 0, data: { results: [{ status: 'free', reason, price: { product: { price: 10 } } }] } } }
  throw new Error('unexpected POST ' + url)
}

;(async () => {
  console.log('── live registry ──')
  op._registryCache.clear()
  const up = await op.verifyRegistryAvailability('  NET.IT ')
  ok(up.verified && up.available === false && up.status === 'UNASSIGNABLE', 'uppercase/whitespace NET.IT → UNASSIGNABLE', up)
  ok(op._registryCache.has('net.it'), 'cache keyed by normalised name')
  // cache hit: queryFn must not be invoked
  let calls = 0
  const cached = await op.verifyRegistryAvailability('net.it', { queryFn: async () => { calls++; return 'Status: AVAILABLE' } })
  ok(calls === 0 && cached.available === false, 'cache hit skips query', { calls, cached })
  const google = await op.verifyRegistryAvailability('google.it')
  ok(google.verified && google.available === false && google.status === 'NOT AVAILABLE', 'google.it → NOT AVAILABLE', google)
  const rnd = 'zqt1' + Date.now().toString(36) + '.it'
  const r = await op.verifyRegistryAvailability(rnd)
  ok(r.verified && r.available === true, `${rnd} → AVAILABLE`, r)

  console.log('── odd answers (injected queryFn) ──')
  op._registryCache.clear()
  // DAS rate limit / garbage → WHOIS used
  let seen = []
  const q1 = async (h) => { seen.push(h); if (h === 'das.nic.it') return 'Status: REQUEST LIMIT EXCEEDED'; return 'Domain: x.it\nStatus: ok\n' }
  const a1 = await op.verifyRegistryAvailability('odd1.it', { queryFn: q1 })
  ok(seen.join(',') === 'das.nic.it,whois.nic.it' && a1.verified && a1.available === false && a1.source === 'whois', 'DAS limit → WHOIS "ok" = taken', a1)
  // WHOIS rate-limit status → unreachable (not cached)
  const q2 = async (h) => { if (h === 'das.nic.it') throw new Error('ECONNRESET'); return 'Status: Request limit exceeded' }
  const a2 = await op.verifyRegistryAvailability('odd2.it', { queryFn: q2 })
  ok(!a2.verified && a2.error === 'registry_unreachable' && !op._registryCache.has('odd2.it'), 'both fail → unreachable & not cached', a2)
  // DAS lowercase status
  const a3 = await op.verifyRegistryAvailability('odd3.it', { queryFn: async () => 'Domain: odd3.it\nstatus: available\n' })
  ok(a3.verified && a3.available === true, 'lowercase "status: available" parsed', a3)
  // empty response from both
  const a4 = await op.verifyRegistryAvailability('odd4.it', { queryFn: async () => '' })
  ok(!a4.verified, 'empty answers → unverified', a4)
  // WHOIS "Status: AVAILABLE" only exact
  const a5 = await op.verifyRegistryAvailability('odd5.it', { queryFn: async (h) => h === 'das.nic.it' ? 'garbage' : 'Status: AVAILABLE BUT PENDING' })
  ok(a5.verified && a5.available === false, 'WHOIS non-exact AVAILABLE → not available', a5)
  ok((await op.verifyRegistryAvailability('foo.com')).error === 'no_verifier', '.com → no_verifier')
  ok((await op.verifyRegistryAvailability('')).error === 'no_verifier', 'empty input → no_verifier (no throw)')

  console.log('── checkDomainAvailability (OP stubbed) ──')
  axios.post = opFree('available (domain not found in DNS)')
  op._registryCache.clear()
  const c1 = await op.checkDomainAvailability('ORG.IT')
  ok(c1.available === false && c1.registryStatus === 'UNASSIGNABLE', 'ORG.IT uppercase → blocked', c1)
  axios.post = opFree('')
  const c2 = await op.checkDomainAvailability('org.it')
  ok(c2.available === false, '.it with no DNS reason still gated', c2)
  const c3 = await op.checkDomainAvailability('zz' + Date.now().toString(36) + 'abc.com')
  ok(c3.available === true, '.com registry-backed free unchanged', c3)
  // multi-label .it extension (e.g. foo.bar.it) — extension 'bar.it'
  axios.post = opFree('available (domain not found in DNS)')
  const c4 = await op.checkDomainAvailability('net.it'.replace('net', 'x.net'))
  console.log('    info: x.net.it →', JSON.stringify(c4))
  axios.post = realPost
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
