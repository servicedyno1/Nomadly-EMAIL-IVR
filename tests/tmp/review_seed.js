const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect('mongodb://localhost:27017');const db=c.db('test');
if(process.argv[2]==='seed'){await db.collection('phoneLogs').insertOne({phoneNumber:'+13346972125',duration:30,_test172:true,createdAt:new Date()});await db.collection('webReviews').deleteOne({_id:'5000000000000001'});await db.collection('webPrefs').updateOne({_id:'5000000000000001'},{$unset:{reviewDismissedAt:1}});}
else {await db.collection('phoneLogs').deleteMany({_test172:true});}
console.log(JSON.stringify(await db.collection('webReviews').find({}).toArray()));c.close()})()
