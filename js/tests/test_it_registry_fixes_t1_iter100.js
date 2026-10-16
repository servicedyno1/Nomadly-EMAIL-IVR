// T1 iteration_100 extra edge cases for the 3 fixes: queued fail copy, isDomainInAccount-gated
// zone cleanup, ConnectReseller registry gate. CR modules stubbed; no real purchase / CF zone ops.
//   node js/tests/test_it_registry_fixes_t1_iter100.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
let pass = 0, fail = 0
const ok = (n, c, e) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${e ? ' — ' + e : ''}`) } }
const stubModule = (rel, exportsObj) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj } }
const crCalls = []
stubModule('../cr-domain-register', { buyDomainOnline: async (...a) => { crCalls.push(a); return { error: 'stub CR fail' } } })
let crPriceImpl = async () => ({ available: false })
stubModule('../cr-domain-price-get', { checkDomainPriceOnline: async (...a) => crPriceImpl(...a) })

const fs = require('fs')
const axios = require('axios')
const op = require('../op-service.js')
const cf = require('../cf-service.js')
const ds = require('../domain-service.js')
const { _domainFailMsg } = require('../cr-register-domain-&-create-cpanel.js')

async function main() {
  console.log('\n── isDomainInAccount LIVE (read-only list) ──')
  ok('net.it → false', (await op.isDomainInAccount('net.it')) === false)
  ok('random .com → false', (await op.isDomainInAccount('zq' + Date.now().toString(36) + 'nope.com')) === false)
  const ours = await op.isDomainInAccount('vabillaprepaid.com')
  ok('vabillaprepaid.com (ours) → true', ours === true, String(ours))

  // ── Fix 1: queued copy ──
  console.log('\n── _domainFailMsg queued copy ──')
  const bad = /not charged|wallet|n'avez pas été débité|portefeuille|未扣款|钱包|कोई शुल्क नहीं|वॉलेट/i
  for (const lang of ['en', 'fr', 'zh', 'hi', 'xx']) {
    for (const err of ['The domain you want to register is not free!', 'HTTP 500', null]) {
      const m = _domainFailMsg(lang, 'net.it', err, { queued: true })
      ok(`${lang} queued (${err ? err.slice(0, 12) : 'null'}) no not-charged/wallet claim`, !bad.test(m) && m.includes('net.it'), m)
    }
  }
  const en = _domainFailMsg('en', 'net.it', 'not free', { queued: true })
  ok('en queued has "payment is safe" + "don\'t need to pay again" + Get Support', /payment is safe/.test(en) && /don't need to pay again/.test(en) && /Get Support/.test(en))
  ok('en queued keeps unavailable headline', /can't be registered/.test(en))
  ok('en queued does NOT tell user to open Anti-Red Hosting (re-buy)', !/Anti-Red Hosting/.test(en))
  const nq = _domainFailMsg('en', 'net.it', 'not free')
  ok('default (no opts) → non-queued copy unchanged', /not charged/.test(nq) && /wallet/.test(nq) && !/payment is safe/.test(nq))
  ok('queued:false → non-queued copy', /not charged/.test(_domainFailMsg('en', 'x.com', null, { queued: false })))
  ok('opts=undefined explicitly does not throw', /not charged/.test(_domainFailMsg('en', 'x.com', null, undefined)))
  const src = fs.readFileSync(path.resolve(__dirname, '../cr-register-domain-&-create-cpanel.js'), 'utf8')
  const calls = src.match(/_domainFailMsg\([^\n]*\)/g).filter(s => !s.startsWith('_domainFailMsg(lang, domain, error, opts'))
  ok('every _domainFailMsg call site passes queued: !!info._fromQueue', calls.length >= 2 && calls.every(c => c.includes('queued: !!info._fromQueue')), JSON.stringify(calls))

  // ── Fix 2: isDomainInAccount extra shapes ──
  console.log('\n── isDomainInAccount extra shapes (stubbed) ──')
  {
    const og = axios.get, opst = axios.post
    axios.post = async (url) => { if (url.includes('/auth/login')) return { data: { code: 0, data: { token: 't' } } }; throw new Error('unexpected post ' + url) }
    let ans, lastParams
    axios.get = async (url, cfg) => { lastParams = cfg?.params; if (ans instanceof Error) throw ans; return ans }
    try {
      ans = { data: { code: 0, data: { total: '0' } } }; ok("total '0' string → false", (await op.isDomainInAccount('net.it')) === false)
      ok('query uses name+extension (net / it)', lastParams?.domain_name_pattern === 'net' && lastParams?.extension === 'it', JSON.stringify(lastParams))
      ans = { data: { code: 0, data: { total: 2 } } }; ok('total>0 without results → true', (await op.isDomainInAccount('a.com')) === true)
      ans = { data: { code: 0 } }; ok('code 0 but no data → null', (await op.isDomainInAccount('a.com')) === null)
      ans = { data: { code: 0, data: { total: 'abc' } } }; ok('non-numeric total → null', (await op.isDomainInAccount('a.com')) === null)
      ans = { data: null }; ok('null body → null', (await op.isDomainInAccount('a.com')) === null)
      ans = Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }); ok('HTTP 500 → null', (await op.isDomainInAccount('a.com')) === null)
    } finally { axios.get = og; axios.post = opst }
  }

  // ── Fix 2: registerDomain cleanup edge cases ──
  console.log('\n── registerDomain cleanup edge cases (stubbed) ──')
  const orig = { createZone: cf.createZone, deleteZone: cf.deleteZone, registerDomain: op.registerDomain, checkNsAuthoritative: op.checkNsAuthoritative, checkDomainAvailability: op.checkDomainAvailability, isDomainInAccount: op.isDomainInAccount }
  let deleted = [], inAcctCalls = 0
  const set = ({ created = true, opResult = { error: 'x' }, inAccount = false, delImpl } = {}) => {
    deleted = []; inAcctCalls = 0; crCalls.length = 0
    cf.createZone = async (d) => ({ success: true, zoneId: `z-${d}`, nameservers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'], ...(created ? { created: true } : {}) })
    cf.deleteZone = delImpl || (async (id) => { deleted.push(id); return { success: true } })
    op.registerDomain = async () => opResult
    op.checkNsAuthoritative = async (_d, ns) => ({ ready: true, authoritativeCount: ns.length, elapsedMs: 1, perNs: [] })
    op.checkDomainAvailability = async () => ({ available: true, price: 30 })
    op.isDomainInAccount = typeof inAccount === 'function' ? inAccount : async () => { inAcctCalls++; return inAccount }
  }
  try {
    set({ inAccount: async () => { inAcctCalls++; throw new Error('boom') } })
    let r = await ds.registerDomain('throws.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('isDomainInAccount throws → zone KEPT, error returned', !!r.error && deleted.length === 0 && inAcctCalls === 1, JSON.stringify(r))
    set({ created: false })
    r = await ds.registerDomain('pre.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('pre-existing zone → isDomainInAccount not even called, zone kept', !!r.error && inAcctCalls === 0 && deleted.length === 0)
    set({ inAccount: async () => { inAcctCalls++; return undefined } })
    r = await ds.registerDomain('undef.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('isDomainInAccount undefined (not strictly false) → zone KEPT', !!r.error && deleted.length === 0)
    set({ delImpl: async () => { throw new Error('CF down') } })
    r = await ds.registerDomain('cfdown.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('deleteZone throws → still returns {error}, no crash', !!r.error && !r.success, JSON.stringify(r))
    set({ delImpl: async () => ({ success: false }) })
    r = await ds.registerDomain('cffail.com', 'OpenProvider', 'cloudflare', null, 1, null)
    ok('deleteZone success:false → still returns {error}', !!r.error)
    set({ inAccount: false })
    r = await ds.registerDomain('crfb.com', 'ConnectReseller', 'cloudflare', null, 1, null)
    ok('CR path + OP fallback fail, even with inAccount=false → zone KEPT', !!r.error && deleted.length === 0 && crCalls.length === 1)
  } finally { Object.assign(cf, { createZone: orig.createZone, deleteZone: orig.deleteZone }); Object.assign(op, { registerDomain: orig.registerDomain, checkNsAuthoritative: orig.checkNsAuthoritative, checkDomainAvailability: orig.checkDomainAvailability, isDomainInAccount: orig.isDomainInAccount }) }

  // ── Fix 3: CR registry gate edge cases ──
  console.log('\n── checkDomainPrice CR gate edge cases (stubbed registry) ──')
  const oCheck = op.checkDomainAvailability, oVer = op.verifyRegistryAvailability
  crPriceImpl = async () => ({ available: true, price: 20, originalPrice: 8 })
  try {
    op.checkDomainAvailability = async () => ({ available: false })
    op.verifyRegistryAvailability = async () => ({ verified: false, error: 'registry_unreachable' })
    ok('registry unreachable → CR .it NOT offered', (await ds.checkDomainPrice('zzunreach.it', null)).available === false)
    op.verifyRegistryAvailability = async () => { throw new Error('boom') }
    ok('registry verifier throws → CR .it NOT offered (no crash)', (await ds.checkDomainPrice('zzthrow.it', null)).available === false)
    let vCalls = 0
    op.verifyRegistryAvailability = async () => { vCalls++; return { verified: true, available: false, status: 'UNASSIGNABLE' } }
    ok('uppercase NET.IT → gated', (await ds.checkDomainPrice('NET.IT', null)).available === false && vCalls === 1)
    vCalls = 0
    ok('.com → verifier never called', (await ds.checkDomainPrice('zzabc.com', null)).available === true && vCalls === 0)
    op.checkDomainAvailability = async () => ({ available: true, price: 25, originalPrice: 9 })
    const both = await ds.checkDomainPrice('zzboth.it', null)
    ok('CR gated + OP available → offered via OpenProvider only', both.available === true && both.registrar === 'OpenProvider', JSON.stringify(both))
    crPriceImpl = async () => ({ available: false })
    vCalls = 0
    await ds.checkDomainPrice('zznotcr.it', null)
    ok('CR not available → no extra registry call from the CR gate', vCalls === 0)
  } finally { op.checkDomainAvailability = oCheck; op.verifyRegistryAvailability = oVer }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(2) })
