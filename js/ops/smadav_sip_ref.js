#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Dump full JSON of the sip.* records in speechcue.com (to mirror onto smadavspeech.com). */
const fs = require('fs')
const path = require('path')
const https = require('https')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const local=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
const CF_KEY=local.CLOUDFLARE_API_KEY, CF_EMAIL=local.CLOUDFLARE_EMAIL
function cf(m,p){return new Promise((res,rej)=>{const r=https.request('https://api.cloudflare.com/client/v4'+p,{method:m,headers:{'X-Auth-Email':CF_EMAIL,'X-Auth-Key':CF_KEY,'Content-Type':'application/json'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,300)))}})});r.on('error',rej);r.end()})}
;(async()=>{
  const z=await cf('GET','/zones?name=speechcue.com'); const zid=z.result[0].id
  const rr=await cf('GET',`/zones/${zid}/dns_records?per_page=200`)
  for(const r of rr.result){ if(/sip/i.test(r.name)){ console.log(JSON.stringify({type:r.type,name:r.name,content:r.content,data:r.data,proxied:r.proxied,ttl:r.ttl})) } }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
