// Hosting ordered with a Cloudflare-blocked main domain: plan still created + flagged, user swaps in a new main domain
// for free (own / external / newly registered), then adding domains works normally. Bot + web.
// Run: node js/tests/test_flagged_primary_swap.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const fs = require('fs'), path = require('path'), { MongoClient } = require('mongodb')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const stub = (m, exports) => { const p = require.resolve(m); require.cache[p] = { id: p, filename: p, loaded: true, exports } }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`qa_flagged_${Date.now()}`)
  const whm = [], dns = [], alerts = []
  stub('../cf-service', {
    ensureZoneReady: async (d) => d === 'bad.com' ? { ok: false, blocked: true, error: '1097' } : d === 'down.com' ? { ok: false, blocked: false, error: 'timeout' } : { ok: true, zoneId: 'z-' + d, nameservers: ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com'] },
    zoneNotReadyText: (d, r) => r.blocked ? `Cloudflare has flagged ${d}` : `We couldn't set up DNS for ${d}`,
  })
  stub('../whm-service', { changePrimaryDomain: async (u, d) => { whm.push([u, d]); return d === 'whmfail.com' ? { success: false, error: 'modifyacct failed' } : { success: true } } })
  stub('../addon-domain-flow', { runDnsAndProtection: async (o) => { dns.push(o.domain) } })
  stub('../hosting-health-check', { scheduleHealthCheck: () => {} })
  stub('../cpanel-proxy', { removeAddonDomain: async () => ({ status: 1 }) })
  const R = require('../hosting-replace-primary')
  await db.collection('domainsOf').insertOne({ _id: '42', 'mine@com': true, 'used@com': true, 'bad@com': true })
  await db.collection('cpanelAccounts').insertMany([
    { _id: 'acct1', cpUser: 'acct1', chatId: '42', domain: 'bad.com', plan: 'Premium Anti-Red (1-Week)', addonDomains: [], primaryCfBlocked: true },
    { _id: 'other', cpUser: 'other', chatId: '42', domain: 'used.com', addonDomains: [] },
  ])
  const acct = () => db.collection('cpanelAccounts').findOne({ _id: 'acct1' })
  ok('eligible list: owned + free domains only (not the flagged one, not on another plan)', JSON.stringify(await R.eligibleReplacements(db, await acct())) === '["mine.com"]')
  const run = async (d) => R.replaceBlockedPrimary({ db, account: await acct(), newDomain: d, notifyAdmin: (x) => alerts.push(x), by: 'test' })
  let r = await run('nope'); ok('invalid domain refused', r.kind === 'invalid')
  r = await run('bad.com'); ok('same flagged domain refused', r.kind === 'same')
  r = await run('used.com'); ok('domain on another plan refused', r.kind === 'on_other_plan')
  await db.collection('cpanelAccounts').updateOne({ _id: 'acct1' }, { $set: { primaryCfBlocked: true } })
  r = await run('down.com'); ok('replacement whose DNS cannot be set up → refused, nothing swapped', r.kind === 'dns_not_ready' && whm.length === 0)
  r = await run('whmfail.com'); ok('WHM failure → error, flag kept', r.kind === 'whm_failed' && (await acct()).primaryCfBlocked === true)
  whm.length = 0
  r = await run('https://www.Mine.com/'); const a1 = await acct()
  ok('own domain swap → main domain changed on WHM + DB, flag cleared', r.ok && whm[0][1] === 'mine.com' && a1.domain === 'mine.com' && !a1.primaryCfBlocked && a1.primaryReplacedFrom === 'bad.com')
  ok('own domain → not external (DNS delegated automatically)', r.external === false && dns.includes('mine.com'))
  ok('admin alerted about the swap', alerts.some(x => /Flagged main domain replaced/.test(x) && /bad\.com/.test(x)))
  r = await run('else.com'); ok('second swap refused once the plan is no longer flagged', r.kind === 'not_blocked')
  await db.collection('cpanelAccounts').updateOne({ _id: 'acct1' }, { $set: { primaryCfBlocked: true, domain: 'bad.com' } })
  r = await run('elsewhere.org'); ok('external domain → swapped + nameservers returned to show the user', r.ok && r.external === true && r.nameservers.length === 2)

  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const prov = src('cr-register-domain-&-create-cpanel.js')
  ok('provisioning: CF block detected, plan still created, flag stored', /else if \(zone\.blocked\)[\s\S]{0,60}cfBlocked = true/.test(prov) && /primaryCfBlocked: true, primaryCfBlockedAt/.test(prov))
  ok('provisioning: after payment the user is told + gets the 🔁 button (order + credentials)', (prov.match(/REPLACE_BTN\[lang\] \|\| REPLACE_BTN\.en/g) || []).length === 2 && /cfBlockedOrderMsg\(lang, domain\)/.test(prov))
  ok('provisioning: no misleading "set these nameservers" for the blocked domain', /isExternal && !cfBlocked && cfNameservers\.length >= 2/.test(prov))
  ok('provisioning: result tells web callers the domain is flagged', /primaryCfBlocked: cfBlocked \}/.test(prov))
  for (const l of ['en', 'fr', 'zh', 'hi', 'fa']) ok(`order message ${l}`, require('../cr-register-domain-&-create-cpanel').cfBlockedOrderMsg(l, 'x.com').includes('x.com'))
  const idx = src('_index.js')
  ok('bot: 🔁 button works from any screen', /Object\.values\(_RF\.REPLACE_BTN\)\.includes\(message\)/.test(idx))
  ok('bot: pick screen offers own domains, external, register new', /`🌐 \$\{d\}`[\s\S]{0,40}_RF\.t\(lang, 'bExternal'\)[\s\S]{0,40}_RF\.t\(lang, 'bBuy'\)/.test(idx))
  ok('bot: register-new routes to Bulletproof Domains then back', /'buyHint'\), k\.of\(\[\[user\.domainNames\], \[_RF\.btn\(lang\)\]/.test(idx))
  ok('bot: external success shows nameservers', /r\.external && r\.nameservers\.length \? _RF\.t\(lang, 'okExt'/.test(idx))
  ok('bot: plan details shows banner + 🔁 button when flagged', /if \(plan\.primaryCfBlocked\) buttons\.unshift\(\[_RF\.btn\(lang\)\]\)/.test(idx))
  ok('bot + panel change-primary also clear the flag', /primaryCfBlocked: '', primaryCfBlockedAt: '' \}/.test(idx) && /primaryCfBlocked: '', primaryCfBlockedAt: '' \}/.test(src('cpanel-routes.js')))
  const routes = src('cpanel-routes.js')
  ok('panel: GET flagged-primary + POST replace-flagged-primary (new session token)', /'\/domains\/flagged-primary'/.test(routes) && /'\/domains\/replace-flagged-primary'[\s\S]{0,900}createToken/.test(routes))
  const fe = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/panel/FlaggedDomainBanner.js'), 'utf8'), dash = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/PanelDashboard.js'), 'utf8')
  ok('panel: banner on every tab with select / type / register / link + NS shown after', /<FlaggedDomainBanner \/>/.test(dash) && ['flagged-domain-select', 'flagged-domain-input', 'flagged-domain-buy-btn', 'flagged-domain-link-btn', 'flagged-domain-ns'].every(x => fe.includes(x)))
  for (const l of ['en', 'fr', 'zh', 'hi']) ok(`panel locale ${l}: fdb keys`, !!JSON.parse(fs.readFileSync(path.join(__dirname, `../../frontend/src/locales/${l}.json`), 'utf8')).fdb?.title)
  await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
