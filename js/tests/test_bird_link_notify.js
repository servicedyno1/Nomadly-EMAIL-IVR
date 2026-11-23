'use strict'
// Admin is told whenever a number gets linked on Bird (caller-ID code accepted).
const { MongoClient } = require('mongodb')
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { createBirdVerify } = require('../bird-callerid-verify')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(`test_bird_notify_${Date.now()}`)
  const told = []
  const bv = createBirdVerify({ db, log: () => {}, transcribe: async () => ({ text: 'Your code is 4 8 1 2 2 6' }), onVerified: (n) => told.push(n),
    bird: { submitCallerIdCode: async (id, code) => (code === '481226' ? { status: 'verified', outbound_enabled: true } : { error: 'bad' }) } })
  await db.collection('birdCallerIdVerify').insertOne({ _id: '+442000000001', verifiedNumberId: 'vvn_1', status: 'calling', attempts: 0, expiresAt: new Date(Date.now() + 60000) })
  const r = await bv.captureFromRecording('+442000000001', Buffer.from('x'))
  await new Promise(r => setTimeout(r, 50))
  const ok = r.status === 'verified' && told[0] === '+442000000001'
  console.log(ok ? '  ✓ admin told when a number is linked to Bird' : `  ✗ not told (${JSON.stringify(r)})`)
  await db.dropDatabase(); await c.close(); process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
