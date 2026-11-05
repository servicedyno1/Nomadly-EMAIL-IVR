'use strict'
// Real platform counters for the landing page proof strip. Computed from live data at most once a day
// (in-process cache); a counter below its floor is returned as null so the page never shows a thin number.
const numbers = require('./numbers')

const TTL_MS = 24 * 60 * 60 * 1000
const floor = (k, d) => Math.max(0, parseInt(process.env[k] || '', 10) || (process.env[k] === '0' ? 0 : d))
const atLeast = (n, min) => (Number.isFinite(n) && n >= min ? n : null)

let cache = null
let pending = null

async function compute(db) {
  const [callsHandled, campaigns, nums] = await Promise.all([
    db.collection('phoneLogs').estimatedDocumentCount(),
    db.collection('bulkCallCampaigns').aggregate([
      { $project: { n: { $size: { $ifNull: ['$leads', []] } } } },
      { $group: { _id: null, calls: { $sum: '$n' } } },
    ]).toArray(),
    db.collection('phoneNumbersOf').aggregate([
      { $unwind: '$val.numbers' },
      { $match: { 'val.numbers.status': 'active' } },
      { $count: 'n' },
    ]).toArray(),
  ])
  return {
    callsHandled: atLeast(callsHandled, floor('CLOUDIVR_PROOF_FLOOR_CALLS', 1000)),
    campaignCalls: atLeast(campaigns[0]?.calls || 0, floor('CLOUDIVR_PROOF_FLOOR_CALLS', 1000)),
    numbersActive: atLeast(nums[0]?.n || 0, floor('CLOUDIVR_PROOF_FLOOR_NUMBERS', 10)),
    countries: numbers.countries().length,
    updatedAt: new Date().toISOString(),
  }
}

async function stats(db) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  if (!pending) pending = compute(db).then(data => { cache = { data, at: Date.now() }; return data }).finally(() => { pending = null })
  return pending
}

function routes(router, { db, h }) {
  router.get('/public/stats', h(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600')
    res.json(await stats(db))
  }))
}

module.exports = { routes, stats, _reset: () => { cache = null } }
