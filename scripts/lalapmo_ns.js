const fs = require('fs')
const https = require('https')
const { MongoClient } = require('mongodb')
function readEnv(f){const o={};for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
function cf(env, path){
  return new Promise((res,rej)=>{
    const headers = env.CLOUDFLARE_API_TOKEN
      ? { Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN }
      : { 'X-Auth-Email':env.CLOUDFLARE_EMAIL, 'X-Auth-Key':env.CLOUDFLARE_API_KEY }
    const r=https.request('https://api.cloudflare.com'+path,{headers},x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>{try{res(JSON.parse(b))}catch{res({raw:b})}})})
    r.on('error',rej); r.end()
  })
}
const DOMAIN='claimoffericers.online'
;(async()=>{
  const env=readEnv('/opt/nomadly/app-main/backend/.env')
  const c=new MongoClient(env.MONGO_URL,{serverSelectionTimeoutMS:20000}); await c.connect()
  const db=c.db(env.DB_NAME)
  const rd=await db.collection('registeredDomains').findOne({_id:DOMAIN})
  const dm=await db.collection('domainsOf').findOne({domainName:DOMAIN})
  console.log('registeredDomains:', JSON.stringify(rd))
  console.log('domainsOf:', JSON.stringify(dm))
  const lang=await db.collection('state').findOne({_id:'1615382593'},{projection:{userLanguage:1}})
  console.log('userLanguage:', lang && lang.userLanguage)
  await c.close()
  console.log('CF auth mode:', env.CLOUDFLARE_API_TOKEN ? 'token' : 'global-key('+ (env.CLOUDFLARE_EMAIL||'?') +')')
  const z=await cf(env,'/client/v4/zones?name='+encodeURIComponent(DOMAIN))
  const zone=(z.result&&z.result[0])||null
  if(!zone){ console.log('CF zone lookup:', JSON.stringify(z).slice(0,400)); return }
  console.log('CF zone:', JSON.stringify({id:zone.id, name:zone.name, status:zone.status, name_servers:zone.name_servers, original_name_servers:zone.original_name_servers, paused:zone.paused}))
})().catch(e=>{console.error(e);process.exit(1)})
