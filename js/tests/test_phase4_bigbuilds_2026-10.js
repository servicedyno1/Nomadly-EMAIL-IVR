/* eslint-disable no-console */
// Phase 4 (2026-10) big builds: one-click WordPress (installer + shared service + reseller API +
// HostPanel Apps routes), MySQL opened to the weekly plan, and short-link analytics / smart
// routing / QR codes on the reseller API.
// Run: node js/tests/test_phase4_bigbuilds_2026-10.js
//
// SAFE BY CONSTRUCTION: cPanel (an in-memory fake account: files + MySQL), WHM, anti-red and the
// registrar are mocked via require.cache BEFORE anything loads; WordPress downloads and the
// one-time setup requests are answered by a fake axios adapter; all data lives in a throw-away DB
// on the LOCAL mongod. The optional redirect E2E uses the local bot (port 5000) + local DB only.
const path = require('path')
const assert = require('assert')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })

process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '3600000'
process.env.RESELLER_WEBHOOK_RETRIES = '0'
process.env.RESELLER_ALERTS_ENABLED = ''
process.env.RESELLER_DOMAIN_AUTORENEW_ENABLED = ''
process.env.SKIP_WEBHOOK_SYNC = 'true'
process.env.BOT_ENVIRONMENT = 'development'

function mockModule(rel, exportsObj) {
  const p = require.resolve(path.resolve(__dirname, '..', rel))
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }
}
const stubProxy = (base) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : async () => ({})) })

// ── Fake cPanel: per-path filesystem + MySQL, with auth-failure + quota knobs ──
const fake = { fs: new Map(), dbs: new Set(), users: new Set(), grants: [], calls: [], rootCalls: 0, authFail: new Set(), dbQuota: {}, installed: {}, challenge: new Set(), failInstall: new Set(), http: [] }
const parentOf = (p) => p.slice(0, p.lastIndexOf('/'))
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1)
const isDir = (p) => fake.fs.get(p)?.type === 'dir'
const children = (dir) => [...fake.fs.keys()].filter((k) => parentOf(k) === dir)
const rmrf = (p) => { for (const k of [...fake.fs.keys()]) if (k === p || k.startsWith(p + '/')) fake.fs.delete(k) }
const mv = (src, dst) => { for (const k of [...fake.fs.keys()]) if (k === src || k.startsWith(src + '/')) { fake.fs.set(dst + k.slice(src.length), fake.fs.get(k)); fake.fs.delete(k) } }
const WP_TREE = ['index.php', 'wp-activate.php', 'wp-blog-header.php', 'wp-comments-post.php', 'wp-config-sample.php', 'wp-cron.php', 'wp-links-opml.php', 'wp-load.php', 'wp-login.php', 'wp-mail.php', 'wp-settings.php', 'wp-signup.php', 'wp-trackback.php', 'xmlrpc.php', 'license.txt', 'readme.html', 'wp-admin', 'wp-content', 'wp-includes']
const SPA = '# BEGIN SPA Fallback (auto)\n<IfModule mod_rewrite.c>\nRewriteRule ^ /index.html [L]\n</IfModule>\n# END SPA Fallback (auto)'
function seedHome(user, { htaccess = `# Anti-Red rules\nRewriteEngine On\n\n${SPA}\n`, indexHtml = true } = {}) {
  rmrf(`/home/${user}`)
  fake.fs.set(`/home/${user}`, { type: 'dir' })
  fake.fs.set(`/home/${user}/public_html`, { type: 'dir' })
  fake.fs.set(`/home/${user}/public_html/cgi-bin`, { type: 'dir' })
  if (htaccess != null) fake.fs.set(`/home/${user}/public_html/.htaccess`, { type: 'file', content: htaccess })
  if (indexHtml) fake.fs.set(`/home/${user}/public_html/index.html`, { type: 'file', content: '<h1>Coming soon</h1>' })
}
const OK = { status: 1, errors: null }
const bad = (m) => ({ status: 0, errors: [m] })
function uapiImpl(user, mod, func, p = {}) {
  fake.calls.push({ user, key: `${mod}::${func}`, p })
  if (mod === 'Mysql') {
    if (func === 'create_database') {
      const mine = [...fake.dbs].filter((d) => d.startsWith(user + '_')).length
      if (fake.dbQuota[user] != null && mine >= fake.dbQuota[user]) return bad('You have reached the maximum allowed number of databases.')
      if (!p.name.startsWith(user + '_')) return bad('bad prefix')
      fake.dbs.add(p.name); return OK
    }
    if (func === 'delete_database') { fake.dbs.delete(p.name); return OK }
    if (func === 'create_user') { fake.users.add(p.name); return OK }
    if (func === 'delete_user') { fake.users.delete(p.name); return OK }
    if (func === 'set_privileges_on_database') { fake.grants.push(p); return OK }
    if (func === 'list_databases') return { status: 1, data: [...fake.dbs].filter((d) => d.startsWith(user + '_')).map((d) => ({ database: d })) }
  }
  if (mod === 'Fileman') {
    if (func === 'list_files') return isDir(p.dir) ? { status: 1, data: children(p.dir).map((k) => ({ file: baseName(k), type: fake.fs.get(k).type })) } : bad('No such directory')
    if (func === 'get_file_content') { const f = fake.fs.get(`${p.dir}/${p.file}`); return f && f.type === 'file' ? { status: 1, data: { content: String(f.content) } } : bad('No such file') }
    if (func === 'save_file_content') { if (!isDir(p.dir)) return bad('No such directory'); fake.fs.set(`${p.dir}/${p.file}`, { type: 'file', content: p.content }); return OK }
  }
  return bad(`unsupported ${mod}::${func}`)
}
function api2Impl(user, func, p = {}) {
  fake.calls.push({ user, key: `Fileman2::${func}:${p.op || ''}`, p })
  if (func === 'mkdir') { if (!isDir(p.path)) return bad('parent missing'); if (!fake.fs.has(`${p.path}/${p.name}`)) fake.fs.set(`${p.path}/${p.name}`, { type: 'dir' }); return OK }
  const src = p.sourcefiles
  const dst = p.destfiles
  if (p.op === 'extract') {
    if (!fake.fs.has(src)) return bad('archive missing')
    fake.fs.set(`${dst}/wordpress`, { type: 'dir' })
    for (const n of WP_TREE) fake.fs.set(`${dst}/wordpress/${n}`, /\./.test(n) ? { type: 'file', content: `<?php // ${n}` } : { type: 'dir' })
    return OK
  }
  if (p.op === 'move' || p.op === 'rename') { if (!fake.fs.has(src)) return bad('source missing'); if (fake.fs.has(dst)) return bad('destination exists'); mv(src, dst); return OK }
  if (p.op === 'unlink' || p.op === 'trash') { if (!fake.fs.has(src)) return bad('missing'); rmrf(src); return OK }
  return bad('unsupported op')
}
const authFail = (user) => (fake.authFail.has(user) ? { status: 0, errors: ['login page'], code: 'CPANEL_AUTH_FAILURE' } : null)
const cpMock = stubProxy({
  uapi: async (user, pass, mod, func, p) => authFail(user) || uapiImpl(user, mod, func, p),
  api2: async (user, pass, mod, func, p) => authFail(user) || api2Impl(user, func, p),
  uapiViaWhmRoot: async (user, mod, func, p) => { fake.rootCalls++; return uapiImpl(user, mod, func, p) },
  api2ViaWhmRoot: async (user, mod, func, p) => { fake.rootCalls++; return api2Impl(user, func, p) },
  uploadFile: async (user, pass, dir, name, buf) => authFail(user) || (isDir(dir) ? (fake.fs.set(`${dir}/${name}`, { type: 'file', content: buf }), OK) : bad('No such directory')),
  uploadFileViaSession: async (user, dir, name, buf) => { fake.rootCalls++; fake.fs.set(`${dir}/${name}`, { type: 'file', content: buf }); return OK },
  listDatabases: async (user) => uapiImpl(user, 'Mysql', 'list_databases'),
  listDatabaseUsers: async () => ({ status: 1, data: [] }),
  createDatabase: async (user, pass, name) => uapiImpl(user, 'Mysql', 'create_database', { name }),
})
const bypass = {}
const bypassCalls = []
const antiRedMock = stubProxy({ setDomainChallengeBypass: async (d, on) => { bypassCalls.push([d, on]); bypass[d] = on; return { success: true } } })
mockModule('cpanel-proxy.js', cpMock)
mockModule('anti-red-service.js', antiRedMock)
mockModule('whm-service.js', stubProxy({ getAccountInfo: async () => ({ success: true, data: { suspended: 0 } }), generateUsername: (d) => String(d).replace(/[^a-z]/g, '').slice(0, 8), _whmApi: null }))
mockModule('cr-register-domain-&-create-cpanel.js', { registerDomainAndCreateCpanel: async () => ({ success: true }) })
mockModule('op-service.js', stubProxy({}))

const express = require('express')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const wp = require('../wordpress-installer')
const apps = require('../hosting-apps')
const analytics = require('../reseller-shortener-analytics')
const cpAuth = require('../cpanel-auth')
const { createResellerApi } = require('../reseller-api')
const { createCpanelRoutes } = require('../cpanel-routes')

let passed = 0
let failed = 0
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) } catch (e) { failed++; console.log(`  ❌ ${name}\n     ${(e.stack || String(e)).split('\n').slice(0, 4).join('\n     ')}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b64d = (s) => Buffer.from(s, 'base64').toString('utf8')

// Fake web: WordPress zip + salts + the one-time setup/reset PHP requests through "the edge".
const WP_ZIP = process.env.WORDPRESS_ZIP_URL || 'https://wordpress.org/latest.zip'
const SALTS = ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'].map((k) => `define('${k}', 'salt-${k}-xyz');`).join('\n')
function fakeSite(domain, file, headers) {
  fake.http.push({ domain, file, headers })
  if (fake.challenge.has(domain) && !bypass[domain]) return '<html><title>Verifying your browser</title></html>'
  const key = [...fake.fs.keys()].find((k) => k.endsWith('/' + file))
  if (!key) return '404'
  const php = String(fake.fs.get(key).content)
  const dir = parentOf(key)
  if (php.includes('wp_install(')) {
    if (!fake.fs.has(`${dir}/wp-config.php`)) return 'Error establishing a database connection'
    if (fake.failInstall.has(domain)) return 'WP_INSTALL_FAIL'
    const user = b64d(php.match(/wp_install\(base64_decode\('[^']*'\), base64_decode\('([^']*)'\)/)[1])
    fake.installed[dir] = { user }
    return 'WP_INSTALL_OK:6.8.3'
  }
  if (php.includes('wp_set_password(')) return fake.installed[dir] ? `WP_RESET_OK:${fake.installed[dir].user}` : 'WP_NO_ADMIN'
  return 'unknown'
}

;(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017')
  await client.connect()
  const DB = client.db(`test_phase4_${Date.now()}`)

  const got = []
  const hook = express()
  hook.use(express.json())
  hook.post('/a', (req, res) => { got.push(req.body); res.json({ ok: true }) })
  const hs = hook.listen(0)
  const HOOK = `http://127.0.0.1:${hs.address().port}`

  const OWNER = '880000771'
  const OTHER = '880000772'
  const KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const OTHER_KEY = `rsk_test_${crypto.randomBytes(12).toString('hex')}`
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
  await DB.collection('resellerApiKeys').insertMany([
    { _id: crypto.randomUUID(), keyHash: sha(KEY), enabled: true, ownerChatId: OWNER, label: 'k1', webhookUrl: `${HOOK}/a`, webhookSecret: 'whsec_test' },
    { _id: crypto.randomUUID(), keyHash: sha(OTHER_KEY), enabled: true, ownerChatId: OTHER, label: 'k2' },
  ])
  const enc = cpAuth.encrypt('Fake-Pass-1!')
  const creds = { cpPass_encrypted: enc.encrypted, cpPass_iv: enc.iv, cpPass_tag: enc.tag }
  const PREMIUM = 'Premium Anti-Red HostPanel (1-Month)'
  const WEEKLY = 'Premium Anti-Red (1-Week)'
  const acct = (id, o = {}) => ({ _id: id, cpUser: id, chatId: OWNER, domain: `${id}.com`, plan: PREMIUM, expiryDate: new Date(Date.now() + 10 * 86400000), ...creds, ...o })
  await DB.collection('cpanelAccounts').insertMany([
    acct('wpone'), acct('wpweek', { plan: WEEKLY }), acct('wpfail'), acct('wpsusp', { suspended: true }), acct('wpdead', { deleted: true }),
    acct('wpauth'), acct('wpdry'), acct('wppanel', { plan: WEEKLY }), acct('wpother', { chatId: OTHER }),
  ])
  for (const u of ['wpone', 'wpweek', 'wpfail', 'wpauth', 'wpdry', 'wppanel', 'wpunit', 'wpunit2', 'wpunit3']) seedHome(u)

  const app = express()
  app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => DB, log: () => {} }))
  app.use('/panel', createCpanelRoutes(() => DB.collection('cpanelAccounts'), { getDb: () => DB }))
  const srv = app.listen(0)
  const BASE = `http://127.0.0.1:${srv.address().port}`
  const http = axios.create({ baseURL: `${BASE}/reseller/v1`, validateStatus: () => true, headers: { Authorization: `Bearer ${KEY}` } })
  const httpOther = axios.create({ baseURL: `${BASE}/reseller/v1`, validateStatus: () => true, headers: { Authorization: `Bearer ${OTHER_KEY}` } })
  const panelFor = (user) => axios.create({ baseURL: `${BASE}/panel`, validateStatus: () => true, headers: { Authorization: `Bearer ${cpAuth.createToken({ cpUser: user, domain: `${user}.com`, chatId: OWNER })}` } })
  const raw = axios.create({ validateStatus: () => true, maxRedirects: 0 })

  // Fake web adapter (installed AFTER the test clients so they keep the real adapter).
  const realAdapter = axios.getAdapter(axios.defaults.adapter)
  axios.defaults.adapter = async (config) => {
    const url = String(config.url || '')
    const reply = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config, request: {} })
    if (url === WP_ZIP) return reply(Buffer.alloc(4096, 7))
    if (url.startsWith('https://api.wordpress.org/secret-key/')) return reply(SALTS)
    const m = url.match(/^https:\/\/([^/]+)\/(?:.*\/)?(wp-setup-[a-f0-9]+\.php)$/)
    if (m) return reply(fakeSite(m[1], m[2], config.headers || {}))
    return realAdapter(config)
  }
  const waitApp = async (user, id, client = http, ms = 5000) => {
    const end = Date.now() + ms
    let r
    while (Date.now() < end) { r = await client.get(`/hosting/${user}/apps/${id}`); if (r.data.state !== 'installing') return r; await sleep(40) }
    return r
  }
  const installer = wp.makeInstaller({ cp: cpMock, antiRed: antiRedMock, bypassWaitMs: 5 })
  const ctxOf = (u, o = {}) => ({ cpUser: u, cpPass: 'x', whmHost: null, domain: `${u}.com`, ...o })

  console.log('\n=== wordpress-installer helpers ===')
  await t('strongPassword: 24 chars, all classes, no quotes/backslashes', async () => {
    for (let i = 0; i < 30; i++) {
      const p = wp.strongPassword()
      assert.strictEqual(p.length, 24)
      assert.ok(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[!@#%^*\-_=+]/.test(p), p)
      assert.ok(!/['"\\$`]/.test(p), p)
    }
  })
  await t('paths: normPath / docRootFor / siteUrls', async () => {
    assert.strictEqual(wp.normPath('/blog/'), 'blog')
    assert.strictEqual(wp.normPath('public_html/shop'), 'shop')
    assert.strictEqual(wp.docRootFor('abc', ''), '/home/abc/public_html')
    assert.strictEqual(wp.docRootFor('abc', 'blog/en'), '/home/abc/public_html/blog/en')
    assert.deepStrictEqual(wp.siteUrls('x.com', '/blog'), { siteUrl: 'https://x.com/blog', adminUrl: 'https://x.com/blog/wp-admin/' })
  })
  await t('withWordPressBlock: appends the WP block, drops the auto SPA fallback, idempotent', async () => {
    const out = wp.withWordPressBlock(`# Anti-Red\n\n${SPA}\n`, '')
    assert.ok(out.startsWith('# Anti-Red') && out.includes('# BEGIN WordPress') && out.includes('RewriteBase /\n') && !out.includes('SPA Fallback'))
    assert.strictEqual(wp.withWordPressBlock(out, ''), null)
    assert.ok(wp.withWordPressBlock('', 'blog').includes('RewriteRule . /blog/index.php [L]'))
  })
  await t('bootstrap PHP base64-encodes every user value (no injection)', async () => {
    const php = wp.bootstrapPhp({ title: "x'); system('id'); //", user: 'admin_ab', email: 'a@b.co', password: 'p' })
    assert.ok(!php.includes("system('id')"))
    assert.ok(php.includes("define('WP_INSTALLING', true)") && php.includes('wp_install(base64_decode('))
  })

  console.log('\n=== wordpress-installer (fake cPanel) ===')
  await t('root install: DB + user + grant, core files placed, config + permalinks, placeholder kept, temp files gone', async () => {
    fake.calls = []; fake.http = []
    const r = await installer.installWordPress(ctxOf('wpunit'), { title: 'My Site', adminEmail: 'me@x.com' })
    const root = '/home/wpunit/public_html'
    assert.strictEqual(r.site_url, 'https://wpunit.com'); assert.strictEqual(r.admin_url, 'https://wpunit.com/wp-admin/')
    assert.ok(/^admin_[a-f0-9]{4}$/.test(r.admin_user)); assert.strictEqual(r.admin_password.length, 24)
    assert.strictEqual(r.version, '6.8.3'); assert.strictEqual(r.title, 'My Site'); assert.strictEqual(r.admin_email, 'me@x.com')
    assert.ok(fake.dbs.has(r.db_name) && fake.users.has(r.db_user) && r.db_name.startsWith('wpunit_wp') && r.db_name.length <= 16)
    assert.ok(fake.grants.some((g) => g.user === r.db_user && g.database === r.db_name && g.privileges === 'ALL PRIVILEGES'))
    for (const n of wp.WP_CORE_ENTRIES) assert.ok(fake.fs.has(`${root}/${n}`), n)
    assert.ok(!fake.fs.has(`${root}/wordpress`), 'nested dir removed')
    assert.ok(!children(root).some((k) => /wp-core-.*\.zip$|wp-setup-/.test(k)), 'zip + bootstrap removed')
    const cfg = String(fake.fs.get(`${root}/wp-config.php`).content)
    assert.ok(cfg.includes(`define( 'DB_NAME', '${r.db_name}' )`) && cfg.includes('salt-AUTH_KEY-xyz') && cfg.includes("require_once ABSPATH . 'wp-settings.php'"))
    const ht = String(fake.fs.get(`${root}/.htaccess`).content)
    assert.ok(ht.startsWith('# Anti-Red rules') && ht.includes('# BEGIN WordPress') && !ht.includes('SPA Fallback'))
    assert.ok(fake.fs.has(`${root}/index.html.pre-wordpress`) && !fake.fs.has(`${root}/index.html`))
    assert.strictEqual(fake.installed[root].user, r.admin_user)
    const h = fake.http.find((x) => x.domain === 'wpunit.com').headers
    assert.strictEqual(h['Sec-Fetch-Site'], 'same-origin'); assert.ok(/Chrome\//.test(h['User-Agent']))
  })
  await t('sub-folder install creates the folder and uses /blog/ rewrite base', async () => {
    const r = await installer.installWordPress(ctxOf('wpunit2'), { path: 'blog/en' })
    assert.strictEqual(r.site_url, 'https://wpunit2.com/blog/en')
    assert.ok(isDir('/home/wpunit2/public_html/blog/en') && fake.fs.has('/home/wpunit2/public_html/blog/en/wp-login.php'))
    assert.ok(String(fake.fs.get('/home/wpunit2/public_html/blog/en/.htaccess').content).includes('RewriteBase /blog/en/'))
    assert.ok(fake.fs.has('/home/wpunit2/public_html/index.html'), 'root placeholder untouched')
  })
  await t('docroot_not_empty: existing WordPress/index.php blocks before any DB is created', async () => {
    const before = fake.dbs.size
    await assert.rejects(installer.installWordPress(ctxOf('wpunit')), (e) => e.code === 'docroot_not_empty')
    assert.strictEqual(fake.dbs.size, before)
  })
  await t('setup failure → challenge bypass retried + restored, everything rolled back', async () => {
    seedHome('wpunit3'); fake.challenge.add('wpunit3.com'); fake.failInstall.add('wpunit3.com'); bypassCalls.length = 0
    const dbBefore = new Set(fake.dbs)
    await assert.rejects(installer.installWordPress(ctxOf('wpunit3')), (e) => e.code === 'wp_install_failed')
    assert.deepStrictEqual(bypassCalls, [['wpunit3.com', true], ['wpunit3.com', false]])
    assert.deepStrictEqual([...fake.dbs], [...dbBefore], 'database dropped')
    assert.ok(![...fake.users].some((u) => u.startsWith('wpunit3_')), 'db user dropped')
    assert.deepStrictEqual(children('/home/wpunit3/public_html').map(baseName).sort(), ['.htaccess', 'cgi-bin', 'index.html'])
    fake.failInstall.delete('wpunit3.com')
  })
  await t('challenge only → bypass makes the setup succeed; prior bypass is kept on', async () => {
    bypassCalls.length = 0; bypass['wpunit3.com'] = false
    const r = await installer.installWordPress(ctxOf('wpunit3', { priorBypass: true }))
    assert.ok(r.admin_user)
    assert.deepStrictEqual(bypassCalls, [['wpunit3.com', true]], 'not switched back off when the owner had it on')
    fake.challenge.delete('wpunit3.com')
  })
  await t('stale cPanel password → WHM-root fallback is used for every step', async () => {
    seedHome('wpunit3'); fake.authFail.add('wpunit3'); fake.rootCalls = 0
    const r = await installer.installWordPress(ctxOf('wpunit3'))
    assert.ok(r.admin_user && fake.rootCalls > 10)
    fake.authFail.delete('wpunit3')
  })
  await t('resetAdminPassword: new password for the installed admin; WP_NO_ADMIN mapped', async () => {
    const r = await installer.resetAdminPassword(ctxOf('wpunit'), { docRoot: '/home/wpunit/public_html', siteUrl: 'https://wpunit.com', adminUser: 'x' })
    assert.strictEqual(r.admin_user, fake.installed['/home/wpunit/public_html'].user); assert.strictEqual(r.admin_password.length, 24)
    await assert.rejects(installer.resetAdminPassword(ctxOf('wpunit2'), { docRoot: '/home/wpunit2/public_html', siteUrl: 'https://wpunit2.com' }), (e) => e.code === 'no_admin_user')
    assert.ok(!children('/home/wpunit/public_html').some((k) => /wp-setup-/.test(k)))
  })

  console.log('\n=== hosting-apps validation ===')
  await t('parseInstallBody rejects bad app / path / email', async () => {
    const code = (b) => { try { apps.parseInstallBody(b); return 'ok' } catch (e) { return e.code } }
    assert.strictEqual(code({ app: 'joomla' }), 'invalid_app')
    for (const p of ['../etc', 'a/../b', '.hidden', 'cgi-bin', 'blog?x', 'a//b', 'x'.repeat(65)]) assert.strictEqual(code({ path: p }), 'invalid_path', p)
    assert.strictEqual(code({ admin_email: 'nope' }), 'invalid_email')
    assert.deepStrictEqual(apps.parseInstallBody({ path: '/Blog/', title: ' T ' }), { app: 'wordpress', path: 'Blog', adminEmail: null, title: 'T' })
  })

  console.log('\n=== reseller API · /hosting/:user/apps ===')
  let wpId
  await t('GET apps: catalog + empty list; other owner → 404', async () => {
    const r = await http.get('/hosting/wpone/apps')
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.data.catalog[0].app, 'wordpress'); assert.deepStrictEqual(r.data.apps, [])
    assert.strictEqual((await httpOther.get('/hosting/wpone/apps')).status, 404)
  })
  await t('POST validation: 400 invalid_path / invalid_app, 409 suspended / terminated, 404 unknown', async () => {
    assert.strictEqual((await http.post('/hosting/wpone/apps', { path: '../x' })).data.error, 'invalid_path')
    assert.strictEqual((await http.post('/hosting/wpone/apps', { app: 'drupal' })).data.error, 'invalid_app')
    const s = await http.post('/hosting/wpsusp/apps', {}); assert.strictEqual(s.status, 409); assert.strictEqual(s.data.error, 'account_suspended')
    assert.strictEqual((await http.post('/hosting/wpdead/apps', {})).data.error, 'account_terminated')
    assert.strictEqual((await http.post('/hosting/nobody/apps', {})).status, 404)
  })
  await t('POST live → 202 installing → ready with admin password; list hides it', async () => {
    const r = await http.post('/hosting/wpone/apps', { title: 'Shop', admin_email: 'owner@wpone.com' })
    assert.strictEqual(r.status, 202, JSON.stringify(r.data))
    assert.strictEqual(r.data.mode, 'live'); assert.strictEqual(r.data.state, 'installing')
    assert.strictEqual(r.data.site_url, 'https://wpone.com'); assert.strictEqual(r.data.poll_url, `/hosting/wpone/apps/${r.data.id}`)
    wpId = r.data.id
    const d = await waitApp('wpone', wpId)
    assert.strictEqual(d.data.state, 'ready', JSON.stringify(d.data))
    assert.strictEqual(d.data.admin_password.length, 24); assert.strictEqual(d.data.title, 'Shop'); assert.strictEqual(d.data.version, '6.8.3')
    assert.strictEqual(d.data.admin_user, fake.installed['/home/wpone/public_html'].user)
    const l = await http.get('/hosting/wpone/apps')
    assert.strictEqual(l.data.apps.length, 1); assert.strictEqual(l.data.apps[0].admin_password, undefined)
  })
  await t('webhook hosting.app_installed + activity log (api start + completion)', async () => {
    await sleep(150)
    const ev = got.find((e) => e.event === 'hosting.app_installed')
    assert.ok(ev, JSON.stringify(got.map((e) => e.event)))
    assert.strictEqual(ev.data.app_id, wpId); assert.strictEqual(ev.data.site_url, 'https://wpone.com')
    const acts = await DB.collection('resellerActivity').find({ resourceId: 'wpone' }).toArray()
    assert.ok(acts.some((a) => a.action === 'app.install.wordpress' && a.actor === 'api'), JSON.stringify(acts.map((a) => a.action)))
    assert.ok(acts.some((a) => a.action === 'app.installed' && a.actor === 'api'))
  })
  await t('duplicate at the same path → 409 app_exists; another path installs fine', async () => {
    const dup = await http.post('/hosting/wpone/apps', {})
    assert.strictEqual(dup.status, 409); assert.strictEqual(dup.data.error, 'app_exists'); assert.strictEqual(dup.data.app.id, wpId)
    const b = await http.post('/hosting/wpone/apps', { path: 'blog' })
    assert.strictEqual(b.status, 202)
    assert.strictEqual((await waitApp('wpone', b.data.id)).data.state, 'ready')
  })
  await t('admin-password reset → new password stored + returned; old one replaced', async () => {
    const before = (await http.get(`/hosting/wpone/apps/${wpId}`)).data.admin_password
    const r = await http.post(`/hosting/wpone/apps/${wpId}/admin-password`)
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.ok(r.data.admin_password && r.data.admin_password !== before)
    assert.strictEqual((await http.get(`/hosting/wpone/apps/${wpId}`)).data.admin_password, r.data.admin_password)
    assert.strictEqual((await http.post('/hosting/wpone/apps/wp_nope/admin-password')).status, 404)
  })
  await t('database quota reached → state failed (db_create_failed), retry allowed after freeing it', async () => {
    fake.dbQuota.wpfail = 0
    const r = await http.post('/hosting/wpfail/apps', {})
    const d = await waitApp('wpfail', r.data.id)
    assert.strictEqual(d.data.state, 'failed'); assert.ok(/^db_create_failed/.test(d.data.error), d.data.error)
    assert.strictEqual((await http.post(`/hosting/wpfail/apps/${r.data.id}/admin-password`)).data.error, 'app_not_ready')
    await sleep(100)
    assert.ok(got.some((e) => e.event === 'hosting.app_install_failed' && e.data.reason === 'db_create_failed'))
    delete fake.dbQuota.wpfail
    const again = await http.post('/hosting/wpfail/apps', {})
    assert.strictEqual(again.status, 202)
    assert.strictEqual((await waitApp('wpfail', again.data.id)).data.state, 'ready')
  })
  await t('weekly plan can install WordPress (MySQL open to weekly)', async () => {
    const r = await http.post('/hosting/wpweek/apps', {})
    assert.strictEqual(r.status, 202)
    assert.strictEqual((await waitApp('wpweek', r.data.id)).data.state, 'ready')
  })
  await t('interrupted install (>30 min "installing") is released and can be retried', async () => {
    await DB.collection('hostingApps').insertOne({ _id: 'wp_stale', username: 'wpauth', chatId: OWNER, app: 'wordpress', path: '', state: 'installing', stage: 'files', liveKey: 'wpauth|', createdAt: new Date(Date.now() - 31 * 60000) })
    const r = await http.post('/hosting/wpauth/apps', {})
    assert.strictEqual(r.status, 202, JSON.stringify(r.data))
    const stale = (await http.get('/hosting/wpauth/apps/wp_stale')).data
    assert.strictEqual(stale.state, 'failed'); assert.ok(/install_interrupted/.test(stale.error))
    await waitApp('wpauth', r.data.id)
  })
  await t('dry-run pod → 202 mode dry_run, nothing touched, path not blocked', async () => {
    process.env.RESELLER_API_LIVE = ''
    const n = fake.calls.length
    const r = await http.post('/hosting/wpdry/apps', { path: 'x' })
    assert.strictEqual(r.status, 202); assert.strictEqual(r.data.mode, 'dry_run'); assert.strictEqual(r.data.state, 'dry_run')
    assert.strictEqual((await http.post('/hosting/wpdry/apps', { path: 'x' })).status, 202, 'dry runs never reserve the path')
    assert.strictEqual(fake.calls.length, n)
    process.env.RESELLER_API_LIVE = 'true'
  })

  console.log('\n=== MySQL on the weekly plan ===')
  await t('reseller API: weekly account can use /mysql (no 403 mysql_requires_monthly)', async () => {
    const r = await http.get('/hosting/wpweek/mysql/databases')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.status, 1)
    const c = await http.post('/hosting/wpweek/mysql/databases', { name: 'wpweek_extra' })
    assert.notStrictEqual(c.status, 403)
  })
  await t('HostPanel: weekly account can list databases', async () => {
    const r = await panelFor('wppanel').get('/mysql/databases')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
  })
  await t('plan limits: weekly 2 · premium 5 · golden unlimited; plan catalog advertises it', async () => {
    const src = require('fs').readFileSync(path.resolve(__dirname, '../whm-service.js'), 'utf8')
    assert.ok(/'Premium-Anti-Red-1-Week': 2,/.test(src) && /'Premium-Anti-Red-HostPanel-1-Month': 5,/.test(src) && /'Golden-Anti-Red-HostPanel-1-Month': -1,/.test(src))
    const plans = (await http.get('/hosting/plans')).data.plans
    const wk = plans.find((p) => p.plan_id === 'premium-weekly')
    assert.ok(JSON.stringify(wk).includes('2 MySQL databases'), JSON.stringify(wk))
  })
  await t('MAXSQL migration: weekly package + weekly accounts raised to 2, once', async () => {
    const calls = []
    const whm = express()
    whm.get('/json-api/:fn', (req, res) => { calls.push({ fn: req.params.fn, ...req.query }); res.json({ metadata: { result: 1 } }) })
    const ws = whm.listen(0)
    const saved = { url: process.env.WHM_API_URL, tok: process.env.WHM_TOKEN }
    process.env.WHM_API_URL = `http://127.0.0.1:${ws.address().port}`; process.env.WHM_TOKEN = 'test'
    await DB.collection('migrations').insertOne({ _id: 'raise_maxsql_premium_monthly_v1', completedAt: new Date() })
    const { runMaxsqlMigration } = require('../maxsql-migration')
    const quiet = { log: console.log, warn: console.warn }; console.log = () => {}; console.warn = () => {}
    try {
      await runMaxsqlMigration(() => DB)
      const first = calls.length
      await runMaxsqlMigration(() => DB)
      assert.strictEqual(calls.length, first, 'second run is a no-op')
    } finally { Object.assign(console, quiet); ws.close(); process.env.WHM_API_URL = saved.url; process.env.WHM_TOKEN = saved.tok }
    const pkg = calls.find((c) => c.fn === 'modifypkg')
    assert.deepStrictEqual([pkg.name, pkg.MAXSQL], ['Premium-Anti-Red-1-Week', '2'])
    const users = calls.filter((c) => c.fn === 'modifyacct').map((c) => c.user).sort()
    assert.deepStrictEqual(users, ['wppanel', 'wpweek'])
    assert.ok((await DB.collection('migrations').findOne({ _id: 'raise_maxsql_premium_weekly_v1' })).completedAt)
  })

  console.log('\n=== HostPanel · Apps tab routes ===')
  const panel = panelFor('wppanel')
  let panelAppId
  await t('dev sandbox → install is recorded as dry_run (live:false); list shows it', async () => {
    const r = await panel.post('/apps', { title: 'Panel Site' })
    assert.strictEqual(r.status, 202, JSON.stringify(r.data))
    assert.strictEqual(r.data.live, false); assert.strictEqual(r.data.app.state, 'dry_run')
    const l = await panel.get('/apps')
    assert.strictEqual(l.data.live, false); assert.strictEqual(l.data.domain, 'wppanel.com'); assert.strictEqual(l.data.apps[0].title, 'Panel Site')
  })
  await t('live panel install → ready; GET shows admin login; reset gives a new password; activity actor "panel"', async () => {
    process.env.SKIP_WEBHOOK_SYNC = ''
    try {
      const r = await panel.post('/apps', { path: 'site' })
      assert.strictEqual(r.status, 202); assert.strictEqual(r.data.app.state, 'installing')
      panelAppId = r.data.app.id
      let d
      for (let i = 0; i < 100; i++) { d = await panel.get(`/apps/${panelAppId}`); if (d.data.app.state !== 'installing') break; await sleep(40) }
      assert.strictEqual(d.data.app.state, 'ready', JSON.stringify(d.data))
      assert.strictEqual(d.data.app.admin_password.length, 24)
      const reset = await panel.post(`/apps/${panelAppId}/admin-password`)
      assert.strictEqual(reset.status, 200); assert.ok(reset.data.admin_password && reset.data.admin_password !== d.data.app.admin_password)
      const acts = await DB.collection('resellerActivity').find({ resourceId: 'wppanel', actor: 'panel' }).toArray()
      assert.deepStrictEqual(acts.map((a) => a.action).sort(), ['app.admin_password_reset', 'app.install.wordpress', 'app.installed'])
    } finally { process.env.SKIP_WEBHOOK_SYNC = 'true' }
  })
  await t('panel errors are readable: duplicate path 409, bad path 400, foreign app 404, no token 401', async () => {
    process.env.SKIP_WEBHOOK_SYNC = ''
    try {
      const dup = await panel.post('/apps', { path: 'site' })
      assert.strictEqual(dup.status, 409); assert.ok(/already/.test(dup.data.error)); assert.strictEqual(dup.data.code, 'app_exists')
    } finally { process.env.SKIP_WEBHOOK_SYNC = 'true' }
    const badPath = await panel.post('/apps', { path: '../../etc' })
    assert.strictEqual(badPath.status, 400); assert.strictEqual(badPath.data.code, 'invalid_path')
    assert.strictEqual((await panel.get(`/apps/${wpId}`)).status, 404)
    assert.strictEqual((await raw.get(`${BASE}/panel/apps`)).status, 401)
  })
  await t('panel reset on a dry-run sandbox returns dryRun without touching the site', async () => {
    const r = await panel.post(`/apps/${panelAppId}/admin-password`)
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.dryRun, true)
  })

  console.log('\n=== short-link analytics / routing helpers ===')
  await t('parseClick: CF country, device classes, referrer host', async () => {
    const c = analytics.parseClick({ headers: { 'cf-ipcountry': 'de', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', referer: 'https://www.t.co/abc' } })
    assert.deepStrictEqual(c, { country: 'DE', device: 'mobile', referrer: 't.co' })
    assert.strictEqual(analytics.deviceFromUA('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'tablet')
    assert.strictEqual(analytics.deviceFromUA('curl/8.0'), 'bot')
    assert.strictEqual(analytics.deviceFromUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'), 'desktop')
    assert.deepStrictEqual(analytics.parseClick({ headers: {} }), { country: 'XX', device: 'unknown', referrer: 'direct' })
  })
  await t('parseRouting validation + resolveRouting first-match / default', async () => {
    assert.strictEqual(analytics.parseRouting({ targets: [{ country: 'DEU', url: 'https://a.com' }] }).error, 'invalid_country')
    assert.strictEqual(analytics.parseRouting({ targets: [{ device: 'watch', url: 'https://a.com' }] }).error, 'invalid_device')
    assert.strictEqual(analytics.parseRouting({ targets: [{ url: 'https://a.com' }] }).error, 'invalid_target')
    assert.strictEqual(analytics.parseRouting({ targets: [{ country: 'DE', url: 'ftp://x' }] }).error, 'invalid_target')
    assert.strictEqual(analytics.parseRouting({ targets: [], default: 'nope' }).error, 'invalid_default')
    const { rules } = analytics.parseRouting({ targets: [{ country: 'de', device: 'Mobile', url: 'https://de-m.com' }, { country: 'DE', url: 'https://de.com' }, { device: 'desktop', url: 'https://desk.com' }], default: 'https://def.com' })
    assert.strictEqual(analytics.resolveRouting(rules, { country: 'DE', device: 'mobile' }), 'https://de-m.com')
    assert.strictEqual(analytics.resolveRouting(rules, { country: 'DE', device: 'desktop' }), 'https://de.com')
    assert.strictEqual(analytics.resolveRouting(rules, { country: 'US', device: 'desktop' }), 'https://desk.com')
    assert.strictEqual(analytics.resolveRouting(rules, { country: 'US', device: 'mobile' }), 'https://def.com')
    assert.strictEqual(analytics.resolveRouting({ targets: [{ country: 'FR', url: 'https://fr.com' }] }, { country: 'US' }), null)
  })

  console.log('\n=== reseller API · shortener stats / routing / QR ===')
  const SD = 'go.p4short.test'
  await DB.collection('shortenerActivations').insertOne({ _id: SD, domain: SD, chatId: OWNER, status: 'completed' })
  const mk = async (alias, url = 'https://example.com/landing') => (await http.post('/shortener/links', { domain: SD, url, alias })).data
  const click = (key, hdr, when) => analytics.recordClick(DB, key, { headers: hdr }, when)
  await t('create links; "stats" is a reserved alias', async () => {
    assert.strictEqual((await mk('promo')).short_url, `https://${SD}/promo`)
    await mk('second')
    const r = await http.post('/shortener/links', { domain: SD, url: 'https://e.com/x', alias: 'stats' })
    assert.strictEqual(r.status, 409); assert.strictEqual(r.data.error, 'reserved_alias')
  })
  const KP = `${SD}/promo`.replaceAll('.', '@')
  const K2 = `${SD}/second`.replaceAll('.', '@')
  await t('per-link stats: totals + by_day / country / device / referrer', async () => {
    const y = new Date(Date.now() - 86400000)
    await click(KP, { 'cf-ipcountry': 'US', 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', referer: 'https://t.co/x' })
    await click(KP, { 'cf-ipcountry': 'US', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' })
    await click(KP, { 'cf-ipcountry': 'DE', 'user-agent': 'Mozilla/5.0 (Android 14; Mobile)' }, y)
    await click(K2, { 'cf-ipcountry': 'FR', 'user-agent': 'curl/8' })
    const r = await http.get('/shortener/links/promo/stats', { params: { domain: SD } })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.strictEqual(r.data.total_clicks, 3); assert.strictEqual(r.data.by_day.length, 2)
    assert.deepStrictEqual(r.data.by_country[0], { name: 'US', clicks: 2 })
    assert.deepStrictEqual(r.data.by_device.find((d) => d.name === 'mobile'), { name: 'mobile', clicks: 2 })
    assert.ok(r.data.by_referrer.some((x) => x.name === 't.co' && x.clicks === 1) && r.data.by_referrer.some((x) => x.name === 'direct' && x.clicks === 2))
    assert.strictEqual((await http.get('/shortener/links/promo/stats', { params: { domain: SD, days: 1 } })).data.by_day.length <= 2, true)
  })
  await t('bulk stats is not shadowed by /links/:slug and sorts by clicks', async () => {
    const r = await http.get('/shortener/links/stats')
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.strictEqual(r.data.count, 2); assert.strictEqual(r.data.total_clicks, 4)
    assert.deepStrictEqual(r.data.links.map((l) => [l.slug, l.total_clicks]), [['promo', 3], ['second', 1]])
    assert.strictEqual((await http.get('/shortener/links/stats', { params: { domain: 'bad domain' } })).status, 400)
    assert.strictEqual((await httpOther.get('/shortener/links/stats')).data.count, 0)
  })
  await t('routing: set → stored; invalid → 400; other owner → 404; null clears', async () => {
    const body = { domain: SD, routing: { targets: [{ country: 'DE', url: 'https://example.de/' }, { device: 'mobile', url: 'https://m.example.com/' }], default: 'https://example.com/other' } }
    const r = await http.put('/shortener/links/promo/routing', body)
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.routing.targets.length, 2)
    const meta = await DB.collection('shortenerLinks').findOne({ _id: KP })
    assert.strictEqual(meta.ownerChatId, OWNER); assert.strictEqual(meta.routing.default, 'https://example.com/other')
    assert.strictEqual((await http.put('/shortener/links/promo/routing', { domain: SD, routing: { targets: [{ country: 'Germany', url: 'https://x.de' }] } })).data.error, 'invalid_country')
    assert.strictEqual((await httpOther.put('/shortener/links/promo/routing', body)).status, 404)
    const c = await http.put('/shortener/links/second/routing', { domain: SD, routing: { targets: [{ device: 'desktop', url: 'https://d.com/' }] } })
    assert.strictEqual(c.status, 200)
    const cleared = await http.put('/shortener/links/second/routing', { domain: SD, routing: null })
    assert.strictEqual(cleared.data.routing, null)
    assert.strictEqual((await DB.collection('shortenerLinks').findOne({ _id: K2 })).routing, undefined)
  })
  await t('QR: PNG (size clamp) + SVG; bad format 400; foreign link 404', async () => {
    const png = await http.get('/shortener/links/promo/qr', { params: { domain: SD, size: 5000 }, responseType: 'arraybuffer' })
    assert.strictEqual(png.status, 200); assert.strictEqual(png.headers['content-type'], 'image/png')
    const buf = Buffer.from(png.data)
    assert.strictEqual(buf.slice(1, 4).toString(), 'PNG'); assert.strictEqual(buf.readUInt32BE(16), 1024)
    const svg = await http.get('/shortener/links/promo/qr', { params: { domain: SD, format: 'svg' } })
    assert.ok(/image\/svg\+xml/.test(svg.headers['content-type']) && String(svg.data).includes('<svg'))
    assert.strictEqual((await http.get('/shortener/links/promo/qr', { params: { domain: SD, format: 'gif' } })).status, 400)
    assert.strictEqual((await httpOther.get('/shortener/links/promo/qr', { params: { domain: SD } })).status, 404)
  })
  await t('rename keeps routing + migrates stats; delete removes stats', async () => {
    const r = await http.post('/shortener/links/promo/rename', { domain: SD, new_slug: 'promo2' })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    const K3 = `${SD}/promo2`.replaceAll('.', '@')
    assert.strictEqual((await DB.collection('shortenerLinks').findOne({ _id: K3 })).routing.targets.length, 2)
    assert.strictEqual((await http.get('/shortener/links/promo2/stats', { params: { domain: SD } })).data.total_clicks, 3)
    assert.strictEqual(await DB.collection(analytics.COLLECTION).countDocuments({ key: KP }), 0)
    await http.delete('/shortener/links/promo2', { params: { domain: SD } })
    assert.strictEqual(await DB.collection(analytics.COLLECTION).countDocuments({ key: K3 }), 0)
  })

  console.log('\n=== redirect E2E (local bot :5000, local DB) ===')
  const live = await raw.get('http://127.0.0.1:5000/health').catch(() => null)
  if (!live || live.status !== 200) console.log('  ⏭️  local bot not reachable — skipped')
  else {
    const LDB = client.db(process.env.DB_NAME)
    const host = 'go.p4e2e.test'
    const slug = `e2e${crypto.randomBytes(3).toString('hex')}`
    const key = `${host}/${slug}`.replaceAll('.', '@')
    const bkey = `${host}/b${slug}`.replaceAll('.', '@')
    await LDB.collection('fullUrlOf').insertMany([{ _id: key, val: 'https://base.example.com/' }, { _id: bkey, val: 'https://bot.example.com/' }])
    await LDB.collection('shortenerLinks').insertOne({ _id: key, ownerChatId: OWNER, domain: host, slug, routing: { targets: [{ country: 'DE', url: 'https://de.example.com/' }] } })
    try {
      await t('API link: DE visitor routed + click recorded; others get the base url', async () => {
        const de = await raw.get(`http://127.0.0.1:5000/${slug}`, { headers: { Host: host, 'CF-IPCountry': 'DE', 'User-Agent': 'Mozilla/5.0 (iPhone) Mobile' } })
        assert.strictEqual(de.status, 302); assert.strictEqual(de.headers.location, 'https://de.example.com/')
        const us = await raw.get(`http://127.0.0.1:5000/${slug}`, { headers: { Host: host, 'CF-IPCountry': 'US' } })
        assert.strictEqual(us.headers.location, 'https://base.example.com/')
        await sleep(300)
        const doc = await LDB.collection(analytics.COLLECTION).findOne({ key })
        assert.strictEqual(doc.total, 2); assert.strictEqual(doc.country.DE, 1); assert.strictEqual(doc.device.mobile, 1)
      })
      await t('bot/legacy link (no API metadata): plain redirect, no detailed stats', async () => {
        const r = await raw.get(`http://127.0.0.1:5000/b${slug}`, { headers: { Host: host, 'CF-IPCountry': 'DE' } })
        assert.strictEqual(r.headers.location, 'https://bot.example.com/')
        await sleep(200)
        assert.strictEqual(await LDB.collection(analytics.COLLECTION).countDocuments({ key: bkey }), 0)
      })
    } finally {
      await LDB.collection('fullUrlOf').deleteMany({ _id: { $in: [key, bkey] } })
      await LDB.collection('shortenerLinks').deleteOne({ _id: key })
      await LDB.collection('clicksOn').deleteMany({ _id: { $in: [key, bkey] } })
      await LDB.collection(analytics.COLLECTION).deleteMany({ key: { $in: [key, bkey] } })
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  await DB.dropDatabase().catch(() => {})
  await client.close()
  srv.close(); hs.close()
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
