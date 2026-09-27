#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Controlled cPanel/WHM provisioning smoke test on the shared prod server:
 *   createacct (test subdomain under smadavhost.com) -> accountsummary verify -> removeacct -> verify gone.
 * Always cleans up (removeacct) even on partial failure. No customer/payment involved. */
const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const N=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
const HOST='whm-api.hostbay.io'
const AUTH=`whm ${N.WHM_USERNAME||'root'}:${N.WHM_TOKEN}`
function whm(endpoint,params){const qs=new URLSearchParams({'api.version':'1',...params}).toString();return new Promise(res=>{const r=https.request({hostname:HOST,path:`/json-api/${endpoint}?${qs}`,method:'GET',headers:{Authorization:AUTH},rejectUnauthorized:false,timeout:60000},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res({status:x.statusCode,json:JSON.parse(d)})}catch(e){res({status:x.statusCode,json:null,raw:d.slice(0,300)})}})});r.on('error',e=>res({status:0,raw:String(e.message)}));r.on('timeout',()=>{r.destroy();res({status:0,raw:'timeout'})});r.end()})}

const rid=crypto.randomBytes(3).toString('hex')
const USERNAME=`opt${rid}`.slice(0,8)              // <=8 chars, starts with letter
const DOMAIN=`optest${rid}.smadavhost.com`
const PASSWORD='Op!'+crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g,'')+'9z'
const PLAN='default'

;(async()=>{
  console.log(`SMOKE TEST — createacct user=${USERNAME} domain=${DOMAIN} plan=${PLAN}`)
  let created=false
  try{
    const c=await whm('createacct',{username:USERNAME,domain:DOMAIN,plan:PLAN,password:PASSWORD,contactemail:`ops@${DOMAIN}`})
    const meta=c.json&&(c.json.metadata||c.json.result&&c.json.result[0])
    const ok=c.json&&((c.json.metadata&&c.json.metadata.result===1)||(c.json.result&&c.json.result[0]&&c.json.result[0].status===1))
    console.log('  createacct HTTP', c.status, '->', ok?'result=1 (created)':JSON.stringify(c.json&&c.json.metadata||c.raw||c.json).slice(0,240))
    if(ok) created=true
    else { console.log('  ❌ createacct did not report success'); }

    // verify
    const s=await whm('accountsummary',{user:USERNAME})
    const acct=s.json&&s.json.data&&s.json.data.acct&&s.json.data.acct[0]
    if(acct) console.log(`  ✅ accountsummary: user=${acct.user} domain=${acct.domain} suspended=${acct.suspended} plan=${acct.plan}`)
    else console.log('  accountsummary:', s.status, JSON.stringify(s.json&&s.json.metadata||s.raw).slice(0,200))
  } catch(e){ console.log('  ERR', e.message) }
  finally{
    if(created){
      const rm=await whm('removeacct',{user:USERNAME})
      const okrm=rm.json&&((rm.json.metadata&&rm.json.metadata.result===1)||(rm.json.result&&rm.json.result[0]&&rm.json.result[0].status===1))
      console.log('  removeacct HTTP', rm.status, '->', okrm?'result=1 (removed)':JSON.stringify(rm.json&&rm.json.metadata||rm.raw).slice(0,200))
      const v=await whm('accountsummary',{user:USERNAME})
      const still=v.json&&v.json.data&&v.json.data.acct&&v.json.data.acct[0]
      console.log('  post-remove check:', still?'⚠️ STILL PRESENT (manual cleanup needed!)':'✅ gone')
    } else {
      console.log('  (no account created — nothing to clean up)')
    }
  }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
