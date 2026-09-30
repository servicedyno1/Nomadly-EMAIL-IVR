/**
 * Route-level regression test — WHM-root impersonation fallback for
 * /files/content, /files/save, /files/rename, /files/copy, /files/move,
 * /files/compress when the user-level cPanel Basic Auth is broken.
 *
 * @Devils_gods (chatId 1446310286, cpUser auth62f9, 2026-08-30):
 *   • Clicking Edit on config.php showed `<!DOCTYPE html>` (login page)
 *   • "i still cant move files and edit them"
 *   • Railway logs confirmed `[cPanel Proxy API2] Fileman::fileop error
 *     (403): Access denied [AUTH]` on every attempt with NO WHM fallback
 *     line — the fallback was only wired for list_files / mkdir / delete /
 *     extract / upload, not for content / save / fileop-based ops.
 *
 * This test:
 *   1. Mounts createCpanelRoutes with a mocked cpanelAccounts collection.
 *   2. Mints a real JWT for a fake `testcp` account.
 *   3. Monkey-patches axios so user-level API returns 403 "Access denied"
 *      and WHM-root API returns success.
 *   4. Hits each of the 6 routes and asserts:
 *      • Response `status:1` with `via:'whm-fallback'`
 *      • WHM-root axios call was made with correct impersonation params
 */

const path = require('path')
const assert = require('assert')

process.env.WHM_HOST = 'whm.test.local'
process.env.WHM_TOKEN = 'test-token'
process.env.WHM_USERNAME = 'root'
process.env.JWT_SECRET = 'test-secret-for-cpanel-routes-fallback'
delete process.env.WHM_API_URL // force :2087 direct route in tests

const axios = require('axios')
const express = require('express')
const http = require('http')

let calls = []
const origGet = axios.get
const origPost = axios.post
const origCreate = axios.create

function installAxiosMocks({ userLevelFails = true } = {}) {
  calls = []
  const handler = async (url, arg2, arg3) => {
    // Normalise opts location across GET (url, opts) and POST (url, body, opts) shapes.
    let opts
    if (arg3 && typeof arg3 === 'object') opts = arg3
    else if (arg2 && typeof arg2 === 'object' && (arg2.params || arg2.headers || arg2.auth || arg2.baseURL !== undefined)) opts = arg2
    else opts = { headers: {} }

    const authHeader = opts?.headers?.Authorization || ''
    const isWhmRoot = authHeader.startsWith('whm ')
    calls.push({ url, params: opts?.params || {}, isWhmRoot, hasBasicAuth: !!(opts?.auth && opts.auth.username) })

    if (isWhmRoot) {
      const func = opts.params?.cpanel_jsonapi_func
      const apiver = opts.params?.cpanel_jsonapi_apiversion
      if (apiver === 3) {
        return {
          status: 200,
          data: {
            module: 'Fileman',
            apiversion: 3,
            result: {
              status: 1,
              data: func === 'get_file_content' ? { content: 'real-file-content-here' } : {},
              errors: null,
              messages: null,
            },
          },
        }
      }
      return {
        status: 200,
        data: {
          cpanelresult: {
            apiversion: '2',
            data: [{ result: 1, reason: `${func} ok via WHM-root` }],
            event: { result: 1 },
          },
        },
      }
    }

    if (userLevelFails) {
      const err = new Error('Request failed with status code 403')
      err.response = { status: 403, data: { cpanelresult: { error: 'Access denied', data: { reason: 'Access denied', result: '0' } } } }
      throw err
    }
    return { status: 200, data: { cpanelresult: { data: [{ result: 1, reason: 'ok' }] } } }
  }
  axios.get = handler
  axios.post = handler
  // Route code calls `axios.create({ baseURL, headers: { Authorization: 'whm root:...' } })`.
  // The created instance has its OWN .get / .post that don't route through our
  // module-level mock, so we need to intercept .create() and hand back an
  // instance whose .get/.post reuse the same handler but merge instance
  // headers (so the `whm ` Authorization is visible to the handler).
  axios.create = (instOpts = {}) => {
    const baseHeaders = instOpts.headers || {}
    const wrap = async (url, arg2, arg3) => {
      // Merge instance-level headers into the per-call opts so the handler
      // sees the Authorization header.
      const opts = { ...(arg3 || arg2 || {}) }
      opts.headers = { ...baseHeaders, ...(opts.headers || {}) }
      return handler(url, opts, undefined)
    }
    return { get: wrap, post: wrap, request: wrap }
  }
}

function restoreAxios() {
  axios.get = origGet
  axios.post = origPost
  axios.create = origCreate
}

// Fresh-require after env is set
delete require.cache[require.resolve(path.resolve(__dirname, '../cpanel-proxy.js'))]
delete require.cache[require.resolve(path.resolve(__dirname, '../cpanel-auth.js'))]
delete require.cache[require.resolve(path.resolve(__dirname, '../cpanel-routes.js'))]

const cpAuth = require(path.resolve(__dirname, '../cpanel-auth.js'))
const { createCpanelRoutes } = require(path.resolve(__dirname, '../cpanel-routes.js'))

// Mock the cpanelAccounts collection so resolveCpPass finds a fake doc.
// We encrypt a real cpPass through cpanel-auth so decrypt roundtrips.
const fakePass = 'stale-pass-hash'
const encPass = cpAuth.encrypt(fakePass)
const fakeAccount = {
  _id: 'testcp',
  cpUser: 'testcp',
  cpPass_encrypted: encPass.encrypted,
  cpPass_iv: encPass.iv,
  cpPass_tag: encPass.tag,
  domain: 'example.com',
  whmHost: null, // uses default WHM_HOST
  plan: 'Premium Anti-Red (1-Week)',
  chatId: '12345',
  addonDomains: [],
}
const fakeCol = {
  findOne: async () => fakeAccount,
}

// Mint a valid session token
const token = cpAuth.createToken({ cpUser: 'testcp', domain: 'example.com', chatId: '12345' })

// Build the app + server
const app = express()
app.use(express.json())
app.use('/panel', createCpanelRoutes(() => fakeCol, { notifyAdmin: () => {} }))
const server = app.listen(0)
const port = server.address().port

async function req(method, url, body) {
  const options = {
    hostname: '127.0.0.1',
    port,
    path: url,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }
  return new Promise((resolve, reject) => {
    const r = http.request(options, (res) => {
      let chunks = ''
      res.on('data', c => chunks += c)
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : {} })
        } catch (e) {
          resolve({ status: res.statusCode, body: chunks })
        }
      })
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

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
  installAxiosMocks()
  await runTest('/files/content — 403 on user-level → WHM-root fallback returns file content', async () => {
    const r = await req('GET', '/panel/files/content?dir=/home/testcp/public_html&file=config.php')
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 1)
    assert.strictEqual(r.body.via, 'whm-fallback')
    assert.strictEqual(r.body.data?.content, 'real-file-content-here')
    // WHM-root call must impersonate the user
    const whmCall = calls.find(c => c.isWhmRoot)
    assert.ok(whmCall, 'expected a WHM-root call')
    assert.strictEqual(whmCall.params.cpanel_jsonapi_user, 'testcp')
    assert.strictEqual(whmCall.params.cpanel_jsonapi_module, 'Fileman')
    assert.strictEqual(whmCall.params.cpanel_jsonapi_func, 'get_file_content')
  })

  installAxiosMocks()
  await runTest('/files/save — 403 on user-level → WHM-root fallback succeeds', async () => {
    const r = await req('POST', '/panel/files/save', { dir: '/home/testcp/public_html', file: 'config.php', content: 'echo "new";' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 1)
    assert.strictEqual(r.body.via, 'whm-fallback')
    const whmCall = calls.find(c => c.isWhmRoot)
    assert.strictEqual(whmCall?.params?.cpanel_jsonapi_func, 'save_file_content')
  })

  installAxiosMocks()
  await runTest('/files/rename — 403 on fileop → WHM-root fileop rename succeeds', async () => {
    const r = await req('POST', '/panel/files/rename', { dir: '/home/testcp/public_html', oldName: 'a.txt', newName: 'b.txt' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 1)
    assert.strictEqual(r.body.via, 'whm-fallback')
    const whmCall = calls.find(c => c.isWhmRoot)
    assert.strictEqual(whmCall?.params?.op, 'rename')
    assert.strictEqual(whmCall?.params?.sourcefiles, '/home/testcp/public_html/a.txt')
    assert.strictEqual(whmCall?.params?.destfiles, '/home/testcp/public_html/b.txt')
  })

  installAxiosMocks()
  await runTest('/files/copy — 403 on fileop → WHM-root fileop copy succeeds', async () => {
    const r = await req('POST', '/panel/files/copy', { dir: '/home/testcp/public_html', file: 'a.txt', destDir: '/home/testcp/public_html/backup' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 1)
    assert.strictEqual(r.body.via, 'whm-fallback')
    const whmCall = calls.find(c => c.isWhmRoot)
    assert.strictEqual(whmCall?.params?.op, 'copy')
  })

  installAxiosMocks()
  await runTest('/files/move — 403 on fileop → WHM-root fileop move succeeds', async () => {
    const r = await req('POST', '/panel/files/move', { dir: '/home/testcp/public_html', file: 'a.txt', destDir: '/home/testcp/public_html/backup' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 1)
    assert.strictEqual(r.body.via, 'whm-fallback')
    const whmCall = calls.find(c => c.isWhmRoot)
    assert.strictEqual(whmCall?.params?.op, 'move')
  })

  installAxiosMocks()
  await runTest('/files/compress — 403 on fileop → WHM-root fileop compress succeeds', async () => {
    const r = await req('POST', '/panel/files/compress', { dir: '/home/testcp/public_html', files: ['a.txt', 'b.txt'], destFile: 'bundle.zip' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.status, 1)
    assert.strictEqual(r.body.via, 'whm-fallback')
    const whmCall = calls.find(c => c.isWhmRoot)
    assert.strictEqual(whmCall?.params?.op, 'compress')
  })

  // Healthy path — no fallback triggered when user-level succeeds
  installAxiosMocks({ userLevelFails: false })
  await runTest('/files/move — healthy user-level succeeds → no WHM fallback', async () => {
    const r = await req('POST', '/panel/files/move', { dir: '/home/testcp/public_html', file: 'a.txt', destDir: '/home/testcp/public_html/backup' })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(r.body.via, undefined, 'via should NOT be set when no fallback happened')
    assert.strictEqual(calls.filter(c => c.isWhmRoot).length, 0, 'WHM-root must NOT be called on healthy path')
  })

  // ─── /domains/remove orphan-state guard (testing-agent 2026-08-30) ──
  // If cPanel removal HARD FAILS (even after WHM-root fallback), the panel
  // must NOT unpersist Mongo addonDomains or wipe Cloudflare records —
  // otherwise the domain disappears from our tracking while still attached
  // in cPanel, which is exactly the "i cant delete that domain" orphan
  // state @Devils_gods reported.
  await runTest('/domains/remove — HARD FAIL keeps Mongo + CF state (no orphan)', async () => {
    calls = []
    // Both user-level and WHM-root fail. cPanel simply refuses (e.g.,
    // domain doesn't exist yet but not "does not exist" wording).
    const handler = async () => {
      const err = new Error('boom')
      err.response = { status: 500, data: { cpanelresult: { error: 'server exploded' } } }
      throw err
    }
    axios.get = handler
    axios.post = handler
    axios.create = () => ({ get: handler, post: handler, request: handler })

    let pullCalled = false
    const col = {
      findOne: async () => ({ ...fakeAccount, addonDomains: ['orphan.com'] }),
      updateOne: async () => { pullCalled = true; return { modifiedCount: 1 } },
    }
    // Swap collection for this test only
    const app2 = express()
    app2.use(express.json())
    app2.use('/panel', createCpanelRoutes(() => col, { notifyAdmin: () => {} }))
    const server2 = app2.listen(0)
    const port2 = server2.address().port
    try {
      const r = await new Promise((resolve, reject) => {
        const rr = http.request({
          hostname: '127.0.0.1', port: port2, path: '/panel/domains/remove', method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }, (res) => {
          let d = ''
          res.on('data', c => d += c)
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }))
        })
        rr.on('error', reject)
        rr.write(JSON.stringify({ domain: 'orphan.com' }))
        rr.end()
      })
      assert.strictEqual(r.status, 502, 'must return 502 on hard failure so panel can show a proper error')
      assert.strictEqual(r.body.status, 0)
      assert.ok(r.body.errors, 'must surface errors[]')
      assert.strictEqual(pullCalled, false, 'must NOT $pull addonDomains when cPanel removal failed — that is exactly the orphan-state bug')
    } finally {
      server2.close()
    }
  })

  // "already-gone" reconcile path: cPanel returns "does not exist" — our
  // Mongo/CF cleanup MUST still run and the response MUST report success.
  await runTest('/domains/remove — "already gone" from cPanel reconciles Mongo + CF', async () => {
    calls = []
    // User-level + WHM-root both come back with a "does not exist" error.
    // We simulate this at the cpProxy.removeAddonDomain layer by mocking
    // the direct HTTP response to a 200 with cPanel-level failure that
    // contains "does not exist" in the reason.
    const handler = async (url, arg2, arg3) => {
      let opts = arg3 || arg2 || {}
      const authHeader = opts?.headers?.Authorization || ''
      const isWhm = authHeader.startsWith('whm ')
      if (isWhm) {
        // WHM-root also finds it already gone
        return {
          status: 200,
          data: { cpanelresult: { data: [{ result: 0, reason: 'Domain does not exist' }] } },
        }
      }
      // user-level Basic Auth: same "does not exist"
      return {
        status: 200,
        data: { cpanelresult: { data: [{ result: 0, reason: 'Domain does not exist' }] } },
      }
    }
    axios.get = handler
    axios.post = handler
    axios.create = (instOpts = {}) => {
      const baseHeaders = instOpts.headers || {}
      const wrap = async (url, arg2, arg3) => {
        const opts = { ...(arg3 || arg2 || {}) }
        opts.headers = { ...baseHeaders, ...(opts.headers || {}) }
        return handler(url, opts, undefined)
      }
      return { get: wrap, post: wrap, request: wrap }
    }

    let pullDomain = null
    const col = {
      findOne: async () => ({ ...fakeAccount, addonDomains: ['staleold.com'] }),
      updateOne: async (_q, upd) => { pullDomain = upd?.$pull?.addonDomains; return { modifiedCount: 1 } },
    }
    const app3 = express()
    app3.use(express.json())
    app3.use('/panel', createCpanelRoutes(() => col, { notifyAdmin: () => {} }))
    const server3 = app3.listen(0)
    const port3 = server3.address().port
    try {
      const r = await new Promise((resolve, reject) => {
        const rr = http.request({
          hostname: '127.0.0.1', port: port3, path: '/panel/domains/remove', method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }, (res) => {
          let d = ''
          res.on('data', c => d += c)
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }))
        })
        rr.on('error', reject)
        rr.write(JSON.stringify({ domain: 'staleold.com' }))
        rr.end()
      })
      assert.strictEqual(r.status, 200, 'reconcile must return 200')
      assert.strictEqual(r.body.status, 1)
      assert.strictEqual(r.body.reconciled, true)
      assert.strictEqual(pullDomain, 'staleold.com', 'must $pull the stale domain from tracking on reconcile')
    } finally {
      server3.close()
    }
  })

  restoreAxios()
  server.close()
  if (process.exitCode) process.exit(process.exitCode)
  console.log('\nAll file-route WHM-root fallback tests passed.')
})().catch(e => {
  console.error('Fatal:', e)
  server.close()
  process.exit(1)
})
