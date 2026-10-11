/* global process */
// Local verification for Issue 1: deactivated shortener domains must stop
// serving 302 redirects (should 410) while active domains still redirect.
// Seeds the LOCAL db only (MONGO_URL=localhost) and hits the running Node
// server on PORT with a spoofed Host header.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const http = require('http')

const PORT = process.env.PORT || 5000
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'

const DEACT_DOMAIN = 'go.testdeact.sbs'
const ACTIVE_DOMAIN = 'go.testactive.sbs'
const SLUG = 'gold'
const sani = (s) => String(s).replaceAll('.', '@')

function hit(host, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'GET', headers: { Host: host } },
      (res) => { resolve({ status: res.statusCode, location: res.headers.location || null }) }
    )
    req.on('error', reject)
    req.end()
  })
}

;(async () => {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  const acts = db.collection('shortenerActivations')
  const urls = db.collection('fullUrlOf')

  // Seed: deactivated domain + an active (completed) domain, each with a slug.
  await acts.updateOne({ _id: DEACT_DOMAIN }, { $set: { _id: DEACT_DOMAIN, chatId: '999999', domain: DEACT_DOMAIN, status: 'deactivated', updatedAt: new Date() } }, { upsert: true })
  await acts.updateOne({ _id: ACTIVE_DOMAIN }, { $set: { _id: ACTIVE_DOMAIN, chatId: '999999', domain: ACTIVE_DOMAIN, status: 'completed', server: '1.2.3.4', recordType: 'A', updatedAt: new Date() } }, { upsert: true })
  await urls.updateOne({ _id: sani(`${DEACT_DOMAIN}/${SLUG}`) }, { $set: { val: 'https://msn.com' } }, { upsert: true })
  await urls.updateOne({ _id: sani(`${ACTIVE_DOMAIN}/${SLUG}`) }, { $set: { val: 'https://example.com' } }, { upsert: true })

  const results = []
  const deact = await hit(DEACT_DOMAIN, `/${SLUG}`)
  results.push(['deactivated domain → should be 410', deact.status === 410, deact])
  const active = await hit(ACTIVE_DOMAIN, `/${SLUG}`)
  results.push(['active domain → should be 302', active.status === 302 && /example\.com/.test(active.location || ''), active])

  // Reactivation restores it: set status back to completed → 302 again.
  await acts.updateOne({ _id: DEACT_DOMAIN }, { $set: { status: 'completed' } })
  const react = await hit(DEACT_DOMAIN, `/${SLUG}`)
  results.push(['reactivated domain → should be 302', react.status === 302 && /msn\.com/.test(react.location || ''), react])

  // Cleanup seeded docs so we leave no residue.
  await acts.deleteMany({ _id: { $in: [DEACT_DOMAIN, ACTIVE_DOMAIN] } })
  await urls.deleteMany({ _id: { $in: [sani(`${DEACT_DOMAIN}/${SLUG}`), sani(`${ACTIVE_DOMAIN}/${SLUG}`)] } })
  await client.close()

  let pass = true
  for (const [name, ok, detail] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${name} :: ${JSON.stringify(detail)}`)
    if (!ok) pass = false
  }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch((e) => { console.error('ERROR', e); process.exit(2) })
