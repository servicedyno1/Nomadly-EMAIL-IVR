/**
 * Regression test — WHM-root impersonation fallback for cPanel API2
 * SubDomain / AddonDomain calls when the user-level HTTP Basic Auth is
 * broken.
 *
 * Motivated by @greyhound110 / cpUser `laup48f8` (2026-08-30):
 *   User bought Premium Anti-Red (1-Week). WHM package has MAXSUB=unlimited,
 *   maxsub=unlimited on the account — plan clearly allows subdomains — but
 *   every panel "Add Subdomain" click silently failed. Live probe showed
 *   cPanel returning HTTP 403 "Access denied" for user-level Basic Auth,
 *   yet WHM-root impersonation (whm root:TOKEN + cpanel_jsonapi_user=X)
 *   worked. Same class of bug that /files/mkdir + /files/list_files already
 *   handled via WHM-root fallback — extended here to SubDomain::addsubdomain,
 *   SubDomain::delsubdomain, AddonDomain::addaddondomain,
 *   AddonDomain::deladdondomain.
 *
 * Black-box: monkey-patch axios so the direct user-level call returns 403
 * and the WHM-root call returns success. Assert the four cpanel-proxy
 * helpers return status:1 with via:'whm-fallback'.
 */

const path = require('path')
process.env.WHM_HOST = 'whm.test.local'
process.env.WHM_TOKEN = 'test-token'
process.env.WHM_USERNAME = 'root'
// CPANEL_API_URL empty so getBaseUrl uses `https://whm.test.local:2083`

const axios = require('axios')
const assert = require('assert')

const origGet = axios.get

// Log of every axios.get call and what URL it targeted.
let calls = []

function installMocks() {
  calls = []
  axios.get = async (url, opts = {}) => {
    calls.push({ url, params: opts.params || {}, hasWhmAuth: !!(opts.headers?.Authorization || '').startsWith('whm '), hasBasicAuth: !!(opts.auth && opts.auth.username) })
    // WHM-root call → https://<WHM_HOST>:2087/json-api/cpanel
    if (/\/json-api\/cpanel$/.test(url) && (opts.headers?.Authorization || '').startsWith('whm ')) {
      const func = opts.params?.cpanel_jsonapi_func
      // Simulate the impersonated cPanel op succeeding.
      return {
        status: 200,
        data: {
          cpanelresult: {
            apiversion: '2',
            data: [{ result: 1, reason: `${func} succeeded via WHM-root` }],
            event: { result: 1 },
          },
        },
      }
    }
    // User-level Basic Auth call → 403 "Access denied"
    if (/\/json-api\/cpanel$/.test(url) && opts.auth?.username) {
      const err = new Error('Request failed with status code 403')
      err.response = { status: 403, data: { cpanelresult: { error: 'Access denied', data: { reason: 'Access denied', result: '0' } } } }
      throw err
    }
    return { status: 200, data: {} }
  }
}

function restoreAxios() {
  axios.get = origGet
}

// Fresh-require cpanel-proxy so it picks up our mocked axios.
delete require.cache[require.resolve(path.resolve(__dirname, '../cpanel-proxy.js'))]
const cpProxy = require(path.resolve(__dirname, '../cpanel-proxy.js'))

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`\u2713 ${name}`)
  } catch (e) {
    console.error(`\u2717 ${name}\n   ${e.stack || e.message}`)
    process.exitCode = 1
  }
}

(async () => {
  installMocks()

  await runTest('createSubdomain falls back to WHM-root on user-level 403', async () => {
    const r = await cpProxy.createSubdomain('laup48f8', 'stalepass', 'blog', 'la-update-our-records.com', undefined)
    assert.strictEqual(r.status, 1, `expected status 1, got ${r.status} errors=${JSON.stringify(r.errors)}`)
    assert.strictEqual(r.via, 'whm-fallback')
    // First call user-level, second WHM-root. Both hit /json-api/cpanel.
    assert.strictEqual(calls.length, 2, `expected 2 axios calls, got ${calls.length}`)
    assert.strictEqual(calls[0].hasBasicAuth, true, 'first call must use user Basic Auth')
    assert.strictEqual(calls[1].hasWhmAuth, true, 'second call must use WHM root Authorization header')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_user, 'laup48f8', 'WHM call must impersonate cpUser')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_module, 'SubDomain')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_func, 'addsubdomain')
  })

  installMocks()
  await runTest('deleteSubdomain falls back to WHM-root on user-level 403', async () => {
    const r = await cpProxy.deleteSubdomain('laup48f8', 'stalepass', 'blog.la-update-our-records.com')
    assert.strictEqual(r.status, 1)
    assert.strictEqual(r.via, 'whm-fallback')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_module, 'SubDomain')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_func, 'delsubdomain')
    assert.strictEqual(calls[1].params.domain, 'blog.la-update-our-records.com')
  })

  installMocks()
  await runTest('addAddonDomain falls back to WHM-root on user-level 403', async () => {
    const r = await cpProxy.addAddonDomain('laup48f8', 'stalepass', 'extra.com', undefined, undefined)
    assert.strictEqual(r.status, 1)
    assert.strictEqual(r.via, 'whm-fallback')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_module, 'AddonDomain')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_func, 'addaddondomain')
    assert.strictEqual(calls[1].params.newdomain, 'extra.com')
  })

  installMocks()
  await runTest('removeAddonDomain falls back to WHM-root on user-level 403', async () => {
    const r = await cpProxy.removeAddonDomain('laup48f8', 'stalepass', 'extra.com', undefined, 'la-update-our-records.com')
    assert.strictEqual(r.status, 1)
    assert.strictEqual(r.via, 'whm-fallback')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_module, 'AddonDomain')
    assert.strictEqual(calls[1].params.cpanel_jsonapi_func, 'deladdondomain')
  })

  // Healthy account: user-level SUCCESS should NOT trigger fallback.
  await runTest('createSubdomain does NOT fall back when user-level succeeds', async () => {
    calls = []
    axios.get = async (url, opts = {}) => {
      calls.push({ url, params: opts.params || {}, hasWhmAuth: !!(opts.headers?.Authorization || '').startsWith('whm ') })
      // user-level Basic Auth path succeeds
      return { status: 200, data: { cpanelresult: { data: [{ result: 1, reason: 'ok' }] } } }
    }
    const r = await cpProxy.createSubdomain('healthyuser', 'goodpass', 'sub', 'example.com')
    assert.strictEqual(r.status, 1)
    assert.strictEqual(r.via, undefined, 'via should be unset when no fallback happened')
    assert.strictEqual(calls.length, 1, `expected exactly 1 axios call, got ${calls.length}`)
    assert.strictEqual(calls[0].hasWhmAuth, false)
  })

  // A cPanel error that is NOT auth-broken (e.g. "already exists") should
  // surface the error to the caller, not silently swallow it with a fallback.
  await runTest('createSubdomain does NOT fall back on non-auth cPanel errors', async () => {
    calls = []
    axios.get = async (url, opts = {}) => {
      calls.push({ url, params: opts.params || {} })
      // user-level returns 200 with cPanel-level failure (already exists)
      return { status: 200, data: { cpanelresult: { data: [{ result: 0, reason: 'subdomain already exists' }] } } }
    }
    const r = await cpProxy.createSubdomain('healthyuser', 'goodpass', 'blog', 'example.com')
    assert.strictEqual(r.status, 0)
    assert.deepStrictEqual(r.errors, ['subdomain already exists'])
    assert.strictEqual(calls.length, 1, 'no fallback for non-auth failures')
  })

  restoreAxios()
  if (process.exitCode) process.exit(process.exitCode)
  console.log('\nAll subdomain/addon WHM-root fallback tests passed.')
})()
