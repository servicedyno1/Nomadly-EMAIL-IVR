// Read-only: prints doc counts, indexes and explain() stats for the per-message hot-path queries.
// Run on the droplet: node scripts/prod_hotpath_index_check.js /opt/nomadly/shared/app-main/backend.env
const { MongoClient } = require('mongodb')
const fs = require('fs')
const envPath = process.argv[2] || require('path').join(__dirname, '..', 'backend', '.env')
const env = fs.readFileSync(envPath, 'utf8')
const pick = k => ((env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '').replace(/^"|"$/g, '')

;(async () => {
  const c = new MongoClient(pick('MONGO_URL'))
  await c.connect()
  const d = c.db(pick('DB_NAME'))
  for (const col of ['state', 'promoStats', 'promoOptOut', 'promoResponses', 'cpanelAccounts', 'testCredentials', 'referralClicks', 'referrals', 'userConversion', 'browseTracking', 'walletOf', 'nameOf', 'transactions', 'docSessions']) {
    try {
      const n = await d.collection(col).estimatedDocumentCount()
      const idx = (await d.collection(col).indexes()).map(i => Object.keys(i.key).join('+')).join(', ')
      console.log(col.padEnd(16), String(n).padStart(7), 'idx:', idx)
    } catch (e) { console.log(col, 'ERR', e.message) }
  }
  const q = async (label, col, f, o = {}) => {
    const t = Date.now()
    const r = await d.collection(col).find(f, o).limit(1).explain('executionStats')
    const s = r.executionStats
    const scan = JSON.stringify(r.queryPlanner.winningPlan).includes('COLLSCAN') ? 'COLLSCAN' : 'IXSCAN'
    console.log(label.padEnd(26), 'ms', String(Date.now() - t).padStart(4), 'docsExamined', String(s.totalDocsExamined).padStart(6), 'keys', String(s.totalKeysExamined).padStart(6), scan)
  }
  await q('promoStats timestamp>=', 'promoStats', { timestamp: { $gte: new Date(Date.now() - 3600e3).toISOString() } })
  await q('promoStats sentAt+lang', 'promoStats', { sentAt: { $gte: new Date(Date.now() - 45 * 60e3) }, lang: 'en' }, { sort: { sentAt: -1 } })
  await q('cpanelAccounts chatId', 'cpanelAccounts', { chatId: '999', terminatedOnWhm: { $ne: true }, deleted: { $ne: true } })
  await q('testCredentials chatId', 'testCredentials', { chatId: '999' })
  await q('referralClicks recent', 'referralClicks', { converted: false, clickedAt: { $gte: new Date(Date.now() - 300e3) } }, { sort: { clickedAt: -1 } })
  await q('nameOf by val regex', 'nameOf', { val: { $regex: '^abc$', $options: 'i' } })
  await q('promoOptOut _id', 'promoOptOut', { _id: '999', optedOut: true })
  await q('userConversion _id', 'userConversion', { _id: '999' })
  await c.close()
})().catch(e => { console.error(e.message); process.exit(1) })
