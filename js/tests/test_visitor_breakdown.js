/* global process */
// Local verification for Visitor Breakdown (top countries / devices / pages).
//  A) unit: cf-service.getDetailedZoneAnalytics parses a clientDeviceType breakdown → byDevice
//     (axios.post monkey-patched with canned Cloudflare GraphQL payloads — no real CF call).
//  B) integration: GET /reseller/v1/hosting/:user/visitors now carries top_countries /
//     top_devices / top_pages, and ?breakdown=false omits them (cf-service patched, LOCAL db).
require('dotenv').config({ path: '/app/backend/.env' })
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')
const axios = require('axios')
const hv = require('/app/js/hosting-visits')
const cf = require('/app/js/cf-service')
const { registerHostingMgmtRoutes } = require('/app/js/reseller-hosting-mgmt')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const OWNER = '660000888'
const USER = 'bdownuser'
const MAIN = 'bdown-main.com'
const ZONE = 'zone-bdown-test'

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
  // ===== A) UNIT — getDetailedZoneAnalytics device parsing =====
  const origPost = axios.post
  axios.post = async (url, body) => {
    const q = (body && body.query) || ''
    if (q.includes('httpRequests1dGroups')) {
      return { data: { data: { viewer: { zones: [{ httpRequests1dGroups: [
        { dimensions: { date: '2026-10-10' }, uniq: { uniques: 40 }, sum: { requests: 100, pageViews: 50, bytes: 0, threats: 0,
          countryMap: [{ clientCountryName: 'United States', requests: 80, threats: 1 }, { clientCountryName: 'Germany', requests: 20, threats: 0 }],
          responseStatusMap: [{ edgeResponseStatus: 200, requests: 95 }] } },
      ] }] } } } }
    }
    if (q.includes('clientDeviceType')) {
      return { data: { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [
        { dimensions: { clientDeviceType: 'desktop' }, count: 60 },
        { dimensions: { clientDeviceType: 'mobile' }, count: 30 },
        { dimensions: { clientDeviceType: 'tablet' }, count: 5 },
      ] }] } } } }
    }
    if (q.includes('clientRequestHTTPHost')) {
      return { data: { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ dimensions: { clientRequestHTTPHost: MAIN }, count: 90 }] }] } } } }
    }
    if (q.includes('clientRequestPath')) {
      return { data: { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [
        { dimensions: { clientRequestPath: '/', edgeResponseStatus: 200 }, count: 70 },
        { dimensions: { clientRequestPath: '/login', edgeResponseStatus: 200 }, count: 20 },
      ] }] } } } }
    }
    if (q.includes('userAgent')) {
      return { data: { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ dimensions: { userAgent: 'Mozilla/5.0' }, count: 88 }] }] } } } }
    }
    return { data: { data: { viewer: { zones: [] } } } }
  }

  const det = await cf.getDetailedZoneAnalytics('zoneX', 7)
  axios.post = origPost
  ok('detailed success', det && det.success === true, det && det.error)
  ok('byDevice present + ordered desktop>mobile>tablet',
    Array.isArray(det.byDevice) && det.byDevice.length === 3 &&
    det.byDevice[0].device === 'desktop' && det.byDevice[0].requests === 60 &&
    det.byDevice[1].device === 'mobile' && det.byDevice[2].device === 'tablet', det.byDevice)
  ok('byCountry parsed (US first)', det.byCountry?.[0]?.country === 'United States' && det.byCountry[0].requests === 80, det.byCountry)
  ok('topPaths parsed (/ first)', det.topPaths?.[0]?.path === '/' && det.topPaths[0].requests === 70, det.topPaths)

  // ===== B) INTEGRATION — reseller visitors endpoint breakdowns =====
  const client = new MongoClient(MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)
  await db.collection(hv.COLLECTION).deleteMany({ zoneId: ZONE })
  const linkedAt = new Date('2026-09-20T00:00:00Z')
  await db.collection('cpanelAccounts').updateOne({ _id: USER }, { $set: {
    _id: USER, cpUser: USER, chatId: OWNER, domain: MAIN, addonDomains: [], plan: 'Golden Anti-Red HostPanel (1-Month)',
    provisionState: 'completed', cfZoneId: ZONE, createdAt: linkedAt,
  } }, { upsert: true })

  const origRange = cf.getZoneVisitsRange
  const origDetailed = cf.getDetailedZoneAnalytics
  cf.getZoneVisitsRange = async () => ({ success: true, days: [{ date: hv.dayStr(Date.now()), uniques: 25, pageViews: 8, requests: 70 }] })
  let detailedCalls = 0
  cf.getDetailedZoneAnalytics = async () => {
    detailedCalls++
    return { success: true, byCountry: [{ country: 'United States', requests: 80, threats: 1 }, { country: 'Germany', requests: 20, threats: 0 }],
      byDevice: [{ device: 'desktop', requests: 60 }, { device: 'mobile', requests: 30 }],
      topPaths: [{ path: '/', requests: 70 }, { path: '/login', requests: 20 }] }
  }

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
  ok('top_countries present + window label', v.json?.top_countries?.items?.[0]?.country === 'United States' && /^last_\d+d$/.test(v.json?.top_countries?.window || ''), v.json?.top_countries)
  ok('top_devices present + window last_24h', v.json?.top_devices?.items?.[0]?.device === 'desktop' && v.json?.top_devices?.window === 'last_24h', v.json?.top_devices)
  ok('top_pages present + window last_24h', v.json?.top_pages?.items?.[0]?.path === '/' && v.json?.top_pages?.window === 'last_24h', v.json?.top_pages)
  ok('total_visitors still computed', typeof v.json?.total_visitors === 'number', v.json?.total_visitors)

  const callsBefore = detailedCalls
  const noB = await get(port, `/reseller/v1/hosting/${USER}/visitors?breakdown=false`)
  ok('breakdown=false → no top_countries/top_devices/top_pages', noB.status === 200 && noB.json?.top_countries === undefined && noB.json?.top_devices === undefined && noB.json?.top_pages === undefined, noB.json)
  ok('breakdown=false → getDetailedZoneAnalytics NOT called', detailedCalls === callsBefore, { before: callsBefore, after: detailedCalls })

  server.close()
  cf.getZoneVisitsRange = origRange
  cf.getDetailedZoneAnalytics = origDetailed
  await db.collection('cpanelAccounts').deleteOne({ _id: USER })
  await db.collection(hv.COLLECTION).deleteMany({ zoneId: ZONE })
  await client.close()

  let pass = true
  for (const [n, good, d] of results) { console.log(`${good ? 'PASS' : 'FAIL'} — ${n}${good ? '' : ' :: ' + JSON.stringify(d)}`); if (!good) pass = false }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch(e => { console.error('ERROR', e); process.exit(2) })
