#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Dump SAMDAV service source (repo+branch) and all SIP/Telnyx/Twilio/voice/provider-related vars (secrets masked). */
const fs = require('fs')
const path = require('path')
const https = require('https')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const local=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
const TOKEN=process.env.RAILWAY_TOKEN||local.API_KEY_RAILWAY
const PROJECT='0f41a48b-d2f6-4be5-acbd-524c6df6d2c6', ENVIRON='b9a9e5d2-0f71-42c4-925b-ac843adcb656'
const SERVICE=process.argv[2]||'6d40a2dd-dfdf-4d05-9c68-4962a065885c'
function gql(q,v){const b=JSON.stringify({query:q,variables:v||{}});return new Promise((res,rej)=>{const r=https.request('https://backboard.railway.com/graphql/v2',{method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':TOKEN,Authorization:`Bearer ${TOKEN}`,'Content-Length':Buffer.byteLength(b)}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,300)))}})});r.on('error',rej);r.write(b);r.end()})}
async function must(q,v,l){const r=await gql(q,v);if(r.errors)throw new Error(`${l}: ${JSON.stringify(r.errors).slice(0,400)}`);return r.data}
const SECRETY=/KEY|SECRET|TOKEN|PASSWORD|PRIVATE|SID|AUTH/i
const mask=(k,v)=>SECRETY.test(k)?(v?String(v).slice(0,4)+'…['+String(v).length+']':v):v
;(async()=>{
  const si=await must(`query($s:String!,$e:String!){ service(id:$s){ id name repoTriggers{ edges{ node{ branch } } } } serviceInstance(serviceId:$s, environmentId:$e){ source{ repo image } } }`,{s:SERVICE,e:ENVIRON},'si').catch(async e=>{
    // fallback without repoTriggers
    return await must(`query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ source{ repo image } } }`,{s:SERVICE,e:ENVIRON},'si2')
  })
  console.log('serviceInstance.source:', JSON.stringify(si.serviceInstance&&si.serviceInstance.source))
  if(si.service) console.log('service.repoTriggers branches:', JSON.stringify((si.service.repoTriggers&&si.service.repoTriggers.edges||[]).map(e=>e.node.branch)))
  const vr=await must(`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,{p:PROJECT,e:ENVIRON,s:SERVICE},'vars')
  const vars=vr.variables||{}
  const RE=/SIP|TELNYX|TWILIO|VOICE|PROVIDER|SIGNALWIRE|CALL_|SMS|REGISTRAR|TRUNK/i
  console.log('\n=== SIP/Telnyx/Twilio/voice/provider vars ===')
  for(const k of Object.keys(vars).sort()) if(RE.test(k)) console.log(`  ${k} = ${mask(k,vars[k])}`)
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
