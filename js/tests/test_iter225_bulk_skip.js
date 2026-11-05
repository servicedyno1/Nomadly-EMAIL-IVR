// Iter225 review: bulk campaign with a carrier-rejected (not in service) lead must keep dialing the remaining leads.
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const fs = require('fs'), path = require('path'), assert = require('assert')
const env = fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf8')
const val = (k) => (env.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, 'm')) || [])[1]
const { MongoClient } = require('mongodb')

;(async () => {
  const client = await MongoClient.connect(val('MONGO_URL'))
  const db = client.db('test_iter225_bulk_' + Date.now())
  let code = 0
  try {
    const vs = require('../voice-service')
    const dialed = []
    vs.initiateOutboundIvrCall = async (p) => {
      dialed.push(p.targetNumber)
      if (p.targetNumber === '+14155550001') return { error: '+14155550001 isn’t an in-service number', invalidNumber: true }
      return { callControlId: 'cc_' + p.targetNumber }
    }
    const bulk = require('../bulk-call-service')
    await bulk.initBulkCallService(db, { sendMessage: async () => ({}) }, null, null, null)
    const chatId = 'TEST_bulk_225'
    await db.collection('walletOf').insertOne({ _id: chatId, usdIn: 100, usdOut: 0, val: { usdIn: 100, usdOut: 0 } })
    const leads = ['+14155550001', '+14155550002', '+14155550003'].map((number, index) => ({ index, number, status: 'pending' }))
    await db.collection('bulkCallCampaigns').insertOne({ id: 'TEST_c225', chatId, callerId: '+18885550100', provider: 'telnyx', status: 'draft', concurrency: 1, leads, mode: 'report_only', greetingText: 'hi', activeKeys: ['1'], createdAt: new Date() })
    const r = await bulk.startCampaign('TEST_c225')
    console.log('start:', JSON.stringify(r).slice(0, 200))
    await new Promise(res => setTimeout(res, 4000))
    const c = await db.collection('bulkCallCampaigns').findOne({ id: 'TEST_c225' })
    console.log('dialed:', dialed)
    console.log('lead statuses:', c.leads.map(l => `${l.number}:${l.status}`).join(', '))
    try { assert.ok(dialed.includes('+14155550002'), 'next lead never dialed after skipped invalid lead'); console.log('PASS bulk: campaign continues after not-in-service lead') }
    catch (e) { code = 1; console.log('FAIL bulk:', e.message) }
  } catch (e) { code = 1; console.log('ERROR', e.stack) }
  await db.dropDatabase(); await client.close(); process.exit(code)
})()
