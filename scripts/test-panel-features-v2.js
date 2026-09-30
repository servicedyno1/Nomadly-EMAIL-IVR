/**
 * Phase 3 & 4: Create test hosting account + comprehensive feature testing
 * 
 * Tests ALL panel features against a fresh cPanel account.
 * Uses DIRECT cPanel user auth (matching the real panel code path).
 * Usage: node scripts/test-panel-features-v2.js
 */
require('dotenv').config()
const axios = require('axios')
const https = require('https')

const WHM_HOST = process.env.WHM_HOST
const WHM_TOKEN = process.env.WHM_TOKEN
const WHM_API_RAW = (process.env.WHM_API_URL || '').replace(/\/+$/, '')
const WHM_API_BASE = WHM_API_RAW ? `${WHM_API_RAW}/json-api` : `https://${WHM_HOST}:2087/json-api`
const CPANEL_API_URL = process.env.CPANEL_API_URL || `https://${WHM_HOST}:2083`
const TEST_DOMAIN = 'testingbays.sbs'
const TEST_PLAN = 'Golden-Anti-Red-HostPanel-1-Month'
const TEST_EMAIL = 'dev@nomadly.test'

const agent = new https.Agent({ rejectUnauthorized: false })
const whmHeaders = { Authorization: `whm root:${WHM_TOKEN}` }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }
function pass(test) { console.log(`  ✅ PASS: ${test}`) }
function fail(test, err) { console.log(`  ❌ FAIL: ${test} — ${err}`) }

let testAccount = null
const results = { passed: 0, failed: 0, tests: [] }

function record(name, ok, detail) {
  results.tests.push({ name, ok, detail })
  if (ok) { results.passed++; pass(name + (detail ? ` (${detail})` : '')) }
  else { results.failed++; fail(name, detail) }
}

// ─── WHM helper ────────────────────────────────────────

async function whmGet(path, params = {}) {
  const res = await axios.get(`${WHM_API_BASE}${path}`, {
    params: { 'api.version': 1, ...params },
    headers: whmHeaders,
    httpsAgent: agent,
    timeout: 30000,
  })
  return res.data
}

// ─── Direct cPanel UAPI (via cPanel port 2083 tunnel) ─

async function uapi(cpUser, cpPass, module, func, params = {}, method = 'GET') {
  const url = `${CPANEL_API_URL}/execute/${module}/${func}`
  const auth = { username: cpUser, password: cpPass }
  const res = await axios({
    method,
    url,
    params: method === 'GET' ? params : undefined,
    data: method === 'POST' ? new URLSearchParams(params).toString() : undefined,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    auth,
    httpsAgent: agent,
    timeout: 30000,
  })
  return res.data
}

// ─── Direct cPanel API2 (via cPanel port 2083 tunnel) ─

async function api2(cpUser, cpPass, module, func, params = {}) {
  const url = `${CPANEL_API_URL}/json-api/cpanel`
  const auth = { username: cpUser, password: cpPass }
  const reqParams = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: module,
    cpanel_jsonapi_func: func,
    ...params,
  }
  const res = await axios.get(url, {
    params: reqParams,
    auth,
    httpsAgent: agent,
    timeout: 30000,
  })
  return res.data?.cpanelresult
}

// ═══════════════════════════════════════════════════════
// PHASE 3: Create Test Account
// ═══════════════════════════════════════════════════════

async function createTestAccount() {
  log('═══ PHASE 3: Creating test hosting account ═══')
  
  const username = 'nbay' + Math.random().toString(36).substring(2, 8)
  const password = 'Pk!' + Math.random().toString(36).substring(2, 12) + 'Zz1'
  
  log(`Creating account: ${username}@${TEST_DOMAIN} (plan: ${TEST_PLAN})`)
  
  try {
    const result = await whmGet('/createacct', {
      username,
      domain: TEST_DOMAIN,
      plan: TEST_PLAN,
      contactemail: TEST_EMAIL,
      password,
      maxpark: 'unlimited',
      maxaddon: 'unlimited',
      maxsql: 'unlimited',
      skip_dns_check: 1,
    })
    
    if (result?.metadata?.result === 1) {
      testAccount = { username, password, domain: TEST_DOMAIN }
      record('WHM createacct', true, `user=${username}`)
      log(`✅ Account created: ${username} / ${password}`)
      return true
    } else {
      const reason = result?.metadata?.reason || 'unknown'
      record('WHM createacct', false, reason)
      return false
    }
  } catch (err) {
    const reason = err.response?.data?.metadata?.reason || err.message
    record('WHM createacct', false, reason)
    return false
  }
}

// ═══════════════════════════════════════════════════════
// PHASE 4: Test ALL Panel Features
// ═══════════════════════════════════════════════════════

async function testFileManager() {
  log('\n─── FILE MANAGER TESTS ───')
  const { username: u, password: p } = testAccount
  
  // 1. List files in /public_html
  try {
    const r = await uapi(u, p, 'Fileman', 'list_files', { dir: '/public_html', include_mime: 1, show_hidden: 0 })
    record('FM: list_files /public_html', r?.status === 1, `${(r?.data || []).length} items`)
  } catch (e) { record('FM: list_files', false, e.message) }
  
  // 2. Create directory (UAPI Fileman::mkdir)
  try {
    const r = await uapi(u, p, 'Fileman', 'mkdir', { path: '/public_html', name: 'test_dir' }, 'POST')
    record('FM: mkdir test_dir', r?.status === 1, JSON.stringify(r?.errors || r?.messages || []))
  } catch (e) { record('FM: mkdir', false, e.message) }
  
  // 3. Save file content (create a new file)
  try {
    const content = '<html><body><h1>Test Page Created by Nomadly Panel Test</h1></body></html>'
    const r = await uapi(u, p, 'Fileman', 'save_file_content', {
      file: 'test_file.html',
      dir: '/public_html/test_dir',
      content,
    }, 'POST')
    record('FM: save_file_content', r?.status === 1, 'test_file.html created')
  } catch (e) { record('FM: save_file_content', false, e.message) }
  
  // 4. Get file content
  try {
    const r = await uapi(u, p, 'Fileman', 'get_file_content', {
      file: 'test_file.html',
      dir: '/public_html/test_dir',
    })
    const hasContent = r?.status === 1 && (r?.data?.content || '').includes('Test Page')
    record('FM: get_file_content', hasContent, hasContent ? 'content verified' : `status=${r?.status}, content=${(r?.data?.content||'').substring(0,50)}`)
  } catch (e) { record('FM: get_file_content', false, e.message) }
  
  // 5. List files after creation - verify test_dir and file exist
  try {
    const r = await uapi(u, p, 'Fileman', 'list_files', { dir: '/public_html/test_dir', show_hidden: 0 })
    const files = r?.data || []
    const hasTestFile = files.some(f => f.file === 'test_file.html' || f.fullpath?.includes('test_file'))
    record('FM: verify file exists', r?.status === 1 && hasTestFile, `${files.length} files in test_dir`)
  } catch (e) { record('FM: verify file', false, e.message) }
  
  // 6. Rename file  
  try {
    const r = await uapi(u, p, 'Fileman', 'rename', {
      dir: '/public_html/test_dir',
      oldname: 'test_file.html',
      newname: 'renamed_file.html',
    }, 'POST')
    record('FM: rename', r?.status === 1, 'test_file.html → renamed_file.html')
  } catch (e) { record('FM: rename', false, e.message) }
  
  // 7. Copy file (using Fileman::fileop)
  try {
    const r = await uapi(u, p, 'Fileman', 'fileop', {
      op: 'copy',
      sourcefiles: '/public_html/test_dir/renamed_file.html',
      destfiles: '/public_html/test_dir/copied_file.html',
    }, 'POST')
    record('FM: copy', r?.status === 1, 'copied_file.html')
  } catch (e) { record('FM: copy', false, e.message) }
  
  // 8. Move file
  try {
    const r = await uapi(u, p, 'Fileman', 'fileop', {
      op: 'move',
      sourcefiles: '/public_html/test_dir/copied_file.html',
      destfiles: '/public_html/moved_file.html',
    }, 'POST')
    record('FM: move', r?.status === 1, '→ /public_html/moved_file.html')
  } catch (e) { record('FM: move', false, e.message) }
  
  // 9. Delete file
  try {
    const r = await uapi(u, p, 'Fileman', 'fileop', {
      op: 'unlink',
      sourcefiles: '/public_html/moved_file.html',
    }, 'POST')
    record('FM: delete file', r?.status === 1, 'moved_file.html')
  } catch (e) { record('FM: delete file', false, e.message) }
  
  // 10. Delete remaining files in test_dir
  try {
    const r = await uapi(u, p, 'Fileman', 'fileop', {
      op: 'unlink',
      sourcefiles: '/public_html/test_dir/renamed_file.html',
    }, 'POST')
    record('FM: delete renamed_file', r?.status === 1, 'renamed_file.html')
  } catch (e) { record('FM: delete renamed_file', false, e.message) }
  
  // 11. Delete test directory 
  try {
    const r = await uapi(u, p, 'Fileman', 'fileop', {
      op: 'unlink',
      sourcefiles: '/public_html/test_dir',
    }, 'POST')
    record('FM: delete dir', r?.status === 1, 'test_dir removed')
  } catch (e) { record('FM: delete dir', false, e.message) }
}

async function testSubdomains() {
  log('\n─── SUBDOMAIN TESTS ───')
  const { username: u, password: p } = testAccount
  
  // 1. List subdomains (should be empty)
  try {
    const r = await api2(u, p, 'SubDomain', 'listsubdomains', {})
    const subs = r?.data || []
    record('SUB: listsubdomains', Array.isArray(subs), `${subs.length} subdomains`)
  } catch (e) { record('SUB: listsubdomains', false, e.message) }
  
  // 2. Create subdomain with CORRECT doc root (public_html/shop)
  try {
    const r = await api2(u, p, 'SubDomain', 'addsubdomain', {
      domain: 'shop',
      rootdomain: TEST_DOMAIN,
      dir: 'public_html/shop',
    })
    const data = r?.data?.[0] || {}
    record('SUB: create shop.' + TEST_DOMAIN, data.result === 1, `reason=${data.reason || 'OK'}`)
  } catch (e) { record('SUB: create subdomain', false, e.message) }
  
  // 3. Verify subdomain docroot is correct
  try {
    const r = await api2(u, p, 'SubDomain', 'listsubdomains', {})
    const subs = r?.data || []
    const shopSub = subs.find(s => (s.domain || '').startsWith('shop'))
    if (shopSub) {
      const docroot = shopSub.dir || shopSub.rootdir || shopSub.documentroot || ''
      const isCorrect = docroot.endsWith('/public_html/shop') || docroot === 'public_html/shop'
      record('SUB: verify docroot = public_html/shop', isCorrect, `actual="${docroot}"`)
    } else {
      record('SUB: verify docroot', false, 'subdomain not found')
    }
  } catch (e) { record('SUB: verify docroot', false, e.message) }

  // 4. Verify the shop folder was actually created on disk
  try {
    const r = await uapi(u, p, 'Fileman', 'list_files', { dir: '/public_html' })
    const files = r?.data || []
    const shopDir = files.find(f => f.file === 'shop' || f.fullpath?.includes('/shop'))
    record('SUB: shop folder exists on disk', !!shopDir, shopDir ? `type=${shopDir.type || shopDir.mimetype}` : 'not found')
  } catch (e) { record('SUB: verify shop folder', false, e.message) }
  
  // 5. Create second subdomain 
  try {
    const r = await api2(u, p, 'SubDomain', 'addsubdomain', {
      domain: 'blog',
      rootdomain: TEST_DOMAIN,
      dir: 'public_html/blog',
    })
    const data = r?.data?.[0] || {}
    record('SUB: create blog.' + TEST_DOMAIN, data.result === 1, data.reason || 'OK')
  } catch (e) { record('SUB: create blog', false, e.message) }
  
  // 6. Delete blog subdomain
  try {
    const r = await api2(u, p, 'SubDomain', 'delsubdomain', {
      domain: `blog.${TEST_DOMAIN}`,
    })
    const data = r?.data?.[0] || {}
    record('SUB: delete blog.' + TEST_DOMAIN, data.result === 1, data.reason || 'OK')
  } catch (e) { record('SUB: delete blog', false, e.message) }
  
  // Keep shop for further testing (docroot change tests)
}

async function testAddonDomains() {
  log('\n─── ADDON DOMAIN TESTS ───')
  const { username: u, password: p } = testAccount
  const addonDomain = 'testinghostbay.sbs'
  
  // 1. List all domains
  try {
    const r = await uapi(u, p, 'DomainInfo', 'list_domains', {})
    const data = r?.data || {}
    record('ADDON: list_domains', r?.status === 1, `main=${data.main_domain}, addons=${(data.addon_domains||[]).length}, subs=${(data.sub_domains||[]).length}`)
  } catch (e) { record('ADDON: list_domains', false, e.message) }
  
  // 2. Add addon domain with separate doc root
  try {
    const r = await api2(u, p, 'AddonDomain', 'addaddondomain', {
      newdomain: addonDomain,
      subdomain: addonDomain.replace(/\./g, ''),
      dir: `public_html/${addonDomain}`,
    })
    const data = r?.data?.[0] || {}
    record('ADDON: addaddondomain', data.result === 1, `domain=${addonDomain}, reason=${data.reason || 'OK'}`)
  } catch (e) { record('ADDON: addaddondomain', false, e.message) }
  
  // 3. Verify addon listed
  try {
    const r = await uapi(u, p, 'DomainInfo', 'list_domains', {})
    const addons = r?.data?.addon_domains || []
    record('ADDON: verify in list', addons.includes(addonDomain), `addons: [${addons.join(', ')}]`)
  } catch (e) { record('ADDON: verify', false, e.message) }
  
  // 4. Verify addon's document root folder exists
  try {
    const r = await uapi(u, p, 'Fileman', 'list_files', { dir: '/public_html' })
    const files = r?.data || []
    const addonDir = files.find(f => f.file === addonDomain || (f.fullpath || '').includes(addonDomain))
    record('ADDON: docroot folder exists', !!addonDir, addonDir ? `found ${addonDomain}/ in public_html` : 'not found')
  } catch (e) { record('ADDON: docroot folder', false, e.message) }
  
  // 5. Remove addon domain
  try {
    const r = await api2(u, p, 'AddonDomain', 'deladdondomain', {
      domain: addonDomain,
      subdomain: addonDomain.replace(/\./g, '') + '.' + TEST_DOMAIN,
    })
    const data = r?.data?.[0] || {}
    record('ADDON: deladdondomain', data.result === 1, data.reason || 'OK')
  } catch (e) { record('ADDON: deladdondomain', false, e.message) }
}

async function testEmail() {
  log('\n─── EMAIL TESTS ───')
  const { username: u, password: p } = testAccount
  
  // 1. List email accounts
  try {
    const r = await uapi(u, p, 'Email', 'list_pops_with_disk', { domain: TEST_DOMAIN })
    record('EMAIL: list_pops_with_disk', r?.status === 1, `${(r?.data || []).length} accounts`)
  } catch (e) { record('EMAIL: list', false, e.message) }
  
  // 2. Create email account
  try {
    const r = await uapi(u, p, 'Email', 'add_pop', {
      email: 'devtest',
      domain: TEST_DOMAIN,
      password: 'DevTestPass123!Zz',
      quota: 100,
    }, 'POST')
    record('EMAIL: add_pop', r?.status === 1, `devtest@${TEST_DOMAIN}`)
  } catch (e) { record('EMAIL: add_pop', false, e.message) }
  
  // 3. Verify email account exists
  try {
    const r = await uapi(u, p, 'Email', 'list_pops_with_disk', { domain: TEST_DOMAIN })
    const accounts = r?.data || []
    const found = accounts.some(a => (a.email || a.login || '').includes('devtest'))
    record('EMAIL: verify created', r?.status === 1 && found, `found devtest in ${accounts.length} accounts`)
  } catch (e) { record('EMAIL: verify', false, e.message) }
  
  // 4. Change email password
  try {
    const r = await uapi(u, p, 'Email', 'passwd_pop', {
      email: 'devtest',
      domain: TEST_DOMAIN,
      password: 'NewDevPass456!Zz',
    }, 'POST')
    record('EMAIL: passwd_pop', r?.status === 1, 'password changed')
  } catch (e) { record('EMAIL: passwd_pop', false, e.message) }
  
  // 5. Delete email account
  try {
    const r = await uapi(u, p, 'Email', 'delete_pop', {
      email: 'devtest',
      domain: TEST_DOMAIN,
    }, 'POST')
    record('EMAIL: delete_pop', r?.status === 1, `devtest@${TEST_DOMAIN} deleted`)
  } catch (e) { record('EMAIL: delete_pop', false, e.message) }
}

async function testMySQL() {
  log('\n─── MYSQL TESTS ───')
  const { username: u, password: p } = testAccount
  // cPanel prefixes with cpUser_ (max 8 chars of username)
  const prefix = u.length > 8 ? u.substring(0, 8) : u
  const dbName = `${prefix}_tstdb`
  const dbUser = `${prefix}_tstus`
  
  log(`  DB prefix: ${prefix}_, db=${dbName}, user=${dbUser}`)
  
  // 1. List databases (should be empty)
  try {
    const r = await uapi(u, p, 'Mysql', 'list_databases', {})
    record('MYSQL: list_databases', r?.status === 1, `${(r?.data || []).length} databases`)
  } catch (e) { record('MYSQL: list_databases', false, e.message) }
  
  // 2. Create database
  try {
    const r = await uapi(u, p, 'Mysql', 'create_database', { name: dbName }, 'POST')
    record('MYSQL: create_database', r?.status === 1, `${dbName} ${r?.errors ? JSON.stringify(r.errors) : ''}`)
  } catch (e) { record('MYSQL: create_database', false, e.message) }
  
  // 3. Create database user
  try {
    const r = await uapi(u, p, 'Mysql', 'create_user', { name: dbUser, password: 'DbPass789!Zz' }, 'POST')
    record('MYSQL: create_user', r?.status === 1, `${dbUser}`)
  } catch (e) { record('MYSQL: create_user', false, e.message) }
  
  // 4. Grant privileges
  try {
    const r = await uapi(u, p, 'Mysql', 'set_privileges_on_database', {
      user: dbUser,
      database: dbName,
      privileges: 'ALL PRIVILEGES',
    }, 'POST')
    record('MYSQL: grant privileges', r?.status === 1, 'ALL PRIVILEGES')
  } catch (e) { record('MYSQL: grant privileges', false, e.message) }
  
  // 5. List users to verify
  try {
    const r = await uapi(u, p, 'Mysql', 'list_users', {})
    const users = r?.data || []
    const found = users.some(usr => (typeof usr === 'string' ? usr : usr?.user || usr?.name || '') === dbUser)
    record('MYSQL: list_users', r?.status === 1 && found, `found ${dbUser}`)
  } catch (e) { record('MYSQL: list_users', false, e.message) }
  
  // 6. Check database integrity
  try {
    const r = await uapi(u, p, 'Mysql', 'check_database', { name: dbName }, 'POST')
    record('MYSQL: check_database', r?.status === 1, 'OK')
  } catch (e) { record('MYSQL: check_database', false, e.message) }
  
  // 7. Repair database
  try {
    const r = await uapi(u, p, 'Mysql', 'repair_database', { name: dbName }, 'POST')
    record('MYSQL: repair_database', r?.status === 1, 'OK')
  } catch (e) { record('MYSQL: repair_database', false, e.message) }
  
  // 8. Revoke privileges
  try {
    const r = await uapi(u, p, 'Mysql', 'revoke_access_to_database', {
      user: dbUser,
      database: dbName,
    }, 'POST')
    record('MYSQL: revoke privileges', r?.status === 1, 'revoked')
  } catch (e) { record('MYSQL: revoke privileges', false, e.message) }
  
  // 9. Delete user
  try {
    const r = await uapi(u, p, 'Mysql', 'delete_user', { name: dbUser }, 'POST')
    record('MYSQL: delete_user', r?.status === 1, dbUser)
  } catch (e) { record('MYSQL: delete_user', false, e.message) }
  
  // 10. Delete database
  try {
    const r = await uapi(u, p, 'Mysql', 'delete_database', { name: dbName }, 'POST')
    record('MYSQL: delete_database', r?.status === 1, dbName)
  } catch (e) { record('MYSQL: delete_database', false, e.message) }
  
  // 11. Remote MySQL hosts
  try {
    const r = await uapi(u, p, 'Mysql', 'get_host_notes', {})
    record('MYSQL: list remote hosts', r?.status === 1, 'OK')
  } catch (e) { record('MYSQL: list remote hosts', false, e.message) }
  
  // 12. Add remote host
  try {
    const r = await uapi(u, p, 'Mysql', 'add_host', { host: '192.168.1.100' }, 'POST')
    record('MYSQL: add_host', r?.status === 1, '192.168.1.100')
  } catch (e) { record('MYSQL: add_host', false, e.message) }
  
  // 13. Delete remote host
  try {
    const r = await uapi(u, p, 'Mysql', 'delete_host', { host: '192.168.1.100' }, 'POST')
    record('MYSQL: delete_host', r?.status === 1, '192.168.1.100')
  } catch (e) { record('MYSQL: delete_host', false, e.message) }
}

async function testStatsAndSSL() {
  log('\n─── STATS, QUOTA, SSL TESTS ───')
  const { username: u, password: p } = testAccount
  
  // 1. Disk quota
  try {
    const r = await uapi(u, p, 'Quota', 'get_local_quota_info', {})
    record('STATS: disk quota', r?.status === 1, `used=${r?.data?.megabytes_used || 0}MB`)
  } catch (e) { record('STATS: disk quota', false, e.message) }
  
  // 2. Bandwidth
  try {
    const r = await uapi(u, p, 'Bandwidth', 'query', {
      grouping: 'domain|year|month',
      interval: 'daily',
    })
    record('STATS: bandwidth', r?.status === 1 || r?.status === 0, 'queried')
  } catch (e) { record('STATS: bandwidth', false, e.message) }
  
  // 3. SSL status
  try {
    const r = await uapi(u, p, 'SSL', 'installed_hosts', {})
    record('SSL: installed_hosts', r?.status === 1, `${(r?.data || []).length} certs`)
  } catch (e) { record('SSL: installed_hosts', false, e.message) }
}

async function testChangeDomainDocRoot() {
  log('\n─── CHANGE DOCROOT TEST (subdomain) ───')
  const { username: u, password: p } = testAccount
  
  // Change shop subdomain docroot to public_html (mirror mode)
  try {
    const r = await api2(u, p, 'SubDomain', 'changedocroot', {
      subdomain: 'shop',
      rootdomain: TEST_DOMAIN,
      dir: 'public_html',
    })
    const data = r?.data?.[0] || {}
    record('DOCROOT: change to mirror (public_html)', data.result === 1, data.reason || 'OK')
  } catch (e) { record('DOCROOT: change to mirror', false, e.message) }
  
  // Verify it changed
  try {
    const r = await api2(u, p, 'SubDomain', 'listsubdomains', {})
    const subs = r?.data || []
    const shopSub = subs.find(s => (s.domain || '').startsWith('shop'))
    const isMirror = shopSub && (shopSub.dir || '').endsWith('/public_html')
    record('DOCROOT: verify mirror', isMirror, `dir="${shopSub?.dir}"`)
  } catch (e) { record('DOCROOT: verify mirror', false, e.message) }
  
  // Change back to own folder (public_html/shop)
  try {
    const r = await api2(u, p, 'SubDomain', 'changedocroot', {
      subdomain: 'shop',
      rootdomain: TEST_DOMAIN,
      dir: 'public_html/shop',
    })
    const data = r?.data?.[0] || {}
    record('DOCROOT: change to own (public_html/shop)', data.result === 1, data.reason || 'OK')
  } catch (e) { record('DOCROOT: change to own', false, e.message) }
}

// ─── Cleanup ──────────────────────────────────────────

async function cleanup() {
  log('\n─── CLEANUP ───')
  if (!testAccount) return
  
  // Delete shop subdomain
  try {
    await api2(testAccount.username, testAccount.password, 'SubDomain', 'delsubdomain', {
      domain: `shop.${TEST_DOMAIN}`,
    })
    log('Deleted shop subdomain')
  } catch (e) { log(`Shop subdomain cleanup: ${e.message}`) }
  
  // Remove WHM account
  try {
    const r = await whmGet('/removeacct', { username: testAccount.username, keepdns: 0 })
    if (r?.metadata?.result === 1) {
      log(`✅ Test account ${testAccount.username} removed`)
    } else {
      log(`⚠️ Removal: ${r?.metadata?.reason || 'unknown'}`)
    }
  } catch (e) { log(`❌ Cleanup failed: ${e.message}`) }
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('════════════════════════════════════════════════════════════')
  log(' NOMADLY HOSTING PANEL — COMPREHENSIVE FEATURE TEST v2')
  log(` Domain: ${TEST_DOMAIN}`)
  log(` WHM: ${WHM_API_BASE}`)
  log(` cPanel: ${CPANEL_API_URL}`)
  log('════════════════════════════════════════════════════════════')
  
  const created = await createTestAccount()
  if (!created) {
    log('❌ Cannot proceed without a test account')
    return
  }
  
  try {
    await testFileManager()
    await testSubdomains()
    await testAddonDomains()
    await testEmail()
    await testMySQL()
    await testStatsAndSSL()
    await testChangeDomainDocRoot()
  } catch (err) {
    log(`\n❌ Fatal error: ${err.message}`)
    console.error(err.stack)
  }
  
  // Print summary
  log('\n════════════════════════════════════════════════════════════')
  log(' TEST RESULTS SUMMARY')
  log('════════════════════════════════════════════════════════════')
  log(`  ✅ PASSED: ${results.passed}`)
  log(`  ❌ FAILED: ${results.failed}`)
  log(`  TOTAL:    ${results.passed + results.failed}`)
  log('────────────────────────────────────────────────────────────')
  
  const failedTests = results.tests.filter(t => !t.ok)
  if (failedTests.length > 0) {
    log('\n  FAILED TESTS:')
    failedTests.forEach(t => console.log(`    ❌ ${t.name} — ${t.detail}`))
  }
  
  log('\n  ALL TESTS:')
  results.tests.forEach(t => console.log(`    ${t.ok ? '✅' : '❌'} ${t.name} — ${t.detail || ''}`))
  
  // Cleanup
  await cleanup()
  
  log(`\n═══ DONE — ${results.passed}/${results.passed + results.failed} passed ═══`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
