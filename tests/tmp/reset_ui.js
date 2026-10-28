const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect('mongodb://localhost:27017');const db=c.db('test');
await db.collection('webPrefs').updateOne({_id:'5000000000000002'},{$unset:{onboardedAt:1,purposes:1}});
await db.collection('webPrefs').updateOne({_id:'5000000000000001'},{$unset:{setups:1,reviewDismissedAt:1}});
await db.collection('webReviews').deleteOne({_id:'5000000000000001'});console.log('reset');c.close()})()
