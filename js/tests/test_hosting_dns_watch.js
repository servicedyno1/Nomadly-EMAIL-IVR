// Hosting DNS watch: typo NS → user told exact fix (once per state), correct NS → propagating, active+up → "live" message, AI line.
// Run: cd /app && node js/tests/test_hosting_dns_watch.js
const w = require('/app/js/hosting-dns-watch')
const axios = require('axios')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const EXP = ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com']
let rdapNs = ['anderson.ns.claudflare.com', 'leanna.ns.claudflare.com'], zoneStatus = 'pending', site = 0, puts = 0
axios.get = async (url) => { if (url.includes('rdap.org')) return { data: { nameservers: rdapNs.map(n => ({ ldhName: n.toUpperCase() })) } }; if (site) return { status: 200 }; throw new Error('ENOTFOUND') }
axios.put = async () => { puts++; return {} }
const docs = { a1: { _id: 'a1', chatId: '42', domain: 'orteac.org', createdAt: new Date(Date.now() - 3600e3).toISOString() } }
const db = { collection: (n) => n === 'state' ? { findOne: async () => ({ userLanguage: 'en' }) } : {
  find: () => ({ limit: () => ({ toArray: async () => Object.values(docs).filter(d => !d.dnsWatch?.liveAt) }) }),
  updateOne: async (q, u) => { const d = docs[q._id]; for (const [k, v] of Object.entries(u.$set)) { const [a, b] = k.split('.'); if (b) { d[a] = d[a] || {}; d[a][b] = v } else d[k] = v } return { modifiedCount: 1 } },
} }
const sent = []
const deps = { cf: { getZoneByName: async () => ({ id: 'z1', status: zoneStatus, name_servers: EXP }) }, sendMessage: async (c, m) => { sent.push([c, m]) }, isExternal: async () => true, log: () => {} }

;(async () => {
  ok('typo detector flags claudflare', w.typos(rdapNs, EXP).length === 2)
  ok('typo detector ignores unrelated registrar NS', w.typos(['dns1.registrar-servers.com'], EXP).length === 0)
  await w.tick(db, deps)
  ok('wrong NS → user told exact names + typo', sent.length === 1 && sent[0][0] === '42' && sent[0][1].includes('leanna.ns.cloudflare.com') && sent[0][1].includes('typo'))
  ok('state saved for AI', docs.a1.dnsWatch.status === 'wrong_nameservers' && docs.a1.dnsWatch.typoNs.length === 2)
  ok('AI line names the typo and the fix', /TYPO detected/.test(w.describe(docs.a1.dnsWatch, 'orteac.org')) && /Must be exactly: anderson/.test(w.describe(docs.a1.dnsWatch, 'orteac.org')))
  docs.a1.dnsWatch.lockUntil = null; await w.tick(db, deps)
  ok('same wrong state → no repeat message', sent.length === 1)
  rdapNs = EXP; docs.a1.dnsWatch.lockUntil = null; await w.tick(db, deps)
  ok('fixed NS → propagating + activation re-check, no message', docs.a1.dnsWatch.status === 'propagating' && puts === 1 && sent.length === 1)
  zoneStatus = 'active'; site = 1; docs.a1.dnsWatch.lockUntil = null; await w.tick(db, deps)
  ok('active + site up → "is live" message', sent.length === 2 && /is live/.test(sent[1][1]) && docs.a1.dnsWatch.liveAt)
  docs.a1.dnsWatch.lockUntil = null; await w.tick(db, deps)
  ok('live accounts no longer checked', sent.length === 2)
  docs.b1 = { _id: 'b1', chatId: '7', domain: 'old.com', createdAt: new Date(Date.now() - 3 * 86400e3).toISOString() }
  await w.tick(db, deps)
  ok('already-live older plan marked quietly', docs.b1.dnsWatch.liveAt && sent.length === 2)
  docs.c1 = { _id: 'c1', chatId: '8', domain: 'ours.com', createdAt: new Date(Date.now() - 3600e3).toISOString() }
  zoneStatus = 'pending'; rdapNs = ['ns1.other.com', 'ns2.other.com']
  await w.tick(db, { ...deps, isExternal: async () => false })
  ok('domains we registered → no NS message (auto-healed)', sent.length === 2 && docs.c1.dnsWatch.status === 'wrong_nameservers')
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.log('ERR', e.stack); process.exit(1) })
