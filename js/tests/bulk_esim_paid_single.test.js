// Paid single texts: free intro of 3, then paid ($1, min $20); a good review pays from the next text; a poor review stays free.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL)
  const bdb = cl.db(process.env.BULK_ESIM_DB || process.env.DB_NAME)
  B.init({ db: bdb, log: () => {}, notifyAdmin: () => {} })
  const C = (n) => bdb.collection(n)
  const base = `Nomadly:9900077`
  const reset = async (cid) => { await C('bsCustomers').updateOne({ _id: cid }, { $set: { status: 'active', brand: 'Nomadly' }, $unset: { smsPaid: '', smsExempt: '', smsPricedAt: '' } }, { upsert: true }); await C('bsMessages').deleteMany({ cid }); await C('bsReviews').deleteMany({ cid }) }
  const sent = async (cid, n) => { for (let i = 0; i < n; i++) await C('bsMessages').insertOne({ _id: `m_${cid}_${i}_${Date.now()}_${Math.random()}`, cid, to: `+1415555${1000 + i}`, direction: 'out', status: 'sent', createdAt: new Date() }) }

  // 1) Fresh user: first 3 free, 4th paid.
  let cid = `${base}1`; await reset(cid)
  ok((await B.singleTextMode(cid)).paid === false, 'fresh user is free (0 sent)')
  await sent(cid, 2); ok((await B.singleTextMode(cid)).paid === false, 'still free after 2 sent')
  await sent(cid, 1); const m3 = await B.singleTextMode(cid); ok(m3.paid === true && m3.price === 1 && m3.minBalance === 20, 'paid once 3 free texts are used (the 4th is paid)')

  // 2) Good review pays from the next text, even inside the free intro.
  cid = `${base}2`; await reset(cid); await sent(cid, 1)
  await C('bsReviews').insertOne({ _id: `r_${cid}`, cid, stars: 5, at: new Date() })
  ok((await B.singleTextMode(cid)).paid === true, 'a 5-star review → paid even with only 1 text sent')

  // 3) Any review (even a low one) now starts charging.
  cid = `${base}3`; await reset(cid); await sent(cid, 1)
  await C('bsReviews').insertOne({ _id: `r_${cid}`, cid, stars: 2, at: new Date() })
  ok((await B.singleTextMode(cid)).paid === true, 'a 2-star review also starts charging')

  // 4) Decision is permanent (persisted smsPaid stays even if later data would say otherwise).
  cid = `${base}4`; await reset(cid); await sent(cid, 3); await B.singleTextMode(cid)
  const cu = await C('bsCustomers').findOne({ _id: cid }); ok(cu.smsPaid === true, 'paid decision is persisted on the customer')

  // 5) Campaign/test reviews don't affect single-text pricing.
  cid = `${base}5`; await reset(cid); await sent(cid, 1)
  await C('bsReviews').insertOne({ _id: `rc_${cid}`, cid, kind: 'campaign', stars: 2, at: new Date() })
  ok((await B.singleTextMode(cid)).paid === false, 'a low CAMPAIGN review does not exempt single texts')

  for (const s of [1, 2, 3, 4, 5]) { await C('bsCustomers').deleteOne({ _id: `${base}${s}` }); await C('bsMessages').deleteMany({ cid: `${base}${s}` }); await C('bsReviews').deleteMany({ cid: `${base}${s}` }) }
  await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
