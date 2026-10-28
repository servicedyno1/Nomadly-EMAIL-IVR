const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect('mongodb://localhost:27017');const db=c.db('test');
const nums=await db.collection('phoneNumbersOf').findOne({_id:'5000000000000001'});const n=nums.val.numbers[0];console.log(JSON.stringify({plan:n.plan,caps:n.capabilities,keys:Object.keys(n)}));
c.close()})()
