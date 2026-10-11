/* global process */
// Local verification for the extended realtime Safe Browsing checks:
//  • shared helpers: domainResolvesTo, linkedDomainsForIp, liveCheck (mocked resolver/sb)
//  • shortener routes: GET /shortener/safe-browsing + /shortener/domains/:domain/safe-browsing
//    (registerShortenerRoutes mounted on the LOCAL db with mock auth — no prod reseller DB).
// The VPS/RDP route handler is thin glue over domainResolvesTo + linkedDomainsForIp + liveCheck,
// which are unit-tested here directly.
require('dotenv').config({ path: '/app/backend/.env' })
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')
const mon = require('/app/js/safe-browsing-monitor')
const { registerShortenerRoutes } = require('/app/js/reseller-shortener')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const OWNER = '880000333'
const SHORT_DOMAIN = 'go.sbext-test.com'

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

  // ---- helper: domainResolvesTo ----
  ok('domainResolvesTo match', await mon.domainResolvesTo('x.com', '1.2.3.4', { resolve4: async () => ['1.2.3.4'] }) === true)
  ok('domainResolvesTo no-match', await mon.domainResolvesTo('x.com', '1.2.3.4', { resolve4: async () => ['9.9.9.9'] }) === false)
  ok('domainResolvesTo bad-ip', await mon.domainResolvesTo('x.com', 'notanip', { resolve4: async () => ['1.2.3.4'] }) === false)

  // ---- helper: linkedDomainsForIp ----
  await db.collection('domainsOf').insertMany([
    { _id: 'sbext-d1', chatId: OWNER, domainName: 'vpsdom.com' },
    { _id: 'sbext-d2', chatId: OWNER, domainName: 'other.com' },
  ])
  const resolve4 = async (h) => (h === 'vpsdom.com' ? ['1.2.3.4'] : ['5.6.7.8'])
  const linked = await mon.linkedDomainsForIp(db, OWNER, '1.2.3.4', { resolve4 })
  ok('linkedDomainsForIp finds only matching', JSON.stringify(linked) === JSON.stringify(['vpsdom.com']), linked)

  // ---- helper: liveCheck (mock sb) ----
  const mockSb = { isConfigured: () => true, checkDomain: async (d) => d === 'bad.com' ? { safe: false, threats: [{ type: 'SOCIAL_ENGINEERING' }] } : { safe: true, threats: [] } }
  const rows = await mon.liveCheck(db, ['good.com', 'bad.com', 'good.com'], { main: 'good.com', sb: mockSb })
  ok('liveCheck dedups', rows.length === 2, rows.map(r => r.domain))
  const bad = rows.find(r => r.domain === 'bad.com')
  const good = rows.find(r => r.domain === 'good.com')
  ok('liveCheck flags bad', bad && bad.flagged === true && bad.safe === false && bad.threats.includes('SOCIAL_ENGINEERING'), bad)
  ok('liveCheck marks good safe + is_main', good && good.flagged === false && good.safe === true && good.is_main === true, good)
  ok('liveCheck is_main false for non-main', bad && bad.is_main === false, bad && bad.is_main)

  // ---- shortener routes (mounted on local db) ----
  await db.collection('shortenerActivations').updateOne({ _id: SHORT_DOMAIN }, { $set: { _id: SHORT_DOMAIN, domain: SHORT_DOMAIN, chatId: OWNER, status: 'completed' } }, { upsert: true })
  const app = express(); const router = express.Router()
  registerShortenerRoutes({
    router,
    apiKeyAuth: (req, _res, next) => { req.reseller = { ownerChatId: OWNER }; next() },
    h: (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next),
    col: (name) => db.collection(name),
    getDb: () => db,
    isLive: () => false, mode: () => 'dry_run', log: () => {}, billedProvision: async () => {},
  })
  app.use('/reseller/v1', router)
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  const sAll = await get(port, '/reseller/v1/shortener/safe-browsing')
  ok('shortener all: 200', sAll.status === 200, sAll.status)
  ok('shortener all: includes domain + realtime', (sAll.json?.results || []).some(r => r.domain === SHORT_DOMAIN) && sAll.json?.realtime === true, sAll.json)

  const sOne = await get(port, `/reseller/v1/shortener/domains/${SHORT_DOMAIN}/safe-browsing`)
  ok('shortener one: 200 + status field', sOne.status === 200 && sOne.json?.domain === SHORT_DOMAIN && sOne.json?.status === 'completed', sOne.json)

  const sBad = await get(port, '/reseller/v1/shortener/domains/not-owned-xyz.com/safe-browsing')
  ok('shortener not-owned: 404', sBad.status === 404 && sBad.json?.error === 'not_found', { s: sBad.status, e: sBad.json?.error })

  server.close()
  // cleanup
  await db.collection('domainsOf').deleteMany({ _id: { $in: ['sbext-d1', 'sbext-d2'] } })
  await db.collection('shortenerActivations').deleteOne({ _id: SHORT_DOMAIN })
  await client.close()

  let pass = true
  for (const [n, good2, d] of results) { console.log(`${good2 ? 'PASS' : 'FAIL'} — ${n}${good2 ? '' : ' :: ' + JSON.stringify(d)}`); if (!good2) pass = false }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch(e => { console.error('ERROR', e); process.exit(2) })
