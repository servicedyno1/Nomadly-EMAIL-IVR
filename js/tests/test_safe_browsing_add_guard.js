/* global process */
// Verifies the add-time Safe Browsing guard: a flagged domain is REJECTED (422
// domain_flagged) before being added to any product; clean domains pass through.
//  • unit: safeBrowsingMonitor.assertAddable (mock sb: safe / flagged / unconfigured / error)
//  • integration: POST /shortener/domains rejects a flagged domain (safe-browsing-service
//    patched so a specific domain reports flagged — no real Google call needed).
require('dotenv').config({ path: '/app/backend/.env' })
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')
const mon = require('/app/js/safe-browsing-monitor')
const sbs = require('/app/js/safe-browsing-service')
const { registerShortenerRoutes } = require('/app/js/reseller-shortener')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const OWNER = '990000444'
const FLAGGED = 'go.flagged-add.com'
const CLEAN = 'go.clean-add.com'

const results = []
const ok = (n, c, d) => results.push([n, !!c, d])

function post(port, path, body) {
  const data = JSON.stringify(body)
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (_) {} resolve({ status: res.statusCode, json: j }) })
    }); r.on('error', e => resolve({ err: e.message })); r.write(data); r.end()
  })
}

;(async () => {
  const client = new MongoClient(MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)

  // ---- unit: assertAddable ----
  const flaggedSb = { isConfigured: () => true, checkDomain: async (d) => d === FLAGGED ? { safe: false, threats: [{ type: 'MALWARE' }] } : { safe: true, threats: [] } }
  const gBad = await mon.assertAddable(FLAGGED, { sb: flaggedSb })
  ok('assertAddable rejects flagged', gBad.allowed === false && gBad.status === 422 && gBad.error === 'domain_flagged' && gBad.threats.includes('MALWARE') && /flagged by Google Safe Browsing/i.test(gBad.message || ''), gBad)
  const gGood = await mon.assertAddable(CLEAN, { sb: flaggedSb })
  ok('assertAddable allows clean', gGood.allowed === true, gGood)
  const gUnconf = await mon.assertAddable(FLAGGED, { sb: { isConfigured: () => false, checkDomain: async () => ({}) } })
  ok('assertAddable fail-open when unconfigured', gUnconf.allowed === true && gUnconf.skipped === 'unconfigured', gUnconf)
  const gErr = await mon.assertAddable(FLAGGED, { sb: { isConfigured: () => true, checkDomain: async () => { throw new Error('boom') } } })
  ok('assertAddable fail-open on check error', gErr.allowed === true && gErr.skipped === 'check_failed', gErr)

  // ---- integration: shortener POST rejects flagged (patch the shared sb module) ----
  const origCheck = sbs.checkDomain, origConf = sbs.isConfigured
  sbs.isConfigured = () => true
  sbs.checkDomain = async (d) => (String(d).toLowerCase() === FLAGGED ? { safe: false, threats: [{ type: 'SOCIAL_ENGINEERING' }] } : { safe: true, threats: [] })

  const app = express(); app.use(express.json()); const router = express.Router()
  registerShortenerRoutes({
    router,
    apiKeyAuth: (req, _res, next) => { req.reseller = { ownerChatId: OWNER }; next() },
    h: (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
    col: (name) => db.collection(name),
    getDb: () => db, isLive: () => true, mode: () => 'live', log: () => {}, billedProvision: async () => {},
  })
  app.use('/reseller/v1', router)
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  const rBad = await post(port, '/reseller/v1/shortener/domains', { domain: FLAGGED, source: 'existing' })
  ok('shortener activate flagged → 422 domain_flagged', rBad.status === 422 && rBad.json?.error === 'domain_flagged' && Array.isArray(rBad.json?.threats), { s: rBad.status, j: rBad.json })

  // clean domain passes the SB guard → proceeds to ownership check (404 not_found, not 422)
  const rClean = await post(port, '/reseller/v1/shortener/domains', { domain: CLEAN, source: 'existing' })
  ok('shortener activate clean → passes guard (not 422)', rClean.status !== 422 && rClean.json?.error !== 'domain_flagged', { s: rClean.status, j: rClean.json })

  server.close()
  sbs.checkDomain = origCheck; sbs.isConfigured = origConf
  await db.collection('shortenerActivations').deleteMany({ _id: { $in: [FLAGGED, CLEAN] } })
  await client.close()

  let pass = true
  for (const [n, good, d] of results) { console.log(`${good ? 'PASS' : 'FAIL'} — ${n}${good ? '' : ' :: ' + JSON.stringify(d)}`); if (!good) pass = false }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch(e => { console.error('ERROR', e); process.exit(2) })
