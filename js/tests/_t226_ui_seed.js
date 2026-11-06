// Iter226 UI seed/cleanup: node _t226_ui_seed.js seed|clean  (only TEST_iter226_ui_* ids)
const fs = require('fs'), path = require('path')
const env = fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf8')
const val = (k) => (env.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, 'm')) || [])[1]
const { MongoClient } = require('mongodb')
const A = '5000000000000001', CAMP = 'TEST_iter226_ui_camp', ORDER = 'TEST_iter226_ui_order', CIDS = ['TEST_iter226_ui_c1', 'TEST_iter226_ui_c2', 'TEST_iter226_ui_c3']
;(async () => {
  const client = await MongoClient.connect(val('MONGO_URL'))
  const db = client.db(val('DB_NAME'))
  await db.collection('bulkCallCampaigns').deleteMany({ id: CAMP })
  await db.collection('webContacts').deleteMany({ _id: { $in: CIDS } })
  await db.collection('webNumberOrders').deleteMany({ _id: ORDER })
  if (process.argv[2] === 'seed') {
    const now = new Date()
    const leads = [
      { index: 0, number: '+14155550921', name: 'Bad A', status: 'failed', hangupCause: 'Not an in-service number — skipped, not charged' },
      { index: 1, number: '+14155550922', status: 'failed', hangupCause: 'unallocated_number' },
      { index: 2, number: '+14155550923', name: 'Good C', status: 'answered', hangupCause: 'normal_clearing', duration: 12 },
    ]
    await db.collection('bulkCallCampaigns').insertOne({ id: CAMP, chatId: A, name: 'TEST_iter226 UI cleanup', callerId: '+13346972125', provider: 'telnyx', status: 'completed', concurrency: 1, mode: 'report_only', audioName: 'TEST audio', activeKeys: ['1'], dryRun: true,
      stats: { total: 3, completed: 3, answered: 1, keyPressed: 0, transferred: 0, noAnswer: 0, hungUp: 0, busy: 0, failed: 2, skipped: 2 }, leads, createdAt: now, startedAt: now, completedAt: now })
    for (const [i, ph] of ['+14155550921', '+14155550922', '+14155550923'].entries())
      await db.collection('webContacts').insertOne({ _id: CIDS[i], chatId: A, phone: ph, name: 'TEST_ui', listIds: [], source: 'manual', createdAt: now, updatedAt: now })
    await db.collection('webNumberOrders').insertOne({ _id: ORDER, chatId: A, email: 'civr.alice@example.com', phoneNumber: '+13346972125', assignedNumber: '+13346972125', planKey: 'business', price: 120, coin: 'BTC', status: 'active', dryRun: true, provider: 'preview', createdAt: now, updatedAt: now })
    console.log('seeded')
  } else console.log('cleaned')
  await client.close()
})()
