const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect('mongodb://localhost:27017');const db=c.db('test');
const a=await db.collection('webAccounts').find({email:{$in:['civr.alice@example.com','civr.bob@example.com']}}).project({email:1,chatId:1,_id:1}).toArray();console.log(JSON.stringify(a));
for(const x of a){const id=x.chatId||x._id;const n=await db.collection('phoneNumbersOf').findOne({_id:id});console.log(id,JSON.stringify(n?.val?.numbers?.map(z=>z.phoneNumber)));const w=await db.collection('webPrefs').findOne({_id:id});console.log(JSON.stringify(w&&{purposes:w.purposes,onb:w.onboardedAt,setups:w.setups,rd:w.reviewDismissedAt}))}
console.log(await db.collection('webReviews').countDocuments(), await db.collection('phoneLogs').countDocuments());
c.close()})()
