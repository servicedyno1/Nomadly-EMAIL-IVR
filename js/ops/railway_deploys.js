#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Read-only: recent deployments for a Railway service. */
const fs = require('fs'), path = require('path'), https = require('https')
function parseEnv(t){const o={};for(const line of t.split('\n')){const m=line.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const local=parseEnv(fs.readFileSync(path.resolve(__dirname,'../../backend/.env'),'utf8'))
const TOKEN=local.API_KEY_RAILWAY
const ENVIRON='b9a9e5d2-0f71-42c4-925b-ac843adcb656'
const SERVICE=process.argv[2]||'73e2050b-586d-41d4-a1b5-6b0914e7a0f9'
function gql(q,v){const body=JSON.stringify({query:q,variables:v||{}});return new Promise((res,rej)=>{const req=https.request('https://backboard.railway.com/graphql/v2',{method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':TOKEN,Authorization:'Bearer '+TOKEN,'Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,300)))}})});req.on('error',rej);req.write(body);req.end()})}
;(async()=>{
  const r=await gql(`query($e:String!,$s:String!){ deployments(first:8, input:{environmentId:$e, serviceId:$s}){ edges{ node{ id status createdAt staticUrl } } } }`,{e:ENVIRON,s:SERVICE})
  if(r.errors){console.error(JSON.stringify(r.errors).slice(0,400));process.exit(1)}
  for(const e of r.data.deployments.edges){const n=e.node;console.log(`${n.createdAt}  ${n.status.padEnd(9)}  ${n.id.slice(0,8)}`)}
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
