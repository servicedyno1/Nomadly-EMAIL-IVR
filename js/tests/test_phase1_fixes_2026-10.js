/* eslint-disable no-console */
// Phase 1 fixes (2026-10): blacklist false positive, .htaccess preservation + SPA fallback,
// localized renewal-terminated message + plan dates, renewal-price-change notice, weekly billing audit.
// Run: node js/tests/test_phase1_fixes_2026-10.js
'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const dnsP = require('dns').promises
const { MongoClient } = require('mongodb')
const sb = require('../safe-browsing-service')
const ar = require('../anti-red-service')
const audit = require('../hosting-billing-audit')
const { translation } = require('../translation')

let passed = 0
let failed = 0
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.stack.split('\n').slice(0, 2).join('\n     ')}`) }
}
const err = (code) => Object.assign(new Error(code), { code })

;(async () => {
  console.log('\n=== Blacklist check ===')
  const realResolve = dnsP.resolve4
  const stubDns = (map) => { dnsP.resolve4 = async (name) => { const v = map[name]; if (v instanceof Error) throw v; if (!v) throw err('ENOTFOUND'); return v } }
  await t('uses the ORIGIN ip (not the CF edge) when given; clean → not listed', async () => {
    stubDns({ 'namewords.sbs': ['172.67.199.112'] })
    const r = await sb.checkBlacklists('namewords.sbs', { ip: '68.183.77.106' })
    assert.strictEqual(r.ip, '68.183.77.106'); assert.strictEqual(r.ip_source, 'origin'); assert.strictEqual(r.listed, false)
  })
  await t('Spamhaus 127.255.255.254 (public resolver refused) is NOT a listing → unavailable', async () => {
    stubDns({ '112.199.67.172.zen.spamhaus.org': ['127.255.255.254'] })
    const r = await sb.checkBlacklists('x.com', { ip: '172.67.199.112' })
    assert.strictEqual(r.listed, false); assert.deepStrictEqual(r.lists, [])
    assert.ok(r.unavailable.some(u => u.list === 'zen.spamhaus.org'), JSON.stringify(r))
  })
  await t('a real 127.0.0.x answer IS a listing', async () => {
    stubDns({ '4.3.2.1.bl.spamcop.net': ['127.0.0.2'] })
    const r = await sb.checkBlacklists('x.com', { ip: '1.2.3.4' })
    assert.strictEqual(r.listed, true); assert.deepStrictEqual(r.lists, ['bl.spamcop.net'])
  })
  await t('resolver failure (ESERVFAIL / refused) → unavailable, never listed', async () => {
    stubDns({ '4.3.2.1.zen.spamhaus.org': err('ESERVFAIL'), '4.3.2.1.b.barracudacentral.org': err('EREFUSED') })
    const r = await sb.checkBlacklists('x.com', { ip: '1.2.3.4' })
    assert.strictEqual(r.listed, false); assert.strictEqual(r.unavailable.length, 2)
  })
  await t('no origin given → falls back to resolving the domain (ip_source resolved); hostname origin is resolved', async () => {
    stubDns({ 'site.com': ['9.9.9.9'], 'whm.example.net': ['5.6.7.8'] })
    assert.strictEqual((await sb.checkBlacklists('site.com')).ip_source, 'resolved')
    const r = await sb.checkBlacklists('site.com', { ip: 'whm.example.net' })
    assert.strictEqual(r.ip, '5.6.7.8'); assert.strictEqual(r.ip_source, 'origin')
  })
  dnsP.resolve4 = realResolve

  console.log('\n=== .htaccess composition (anti-red redeploy) ===')
  const RULES = ar.generateHtaccessRules('cpuser', { behindCloudflare: true })
  const HANDLER = '# php -- BEGIN cPanel-generated handler, do not edit\n<IfModule mime_module>\n  AddHandler application/x-httpd-ea-php82 .php\n</IfModule>\n# php -- END cPanel-generated handler, do not edit'
  const WP = '# BEGIN WordPress\n<IfModule mod_rewrite.c>\nRewriteEngine On\nRewriteBase /\nRewriteRule ^index\\.php$ - [L]\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteRule . /index.php [L]\n</IfModule>\n# END WordPress'
  const LSC = '# BEGIN LSCACHE\n<IfModule LiteSpeed>\nCacheLookup on\n</IfModule>\n# END LSCACHE'
  const OLD = `${HANDLER}\n\n${WP}\n\n${LSC}\n\n# ====== Anti-Red Protection ======\nRewriteEngine On\nRewriteRule ^old - [F]\n# ====== End Anti-Red Protection ======\n`
  await t('keeps cPanel handler first, rebuilds anti-red rules, keeps WordPress + plugin blocks after them', async () => {
    const out = ar.composeHtaccess(OLD, RULES)
    assert.ok(out.startsWith(HANDLER))
    assert.ok(out.includes(WP) && out.includes(LSC))
    assert.ok(out.indexOf(RULES) < out.indexOf('# BEGIN WordPress'), 'anti-red rules must run before WordPress')
    assert.ok(!out.includes('RewriteRule ^old'), 'stale anti-red rules must be replaced')
  })
  await t('idempotent: redeploying its own output changes nothing (no duplicated blocks)', async () => {
    const once = ar.composeHtaccess(OLD, RULES, { spa: true })
    const twice = ar.composeHtaccess(once, RULES, { spa: true })
    assert.strictEqual(twice, once)
    assert.strictEqual(once.split('# BEGIN WordPress').length - 1, 1)
  })
  await t('SPA fallback added for app shells, not when WordPress is present, never duplicated', async () => {
    const spaOut = ar.composeHtaccess(HANDLER, RULES, { spa: true })
    assert.ok(spaOut.includes('# BEGIN SPA Fallback (auto)') && spaOut.includes('RewriteRule ^ /index.html [L]'))
    assert.strictEqual(ar.composeHtaccess(spaOut, RULES, { spa: true }).split('# BEGIN SPA Fallback').length - 1, 1)
    assert.ok(!ar.composeHtaccess(OLD, RULES, { spa: true }).includes('SPA Fallback'), 'WordPress site must not get SPA fallback')
    assert.ok(!ar.composeHtaccess(spaOut, RULES, { spa: false }).includes('SPA Fallback'), 'dropped when the site is no longer an SPA')
  })
  await t('customer FallbackResource and CORS section survive; custom "# BEGIN Custom Rules" block survives', async () => {
    const custom = '# BEGIN Custom Rules\nRedirect 301 /old /new\n# END Custom Rules'
    const cors = '# --- CORS headers ---\n<IfModule mod_headers.c>\n  Header set Access-Control-Allow-Origin "*"\n</IfModule>'
    const out = ar.composeHtaccess(`FallbackResource /index.html\n${custom}\n${cors}\n`, RULES, { spa: true })
    assert.ok(out.includes('FallbackResource /index.html') && out.includes(custom))
    assert.ok(out.includes('cross-origin'), 'anti-red rules carry their own CORS headers (legacy CORS block not duplicated)')
    assert.ok(!out.includes('SPA Fallback'), 'own FallbackResource wins over the auto block')
  })
  await t('isSpaIndex: Vite/CRA/Vue shells yes; plain HTML and Next.js export no', async () => {
    assert.ok(ar.isSpaIndex('<div id="root"></div><script type="module" src="/assets/index-abc.js"></script>'))
    assert.ok(ar.isSpaIndex('<div id="root"></div><script defer src="/static/js/main.1a2b.js"></script>'))
    assert.ok(ar.isSpaIndex("<div id='app'></div><script src='/js/app.123.js'></script>"))
    assert.ok(!ar.isSpaIndex('<h1>Hello</h1><script src="/main.js"></script>'))
    assert.ok(!ar.isSpaIndex('<div id="__next"></div><script src="/_next/static/chunks/main.js"></script>'))
  })
  await t('deployHtaccess detects CRA build/ AND Vite dist/ static paths', async () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../anti-red-service.js'), 'utf8')
    assert.ok(src.includes('(\\S+\\/(?:build|dist))\\/'))
    assert.ok(src.includes('const finalContent = composeHtaccess(existingContent, rules, { spa })'))
  })

  console.log('\n=== Translations ===')
  const LANGS = ['en', 'fr', 'hi', 'zh']
  const DATE = '2026-11-09T12:00:00Z'
  const EXP = { en: 'Nov 9, 2026', fr: '9 nov. 2026', hi: '2026', zh: '2026年11月9日' }
  for (const lang of LANGS) {
    const raw = require(`../lang/${lang}.js`)[lang]
    await t(`[${lang}] fmtDate / renewTerminated / renewalPriceChangedNotice exist natively and render`, async () => {
      for (const k of ['fmtDate', 'renewTerminated', 'renewalPriceChangedNotice']) assert.ok(raw.t[k], `missing t.${k}`)
      assert.ok(translation('t.fmtDate', lang, DATE).includes(EXP[lang]))
      const btn = translation('user.hostingDomainsRedirect', lang)
      assert.ok(translation('t.renewTerminated', lang, btn).includes(btn))
      const n = translation('t.renewalPriceChangedNotice', lang, 'site.com', 'Golden Anti-Red HostPanel (30 Days)', '30.00', '100.00', DATE, true)
      assert.ok(n.includes('$100.00') && n.includes('$30.00') && n.includes('site.com') && n.includes(EXP[lang]), n)
      const noDate = translation('t.renewalPriceChangedNotice', lang, 'site.com', 'P', '30.00', '100.00', null, true)
      assert.ok(!/undefined|Invalid Date|null/.test(noDate), noDate)
    })
  }

  console.log('\n=== Weekly billing audit ===')
  const mc = await MongoClient.connect(process.env.MONGO_URL || 'mongodb://localhost:27017')
  const col = mc.db('test').collection('audit_test_cpanelAccounts')
  await col.deleteMany({})
  const now = new Date('2026-10-12T09:00:00Z')
  const d = (days) => new Date(now.getTime() + days * 864e5)
  const golden = 'Golden Anti-Red HostPanel (30 Days)'
  const weekly = 'Premium Anti-Red (1-Week)'
  const goldList = require('../hosting-scheduler').getPlanPrice(golden)
  await col.insertMany([
    { _id: 'ok1', domain: 'ok.com', plan: golden, renewalPriceUsd: goldList, expiryDate: d(10) },
    { _id: 'stale1', domain: 's.com', plan: golden, renewalPriceUsd: 30, upgradedAt: d(-2), upgradedFrom: weekly, expiryDate: d(28) },
    { _id: 'above1', domain: 'a.com', plan: golden, renewalPriceUsd: goldList + 50, expiryDate: d(10) },
    { _id: 'locked1', domain: 'l.com', plan: golden, renewalPriceUsd: goldList - 25, expiryDate: d(10) },
    { _id: 'weeklylong', domain: 'w.com', plan: weekly, renewalPriceUsd: require('../hosting-scheduler').getPlanPrice(weekly), expiryDate: d(26) },
    { _id: 'overdue', domain: 'o.com', plan: golden, renewalPriceUsd: goldList, expiryDate: d(-5), suspended: false },
    { _id: 'nolock', domain: 'n.com', plan: golden, expiryDate: d(10) },
    { _id: 'gone', domain: 'g.com', plan: golden, renewalPriceUsd: 1, deleted: true },
    { _id: 'failed', domain: 'f.com', plan: golden, renewalPriceUsd: 1, provisionState: 'failed' },
  ])
  await t('categorises every anomaly once; ignores deleted / failed / healthy accounts', async () => {
    const r = await audit.runAudit(col, now)
    assert.strictEqual(r.checked, 7)
    const ids = (k) => r[k].map(x => x.username)
    assert.deepStrictEqual(ids('stale_after_plan_change'), ['stale1'])
    assert.deepStrictEqual(ids('price_above_list'), ['above1'])
    assert.deepStrictEqual(ids('price_locked_below_list'), ['locked1'])
    assert.deepStrictEqual(ids('weekly_term_too_long'), ['weeklylong'])
    assert.deepStrictEqual(ids('expired_not_suspended'), ['overdue'])
    assert.deepStrictEqual(ids('no_price_lock'), ['nolock'])
    assert.strictEqual(r.needs_action, 4)
    const msg = audit.formatAdminSummary(r)
    assert.ok(msg.includes('Needs action') && msg.includes('<code>stale1</code>') && msg.includes('<code>overdue</code>'))
  })
  await t('report-only: the audit never writes', async () => {
    const before = JSON.stringify(await col.find({}).sort({ _id: 1 }).toArray())
    await audit.runAudit(col, now)
    assert.strictEqual(JSON.stringify(await col.find({}).sort({ _id: 1 }).toArray()), before)
  })
  await col.drop().catch(() => {}); await mc.close()

  console.log('\n=== Bot wiring (static) ===')
  const src = fs.readFileSync(path.resolve(__dirname, '../_index.js'), 'utf8')
  await t('renew flow uses translated terminated message (no hard-coded English left)', async () => {
    assert.ok(src.includes("trans('t.renewTerminated', user.hostingDomainsRedirect)"))
    assert.ok(!src.includes('☁️ Hosting & Domains → Choose a plan'))
  })
  await t('plan list / billing / plan details dates use t.fmtDate', async () => {
    assert.strictEqual((src.match(/trans\('t\.fmtDate', (p|plan)\.(expiryDate|createdAt)\)/g) || []).length, 4)
  })
  await t('price-repair apply notifies bot customers (skips reseller accounts); weekly audit scheduled + admin endpoint', async () => {
    assert.ok(src.includes("translation('t.renewalPriceChangedNotice', lang"))
    assert.ok(src.includes("r.source === 'reseller_api'"))
    assert.ok(src.includes("schedule.scheduleJob('0 9 * * 1'"))
    assert.ok(src.includes("app.get('/admin/hosting-billing-audit'"))
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
