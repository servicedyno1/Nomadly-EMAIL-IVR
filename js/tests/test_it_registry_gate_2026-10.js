// .it registry gate + failed-registration Cloudflare cleanup + clear "not charged" copy (2026-10-16)
// Incident: SMADAV @Todexman009 was sold net.it / org.it as "available" (OpenProvider's
// .it check is a DNS heuristic). Registry (NIC.it) says UNASSIGNABLE → OP code 311 at
// registration, an orphan Cloudflare zone, and an unclear failure message.
//   node js/tests/test_it_registry_gate_2026-10.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })

let pass = 0, fail = 0
const ok = (n, c, e) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${e ? ' — ' + e : ''}`) } }

// ── Stub ConnectReseller modules BEFORE domain-service loads (it destructures them).
//    Guarantees no real registrar purchase can ever happen in this test.
const crCalls = []
let crImpl = async () => ({ error: 'stubbed CR failure' })
const stubModule = (rel, exportsObj) => {
  const p = require.resolve(rel)
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }
}
stubModule('../cr-domain-register', { buyDomainOnline: async (...a) => { crCalls.push(a); return crImpl(...a) } })
let crPriceImpl = async () => ({ available: false })
stubModule('../cr-domain-price-get', { checkDomainPriceOnline: async (...a) => crPriceImpl(...a) })

const axios = require('axios')
const op = require('../op-service.js')
const cf = require('../cf-service.js')
const ds = require('../domain-service.js')
const { _domainFailMsg } = require('../cr-register-domain-&-create-cpanel.js')

async function main() {
  // ─────────────────────────────────────────────────────────────────
  console.log('\n── _parseRegistryStatus ──')
  ok('DAS UNASSIGNABLE', op._parseRegistryStatus('Domain: net.it\nStatus: UNASSIGNABLE\n') === 'UNASSIGNABLE')
  ok('DAS NOT AVAILABLE', op._parseRegistryStatus('Domain: host.it\r\nStatus: NOT AVAILABLE\r\n') === 'NOT AVAILABLE')
  ok('WHOIS padded "Status:             ok"', op._parseRegistryStatus('Domain:             host.it\nStatus:             ok\n') === 'OK')
  ok('no status → null', op._parseRegistryStatus('garbage') === null)

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── verifyRegistryAvailability (injected registry answers) ──')
  const fakeQuery = (map) => async (host, port, q) => {
    const k = `${host}:${q}`
    const v = map[k]
    if (v instanceof Error) throw v
    if (v === undefined) throw new Error('unexpected query ' + k)
    return v
  }
  op._registryCache.clear()
  let r = await op.verifyRegistryAvailability('net.it', { queryFn: fakeQuery({ 'das.nic.it:net.it': 'Domain: net.it\nStatus: UNASSIGNABLE\n' }) })
  ok('UNASSIGNABLE → verified, NOT available', r.verified && r.available === false && r.status === 'UNASSIGNABLE' && r.source === 'das', JSON.stringify(r))
  op._registryCache.clear()
  r = await op.verifyRegistryAvailability('host.it', { queryFn: fakeQuery({ 'das.nic.it:host.it': 'Status: NOT AVAILABLE' }) })
  ok('NOT AVAILABLE → NOT available', r.verified && !r.available, JSON.stringify(r))
  op._registryCache.clear()
  r = await op.verifyRegistryAvailability('freeone.it', { queryFn: fakeQuery({ 'das.nic.it:freeone.it': 'Status: AVAILABLE' }) })
  ok('AVAILABLE → available', r.verified && r.available === true, JSON.stringify(r))
  op._registryCache.clear()
  r = await op.verifyRegistryAvailability('taken.it', { queryFn: fakeQuery({ 'das.nic.it:taken.it': new Error('ECONNRESET'), 'whois.nic.it:taken.it': 'Domain: taken.it\nStatus:             ok\n' }) })
  ok('DAS down → WHOIS "ok" → NOT available (source whois)', r.verified && !r.available && r.source === 'whois', JSON.stringify(r))
  op._registryCache.clear()
  r = await op.verifyRegistryAvailability('odd.it', { queryFn: fakeQuery({ 'das.nic.it:odd.it': 'Status: SOMETHING NEW', 'whois.nic.it:odd.it': 'Status: AVAILABLE' }) })
  ok('unknown DAS status → WHOIS AVAILABLE → available', r.verified && r.available && r.source === 'whois', JSON.stringify(r))
  op._registryCache.clear()
  r = await op.verifyRegistryAvailability('dead.it', { queryFn: fakeQuery({ 'das.nic.it:dead.it': new Error('timeout'), 'whois.nic.it:dead.it': new Error('timeout') }) })
  ok('both registry endpoints fail → verified:false (registry_unreachable)', r.verified === false && r.error === 'registry_unreachable', JSON.stringify(r))
  r = await op.verifyRegistryAvailability('example.com')
  ok('.com has no verifier → verified:false (no_verifier)', r.verified === false && r.error === 'no_verifier')
  op._registryCache.clear()
  let calls = 0
  const counting = async () => { calls++; return 'Status: AVAILABLE' }
  await op.verifyRegistryAvailability('cached.it', { queryFn: counting })
  await op.verifyRegistryAvailability('cached.it', { queryFn: counting })
  ok('result cached (2nd lookup does not hit the registry)', calls === 1, `calls=${calls}`)

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── LIVE NIC.it registry (real DAS) ──')
  op._registryCache.clear()
  const liveNet = await op.verifyRegistryAvailability('net.it')
  ok('net.it → UNASSIGNABLE (the incident domain)', liveNet.verified && !liveNet.available && liveNet.status === 'UNASSIGNABLE', JSON.stringify(liveNet))
  const liveOrg = await op.verifyRegistryAvailability('org.it')
  ok('org.it → UNASSIGNABLE (the incident domain)', liveOrg.verified && !liveOrg.available, JSON.stringify(liveOrg))
  const liveHost = await op.verifyRegistryAvailability('host.it')
  ok('host.it → NOT AVAILABLE', liveHost.verified && !liveHost.available, JSON.stringify(liveHost))
  const rnd = 'zq' + Math.random().toString(36).slice(2, 10) + '.it'
  const liveRnd = await op.verifyRegistryAvailability(rnd)
  ok(`${rnd} → AVAILABLE`, liveRnd.verified && liveRnd.available, JSON.stringify(liveRnd))

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── checkDomainAvailability: OP "free" is gated by the registry ──')
  const origPost = axios.post
  const opAnswers = {} // 'name.ext' -> { status, reason }
  axios.post = async (url, body) => {
    if (url.includes('/auth/login')) return { data: { code: 0, data: { token: 'test-token' } } }
    if (url.includes('/domains/check')) {
      const d = body.domains[0]; const key = `${d.name}.${d.extension}`
      const a = opAnswers[key] || { status: 'free' }
      return { data: { code: 0, data: { results: [{ domain: key, status: a.status, reason: a.reason, price: { product: { price: 4.99 } } }] } } }
    }
    throw new Error('unexpected axios.post ' + url)
  }
  try {
    op._registryCache.clear()
    opAnswers['net.it'] = { status: 'free', reason: 'available (domain not found in DNS)' }
    let c = await op.checkDomainAvailability('net.it')
    ok('net.it (OP free via DNS heuristic, registry UNASSIGNABLE) → NOT available', c.available === false && c.registryStatus === 'UNASSIGNABLE', JSON.stringify(c))
    opAnswers['org.it'] = { status: 'free', reason: 'available (domain not found in DNS)' }
    c = await op.checkDomainAvailability('org.it')
    ok('org.it → NOT available', c.available === false, JSON.stringify(c))
    opAnswers[rnd] = { status: 'free', reason: 'available (domain not found in DNS)' }
    c = await op.checkDomainAvailability(rnd)
    ok(`${rnd} (registry AVAILABLE) → still available with a price`, c.available === true && c.price >= 1, JSON.stringify(c))
    opAnswers['host.it'] = { status: 'active', reason: 'occupied (as per dig result)' }
    c = await op.checkDomainAvailability('host.it')
    ok('host.it (OP active) → NOT available (unchanged behaviour)', c.available === false)
    opAnswers['zqfreeexample123.com'] = { status: 'free' }
    c = await op.checkDomainAvailability('zqfreeexample123.com')
    ok('.com free (registry-backed, no heuristic) → available, no registry gate', c.available === true)
  } finally {
    axios.post = origPost
  }

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── registerDomain: Cloudflare zone cleanup on failure ──')
  const orig = {
    createZone: cf.createZone, deleteZone: cf.deleteZone,
    registerDomain: op.registerDomain, checkNsAuthoritative: op.checkNsAuthoritative,
    checkDomainAvailability: op.checkDomainAvailability, isDomainInAccount: op.isDomainInAccount,
  }
  let deleted = []
  let opRegisterCalls = 0
  const setStubs = ({ created, opResult, nastReady = true, inAccount = false }) => {
    deleted = []; opRegisterCalls = 0; crCalls.length = 0
    cf.createZone = async (d) => ({ success: true, zoneId: `zone-${d}`, nameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'], ...(created ? { created: true } : {}) })
    cf.deleteZone = async (id) => { deleted.push(id); return { success: true } }
    op.registerDomain = async () => { opRegisterCalls++; return opResult }
    op.checkNsAuthoritative = async (_d, ns) => ({ ready: nastReady, authoritativeCount: nastReady ? ns.length : 0, elapsedMs: 5, perNs: ns.map(n => ({ ns: n, aa: nastReady })) })
    op.checkDomainAvailability = async () => ({ available: true, price: 30 })
    op.isDomainInAccount = async () => inAccount
  }
  try {
    setStubs({ created: true, opResult: { error: 'The domain you want to register is not free!' } })
    let res = await ds.registerDomain('fail-new.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('OP failure + zone created now → error returned', !!res.error && !res.success, JSON.stringify(res))
    ok('…and the new zone is DELETED', deleted.length === 1 && deleted[0] === 'zone-fail-new.com', JSON.stringify(deleted))

    setStubs({ created: true, opResult: { error: 'OpenProvider HTTP 500 (verification failed)' }, inAccount: null })
    res = await ds.registerDomain('maybe-registered.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('OP failure but ownership UNKNOWN (null) → zone KEPT', !!res.error && deleted.length === 0, JSON.stringify(deleted))

    setStubs({ created: true, opResult: { error: 'timeout' }, inAccount: true })
    res = await ds.registerDomain('actually-ours.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('OP failure but domain IS in our OP account → zone KEPT', !!res.error && deleted.length === 0, JSON.stringify(deleted))

    setStubs({ created: false, opResult: { error: 'The domain you want to register is not free!' } })
    res = await ds.registerDomain('fail-existing.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('OP failure + PRE-EXISTING zone → error returned', !!res.error)
    ok('…and the pre-existing zone is NOT deleted', deleted.length === 0, JSON.stringify(deleted))

    setStubs({ created: true, opResult: { success: true, domainId: 1 }, nastReady: false })
    res = await ds.registerDomain('nastfail.it', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('.it NAST pre-check failure → error, registration never submitted', !!res.error && opRegisterCalls === 0, JSON.stringify(res))
    ok('…and the new zone is DELETED', deleted.length === 1 && deleted[0] === 'zone-nastfail.it', JSON.stringify(deleted))

    setStubs({ created: true, opResult: { success: true, domainId: 42 } })
    res = await ds.registerDomain('works.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('successful registration → success', res.success === true && res.cfZoneId === 'zone-works.com', JSON.stringify(res))
    ok('…and the zone is KEPT', deleted.length === 0, JSON.stringify(deleted))

    setStubs({ created: true, opResult: { error: 'The domain you want to register is not free!' } })
    crImpl = async () => ({ error: 'CR timeout' })
    res = await ds.registerDomain('crpath.com', 'ConnectReseller', 'cloudflare', null, 1, null)
    ok('ConnectReseller → OP fallback failure → error returned', !!res.error && crCalls.length === 1, JSON.stringify(res))
    ok('…zone KEPT on the ambiguous CR path (never strip DNS from a maybe-registered domain)', deleted.length === 0, JSON.stringify(deleted))

    setStubs({ created: true, opResult: { error: 'x' } })
    res = await ds.registerDomain('nocf.com', 'OpenProvider', 'provider_default', null, 1, null)
    ok('provider_default (no Cloudflare zone) failure → no delete attempted', !!res.error && deleted.length === 0)
  } finally {
    Object.assign(cf, { createZone: orig.createZone, deleteZone: orig.deleteZone })
    Object.assign(op, { registerDomain: orig.registerDomain, checkNsAuthoritative: orig.checkNsAuthoritative, checkDomainAvailability: orig.checkDomainAvailability, isDomainInAccount: orig.isDomainInAccount })
  }

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── isDomainInAccount tri-state (stubbed OpenProvider list API) ──')
  {
    const origGet = axios.get, origPost2 = axios.post
    axios.post = async (url) => { if (url.includes('/auth/login')) return { data: { code: 0, data: { token: 't' } } }; throw new Error('unexpected post ' + url) }
    let listAnswer
    axios.get = async (url) => { if (url.includes('/v1beta/domains')) { if (listAnswer instanceof Error) throw listAnswer; return listAnswer } throw new Error('unexpected get ' + url) }
    try {
      listAnswer = { data: { code: 0, data: { total: 0 } } }
      ok('{ total: 0 } (OP omits results) → false', (await op.isDomainInAccount('net.it')) === false)
      listAnswer = { data: { code: 0, data: { total: 1, results: [{ id: 9 }] } } }
      ok('results present → true', (await op.isDomainInAccount('ours.com')) === true)
      listAnswer = { data: { code: 0, data: { results: [] } } }
      ok('empty results array → false', (await op.isDomainInAccount('x.com')) === false)
      listAnswer = { data: { code: 196, desc: 'auth' } }
      ok('API error code → null (unknown)', (await op.isDomainInAccount('x.com')) === null)
      listAnswer = { data: { code: 0, data: {} } }
      ok('unrecognised shape → null (unknown)', (await op.isDomainInAccount('x.com')) === null)
      listAnswer = new Error('ETIMEDOUT')
      ok('network error → null (unknown)', (await op.isDomainInAccount('x.com')) === null)
    } finally { axios.get = origGet; axios.post = origPost2 }
  }

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── checkDomainPrice: ConnectReseller "available" is registry-gated for .it (live DAS) ──')
  {
    const origCheck = op.checkDomainAvailability
    op.checkDomainAvailability = async () => ({ available: false, message: 'stub OP' })
    crPriceImpl = async (d) => ({ available: true, price: 30, originalPrice: 9, message: 'CR stub available ' + d })
    try {
      op._registryCache.clear()
      let p = await ds.checkDomainPrice('net.it', null)
      ok('CR says net.it available, registry UNASSIGNABLE → NOT offered', p.available === false, JSON.stringify(p))
      p = await ds.checkDomainPrice(rnd, null)
      ok(`CR says ${rnd} available, registry AVAILABLE → offered via ConnectReseller`, p.available === true && p.registrar === 'ConnectReseller', JSON.stringify(p))
      p = await ds.checkDomainPrice('zqcrnotgated' + Date.now() + '.com', null)
      ok('CR .com available → offered (no registry gate for .com)', p.available === true && p.registrar === 'ConnectReseller')
    } finally { op.checkDomainAvailability = origCheck; crPriceImpl = async () => ({ available: false }) }
  }

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── cf-service.createZone marks only freshly created zones ──')
  const src = require('fs').readFileSync(path.resolve(__dirname, '../cf-service.js'), 'utf8')
  const createdFlags = (src.match(/created: true/g) || []).length
  ok('exactly one "created: true" (fresh-create branch only)', createdFlags === 1, `found ${createdFlags}`)

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── user-facing failure message ──')
  const m1 = _domainFailMsg('en', 'net.it', 'The domain you want to register is not free!')
  ok('unavailable: says it can\'t be registered', /net\.it<\/b> can't be registered/.test(m1), m1)
  ok('unavailable: says NOT charged + crypto/bank refund to wallet', /not charged/.test(m1) && /crypto or bank transfer/.test(m1) && /wallet/.test(m1))
  ok('unavailable: tells user how to pick another name', /different domain name/.test(m1))
  ok('unavailable: does not leak raw registrar text', !/not free!/.test(m1))
  const m2 = _domainFailMsg('en', 'foo.com', 'OpenProvider error: timeout')
  ok('generic error: "couldn\'t register" + not charged + retry advice', /couldn't register/.test(m2) && /not charged/.test(m2) && /try again/.test(m2), m2)
  const m3 = _domainFailMsg('en', 'foo.com', null)
  ok('exception path (no error text) → generic copy', /couldn't register/.test(m3))
  ok('fr copy', /n'avez pas été débité/.test(_domainFailMsg('fr', 'net.it', 'not free')))
  ok('zh copy', /未扣款/.test(_domainFailMsg('zh', 'net.it', 'not free')))
  ok('hi copy', /कोई शुल्क नहीं/.test(_domainFailMsg('hi', 'net.it', 'not free')))
  ok('unknown language → English', /not charged/.test(_domainFailMsg('xx', 'net.it', 'not free')))
  const mq = _domainFailMsg('en', 'net.it', 'The domain you want to register is not free!', { queued: true })
  ok('QUEUED (already charged) order: never claims "not charged"', !/not charged/.test(mq) && !/added to your wallet/.test(mq), mq)
  ok('QUEUED: says payment is safe + team will refund or help + no need to pay again', /payment is safe/.test(mq) && /refund/.test(mq) && /don't need to pay again/.test(mq))
  ok('QUEUED fr/zh/hi variants avoid the "not charged" line', !/n'avez pas été débité/.test(_domainFailMsg('fr', 'x.it', 'not free', { queued: true })) && !/未扣款/.test(_domainFailMsg('zh', 'x.it', 'not free', { queued: true })) && !/कोई शुल्क नहीं/.test(_domainFailMsg('hi', 'x.it', 'not free', { queued: true })))
  const crs = require('fs').readFileSync(path.resolve(__dirname, '../cr-register-domain-&-create-cpanel.js'), 'utf8')
  ok('both call sites pass { queued: !!info._fromQueue }', (crs.match(/_domainFailMsg\(lang, domain, [^)]*\{ queued: !!info\._fromQueue \}\)/g) || []).length === 2)

  // ─────────────────────────────────────────────────────────────────
  console.log('\n── _index.js: no duplicate raw-error message after a domain-step failure ──')
  const idx = require('fs').readFileSync(path.resolve(__dirname, '../_index.js'), 'utf8')
  ok('wallet path returns early when userNotified', /if \(hostingResult\?\.userNotified\) return\n\s+return send\(chatId, hostingResult\?\.error \|\| 'Hosting creation failed\. Your wallet was not charged/.test(idx))
  ok('bank NGN full-refund path guarded', idx.includes("if (!hostingResult?.userNotified) sendMessage(chatId, hostingResult?.error || 'Hosting creation failed. Full payment refunded to your wallet.')"))
  ok('both crypto full-refund paths guarded', (idx.match(/if \(!hostingResult\?\.userNotified\) sendMessage\(chatId, hostingResult\?\.error \|\| 'Hosting creation failed\. Full payment refunded to your USD wallet\.'\)/g) || []).length === 2)
  const crsrc = require('fs').readFileSync(path.resolve(__dirname, '../cr-register-domain-&-create-cpanel.js'), 'utf8')
  ok('domain-step failure returns userNotified: true (both branches)', (crsrc.match(/domainRegistered, userNotified: true \}/g) || []).length === 2)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
