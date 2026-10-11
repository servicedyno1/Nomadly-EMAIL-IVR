/* global process */
// Local verification for hosting visitor totals (Issue: total visitors since linked).
//  • unit: hosting-visits.totalVisitors merges stored history + live top-up (live authoritative on overlap)
//  • integration: GET /hosting/:user/visitors (reseller-hosting-mgmt mounted on LOCAL db, mock auth,
//    cf-service.getZoneVisitsRange patched — no real Cloudflare call).
require('dotenv').config({ path: '/app/backend/.env' })
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')
const hv = require('/app/js/hosting-visits')
const cf = require('/app/js/cf-service')
const { registerHostingMgmtRoutes } = require('/app/js/reseller-hosting-mgmt')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const OWNER = '660000777'
const USER = 'visitsuser'
const MAIN = 'visits-main.com'
const ADDON = 'visits-addon.com'
const ZONE = 'zone-visits-test'

const results = []
const ok = (n, c, d) => results.push([n, !!c, d])
function get(port, path) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Authorization: 'Bearer t' } }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch (_) {} resolve({ status: res.statusCode, json: j }) })
    }); r.on('error', e => resolve({ err: e.message })); r.end()
  })
}

;(async () => {
  const client = new MongoClient(MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)
  await db.collection(hv.COLLECTION).deleteMany({ zoneId: { $in: [ZONE, 'zmerge'] } })

  // ---- unit: totalVisitors merge ----
  await hv.storeDays(db, { zoneId: 'zmerge', domain: 'm.com', chatId: OWNER }, [
    { date: '2026-10-01', uniques: 5, pageViews: 2, requests: 20 },
    { date: '2026-10-02', uniques: 7, pageViews: 3, requests: 30 }, // will be overridden by live
  ])
  const mockCf = { getZoneVisitsRange: async () => ({ success: true, days: [
    { date: '2026-10-02', uniques: 9, pageViews: 4, requests: 33 }, // overlap → live wins
    { date: '2026-10-03', uniques: 4, pageViews: 1, requests: 10 }, // new
  ] }) }
  const merged = await hv.totalVisitors(db, { zoneId: 'zmerge', domain: 'm.com', chatId: OWNER, since: '2026-10-01', until: '2026-10-03', cfClient: mockCf })
  ok('merge total_visitors 5+9+4=18', merged.total_visitors === 18, merged)
  ok('merge days_counted=3', merged.days_counted === 3, merged.days_counted)
  ok('merge coverage_from=2026-10-01', merged.coverage_from === '2026-10-01', merged.coverage_from)
  const persisted = await db.collection(hv.COLLECTION).findOne({ zoneId: 'zmerge', date: '2026-10-02' })
  ok('merge persists live override (10-02 uniques=9)', persisted && persisted.uniques === 9, persisted && persisted.uniques)

  // live error path (CF down) → stored only, live_error set
  const errCf = { getZoneVisitsRange: async () => ({ success: false, error: 'boom', days: [] }) }
  const storedOnly = await hv.totalVisitors(db, { zoneId: 'zmerge', domain: 'm.com', chatId: OWNER, since: '2026-10-01', until: '2026-10-03', cfClient: errCf })
  ok('live error → stored sum (5+9+4=18) + live_error', storedOnly.total_visitors === 18 && storedOnly.live_error === 'boom', { t: storedOnly.total_visitors, e: storedOnly.live_error })

  // ---- integration: endpoint ----
  const linkedAt = new Date('2026-09-15T00:00:00Z')
  await db.collection('cpanelAccounts').updateOne({ _id: USER }, { $set: {
    _id: USER, cpUser: USER, chatId: OWNER, domain: MAIN, addonDomains: [ADDON], plan: 'Golden Anti-Red HostPanel (1-Month)',
    provisionState: 'completed', cfZoneId: ZONE, createdAt: linkedAt,
  } }, { upsert: true })
  // seed lifetime history for the main zone (older than CF retention) + patch CF for recent top-up
  await hv.storeDays(db, { zoneId: ZONE, domain: MAIN, chatId: OWNER }, [
    { date: '2026-09-15', uniques: 100, pageViews: 50, requests: 400 },
    { date: '2026-09-16', uniques: 120, pageViews: 60, requests: 500 },
  ])
  const origRange = cf.getZoneVisitsRange
  cf.getZoneVisitsRange = async () => ({ success: true, days: [{ date: hv.dayStr(Date.now()), uniques: 30, pageViews: 10, requests: 90 }] })

  const app = express(); const router = express.Router()
  registerHostingMgmtRoutes({
    router,
    apiKeyAuth: (req, _res, next) => { req.reseller = { ownerChatId: OWNER, keyId: 'k' }; next() },
    h: (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
    col: (name) => db.collection(name),
    getDb: () => db,
    loadOwnedCpanel: async (req, user) => db.collection('cpanelAccounts').findOne({ _id: user, chatId: req.reseller.ownerChatId }),
    isLive: () => false, mode: () => 'dry_run', log: () => {},
  })
  app.use('/reseller/v1', router)
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  const v = await get(port, `/reseller/v1/hosting/${USER}/visitors`)
  ok('endpoint 200', v.status === 200, { s: v.status, j: v.json })
  ok('endpoint total_visitors=100+120+30=250', v.json?.total_visitors === 250, v.json)
  ok('endpoint domain=main + is_main', v.json?.domain === MAIN && v.json?.is_main === true, v.json)
  ok('endpoint linked_at reflects account createdAt', (v.json?.linked_at || '').startsWith('2026-09-15'), v.json?.linked_at)
  ok('endpoint source=cloudflare + coverage_complete true', v.json?.source === 'cloudflare' && v.json?.coverage_complete === true, { s: v.json?.source, c: v.json?.coverage_complete })

  const bad = await get(port, `/reseller/v1/hosting/${USER}/visitors?domain=not-mine.com`)
  ok('endpoint not-associated → 404', bad.status === 404 && bad.json?.error === 'domain_not_associated', { s: bad.status, e: bad.json?.error })

  server.close(); cf.getZoneVisitsRange = origRange
  await db.collection('cpanelAccounts').deleteOne({ _id: USER })
  await db.collection(hv.COLLECTION).deleteMany({ zoneId: { $in: [ZONE, 'zmerge'] } })
  await client.close()

  let pass = true
  for (const [n, good, d] of results) { console.log(`${good ? 'PASS' : 'FAIL'} — ${n}${good ? '' : ' :: ' + JSON.stringify(d)}`); if (!good) pass = false }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch(e => { console.error('ERROR', e); process.exit(2) })
