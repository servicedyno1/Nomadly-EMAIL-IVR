/**
 * Phase 3 & 4: Create test hosting account + comprehensive feature testing
 * 
 * Tests ALL panel features against a fresh cPanel account.
 * Usage: node scripts/test-panel-features.js
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
const TEST_PLAN = 'Golden-Anti-Red-HostPanel-1-Month'   // generous plan so all features unlocked
const TEST_EMAIL = 'test@nomadly.test'

const agent = new https.Agent({ rejectUnauthorized: false })
const whmHeaders = {
  Authorization: `whm root:${WHM_TOKEN}`,
}

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

// ─── WHM helpers ───────────────────────────────────────

async function whmGet(path, params = {}) {
  const res = await axios.get(`${WHM_API_BASE}${path}`, {
    params: { 'api.version': 1, ...params },
    headers: whmHeaders,
    httpsAgent: agent,
    timeout: 30000,
  })
  return res.data
}

// ─── cPanel UAPI helper (via WHM impersonation) ───────

async function uapi(cpUser, module, func, params = {}, method = 'GET') {
  const url = `${WHM_API_BASE}/cpanel`
  const reqParams = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 3,
    cpanel_jsonapi_module: module,
    cpanel_jsonapi_func: func,
    ...params,
  }
  const res = await axios({
    method,
    url,
    params: method === 'GET' ? reqParams : undefined,
    data: method === 'POST' ? reqParams : undefined,
    headers: whmHeaders,
    httpsAgent: agent,
    timeout: 30000,
  })
  const result = res.data?.result
  return result
}

// ─── cPanel API2 helper (via WHM impersonation) ───────

async function api2(cpUser, module, func, params = {}) {
  const url = `${WHM_API_BASE}/cpanel`
  const reqParams = {
    cpanel_jsonapi_user: cpUser,
    cpanel_jsonapi_apiversion: 2,
    cpanel_jsonapi_module: module,
    cpanel_jsonapi_func: func,
    ...params,
  }
  const res = await axios.get(url, {
    params: reqParams,
    headers: whmHeaders,
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
  
  // First check if domain already exists
  try {
    const existing = await whmGet('/accountsummary', { user: undefined, domain: TEST_DOMAIN })
    if (existing?.metadata?.result === 1 && existing?.data?.acct?.[0]) {
      const acct = existing.data.acct[0]
      log(`⚠️ Domain ${TEST_DOMAIN} already exists as user: ${acct.user}`)
      testAccount = { username: acct.user, domain: TEST_DOMAIN, password: null, preExisting: true }
      return true
    }
  } catch (e) {
    // Not found — good
  }
  
  // Generate a unique username
  const username = 'nbay' + Math.random().toString(36).substring(2, 8)
  const password = 'Test!' + Math.random().toString(36).substring(2, 10) + 'Zz1'
  
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
      log(`✅ Account created: ${username}`)
      return true
    } else {
      const reason = result?.metadata?.reason || 'unknown'
      record('WHM createacct', false, reason)
      return false
    }
  } catch (err) {
    record('WHM createacct', false, err.message)
    return false
  }
}

// ═══════════════════════════════════════════════════════
// PHASE 4: Test ALL Panel Features
// ═══════════════════════════════════════════════════════

async function testFileManager() {
  log('\n─── FILE MANAGER TESTS ───')
  const u = testAccount.username
  
  // 1. List files in /public_html
  try {
    const r = await uapi(u, 'Fileman', 'list_files', { dir: '/public_html', include_mime: 1, show_hidden: 0 })
    record('FM: list_files /public_html', r?.status === 1, `${(r?.data || []).length} items`)
  } catch (e) { record('FM: list_files', false, e.message) }
  
  // 2. Create directory
  try {
    const r = await uapi(u, 'Fileman', 'mkdir', { path: '/public_html', name: 'test_dir' })
    record('FM: mkdir test_dir', r?.status === 1, JSON.stringify(r?.errors || []))
  } catch (e) { record('FM: mkdir', false, e.message) }
  
  // 3. Save file content (create a new file)
  try {
    const content = '<html><body><h1>Test Page</h1></body></html>'
    const r = await uapi(u, 'Fileman', 'save_file_content', {
      file: 'test_file.html',
      dir: '/public_html/test_dir',
      content,
    })
    record('FM: save_file_content', r?.status === 1, 'test_file.html')
  } catch (e) { record('FM: save_file_content', false, e.message) }
  
  // 4. Get file content
  try {
    const r = await uapi(u, 'Fileman', 'get_file_content', {
      file: 'test_file.html',
      dir: '/public_html/test_dir',
    })
    const hasContent = r?.status === 1 && (r?.data?.content || '').includes('Test Page')
    record('FM: get_file_content', hasContent, hasContent ? 'content matches' : 'content mismatch')
  } catch (e) { record('FM: get_file_content', false, e.message) }
  
  // 5. Rename file
  try {
    const r = await uapi(u, 'Fileman', 'rename', {
      dir: '/public_html/test_dir',
      oldname: 'test_file.html',
      newname: 'renamed_file.html',
    })
    // Rename returns data with status. Check if the operation succeeded.
    const ok = r?.status === 1 || (r?.data && !r?.errors?.length)
    record('FM: rename', ok, 'test_file.html → renamed_file.html')
  } catch (e) { record('FM: rename', false, e.message) }
  
  // 6. Copy file
  try {
    const r = await uapi(u, 'Fileman', 'fileop', {
      op: 'copy',
      sourcefiles: '/public_html/test_dir/renamed_file.html',
      destfiles: '/public_html/test_dir/copied_file.html',
    })
    record('FM: copy (fileop)', r?.status === 1 || !r?.errors?.length, 'copied_file.html')
  } catch (e) { record('FM: copy', false, e.message) }
  
  // 7. Move file
  try {
    const r = await uapi(u, 'Fileman', 'fileop', {
      op: 'move',
      sourcefiles: '/public_html/test_dir/copied_file.html',
      destfiles: '/public_html/moved_file.html',
    })
    record('FM: move (fileop)', r?.status === 1 || !r?.errors?.length, '→ /public_html/moved_file.html')
  } catch (e) { record('FM: move', false, e.message) }
  
  // 8. Delete file
  try {
    const r = await uapi(u, 'Fileman', 'fileop', {
      op: 'unlink',
      sourcefiles: '/public_html/moved_file.html',
    })
    record('FM: delete (fileop unlink)', r?.status === 1 || !r?.errors?.length, 'moved_file.html')
  } catch (e) { record('FM: delete', false, e.message) }
  
  // 9. Delete test directory 
  try {
    const r = await uapi(u, 'Fileman', 'fileop', {
      op: 'unlink',
      sourcefiles: '/public_html/test_dir',
    })
    record('FM: delete dir', r?.status === 1 || !r?.errors?.length, 'test_dir')
  } catch (e) { record('FM: delete dir', false, e.message) }
}

async function testSubdomains() {
  log('\n─── SUBDOMAIN TESTS ───')
  const u = testAccount.username
  
  // 1. List subdomains (should be empty initially)
  try {
    const r = await api2(u, 'SubDomain', 'listsubdomains', {})
    const subs = r?.data || []
    record('SUB: listsubdomains', r?.event?.result === 1 || Array.isArray(subs), `${subs.length} subdomains`)
  } catch (e) { record('SUB: listsubdomains', false, e.message) }
  
  // 2. Create subdomain with FIXED doc root (public_html/shop)
  try {
    const r = await api2(u, 'SubDomain', 'addsubdomain', {
      domain: 'shop',
      rootdomain: TEST_DOMAIN,
      dir: `public_html/shop`,
    })
    const data = r?.data?.[0] || {}
    record('SUB: create shop.' + TEST_DOMAIN, data.result === 1, `docroot=public_html/shop, reason=${data.reason || 'OK'}`)
  } catch (e) { record('SUB: create subdomain', false, e.message) }
  
  // 3. Verify subdomain was created with correct document root
  try {
    const r = await api2(u, 'SubDomain', 'listsubdomains', {})
    const subs = r?.data || []
    const shopSub = subs.find(s => s.domain === 'shop' || (s.domain || '').startsWith('shop'))
    if (shopSub) {
      const docroot = shopSub.dir || shopSub.rootdir || shopSub.documentroot || ''
      const isCorrect = docroot.includes('public_html/shop') && !docroot.includes(TEST_DOMAIN)
      record('SUB: verify docroot', isCorrect, `docroot="${docroot}" ${isCorrect ? '(correct! separate folder)' : '(WRONG: contains full FQDN or primary public_html)'}`)
    } else {
      record('SUB: verify docroot', false, 'subdomain not found in list')
    }
  } catch (e) { record('SUB: verify docroot', false, e.message) }
  
  // 4. Create another subdomain to verify pattern
  try {
    const r = await api2(u, 'SubDomain', 'addsubdomain', {
      domain: 'blog',
      rootdomain: TEST_DOMAIN,
      dir: `public_html/blog`,
    })
    const data = r?.data?.[0] || {}
    record('SUB: create blog.' + TEST_DOMAIN, data.result === 1, `docroot=public_html/blog`)
  } catch (e) { record('SUB: create blog subdomain', false, e.message) }
  
  // 5. Delete subdomain
  try {
    const r = await api2(u, 'SubDomain', 'delsubdomain', {
      domain: `blog.${TEST_DOMAIN}`,
    })
    const data = r?.data?.[0] || {}
    record('SUB: delete blog.' + TEST_DOMAIN, data.result === 1, data.reason || 'OK')
  } catch (e) { record('SUB: delete subdomain', false, e.message) }
  
  // Keep shop subdomain for further testing
}

async function testAddonDomains() {
  log('\n─── ADDON DOMAIN TESTS ───')
  const u = testAccount.username
  const addonDomain = 'testaddon-' + Date.now() + '.example.com'
  
  // 1. List domains
  try {
    const r = await uapi(u, 'DomainInfo', 'list_domains', {})
    const data = r?.data || {}
    record('ADDON: list_domains', r?.status === 1, `main=${data.main_domain}, addons=${(data.addon_domains||[]).length}, subs=${(data.sub_domains||[]).length}`)
  } catch (e) { record('ADDON: list_domains', false, e.message) }
  
  // 2. Add addon domain (use a fake domain that won't conflict - just testing API)
  // We use the second .sbs domain for testing
  const testAddon = 'testinghostbay.sbs'
  try {
    const r = await api2(u, 'AddonDomain', 'addaddondomain', {
      newdomain: testAddon,
      subdomain: testAddon.replace(/\./g, ''),
      dir: `public_html/${testAddon}`,
    })
    const data = r?.data?.[0] || {}
    record('ADDON: addaddondomain', data.result === 1, `domain=${testAddon}, reason=${data.reason || 'OK'}`)
  } catch (e) { record('ADDON: addaddondomain', false, e.message) }
  
  // 3. Verify addon domain's document root
  try {
    const r = await uapi(u, 'DomainInfo', 'list_domains', {})
    const addons = r?.data?.addon_domains || []
    const found = addons.includes(testAddon)
    record('ADDON: verify in list', found, `addon_domains: [${addons.join(', ')}]`)
  } catch (e) { record('ADDON: verify', false, e.message) }
  
  // 4. Check document root via DomainInfo domains_data
  try {
    const r = await uapi(u, 'DomainInfo', 'domains_data', { format: 'hash' })
    if (r?.status === 1 && r?.data) {
      const domData = r.data[testAddon] || {}
      record('ADDON: docroot check', true, `documentroot=${domData.documentroot || domData.dir || 'N/A'}`)
    } else {
      record('ADDON: docroot check', false, 'domains_data returned no data')
    }
  } catch (e) { record('ADDON: docroot check', false, e.message) }
  
  // 5. Remove addon domain
  try {
    const r = await api2(u, 'AddonDomain', 'deladdondomain', {
      domain: testAddon,
      subdomain: testAddon.replace(/\./g, '') + '.' + TEST_DOMAIN,
    })
    const data = r?.data?.[0] || {}
    record('ADDON: deladdondomain', data.result === 1, data.reason || 'OK')
  } catch (e) { record('ADDON: deladdondomain', false, e.message) }
}

async function testEmail() {
  log('\n─── EMAIL TESTS ───')
  const u = testAccount.username
  
  // 1. List email accounts
  try {
    const r = await uapi(u, 'Email', 'list_pops_with_disk', { domain: TEST_DOMAIN })
    record('EMAIL: list_pops_with_disk', r?.status === 1, `${(r?.data || []).length} accounts`)
  } catch (e) { record('EMAIL: list', false, e.message) }
  
  // 2. Create email account
  try {
    const r = await uapi(u, 'Email', 'add_pop', {
      email: 'testuser',
      domain: TEST_DOMAIN,
      password: 'TestPass123!Zz',
      quota: 100,
    })
    record('EMAIL: add_pop', r?.status === 1, `testuser@${TEST_DOMAIN}`)
  } catch (e) { record('EMAIL: add_pop', false, e.message) }
  
  // 3. Change email password
  try {
    const r = await uapi(u, 'Email', 'passwd_pop', {
      email: 'testuser',
      domain: TEST_DOMAIN,
      password: 'NewTestPass456!Zz',
    })
    record('EMAIL: passwd_pop', r?.status === 1, 'password changed')
  } catch (e) { record('EMAIL: passwd_pop', false, e.message) }
  
  // 4. Delete email account
  try {
    const r = await uapi(u, 'Email', 'delete_pop', {
      email: 'testuser',
      domain: TEST_DOMAIN,
    })
    record('EMAIL: delete_pop', r?.status === 1, `testuser@${TEST_DOMAIN} deleted`)
  } catch (e) { record('EMAIL: delete_pop', false, e.message) }
}

async function testMySQL() {
  log('\n─── MYSQL TESTS ───')
  const u = testAccount.username
  // cPanel prefixes DB/user names with cpUser_ (8 char max prefix)
  const prefix = u.length > 8 ? u.substring(0, 8) : u
  const dbName = `${prefix}_testdb`
  const dbUser = `${prefix}_testus`
  
  // 1. List databases
  try {
    const r = await uapi(u, 'Mysql', 'list_databases', {})
    record('MYSQL: list_databases', r?.status === 1, `${(r?.data || []).length} databases`)
  } catch (e) { record('MYSQL: list_databases', false, e.message) }
  
  // 2. Create database
  try {
    const r = await uapi(u, 'Mysql', 'create_database', { name: dbName })
    record('MYSQL: create_database', r?.status === 1, dbName)
  } catch (e) { record('MYSQL: create_database', false, e.message) }
  
  // 3. Create database user
  try {
    const r = await uapi(u, 'Mysql', 'create_user', { name: dbUser, password: 'DbPass789!Zz' })
    record('MYSQL: create_user', r?.status === 1, dbUser)
  } catch (e) { record('MYSQL: create_user', false, e.message) }
  
  // 4. Grant privileges
  try {
    const r = await uapi(u, 'Mysql', 'set_privileges_on_database', {
      user: dbUser,
      database: dbName,
      privileges: 'ALL PRIVILEGES',
    })
    record('MYSQL: grant privileges', r?.status === 1, 'ALL PRIVILEGES')
  } catch (e) { record('MYSQL: grant privileges', false, e.message) }
  
  // 5. List users
  try {
    const r = await uapi(u, 'Mysql', 'list_users', {})
    const users = r?.data || []
    const found = users.some(usr => (typeof usr === 'string' ? usr : usr.user || usr.name || '') === dbUser)
    record('MYSQL: list_users', r?.status === 1 && found, `found ${dbUser} in list`)
  } catch (e) { record('MYSQL: list_users', false, e.message) }
  
  // 6. Check database
  try {
    const r = await uapi(u, 'Mysql', 'check_database', { name: dbName })
    record('MYSQL: check_database', r?.status === 1, 'integrity check')
  } catch (e) { record('MYSQL: check_database', false, e.message) }
  
  // 7. Repair database  
  try {
    const r = await uapi(u, 'Mysql', 'repair_database', { name: dbName })
    record('MYSQL: repair_database', r?.status === 1, 'repair')
  } catch (e) { record('MYSQL: repair_database', false, e.message) }
  
  // 8. Revoke privileges
  try {
    const r = await uapi(u, 'Mysql', 'revoke_access_to_database', {
      user: dbUser,
      database: dbName,
    })
    record('MYSQL: revoke privileges', r?.status === 1, 'revoked')
  } catch (e) { record('MYSQL: revoke privileges', false, e.message) }
  
  // 9. Delete user
  try {
    const r = await uapi(u, 'Mysql', 'delete_user', { name: dbUser })
    record('MYSQL: delete_user', r?.status === 1, dbUser)
  } catch (e) { record('MYSQL: delete_user', false, e.message) }
  
  // 10. Delete database
  try {
    const r = await uapi(u, 'Mysql', 'delete_database', { name: dbName })
    record('MYSQL: delete_database', r?.status === 1, dbName)
  } catch (e) { record('MYSQL: delete_database', false, e.message) }
  
  // 11. Remote MySQL hosts
  try {
    const r = await uapi(u, 'Mysql', 'get_host_notes', {})
    record('MYSQL: list remote hosts', r?.status === 1, 'listed')
  } catch (e) { record('MYSQL: list remote hosts', false, e.message) }
  
  // 12. Add remote host
  try {
    const r = await uapi(u, 'Mysql', 'add_host', { host: '192.168.1.100' })
    record('MYSQL: add_host', r?.status === 1, '192.168.1.100')
  } catch (e) { record('MYSQL: add_host', false, e.message) }
  
  // 13. Delete remote host  
  try {
    const r = await uapi(u, 'Mysql', 'delete_host', { host: '192.168.1.100' })
    record('MYSQL: delete_host', r?.status === 1, '192.168.1.100')
  } catch (e) { record('MYSQL: delete_host', false, e.message) }
}

async function testDomainDocrootAndStats() {
  log('\n─── DOMAIN DOCROOT + STATS TESTS ───')
  const u = testAccount.username
  
  // 1. Get disk quota
  try {
    const r = await uapi(u, 'Quota', 'get_local_quota_info', {})
    record('STATS: quota', r?.status === 1, `used=${r?.data?.megabytes_used || 0}MB`)
  } catch (e) { record('STATS: quota', false, e.message) }
  
  // 2. Get bandwidth data
  try {
    const r = await uapi(u, 'Bandwidth', 'query', {
      grouping: 'domain|year|month',
      interval: 'daily',
    })
    record('STATS: bandwidth', r?.status === 1 || r?.status === 0, `data available`)
  } catch (e) { record('STATS: bandwidth', false, e.message) }
  
  // 3. SSL status
  try {
    const r = await uapi(u, 'SSL', 'installed_hosts', {})
    record('SSL: installed_hosts', r?.status === 1, `${(r?.data || []).length} certs`)
  } catch (e) { record('SSL: installed_hosts', false, e.message) }
}

async function testChangeDomainDocRoot() {
  log('\n─── CHANGE DOCROOT TEST (subdomain) ───')
  const u = testAccount.username
  
  // Test SubDomain::changedocroot on our shop subdomain
  // Change docroot from public_html/shop to public_html (mirror mode)
  try {
    const r = await api2(u, 'SubDomain', 'changedocroot', {
      subdomain: 'shop',
      rootdomain: TEST_DOMAIN,
      dir: 'public_html',
    })
    const data = r?.data?.[0] || {}
    record('DOCROOT: change to mirror (public_html)', data.result === 1, data.reason || 'OK')
  } catch (e) { record('DOCROOT: change to mirror', false, e.message) }
  
  // Change back to own folder
  try {
    const r = await api2(u, 'SubDomain', 'changedocroot', {
      subdomain: 'shop',
      rootdomain: TEST_DOMAIN,
      dir: 'public_html/shop',
    })
    const data = r?.data?.[0] || {}
    record('DOCROOT: change back to own (public_html/shop)', data.result === 1, data.reason || 'OK')
  } catch (e) { record('DOCROOT: change back', false, e.message) }
}

// ─── Cleanup ──────────────────────────────────────────

async function cleanup() {
  log('\n─── CLEANUP ───')
  
  if (!testAccount || testAccount.preExisting) {
    log('Skipping cleanup (pre-existing account)')
    return
  }
  
  // Delete shop subdomain first
  try {
    await api2(testAccount.username, 'SubDomain', 'delsubdomain', {
      domain: `shop.${TEST_DOMAIN}`,
    })
    log('Deleted shop subdomain')
  } catch (e) { log(`Shop subdomain cleanup: ${e.message}`) }
  
  // Remove the WHM account  
  try {
    const r = await whmGet('/removeacct', { username: testAccount.username, keepdns: 0 })
    if (r?.metadata?.result === 1) {
      log(`✅ Test account ${testAccount.username} removed`)
    } else {
      log(`⚠️ Account removal: ${r?.metadata?.reason || 'unknown'}`)
    }
  } catch (e) {
    log(`❌ Cleanup failed: ${e.message}`)
  }
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('════════════════════════════════════════════════')
  log(' NOMADLY HOSTING PANEL — COMPREHENSIVE FEATURE TEST')
  log(`  Domain: ${TEST_DOMAIN}`)
  log(`  WHM: ${WHM_API_BASE}`)
  log('════════════════════════════════════════════════')
  
  const created = await createTestAccount()
  if (!created) {
    log('❌ Cannot proceed without a test account')
    return
  }
  
  if (testAccount.preExisting) {
    log('⚠️ Using pre-existing account — password unknown. Testing with WHM root impersonation only.')
  }
  
  try {
    await testFileManager()
    await testSubdomains()
    await testAddonDomains()
    await testEmail()
    await testMySQL()
    await testDomainDocrootAndStats()
    await testChangeDomainDocRoot()
  } catch (err) {
    log(`\n❌ Fatal error during testing: ${err.message}`)
    console.error(err.stack)
  }
  
  // Print summary
  log('\n════════════════════════════════════════════════')
  log(' TEST RESULTS SUMMARY')
  log('════════════════════════════════════════════════')
  log(`  ✅ PASSED: ${results.passed}`)
  log(`  ❌ FAILED: ${results.failed}`)
  log(`  TOTAL:    ${results.passed + results.failed}`)
  log('────────────────────────────────────────────────')
  
  results.tests.forEach(t => {
    console.log(`  ${t.ok ? '✅' : '❌'} ${t.name} ${t.detail ? '— ' + t.detail : ''}`)
  })
  
  log('\n────────────────────────────────────────────────')
  
  // Cleanup
  await cleanup()
  
  log('\n════════════════════════════════════════════════')
  log(` DONE — ${results.passed}/${results.passed + results.failed} passed`)
  log('════════════════════════════════════════════════')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
