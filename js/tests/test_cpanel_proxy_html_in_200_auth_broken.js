/**
 * Regression test — uapi() detects "cpsrvd returned HTTP 200 with cPanel
 * login-page HTML" and normalises it to CPANEL_AUTH_FAILURE. This is the
 * @Devils_gods (chatId 1446310286, cpUser auth62f9, 2026-08-30) bug:
 * clicking Edit on config.php in the panel returned `<!DOCTYPE html>...`
 * as the file "content" because get_file_content had NO auth-broken
 * detection (unlike uploadFile which already had the same check).
 *
 * Without the fix, uapi() returned `sanitize(<html-login-page>)` as if it
 * were valid data — the frontend blindly rendered it in the code editor.
 * With the fix, uapi() returns `{status:0, code:'CPANEL_AUTH_FAILURE',
 * httpStatus:200}` so the route can trigger the WHM-root fallback.
 */

const path = require('path')
process.env.WHM_HOST = 'whm.test.local'
// Keep CPANEL_API_URL empty so getBaseUrl uses `https://whm.test.local:2083`

const axios = require('axios')
const assert = require('assert')

const origGet = axios.get
const origPost = axios.post

let calls = []

function installMocks({ mode }) {
  calls = []
  const handler = async (url, ...rest) => {
    calls.push({ url, mode })
    if (mode === 'html-in-200') {
      // cpsrvd returns 200 OK with the cPanel login page HTML — no thrown err
      return {
        status: 200,
        data: '<!DOCTYPE html>\n<html>\n<head><title>cPanel Login</title></head>\n<body>...</body>\n</html>',
      }
    }
    if (mode === 'clean-json') {
      return {
        status: 200,
        data: { status: 1, data: { content: 'echo "hello";' }, errors: null, messages: null },
      }
    }
    if (mode === 'proper-401') {
      const err = new Error('Request failed with status code 401')
      err.response = { status: 401, data: '<!DOCTYPE html>\n<html><head><title>cPanel Login</title></head></html>' }
      throw err
    }
    throw new Error('unexpected mode ' + mode)
  }
  axios.get = handler
  axios.post = handler
}

function restoreAxios() {
  axios.get = origGet
  axios.post = origPost
}

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
  installMocks({ mode: 'html-in-200' })
  await runTest('getFileContent — HTTP 200 with login-page HTML is treated as auth failure', async () => {
    const r = await cpProxy.getFileContent('user', 'stalepass', '/home/user/public_html', 'config.php')
    assert.strictEqual(r.status, 0, 'must not report status:1 when body is login-page HTML')
    assert.strictEqual(r.code, 'CPANEL_AUTH_FAILURE', 'must tag as CPANEL_AUTH_FAILURE so routes can trigger WHM-root fallback')
    assert.strictEqual(r.httpStatus, 200)
    assert.strictEqual(r.data, null, 'must NOT surface the raw HTML as data (previous bug leaked it to the editor)')
  })

  installMocks({ mode: 'html-in-200' })
  await runTest('saveFileContent — HTTP 200 with login-page HTML is treated as auth failure', async () => {
    const r = await cpProxy.saveFileContent('user', 'stalepass', '/home/user/public_html', 'config.php', 'echo "new";')
    assert.strictEqual(r.status, 0)
    assert.strictEqual(r.code, 'CPANEL_AUTH_FAILURE')
    assert.strictEqual(r.data, null)
  })

  installMocks({ mode: 'clean-json' })
  await runTest('getFileContent — normal JSON body is NOT flagged as auth failure', async () => {
    const r = await cpProxy.getFileContent('user', 'goodpass', '/home/user/public_html', 'config.php')
    assert.strictEqual(r.status, 1, 'clean body must pass through')
    assert.notStrictEqual(r.code, 'CPANEL_AUTH_FAILURE')
    assert.strictEqual(r.data?.content, 'echo "hello";')
  })

  installMocks({ mode: 'proper-401' })
  await runTest('getFileContent — proper HTTP 401 remains auth-broken (existing behaviour intact)', async () => {
    const r = await cpProxy.getFileContent('user', 'stalepass', '/home/user/public_html', 'config.php')
    assert.strictEqual(r.status, 0)
    assert.strictEqual(r.code, 'CPANEL_AUTH_FAILURE')
    assert.strictEqual(r.httpStatus, 401)
  })

  // api2() — Fileman::fileop with HTTP 200 + login-page HTML (@Devils_gods
  // hardening after testing-agent flagged the coverage gap on 2026-08-30).
  installMocks({ mode: 'html-in-200' })
  await runTest('api2() — HTML-in-200 for Fileman::fileop is treated as CPANEL_AUTH_FAILURE', async () => {
    // Call renameFile which internally uses api2()
    const r = await cpProxy.renameFile('user', 'stalepass', '/home/user/public_html', 'a.txt', 'b.txt')
    assert.strictEqual(r.status, 0)
    assert.strictEqual(r.code, 'CPANEL_AUTH_FAILURE', 'api2 must tag HTML-in-200 as auth failure so route WHM-root fallback fires')
    assert.strictEqual(r.data, null)
  })

  restoreAxios()
  if (process.exitCode) process.exit(process.exitCode)
  console.log('\nAll uapi HTML-in-200 auth-broken detection tests passed.')
})()
