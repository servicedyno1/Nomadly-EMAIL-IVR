#!/usr/bin/env node
// iter208 BUG REPRO: a pay-first line whose IMEI arrives >24h after payment is refunded/failed on the very next poll,
// because pollOne() measures the 24h Spenza timeout from createdAt (payment time), not from when the IMEI was sent.
// Uses the running bot's 15s tick (real-mode line: no `simulated` flag; Spenza GET with a fake transactionId returns nothing).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const CH = '990208060', ID = 'es_it208late'
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
  const clean = async () => { await db.collection('esimLines').deleteMany({ chatId: CH }); await db.collection('walletOf').deleteMany({ _id: CH }); await db.collection('transactions').deleteMany({ chatId: CH }) }
  await clean()
  await db.collection('walletOf').insertOne({ _id: CH, usdIn: 75, usdOut: 75 })
  // paid 2 days ago, IMEI sent just now (what submitImei() leaves behind: status provisioning, createdAt unchanged)
  await db.collection('esimLines').insertOne({ _id: ID, chatId: CH, planId: 'SPENZA_001', price: 75, imei: '356938035643809', status: 'provisioning', transactionId: 'it208-fake-txn', source: 'telegram', lang: 'en', createdAt: new Date(Date.now() - 2 * 86400000), provisionStartedAt: new Date(), updatedAt: new Date() })
  try {
    await sleep(20000)
    const d = await db.collection('esimLines').findOne({ _id: ID })
    const w = await db.collection('walletOf').findOne({ _id: CH })
    console.log(JSON.stringify({ status: d.status, providerError: d.providerError, wallet: w.usdIn - w.usdOut }))
    console.log(d.status === 'failed' ? 'BUG REPRODUCED: IMEI sent minutes ago but line failed+refunded as "timed out after 24 h"' : 'not reproduced')
  } finally { await clean(); await mc.close() }
})()
