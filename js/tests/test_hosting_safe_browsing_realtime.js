/* global process */
// Local E2E for GET /hosting/:user/safe-browsing (realtime). Mounts the hosting-mgmt
// routes against the LOCAL db with a mock API-key auth (no prod reseller DB touched),
// seeds a hosting account with a main + addon domain, and asserts association +
// response shape. Safe-Browsing checks hit the real Google API (test domains = safe).
require('dotenv').config({ path: '/app/backend/.env' })
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')
const { registerHostingMgmtRoutes } = require('/app/js/reseller-hosting-mgmt')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const OWNER = '770000222'
const USER = 'sbrealtimeuser'
const MAIN = 'sbrealtime-main.com'
const ADDON = 'sbrealtime-addon.com'

const results = []
const ok = (n, c, d) => results.push([n, !!c, d])

function get(port, path) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Authorization: 'Bearer test' } }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (_) {} resolve({ status: res.statusCode, json: j }) })
    })
    r.on('error', e => resolve({ err: e.message })); r.end()
  })
}

;(async () => {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  await db.collection('cpanelAccounts').updateOne({ _id: USER }, { $set: {
    _id: USER, cpUser: USER, chatId: OWNER, domain: MAIN, addonDomains: [{ domain: ADDON }],
    plan: 'Premium Anti-Red HostPanel (30 Days)', provisionState: 'completed', whmHost: null,
  } }, { upsert: true })

  const app = express()
  const router = express.Router()
  registerHostingMgmtRoutes({
    router,
    apiKeyAuth: (req, _res, next) => { req.reseller = { ownerChatId: OWNER, keyId: 'k1' }; next() },
    h: (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
    col: (name) => db.collection(name),
    getDb: () => db,
    loadOwnedCpanel: async (req, user) => db.collection('cpanelAccounts').findOne({ _id: user, chatId: req.reseller.ownerChatId }),
    isLive: () => false,
    mode: () => 'dry_run',
    log: () => {},
  })
  app.use('/reseller/v1', router)
  const server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  // 1) all plan domains
  const all = await get(port, `/reseller/v1/hosting/${USER}/safe-browsing`)
  ok('all: 200', all.status === 200, all.status)
  const doms = (all.json?.results || []).map(r => r.domain).sort()
  ok('all: returns main+addon', JSON.stringify(doms) === JSON.stringify([ADDON, MAIN].sort()), doms)
  ok('all: realtime+configured flags', all.json?.realtime === true && all.json?.configured === true, all.json && { r: all.json.realtime, c: all.json.configured })
  const mainRow = (all.json?.results || []).find(r => r.domain === MAIN)
  ok('all: main is_main true, has safe field', mainRow && mainRow.is_main === true && 'safe' in mainRow, mainRow)
  ok('all: flagged_count numeric', typeof all.json?.flagged_count === 'number', all.json?.flagged_count)

  // 2) single associated domain
  const one = await get(port, `/reseller/v1/hosting/${USER}/safe-browsing?domain=${MAIN}`)
  ok('single: 200', one.status === 200, one.status)
  ok('single: one result = main', (one.json?.results || []).length === 1 && one.json.results[0].domain === MAIN, one.json?.results)
  ok('single: echoes domain', one.json?.domain === MAIN, one.json?.domain)

  // 3) domain NOT associated → 404
  const bad = await get(port, `/reseller/v1/hosting/${USER}/safe-browsing?domain=not-mine.com`)
  ok('not-associated: 404', bad.status === 404 && bad.json?.error === 'domain_not_associated', { s: bad.status, e: bad.json?.error })
  ok('not-associated: lists plan_domains', Array.isArray(bad.json?.plan_domains) && bad.json.plan_domains.includes(MAIN), bad.json?.plan_domains)

  // 4) unknown hosting user → 404 not_found
  const nouser = await get(port, `/reseller/v1/hosting/nope/safe-browsing`)
  ok('unknown user: 404', nouser.status === 404, nouser.status)

  server.close()
  await db.collection('cpanelAccounts').deleteOne({ _id: USER })
  await client.close()

  let pass = true
  for (const [n, good, d] of results) { console.log(`${good ? 'PASS' : 'FAIL'} — ${n}${good ? '' : ' :: ' + JSON.stringify(d)}`); if (!good) pass = false }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch(e => { console.error('ERROR', e); process.exit(2) })
