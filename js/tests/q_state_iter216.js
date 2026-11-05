require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async()=>{const mc=await MongoClient.connect(process.env.MONGO_URL);const db=mc.db(process.env.DB_NAME)
for(const id of process.argv.slice(2)){const s=await db.collection('state').findOne({_id:id});const w=await db.collection('walletOf').findOne({_id:id});const wb=await db.collection('welcomeBonuses').findOne({chatId:id})
console.log(id,'pending=',s?.welcomeGiftPending,'action=',s?.action,'lang=',s?.userLanguage,'wallet=',w&&(w.usdIn||0)-(w.usdOut||0),'bonus=',!!wb)}
await mc.close()})()
