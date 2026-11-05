require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => { const mc = await MongoClient.connect(process.env.MONGO_URL); const db = mc.db(process.env.DB_NAME)
 const [col, id, ...fields] = process.argv.slice(2)
 const q = id.startsWith('{') ? JSON.parse(id) : { _id: id }
 const docs = await db.collection(col).find(q).limit(5).toArray()
 for (const d of docs) console.log(JSON.stringify(fields.length ? Object.fromEntries(fields.map(f => [f, f.split('.').reduce((o, k) => o?.[k], d)])) : d).slice(0, 1500))
 await mc.close() })()
