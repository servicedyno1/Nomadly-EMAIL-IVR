// Hosting health check through the Cloudflare tunnel (2026-10-14 RCA): the module called WHM :2087 and the
// origin :443 DIRECTLY — both firewalled in production — so every call timed out, was swallowed, and every
// report said "Content: empty" / "Prepend: none" / "Origin: HTTP N/A" and re-deployed the IP-fix prepend.
// No network: axios + anti-red-service are stubbed.   node js/tests/test_healthcheck_tunnel_2026-10.js
const path = require('path')
const Module = require('module')

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''}`) } }

// ── fake WHM / web / Telegram ──
const FS = {} // user → { files: { name: content }, dirs: { name: { files } } }
const NET = { whmDown: false, webDown: false, created: [], directLookups: 0, telegram: [], whmCalls: 0 }
function whmGet(base, params) {
  NET.whmCalls++
  if (NET.whmDown) { const e = new Error('timeout of 30000ms exceeded'); e.code = 'ECONNABORTED'; return Promise.reject(e) }
  const u = FS[params.cpanel_jsonapi_user] || { files: {}, dirs: {} }
  if (params.cpanel_jsonapi_func === 'listfiles') {
    const rel = String(params.dir).replace(`/home/${params.cpanel_jsonapi_user}/public_html`, '').replace(/^\//, '')
    const node = rel ? (u.dirs[rel] || { files: {}, dirs: {} }) : u
    const list = params.types === 'dir' ? Object.keys(node.dirs || {}) : Object.keys(node.files || {})
    return Promise.resolve({ status: 200, data: { cpanelresult: { event: { result: 1 }, data: list.map(f => ({ file: f, type: params.types })) } } })
  }
  if (params.cpanel_jsonapi_func === 'get_file_content') {
    const c = u.files[params.file]
    return Promise.resolve({ status: 200, data: { result: c == null ? { status: 0, errors: ['File does not exist'], data: null } : { status: 1, errors: null, data: { content: c } } } })
  }
  return Promise.resolve({ status: 200, data: {} })
}
function fakeAxios(cfg) { // httpCheck → axios(requestConfig)
  if (cfg.httpsAgent && cfg.httpsAgent.options && typeof cfg.httpsAgent.options.lookup === 'function') NET.directLookups++
  if (NET.webDown) { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; return Promise.reject(e) }
  return Promise.resolve({ status: 200, data: '<html>' + 'x'.repeat(800) + '</html>', headers: {} })
}
fakeAxios.create = (defaults) => { NET.created.push(defaults); return { get: (url, { params }) => whmGet(defaults.baseURL, params) } }
fakeAxios.post = async (url, body) => { NET.telegram.push(body); return { data: { ok: true } } }
const AR = { ipFixDeploys: 0 }
const fakeAntiRed = { deployCFIPFix: async () => { AR.ipFixDeploys++; return { ok: true } }, deployHtaccess: async () => ({ ok: true }) }

function loadHealthCheck(env) {
  for (const k of ['WHM_HOST', 'WHM_TOKEN', 'WHM_API_URL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'TELEGRAM_DEV_CHAT_ID', 'TELEGRAM_BOT_TOKEN_PROD']) delete process.env[k]
  Object.assign(process.env, env)
  const hcPath = require.resolve('../hosting-health-check')
  delete require.cache[hcPath]
  require.cache[require.resolve('axios')].exports = fakeAxios
  const arPath = path.resolve(__dirname, '../anti-red-service.js')
  require.cache[arPath] = Object.assign(new Module(arPath), { filename: arPath, loaded: true, exports: fakeAntiRed })
  NET.created.length = 0
  return require('../hosting-health-check')
}
require('axios') // populate cache entry

const SITE = () => ({
  files: { '.htaccess': '# Anti-Red rules\nRewriteEngine On', '.user.ini': 'auto_prepend_file=/home/vabi2597/public_html/.antired-challenge.php', '.antired-challenge.php': "<?php define('ANTIRED_IP_FIXED',1); $_SERVER['REMOTE_ADDR']=$_SERVER['HTTP_CF_CONNECTING_IP'];", 'config.php': '<?php', 'index.php': '<?php echo 1;', 'telegram.php': '<?php' },
  dirs: {},
})

;(async () => {
  const TUNNEL = { WHM_HOST: '68.183.77.106', WHM_TOKEN: 'tok', WHM_API_URL: 'https://whm-api.example.io/', CF_ACCESS_CLIENT_ID: 'cid', CF_ACCESS_CLIENT_SECRET: 'csec', TELEGRAM_DEV_CHAT_ID: '5590563715', TELEGRAM_BOT_TOKEN_PROD: 'bot-tok' }
  let hc = loadHealthCheck(TUNNEL)

  console.log('\n── 1: routing (production = tunnel) ──')
  const c = NET.created[0] || {}
  ok('WHM calls go through WHM_API_URL (Cloudflare tunnel), not https://<WHM_HOST>:2087', c.baseURL === 'https://whm-api.example.io/json-api' && hc._routing.WHM_BASE === 'https://whm-api.example.io/json-api', c.baseURL)
  ok('CF Access service-token headers sent', c.headers && c.headers['CF-Access-Client-Id'] === 'cid' && c.headers['CF-Access-Client-Secret'] === 'csec' && /^whm root:tok$/.test(c.headers.Authorization), c.headers)
  ok('origin probes go via Cloudflare (no direct-IP lookup override)', hc._routing.ORIGIN_DIRECT_IP === null && hc._routing.ORIGIN_LABEL === 'Site (via Cloudflare tunnel)')

  console.log('\n── 2: the reported case — user uploaded index.php (vabi2597) ──')
  FS.vabi2597 = SITE()
  AR.ipFixDeploys = 0; NET.directLookups = 0
  let r = await hc.runHealthCheck('vabillaprepaid.com', 'vabi2597', 2)
  ok('Content found: public_html (index.php)', r.checks.content.location === 'public_html' && r.checks.content.contentPaths[0].indexFile === 'index.php', r.checks.content)
  ok('Prepend read as ip_fix → NO redundant "Deployed IP-fix prepend (was missing)"', r.checks.prepend.type === 'ip_fix' && AR.ipFixDeploys === 0 && !r.autoFixes.some(f => /IP-fix/.test(f)), { prepend: r.checks.prepend, fixes: r.autoFixes })
  ok('no "No user content found" warning', !r.warnings.some(w => /No user content/.test(w)), r.warnings)
  ok('site check HTTP 200 via Cloudflare, no direct-IP probe', r.checks.originRoot.status === 200 && NET.directLookups === 0, r.checks.originRoot)
  NET.telegram.length = 0
  let msg = await hc.reportResults('vabillaprepaid.com', 'vabi2597', '1', r, 2)
  ok('report: ✅, "Site (via Cloudflare tunnel): HTTP 200", "Content: public_html", "Prepend: ip_fix", no Auto-Fixes/Warnings', /^✅/.test(msg) && /Site \(via Cloudflare tunnel\):<\/b> HTTP 200/.test(msg) && /Content:<\/b> public_html/.test(msg) && /Prepend:<\/b> ip_fix/.test(msg) && !/Auto-Fixes|Warnings/.test(msg), msg)
  ok('report delivered to the admin chat', NET.telegram.length === 1 && NET.telegram[0].chat_id === '5590563715')

  console.log('\n── 3: WHM unreachable → "could not check", never "empty" / "missing" ──')
  NET.whmDown = true; AR.ipFixDeploys = 0
  r = await hc.runHealthCheck('vabillaprepaid.com', 'vabi2597', 2)
  ok('content → error (not "empty")', r.checks.content.error && r.checks.content.location !== 'empty', r.checks.content)
  ok('prepend → error (not "none") and NO IP-fix redeploy', r.checks.prepend.error && AR.ipFixDeploys === 0, r.checks.prepend)
  ok('warnings say "could not check", no "No user content found"', r.warnings.some(w => /Could not check uploaded files/.test(w)) && r.warnings.some(w => /Could not read the prepend config/.test(w)) && !r.warnings.some(w => /No user content/.test(w)), r.warnings)
  msg = await hc.reportResults('vabillaprepaid.com', 'vabi2597', '1', r, 2)
  ok('report shows "Content: could not check (…)" and "Prepend: could not check (…)"', /Content:<\/b> could not check \(timeout of 30000ms exceeded\)/.test(msg) && /Prepend:<\/b> could not check \(ECONNABORTED\)/.test(msg), msg)
  NET.whmDown = false

  console.log('\n── 4: genuinely empty / genuinely missing still reported ──')
  FS.empty01 = { files: { '.htaccess': '# Anti-Red', '.user.ini': 'auto_prepend_file=x', '.antired-challenge.php': 'ANTIRED_IP_FIXED' }, dirs: {} }
  r = await hc.runHealthCheck('empty.example', 'empty01', 2)
  ok('nothing uploaded → "empty" + the upload warning', r.checks.content.location === 'empty' && r.warnings.some(w => /No user content found/.test(w)), r.checks.content)
  FS.noprep01 = { files: { 'index.html': '<h1>hi</h1>', '.htaccess': '# Anti-Red' }, dirs: {} }
  AR.ipFixDeploys = 0
  r = await hc.runHealthCheck('noprep.example', 'noprep01', 1)
  ok('prepend files really missing → type none → IP-fix deployed once', r.checks.prepend.type === 'none' && AR.ipFixDeploys === 1 && r.autoFixes.includes('Deployed IP-fix prepend (was missing)'), { p: r.checks.prepend, f: r.autoFixes })
  FS.sub01 = { files: { '.htaccess': '# Anti-Red', '.user.ini': 'auto_prepend_file=x', '.antired-challenge.php': 'ANTIRED_IP_FIXED' }, dirs: { site: { files: { 'index.php': '<?php' }, dirs: {} } } }
  const cont = await hc.detectUserContent('sub01')
  ok('content in one sub-folder → redirect target /site/', cont.needsRedirect === true && cont.redirectTarget === '/site/', cont)

  console.log('\n── 5: new domain whose DNS is not live yet ──')
  NET.webDown = true
  r = await hc.runHealthCheck('fresh.example', 'vabi2597', 1)
  msg = await hc.reportResults('fresh.example', 'vabi2597', '1', r, 1)
  ok('"not reachable yet (ENOTFOUND)" instead of "HTTP N/A"', /Site \(via Cloudflare tunnel\):<\/b> not reachable yet \(ENOTFOUND\)/.test(msg) && !/N\/A/.test(msg), msg)
  NET.webDown = false

  console.log('\n── 6: legacy direct mode (no WHM_API_URL) unchanged ──')
  hc = loadHealthCheck({ WHM_HOST: '10.1.2.3', WHM_TOKEN: 'tok' })
  ok('direct WHM :2087 + direct origin IP when there is no tunnel', NET.created[0].baseURL === 'https://10.1.2.3:2087/json-api' && hc._routing.ORIGIN_DIRECT_IP === '10.1.2.3' && hc._routing.ORIGIN_LABEL === 'Origin', NET.created[0])
  NET.directLookups = 0
  r = await hc.runHealthCheck('vabillaprepaid.com', 'vabi2597', 1)
  ok('…and the origin probe pins the WHM IP', NET.directLookups === 1 && r.checks.originRoot.status === 200)

  console.log(`\n${fail ? '❌' : '✅'} health-check tunnel suite: ${pass} passed / ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.log('  ❌ suite crashed:', e.stack || e.message); process.exit(1) })
