#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY: validate Telnyx + Twilio credentials for both prod bots against live APIs.
 * Fetches creds from Railway (SAMDAV + Nomadly). Keys redacted in output. */
const fs = require('fs'), path = require('path'), https = require('https')
const axios = require('axios')
function parseEnv(t){const o={};for(const line of t.split('\n')){const m=line.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const local=parseEnv(fs.readFileSync(path.resolve(__dirname,'../../backend/.env'),'utf8'))
const TOKEN=local.API_KEY_RAILWAY
const PROJECT='0f41a48b-d2f6-4be5-acbd-524c6df6d2c6', ENVIRON='b9a9e5d2-0f71-42c4-925b-ac843adcb656'
function railwayVars(service){const body=JSON.stringify({query:`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,variables:{p:PROJECT,e:ENVIRON,s:service}});return new Promise((res,rej)=>{const req=https.request('https://backboard.railway.com/graphql/v2',{method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':TOKEN,Authorization:'Bearer '+TOKEN,'Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);res((j.data&&j.data.variables)||{})}catch(e){rej(new Error(d.slice(0,200)))}})});req.on('error',rej);req.write(body);req.end()})}
const redact=k=>k?(k.length>14?k.slice(0,8)+'…'+k.slice(-4):'set('+k.length+'ch)'):'(MISSING)'

async function testTelnyx(apiKey){
  if(!apiKey) return 'TELNYX_API_KEY MISSING'
  try{const r=await axios.get('https://api.telnyx.com/v2/balance',{headers:{Authorization:`Bearer ${apiKey}`},timeout:15000,validateStatus:()=>true})
    if(r.status===200){const d=r.data?.data;return `OK 200  balance=$${d?.balance} ${d?.currency} (available_credit=$${d?.available_credit})`}
    return `FAIL ${r.status}  ${JSON.stringify(r.data).slice(0,200)}`}catch(e){return `ERR ${e.message}`}
}
async function testTwilio(sid,token){
  if(!sid||!token) return `TWILIO creds MISSING (sid=${!!sid} token=${!!token})`
  try{const r=await axios.get(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`,{auth:{username:sid,password:token},timeout:15000,validateStatus:()=>true})
    if(r.status===200){return `OK 200  balance=$${r.data?.balance} ${r.data?.currency}`}
    return `FAIL ${r.status}  ${JSON.stringify(r.data).slice(0,220)}`}catch(e){return `ERR ${e.message}`}
}
async function probe(label,v){
  console.log(`\n════════ ${label} ════════`)
  console.log(`  TELEGRAM_ADMIN_CHAT_ID : ${v.TELEGRAM_ADMIN_CHAT_ID||'(MISSING — alerts DISABLED)'}`)
  console.log(`  TELNYX_API_KEY         : ${redact(v.TELNYX_API_KEY)}`)
  console.log(`  TWILIO_ACCOUNT_SID     : ${v.TWILIO_ACCOUNT_SID?v.TWILIO_ACCOUNT_SID.slice(0,10)+'…':'(MISSING)'}`)
  console.log(`  TWILIO_AUTH_TOKEN      : ${redact(v.TWILIO_AUTH_TOKEN)}`)
  console.log(`  BALANCE thresholds     : warn=$${v.BALANCE_WARN_THRESHOLD||'10'} crit=$${v.BALANCE_CRIT_THRESHOLD||'5'} interval=${v.BALANCE_CHECK_INTERVAL_MIN||'120'}min`)
  console.log(`  → Telnyx  : ${await testTelnyx(v.TELNYX_API_KEY)}`)
  console.log(`  → Twilio  : ${await testTwilio(v.TWILIO_ACCOUNT_SID,v.TWILIO_AUTH_TOKEN)}`)
}
;(async()=>{
  const [smad,noma]=await Promise.all([railwayVars('6d40a2dd-dfdf-4d05-9c68-4962a065885c'),railwayVars('73e2050b-586d-41d4-a1b5-6b0914e7a0f9')])
  await probe('NOMADLY (prod)',noma)
  await probe('SMADAV (prod)',smad)
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
