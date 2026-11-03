// One-off prod check: every domain Hosta's DNS manager can open must pass the Nomadly reseller
// DNS ownership guard for Hosta's API-key owner. Prints counts only (domains masked).
const fs = require('fs'), { MongoClient } = require('mongodb')
const env = (p) => Object.fromEntries(fs.readFileSync(p, 'utf8').split('\n').map(l => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]))
const N = env(process.argv[2]), HO = env(process.argv[3])
const mask = (d) => String(d).replace(/^(.{3}).*(\.[^.]+)$/, '$1***$2')
;(async () => {
  const nc = await MongoClient.connect(N.MONGO_URL); const ndb = nc.db(N.DB_NAME)
  const hc = await MongoClient.connect(HO.DB_URI); const hdb = hc.db()
  const key = await ndb.collection('resellerApiKeys').findOne({ enabled: true }, { projection: { ownerChatId: 1, label: 1 } })
  const owner = String(key.ownerChatId)
  const names = new Set()
  for (const c of ['domains', 'hostingorders', 'orders', 'shortenerdomains', 'dnsexternalconsents']) {
    const docs = await hdb.collection(c).find({}).limit(5000).toArray().catch(() => [])
    for (const d of docs) for (const v of [d.domain, d.domainName, d.name, d.parent, d.item && d.item.domain, ...(Array.isArray(d.items) ? d.items.map(i => i && i.domain) : [])]) if (typeof v === 'string' && /\./.test(v)) names.add(v.toLowerCase())
  }
  let ok = 0; const miss = []
  for (const domain of names) {
    const own = await ndb.collection('domainsOf').findOne({ domainName: domain, chatId: owner }) ||
      await ndb.collection('cpanelAccounts').findOne({ chatId: owner, deleted: { $ne: true }, $or: [{ domain }, { addonDomains: domain }, { 'addonDomains.domain': domain }] }) ||
      await ndb.collection('brandedNsDomains').findOne({ _id: domain, ownerChatId: owner })
    if (own) ok++; else miss.push(domain)
  }
  console.log('hosta key label:', key.label, '| hosta domains seen:', names.size, '| pass guard:', ok, '| would be blocked:', miss.length)
  for (const d of miss.slice(0, 40)) {
    const any = await ndb.collection('domainsOf').findOne({ domainName: d }, { projection: { chatId: 1 } })
    const acc = await ndb.collection('cpanelAccounts').findOne({ $or: [{ domain: d }, { addonDomains: d }, { 'addonDomains.domain': d }] }, { projection: { chatId: 1, deleted: 1 } })
    console.log('  blocked', mask(d), '| nomadly domainsOf owner:', any ? (String(any.chatId) === owner ? 'hosta' : 'OTHER') : 'none', '| hosting:', acc ? (String(acc.chatId) === owner ? (acc.deleted ? 'hosta(deleted)' : 'hosta') : 'OTHER') : 'none')
  }
  await nc.close(); await hc.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
