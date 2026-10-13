// SMS app per-brand server resolution + brand-keyed discovery + update notice (2026-10).
// Run: node js/tests/test_sms_app_brand_resolution_2026-10.js
const fs = require('fs')
const path = require('path')
const vm = require('vm')

let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name) } else { fail++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra) : '') } }

const NOMADLY = 'https://2.speechcue.com'
const SMADAV = 'https://1.smadavspeech.com'
const DISCOVERY = 'https://nomadly-api-config.nomadly-cfg.workers.dev/'
const API_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'sms-app', 'www', 'js', 'api.js'), 'utf8')

// Load the real APK api.js in a sandbox: `up` = set of reachable hosts, `discovery` = Worker payload.
function loadApi({ brand, native = true, up = [], discovery = null, discoveryDown = false }) {
  const calls = []
  const fetch = async (url) => {
    calls.push(url)
    if (url.startsWith(DISCOVERY)) {
      if (discoveryDown || !discovery) throw new Error('worker unreachable')
      return { ok: true, status: 200, json: async () => discovery }
    }
    const host = up.find(h => url.startsWith(h))
    if (!host) throw new Error('net::ERR_NAME_NOT_RESOLVED')
    return { ok: true, status: 200, json: async () => ({ ok: true, url }) }
  }
  const window = { BRAND: brand, location: { origin: 'https://preview.example' }, Capacitor: native ? { isNativePlatform: () => true } : undefined }
  const ctx = { window, fetch, console: { log() {}, warn() {}, error() {} }, AbortController, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, encodeURIComponent, Storage: { getDeviceId: () => 'dev1' } }
  vm.createContext(ctx)
  vm.runInContext(`${API_SRC}\n;this.API = API; this.APIError = APIError;`, ctx)
  return { API: ctx.API, calls, ctx }
}
const nomadlyBrand = { slug: 'nomadly', name: 'Nomadly', apiBase: NOMADLY, version: '2.8.0' }
const smadavBrand = { slug: 'smadav', name: 'Smadav', apiBase: SMADAV, version: '2.8.0' }
const V2 = { apiBase: NOMADLY, brands: { nomadly: NOMADLY, smadav: SMADAV }, version: 2 }
const V1_SMADAV = { apiBase: SMADAV, version: 1 } // the live broken state found on 2026-10-13

;(async () => {
  console.log('\nA. APK resolver — baked brand server first, Cloudflare only as same-brand backup')
  {
    const { API, calls } = loadApi({ brand: nomadlyBrand, up: [NOMADLY, SMADAV], discovery: V1_SMADAV })
    ok('A1 nomadly uses its baked server even when the Worker points at Smadav', await API.baseUrl() === NOMADLY)
    ok('A1b Worker never consulted when baked server is up', !calls.some(u => u.startsWith(DISCOVERY)), calls)
  }
  {
    const { API, calls } = loadApi({ brand: smadavBrand, up: [NOMADLY, SMADAV], discovery: V2 })
    ok('A2 smadav uses 1.smadavspeech.com', await API.baseUrl() === SMADAV)
    ok('A2b probe hits /sms-app/config', calls[0] === `${SMADAV}/sms-app/config`, calls)
  }
  {
    const { API } = loadApi({ brand: smadavBrand, up: ['https://smadav-new.example'], discovery: { ...V2, brands: { ...V2.brands, smadav: 'https://smadav-new.example' } } })
    ok('A3 baked down → discovered brands.smadav backup used', await API.baseUrl() === 'https://smadav-new.example')
  }
  {
    const { API } = loadApi({ brand: smadavBrand, up: [NOMADLY], discovery: { apiBase: NOMADLY, version: 1 } })
    let err = null
    try { await API.baseUrl() } catch (e) { err = e }
    ok('A4 smadav NEVER falls over to the Nomadly server via a v1 payload', err && err.type === 'network' && /Smadav/.test(err.message), err && err.message)
  }
  {
    const { API } = loadApi({ brand: smadavBrand, up: [NOMADLY], discovery: V2 })
    let err = null
    try { await API.baseUrl() } catch (e) { err = e }
    ok('A5 smadav ignores brands.nomadly when its own server is down', !!err)
  }
  {
    const { API } = loadApi({ brand: nomadlyBrand, up: ['https://nomadly-moved.example'], discovery: { apiBase: 'https://nomadly-moved.example', version: 1 } })
    ok('A6 nomadly honours a legacy v1 apiBase as backup', await API.baseUrl() === 'https://nomadly-moved.example')
  }
  {
    const env = loadApi({ brand: nomadlyBrand, up: [], discoveryDown: true })
    let err = null
    try { await env.API.baseUrl() } catch (e) { err = e }
    ok('A7 nothing reachable → clean network error', err && err.type === 'network' && err.detail === 'server_unreachable', err && err.detail)
    env.ctx.fetch = undefined
    const { API } = env
    // bring the server back: failure must not be memoised
    vm.runInContext(`fetch = async (u) => ({ ok: true, status: 200, json: async () => ({}) })`, env.ctx)
    ok('A8 failure not memoised — next call recovers', await API.baseUrl() === NOMADLY)
  }
  {
    const { API } = loadApi({ brand: nomadlyBrand, native: false })
    ok('A9 browser preview uses same-origin /api', await API.baseUrl() === 'https://preview.example/api')
  }
  {
    const { API, calls } = loadApi({ brand: nomadlyBrand, up: [NOMADLY] })
    await API.sync('123')
    ok('A10 sync reports the brand version (2.8.0)', calls.some(u => u === `${NOMADLY}/sms-app/sync/123?version=2.8.0`), calls)
  }

  console.log('\nB. Discovery Worker merge (server side, never clobbers the other brand)')
  const { mergeDiscovery, buildWorkerSource } = require('../cloudflare-discovery-sync.js')
  {
    const r = mergeDiscovery(V2, 'smadav', SMADAV)
    ok('B1 v2 + same URL → unchanged', r.changed === false)
    const r2 = mergeDiscovery(V2, 'smadav', 'https://smadav-new.example')
    ok('B2 smadav move only edits brands.smadav; apiBase stays Nomadly', r2.changed && r2.brands.smadav === 'https://smadav-new.example' && r2.brands.nomadly === NOMADLY && r2.apiBase === NOMADLY, r2)
    const r3 = mergeDiscovery({ apiBase: NOMADLY, version: 1 }, 'smadav', SMADAV)
    ok('B3 v1(nomadly) + smadav sync → migrates, keeps legacy apiBase = Nomadly', r3.brands.nomadly === NOMADLY && r3.brands.smadav === SMADAV && r3.apiBase === NOMADLY, r3)
    const r4 = mergeDiscovery(V1_SMADAV, 'nomadly', NOMADLY)
    ok('B4 v1(smadav) + nomadly sync → apiBase back to Nomadly', r4.apiBase === NOMADLY && r4.brands.nomadly === NOMADLY, r4)
  }
  {
    const src = buildWorkerSource(V2.brands, NOMADLY)
    const sandbox = { addEventListener: (_e, cb) => { sandbox.handler = cb }, Response: class { constructor(b, o) { this.body = b; this.o = o } }, URL }
    vm.createContext(sandbox); vm.runInContext(src, sandbox)
    const ask = async (q) => { let p; sandbox.handler({ request: { method: 'GET', url: DISCOVERY + q }, respondWith: (x) => { p = x } }); return JSON.parse((await p).body) }
    ok('B5 Worker ?brand=smadav → Smadav', (await ask('?brand=smadav')).apiBase === SMADAV)
    ok('B6 Worker without brand (pre-2.8 APKs) → Nomadly', (await ask('')).apiBase === NOMADLY)
  }

  console.log('\nC. Brand-specific APK + update notice')
  const brandMod = require('../sms-app-brand.js')
  const svc = require('../sms-app-service.js')
  const saved = { b: process.env.CHAT_BOT_BRAND, s: process.env.SELF_URL_PROD }
  process.env.CHAT_BOT_BRAND = 'Smadav'; process.env.SELF_URL_PROD = SMADAV
  {
    const apk = brandMod.resolveApk()
    ok('C1 Smadav bot serves smadav-sms.apk', apk.file === 'smadav-sms.apk' && apk.exists && apk.downloadName === 'SmadavSMS.apk', apk)
    const msg = svc.buildAppUpdateAnnouncement('2.8.0')
    ok('C2 Smadav notice has the direct Smadav download link', msg.includes(`${SMADAV}/sms-app/download`), msg)
    ok('C3 Smadav notice tells users to uninstall the old Nomadly SMS app', /Uninstall the old <b>Nomadly SMS<\/b>/.test(msg))
  }
  process.env.CHAT_BOT_BRAND = 'Nomadly'; process.env.SELF_URL_PROD = NOMADLY
  {
    const apk = brandMod.resolveApk()
    ok('C4 Nomadly bot serves nomadly-sms.apk', apk.file === 'nomadly-sms.apk' && apk.exists, apk)
    const msg = svc.buildAppUpdateAnnouncement('2.8.0')
    ok('C5 Nomadly notice links 2.speechcue.com', msg.includes(`${NOMADLY}/sms-app/download`) && !msg.includes('smadav'), msg)
  }
  for (const [slug, base] of [['nomadly', NOMADLY], ['smadav', SMADAV]]) {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'static', `${slug}-sms.apk.json`), 'utf8'))
    ok(`C6 ${slug} APK manifest = v2.8.0 → ${base}`, m.version === '2.8.0' && m.apiBase === base && m.brand === slug, m)
  }
  process.env.CHAT_BOT_BRAND = saved.b; process.env.SELF_URL_PROD = saved.s

  console.log(`\nResult: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
