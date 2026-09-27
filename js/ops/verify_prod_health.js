#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY production health: WHM (shared), Twilio (shared), Telnyx (Nomadly + SMADAV), SIP DNS. */
const fs = require('fs')
const path = require('path')
const https = require('https')
const dns = require('dns')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const N=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))  // Nomadly local vault creds
function req(opts,body){return new Promise((res)=>{const r=https.request(opts,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}))});r.on('error',e=>res({status:0,body:String(e.message)}));if(body)r.write(body);r.setTimeout(30000,()=>{r.destroy();res({status:0,body:'timeout'})});r.end()})}
function rgql(){const b=JSON.stringify({query:`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,variables:{p:'0f41a48b-d2f6-4be5-acbd-524c6df6d2c6',e:'b9a9e5d2-0f71-42c4-925b-ac843adcb656',s:'6d40a2dd-dfdf-4d05-9c68-4962a065885c'}});return req({hostname:'backboard.railway.com',path:'/graphql/v2',method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':N.API_KEY_RAILWAY,'Content-Length':Buffer.byteLength(b)}},b).then(r=>JSON.parse(r.body).data.variables)}

async function whmHealth(){
  console.log('\n=== WHM (shared 68.183.77.106 via whm-api.hostbay.io) ===')
  const host='whm-api.hostbay.io', auth=`whm ${N.WHM_USERNAME||'root'}:${N.WHM_TOKEN}`
  const v=await req({hostname:host,path:'/json-api/version?api.version=1',method:'GET',headers:{Authorization:auth},rejectUnauthorized:false})
  try{const j=JSON.parse(v.body);console.log('  /version:',v.status,'->',JSON.stringify(j.data||j.metadata||j).slice(0,160))}catch{console.log('  /version:',v.status,v.body.slice(0,160))}
  const la=await req({hostname:host,path:'/json-api/listaccts?api.version=1',method:'GET',headers:{Authorization:auth},rejectUnauthorized:false})
  try{const j=JSON.parse(la.body);const n=(j.data&&j.data.acct||[]).length;console.log('  /listaccts:',la.status,'-> accounts:',n)}catch{console.log('  /listaccts:',la.status,la.body.slice(0,160))}
}
async function telnyx(label,key,connId){
  console.log(`\n=== Telnyx (${label}) ===`)
  const bal=await req({hostname:'api.telnyx.com',path:'/v2/balance',method:'GET',headers:{Authorization:`Bearer ${key}`}})
  try{const d=JSON.parse(bal.body).data;console.log('  balance:',bal.status,'->',d?`${d.balance} ${d.currency} (credit_limit ${d.credit_limit})`:bal.body.slice(0,120))}catch{console.log('  balance:',bal.status,bal.body.slice(0,120))}
  const c=await req({hostname:'api.telnyx.com',path:`/v2/credential_connections/${connId}`,method:'GET',headers:{Authorization:`Bearer ${key}`}})
  try{const d=JSON.parse(c.body).data;console.log('  connection:',c.status,'->',d?`${d.connection_name} active=${d.active} user=${d.user_name}`:c.body.slice(0,120))}catch{console.log('  connection:',c.status,c.body.slice(0,120))}
}
async function twilio(){
  console.log('\n=== Twilio (shared account) ===')
  const auth='Basic '+Buffer.from(`${N.TWILIO_ACCOUNT_SID}:${N.TWILIO_AUTH_TOKEN}`).toString('base64')
  const b=await req({hostname:'api.twilio.com',path:`/2010-04-01/Accounts/${N.TWILIO_ACCOUNT_SID}/Balance.json`,method:'GET',headers:{Authorization:auth}})
  try{const d=JSON.parse(b.body);console.log('  balance:',b.status,'->',`${d.balance} ${d.currency}`)}catch{console.log('  balance:',b.status,b.body.slice(0,120))}
}
function sipDns(host){return new Promise(res=>{const r=new dns.Resolver();r.setServers(['1.1.1.1','8.8.8.8']);r.resolve4(host,(e,a)=>{r.resolveSrv('_sip._udp.'+host,(e2,s)=>{console.log(`  ${host}: A=${e?('ERR '+e.code):JSON.stringify(a)}  SRV _sip._udp=${e2?('ERR '+e2.code):JSON.stringify(s)}`);res()})})})}

;(async()=>{
  await whmHealth()
  await telnyx('Nomadly', N.TELNYX_API_KEY, N.TELNYX_SIP_CONNECTION_ID)
  const S=await rgql()
  await telnyx('SMADAV', S.TELNYX_API_KEY, S.TELNYX_SIP_CONNECTION_ID)
  await twilio()
  console.log('\n=== SIP DNS (public resolvers) ===')
  await sipDns('sip.speechcue.com')
  await sipDns('sip.smadavspeech.com')
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
