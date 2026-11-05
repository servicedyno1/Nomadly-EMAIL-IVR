const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect('mongodb://localhost:27017');const db=c.db('test');
const docs=await db.collection('phoneNumbersOf').find({}).limit(5).toArray();console.log(JSON.stringify(docs.map(d=>({_id:d._id,t:typeof d._id,nums:d.val?.numbers?.map(n=>n.phoneNumber)}))));
console.log(JSON.stringify(await db.collection('webAccounts').findOne({email:'civr.alice@example.com'},{projection:{passwordHash:0}})).slice(0,600));
console.log(JSON.stringify(await db.collection('webPrefs').find({}).limit(5).toArray()).slice(0,800));
c.close()})()
