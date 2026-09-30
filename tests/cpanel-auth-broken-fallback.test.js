/**
 * cpanel-auth-broken-fallback.test.js
 *
 * Regression suite for the "user-level cPanel auth is dead" class of bugs.
 * A broken cpPass / cPHulk lockout / session-security policy makes cpsrvd
 * deny the user's HTTP Basic Auth in THREE shapes:
 *   1. HTTP 401 with the login page as body   (axios throws)
 *   2. HTTP 403 {"cpanelresult":{"error":"Access denied"}}  (axios throws)
 *   3. HTTP 200 with the raw login-page HTML as body  (axios RESOLVES → the
 *      silent one that leaked <!DOCTYPE html> into the file editor and made
 *      api2 callers invent a generic "Operation failed")
 *
 * The proxy must (a) normalise shape #3 to code:'CPANEL_AUTH_FAILURE', and
 * (b) transparently recover the domain/subdomain ops via WHM-root
 * impersonation (`Authorization: whm root:TOKEN` + cpanel_jsonapi_user=<u>).
 *
 * All mocked with nock — NO live network calls. Env MUST be set before the
 * proxy module is required (it reads CPANEL_API_URL / WHM_HOST at load time).
 */

'use strict'

// ── Set env BEFORE requiring the proxy (module-load-time consts) ──
process.env.CPANEL_API_URL = 'https://cpanel-test.local'
process.env.WHM_API_URL = 'https://whm-test.local'
process.env.WHM_HOST = 'whm-test.local'
process.env.WHM_TOKEN = 'test-whm-root-token'
process.env.WHM_USERNAME = 'root'
delete process.env.CF_ACCESS_CLIENT_ID
delete process.env.CF_ACCESS_CLIENT_SECRET

const nock = require('nock')
const cpProxy = require('../js/cpanel-proxy')

const CPANEL = 'https://cpanel-test.local'   // user-level (Basic Auth) origin
const WHM = 'https://whm-test.local'         // WHM-root impersonation origin

const LOGIN_HTML =
  '<!DOCTYPE html>\n<html><head><title>cPanel Login</title></head>' +
  '<body><form>Please log in</form></body></html>'

// A successful WHM-root api2 impersonation payload.
const WHM_OK = { cpanelresult: { event: { result: 1 }, data: [{ result: 1 }] } }

beforeAll(() => {
  nock.disableNetConnect()
})

afterEach(() => {
  nock.cleanAll()
})

afterAll(() => {
  nock.enableNetConnect()
})

describe('cPanel broken-user-auth fallback', () => {
  // 1 ─ uapi: HTTP 200 + login-page HTML → CPANEL_AUTH_FAILURE
  test('uapi() normalises HTTP-200 login-page HTML to CPANEL_AUTH_FAILURE', async () => {
    nock(CPANEL)
      .get('/execute/Fileman/get_file_content')
      .query(true)
      .reply(200, LOGIN_HTML, { 'Content-Type': 'text/html' })

    const r = await cpProxy.uapi('brokenuser', 'stalepass', 'Fileman', 'get_file_content', { dir: '/public_html', file: 'index.html' }, 'GET')
    expect(r.status).toBe(0)
    expect(r.code).toBe('CPANEL_AUTH_FAILURE')
    // Must NOT leak the raw HTML as "file content"
    expect(r.data).toBeNull()
  })

  // 2 ─ api2: HTTP 200 + login-page HTML → CPANEL_AUTH_FAILURE
  test('api2() normalises HTTP-200 login-page HTML to CPANEL_AUTH_FAILURE', async () => {
    nock(CPANEL)
      .get('/json-api/cpanel')
      .query(true)
      .reply(200, LOGIN_HTML, { 'Content-Type': 'text/html' })

    const r = await cpProxy.api2('brokenuser', 'stalepass', 'Email', 'listpopswithdisk', {})
    expect(r.status).toBe(0)
    expect(r.code).toBe('CPANEL_AUTH_FAILURE')
  })

  // 3 ─ createSubdomain recovers via WHM-root on login-page HTML
  test('createSubdomain() recovers via WHM-root on HTTP-200 login-page HTML', async () => {
    nock(CPANEL).get('/json-api/cpanel').query(true).reply(200, LOGIN_HTML, { 'Content-Type': 'text/html' })
    const whmScope = nock(WHM).get('/json-api/cpanel').query(true).reply(200, WHM_OK)

    const r = await cpProxy.createSubdomain('brokenuser', 'stalepass', 'shop', 'example.com', null)
    expect(r.status).toBe(1)
    expect(r.via).toBe('whm-fallback')
    expect(whmScope.isDone()).toBe(true)
  })

  // 4 ─ deleteSubdomain recovers via WHM-root on login-page HTML
  test('deleteSubdomain() recovers via WHM-root on HTTP-200 login-page HTML', async () => {
    nock(CPANEL).get('/json-api/cpanel').query(true).reply(200, LOGIN_HTML, { 'Content-Type': 'text/html' })
    const whmScope = nock(WHM).get('/json-api/cpanel').query(true).reply(200, WHM_OK)

    const r = await cpProxy.deleteSubdomain('brokenuser', 'stalepass', 'shop.example.com')
    expect(r.status).toBe(1)
    expect(r.via).toBe('whm-fallback')
    expect(whmScope.isDone()).toBe(true)
  })

  // 5 ─ addAddonDomain recovers via WHM-root on HTTP 401 (axios throws)
  test('addAddonDomain() recovers via WHM-root on HTTP 401', async () => {
    nock(CPANEL).get('/json-api/cpanel').query(true).reply(401, LOGIN_HTML, { 'Content-Type': 'text/html' })
    const whmScope = nock(WHM).get('/json-api/cpanel').query(true).reply(200, WHM_OK)

    const r = await cpProxy.addAddonDomain('brokenuser', 'stalepass', 'addon.com', null, null)
    expect(r.status).toBe(1)
    expect(r.via).toBe('whm-fallback')
    expect(whmScope.isDone()).toBe(true)
  })

  // 6 ─ removeAddonDomain recovers via WHM-root on HTTP 403 "Access denied"
  test('removeAddonDomain() recovers via WHM-root on HTTP 403 Access denied', async () => {
    nock(CPANEL).get('/json-api/cpanel').query(true).reply(403, 'Access denied')
    const whmScope = nock(WHM).get('/json-api/cpanel').query(true).reply(200, WHM_OK)

    const r = await cpProxy.removeAddonDomain('brokenuser', 'stalepass', 'addon.com', null, 'example.com')
    expect(r.status).toBe(1)
    expect(r.via).toBe('whm-fallback')
    expect(whmScope.isDone()).toBe(true)
  })

  // 7 ─ HEALTHY account never touches the WHM fallback
  test('healthy createSubdomain() never calls the WHM fallback', async () => {
    nock(CPANEL).get('/json-api/cpanel').query(true).reply(200, { cpanelresult: { data: [{ result: 1 }] } })
    // Register a WHM interceptor and assert it is NEVER consumed.
    const whmScope = nock(WHM).get('/json-api/cpanel').query(true).reply(200, WHM_OK)

    const r = await cpProxy.createSubdomain('gooduser', 'goodpass', 'shop', 'example.com', null)
    expect(r.status).toBe(1)
    expect(r.via).toBeUndefined()
    expect(whmScope.isDone()).toBe(false) // WHM endpoint NOT hit
  })

  // 8 ─ a genuine "already exists" error is surfaced, NOT swallowed / retried
  test('genuine "already exists" error is surfaced, not swallowed via fallback', async () => {
    nock(CPANEL).get('/json-api/cpanel').query(true).reply(200, {
      cpanelresult: { data: [{ result: 0, reason: 'The subdomain shop.example.com already exists.' }] },
    })
    const whmScope = nock(WHM).get('/json-api/cpanel').query(true).reply(200, WHM_OK)

    const r = await cpProxy.createSubdomain('gooduser', 'goodpass', 'shop', 'example.com', null)
    expect(r.status).toBe(0)
    expect(r.errors[0]).toMatch(/already exists/i)
    expect(r.via).toBeUndefined()
    expect(whmScope.isDone()).toBe(false) // healthy 200 result:0 must NOT retry via WHM
  })

  // 9 ─ createSubdomain uses the corrected docroot public_html/<sub>
  test('createSubdomain() uses the corrected docroot public_html/<sub>', async () => {
    let capturedDir
    nock(CPANEL)
      .get('/json-api/cpanel')
      .query((q) => { capturedDir = q.dir; return true })
      .reply(200, { cpanelresult: { data: [{ result: 1 }] } })

    const r = await cpProxy.createSubdomain('gooduser', 'goodpass', 'shop', 'example.com', null)
    expect(r.status).toBe(1)
    expect(capturedDir).toBe('public_html/shop')
  })
})
