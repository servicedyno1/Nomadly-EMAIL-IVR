const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect('mongodb://localhost:27017');const db=c.db('test');
const plan=process.argv[2];await db.collection('phoneNumbersOf').updateOne({_id:'5000000000000001'},{$set:{'val.numbers.0.plan':plan}});
await db.collection('webPrefs').updateOne({_id:'5000000000000001'},{$unset:{setups:1}});console.log('ok',plan);c.close()})()
