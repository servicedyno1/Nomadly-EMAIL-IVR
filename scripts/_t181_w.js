require('dotenv').config({path:'/app/backend/.env'})
const {MongoClient}=require('mongodb')
;(async()=>{const c=await MongoClient.connect(process.env.MONGO_URL);const db=c.db(process.env.DB_NAME)
const ids=[];for (const e of ['civr.bob@example.com','civr.alice@example.com']){const cols=await db.listCollections().toArray();}
const acc=db.collection('webAccounts')
for (const e of ['civr.bob@example.com','civr.alice@example.com']){const a=await acc.findOne({email:e});const w=a&&await db.collection('walletOf').findOne({_id:String(a._id)});console.log(e,a&&a._id,w)}
console.log(await db.collection('hostedSms').countDocuments())
process.exit(0)})()
