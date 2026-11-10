// iter243 probe: link followed by punctuation (e.g. "shop.example.com:") — swapIn / aiVariants keep-link check. ONE real Claude call.
// Run from /app: node js/tests/test_bulk_esim_iter243_linkpunct_probe.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'
const { MongoClient } = require('mongodb'), B = require('../bulk-esim/core')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await B.init({ db, log: () => {}, notifyAdmin: () => {} })
  const src = 'Spring sale at shop.example.com: 20% off all plans this week.'
  ok('swapIn: variant w/o trailing colon still gets the new link', B.swapIn('Shop shop.example.com now', src, 'deals.example.org') === 'Shop deals.example.org now', String(B.swapIn('Shop shop.example.com now', src, 'deals.example.org')))
  ok('swapIn: link at end of sentence "shop.example.com." swaps', B.swapIn('Visit shop.example.com.', 'Visit shop.example.com today', 'deals.example.org') === 'Visit deals.example.org.', String(B.swapIn('Visit shop.example.com.', 'Visit shop.example.com today', 'deals.example.org')))
  const cid = 'qa-iter243-probe'
  const r = await B.aiVariants(cid, { text: src, optOut: true })
  const doc = await db.collection('bsAiVariants').findOne({ cid }, { sort: { at: -1 } })
  console.log('   raw:', JSON.stringify(doc?.raw)); console.log('   kept:', JSON.stringify(r.variants || r.error))
  ok('aiVariants keep-same-link: ≥3 of 7 Claude variants survive validation', (r.variants || []).length >= 3, `${(r.variants || []).length} kept of ${doc?.raw?.length}`)
  await db.collection('bsAiVariants').deleteMany({ cid }); await db.collection('bsAudit').deleteMany({ 'data.cid': cid }).catch(() => {})
  console.log(`\n${pass} passed, ${fail} failed`); await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
