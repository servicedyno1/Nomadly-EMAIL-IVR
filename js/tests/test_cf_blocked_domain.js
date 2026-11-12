// Cloudflare-blocked domains (CF 1097) are refused before any hosting change: addon add (panel + bot), set-primary
// (panel, bot, reseller). Real case: @smsbeast_real 2026-11-12 — cunetsballs.com / furrycitadel.com.
// Run: node js/tests/test_cf_blocked_domain.js
const fs = require('fs'), path = require('path')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const axios = require('axios'), realPost = axios.post, realGet = axios.get
  process.env.CLOUDFLARE_EMAIL = 'qa@x'; process.env.CLOUDFLARE_API_KEY = 'k'
  axios.get = async (url) => ({ data: { success: true, result: [] } })
  axios.post = async (url, body) => {
    if (body?.name === 'blocked.com') { const e = new Error('Request failed with status code 400'); e.response = { status: 400, data: { success: false, errors: [{ code: 1097, message: 'This web property cannot be added to Cloudflare at this time.' }] } }; throw e }
    if (body?.name === 'flaky.com') { const e = new Error('timeout'); throw e }
    return { data: { success: true, result: { id: 'z1', name_servers: ['a.ns.cloudflare.com'], status: 'pending' } } }
  }
  delete require.cache[require.resolve('../cf-service')]
  const cf = require('../cf-service')
  let r = await cf.ensureZoneReady('blocked.com')
  ok('CF 1097 → blocked (error code read from the 400 body)', !r.ok && r.blocked && /cannot be added/.test(r.error), JSON.stringify(r))
  ok('blocked text tells user nothing changed + use another domain', /flagged .*abuse/.test(cf.zoneNotReadyText('blocked.com', r)) && /Nothing on your plan was changed/.test(cf.zoneNotReadyText('blocked.com', r)))
  r = await cf.ensureZoneReady('flaky.com')
  ok('network error → not ready, not blocked', !r.ok && !r.blocked)
  r = await cf.ensureZoneReady('good.com')
  ok('normal domain → zone ready', r.ok && r.zoneId === 'z1')
  axios.post = realPost; axios.get = realGet

  // Bot/shared addon flow refuses a CF-blocked domain before touching cPanel
  const stub = (m, exports) => { const p = require.resolve(m); require.cache[p] = { id: p, filename: p, loaded: true, exports } }
  const cpCalls = []
  stub('../cpanel-proxy', { addAddonDomain: async (...a) => { cpCalls.push(a); return { status: 1 } } })
  stub('../cf-service', { ensureZoneReady: async (d) => d === 'blocked.com' ? { ok: false, blocked: true, error: '1097' } : { ok: true, zoneId: 'z' }, zoneNotReadyText: cf.zoneNotReadyText, getZoneByName: async () => ({ id: 'z' }) })
  stub('../whm-service', { getAddonLimit: () => 5 })
  stub('../anti-red-service', {})
  delete require.cache[require.resolve('../addon-domain-flow')]
  const flow = require('../addon-domain-flow')
  const db = { collection: () => ({ findOne: async () => null, updateOne: async () => ({}) }) }
  const res = await flow.attachAddonDomain({ account: { _id: 'u1', cpUser: 'u1', domain: 'main.com', plan: 'Premium Anti-Red (1-Week)', addonDomains: [] }, cpPass: 'x', domain: 'blocked.com', db })
  ok('addon flow → errorKind cf_blocked, cPanel never called', res.errorKind === 'cf_blocked' && cpCalls.length === 0, JSON.stringify(res))

  // Source guards: pre-flight runs BEFORE any destructive step on every path
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
  const routes = src('cpanel-routes.js'), sp = routes.slice(routes.indexOf("router.post('/domains/set-primary'"), routes.indexOf("router.post('/account/cancel'"))
  ok('panel set-primary: zone pre-flight before removeAddon / WHM swap', sp.indexOf('ensureZoneReady') > 0 && sp.indexOf('ensureZoneReady') < sp.indexOf('removeAddonDomain') && sp.indexOf('ensureZoneReady') < sp.indexOf('changePrimaryDomain'))
  const ae = routes.slice(routes.indexOf("router.post('/domains/add-enhanced'"))
  ok('panel add-enhanced: CF-block pre-flight before cPanel addAddonDomain', ae.indexOf('ensureZoneReady') > 0 && ae.indexOf('ensureZoneReady') < ae.indexOf('cpProxy.addAddonDomain'))
  const idx = src('_index.js'), cp = idx.slice(idx.indexOf('// ── Change Primary Domain — confirm & execute ──'))
  ok('bot change-primary: pre-flight before addon removal + WHM swap', cp.indexOf('ensureZoneReady') > 0 && cp.indexOf('ensureZoneReady') < cp.indexOf('removeAddonDomain') && cp.indexOf('ensureZoneReady') < cp.indexOf('changePrimaryDomain('))
  ok('bot maps cf_blocked to the clear message', /errorKind === 'cf_blocked'[\s\S]{0,80}t\.domainCfBlocked/.test(idx))
  ok('bot limit-reached screen offers Upgrade', /attachDomainLimitReached\(limit, plan\.plan \|\| 'Hosting'\), k\.of\(\[\[user\.upgradeHostingPlan\]/.test(idx))
  ok('bot handles /start upgrade_<domain> deep link', /\^\\\/start upgrade_/.test(idx))
  const rs = src('reseller-hosting-mgmt.js')
  ok('reseller set-primary + change-primary both pre-flight', (rs.match(/ensureZoneReady/g) || []).length === 2)
  for (const l of ['en', 'fr', 'zh', 'hi', 'fa']) ok(`lang ${l}: domainCfBlocked`, /domainCfBlocked: \(d\) =>/.test(src(`lang/${l}.js`)))
  const dl = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/panel/DomainList.js'), 'utf8')
  ok('panel shows Upgrade plan button when the limit is hit', /data-testid="dl-upgrade-plan-btn"/.test(dl) && /upgrade_\$\{upgradeKey\}/.test(dl))
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
