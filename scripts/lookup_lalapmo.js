const fs = require('fs')
const { MongoClient } = require('mongodb')
function readEnv(f){const o={};for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const CHAT='1615382593'
;(async()=>{
  const env=readEnv('/opt/nomadly/app-main/backend/.env')
  const c=new MongoClient(env.MONGO_URL,{serverSelectionTimeoutMS:20000}); await c.connect()
  const db=c.db(env.DB_NAME)
  const show=(t,d)=>{console.log('\n=== '+t+' ===');(Array.isArray(d)?d:[d]).forEach(x=>console.log(JSON.stringify(x)))}
  // cPanel accounts owned by this chat
  const cp=await db.collection('cpanelAccounts').find({chatId:CHAT}).toArray()
  cp.forEach(a=>{const r={...a}; delete r.cpPass_encrypted; delete r.cpPass_iv; delete r.cpPass_tag; delete r.pinHash; show('cpanelAccounts '+a._id, r)})
  // domains
  const dom=await db.collection('domainsOf').find({chatId:CHAT}).toArray()
  show('domainsOf ('+dom.length+')', dom.map(d=>({domainName:d.domainName,registrar:d.registrar,nsType:d.nameserverType,ns:d.nameservers,cfZoneId:d.cfZoneId})))
  // registeredDomains cross-ref by chatId
  const rd=await db.collection('registeredDomains').find({'val.chatId':CHAT}).toArray()
  show('registeredDomains ('+rd.length+')', rd.map(d=>({_id:d._id, val:d.val})))
  // hosting transactions
  const ht=await db.collection('hostingTransactions').find({chatId:CHAT}).sort({timestamp:-1}).limit(5).toArray()
  show('hostingTransactions', ht.map(h=>({domain:h.domain,plan:h.plan,priceUsd:h.priceUsd,outcome:h.outcome,hostingUsername:h.hostingUsername,timestamp:h.timestamp})))
  // generic transactions (hosting/domain)
  const tx=await db.collection('transactions').find({chatId:CHAT}).sort({createdAt:-1}).limit(8).toArray()
  show('transactions', tx.map(t=>({_id:t._id,type:t.type,amount:t.amount,status:t.status,domain:t.metadata&&t.metadata.domain,plan:t.metadata&&t.metadata.plan,cpUser:t.metadata&&t.metadata.cpUser,createdAt:t.createdAt})))
  await c.close()
})().catch(e=>{console.error(e);process.exit(1)})
