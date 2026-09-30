/**
 * Testing-agent probe (iteration_41) — closes the last uncovered branch of
 * the _detectLoginPageHtml hardening.
 *
 * test_cpanel_proxy_subdomain_addon_whm_fallback.js covers the HTTP-403
 * variant for the four direct-axios API2 helpers. test_cpanel_proxy_html_in_200
 * covers HTML-in-200 for uapi() + api2(). NOBODY covered
 * "HTML-in-200 on addAddonDomain/removeAddonDomain/createSubdomain/
 * deleteSubdomain → _api2ViaWhmRoot fallback", which is exactly the branch
 * the main agent added at cpanel-proxy.js ~891/944/1070/1123.
 *
 * Asserts both halves of that branch:
 *   (a) WHM_TOKEN present  → transparent WHM-root success (status:1, via:'whm-fallback')
 *   (b) WHM_TOKEN missing  → _api2ViaWhmRoot returns null → surface
 *       {status:0, code:'CPANEL_AUTH_FAILURE'} (NOT a generic error)
 */

const path = require('path')
const assert = require('assert')
const axios = require('axios')

process.env.WHM_HOST = 'whm.test.local'
process.env.WHM_USERNAME = 'root'

const origGet = axios.get
const origPost = axios.post

const LOGIN_HTML = '<!DOCTYPE html>\n<html><head><title>cPanel Login</title></head><body>..</body></html>'

let calls = []

function installMocks() {
  calls = []
  const handler = async (url, opts = {}) => {
    const isWhmRoot = /:2087\/json-api\/cpanel$/.test(url) &&
      String(opts.headers?.Authorization || '').startsWith('whm ')
    calls.push({ url, isWhmRoot, func: opts.params?.cpanel_jsonapi_func })
    if (isWhmRoot) {
      return {
        status: 200,
        data: { cpanelresult: { data: [{ result: 1, reason: 'ok via WHM-root' }], event: { result: 1 } } },
      }
    }
    // user-level cpsrvd → HTTP 200 carrying the login page HTML
    return { status: 200, data: LOGIN_HTML }
  }
  axios.get = handler
  axios.post = handler
}

function restoreAxios() {
  axios.get = origGet
  axios.post = origPost
}

function freshProxy() {
  delete require.cache[require.resolve(path.resolve(__dirname, '../cpanel-proxy.js'))]
  return require(path.resolve(__dirname, '../cpanel-proxy.js'))
}

let passed = 0
let failed = 0
async function runTest(name, fn) {
  try {
    await fn()
    console.log(`✓ ${name}`)
    passed++
  } catch (err) {
    console.log(`✗ ${name} — ${err.message}`)
    failed++
  }
}

async function main() {
  // ── (a) WHM_TOKEN present → transparent WHM-root success ──
  process.env.WHM_TOKEN = 'test-token'
  installMocks()
  let cpProxy = freshProxy()

  const cases = [
    ['addAddonDomain', () => cpProxy.addAddonDomain('u1', 'p', 'new.com', 'sub', 'primary.com')],
    ['removeAddonDomain', () => cpProxy.removeAddonDomain('u1', 'p', 'anydomain.com', 'sub', 'primary.com')],
    ['createSubdomain', () => cpProxy.createSubdomain('u1', 'p', 'blog', 'primary.com')],
    ['deleteSubdomain', () => cpProxy.deleteSubdomain('u1', 'p', 'blog.primary.com', 'primary.com')],
  ]

  for (const [name, call] of cases) {
    await runTest(`${name} — HTML-in-200 falls back via WHM-root (status:1)`, async () => {
      calls = []
      const r = await call()
      assert.strictEqual(r.status, 1, `expected status 1, got ${JSON.stringify(r)}`)
      assert.strictEqual(r.via, 'whm-fallback', `expected via:whm-fallback, got ${r.via}`)
      assert.ok(calls.some(c => c.isWhmRoot), 'WHM-root call was never attempted')
    })
  }

  // ── (b) WHM_TOKEN missing → CPANEL_AUTH_FAILURE surfaced (no generic error) ──
  restoreAxios()
  delete process.env.WHM_TOKEN
  installMocks()
  cpProxy = freshProxy()

  const casesNoToken = [
    ['addAddonDomain', () => cpProxy.addAddonDomain('u1', 'p', 'new.com', 'sub', 'primary.com')],
    ['removeAddonDomain', () => cpProxy.removeAddonDomain('u1', 'p', 'anydomain.com', 'sub', 'primary.com')],
    ['createSubdomain', () => cpProxy.createSubdomain('u1', 'p', 'blog', 'primary.com')],
    ['deleteSubdomain', () => cpProxy.deleteSubdomain('u1', 'p', 'blog.primary.com', 'primary.com')],
  ]

  for (const [name, call] of casesNoToken) {
    await runTest(`${name} — HTML-in-200 with no WHM_TOKEN → CPANEL_AUTH_FAILURE`, async () => {
      const r = await call()
      assert.strictEqual(r.status, 0, `expected status 0, got ${JSON.stringify(r)}`)
      assert.strictEqual(r.code, 'CPANEL_AUTH_FAILURE', `expected CPANEL_AUTH_FAILURE, got ${JSON.stringify(r)}`)
    })
  }

  restoreAxios()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { restoreAxios(); console.error(e); process.exit(1) })
