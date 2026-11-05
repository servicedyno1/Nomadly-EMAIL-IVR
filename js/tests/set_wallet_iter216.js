// iter216 helper: set test wallet balance (TEST chat ids only). usage: node set_wallet_iter216.js <chatId> <usd>
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => { const [id, usd] = process.argv.slice(2); if (!/^9902131\d\d$/.test(id)) throw new Error('test ids only')
  const mc = await MongoClient.connect(process.env.MONGO_URL); await mc.db(process.env.DB_NAME).collection('walletOf').updateOne({ _id: id }, { $set: { usdIn: Number(usd), usdOut: 0 } }, { upsert: true }); console.log('set', id, usd); await mc.close() })()
