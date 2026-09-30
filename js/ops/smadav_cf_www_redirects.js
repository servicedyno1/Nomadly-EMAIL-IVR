#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Add www + root 301 redirects for the SMADAV zones (redirect-only proxied placeholder records +
 * dynamic-redirect rules appended to the existing entrypoint). Path+query preserved.
 *   www.smadavspeech.com        -> https://1.smadavspeech.com
 *   www.smadavhost.com + apex   -> https://1.panel.smadavhost.com
 * Skips www.panel.smadavhost.com (2nd-level, not covered by Universal SSL). */
const fs = require('fs')
const path = require('path')
const https = require('https')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const local=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
const CF_KEY=local.CLOUDFLARE_API_KEY, CF_EMAIL=local.CLOUDFLARE_EMAIL
function cf(method,pathname,body){const payload=body?JSON.stringify(body):null;return new Promise((res,rej)=>{const r=https.request('https://api.cloudflare.com/client/v4'+pathname,{method,headers:{'X-Auth-Email':CF_EMAIL,'X-Auth-Key':CF_KEY,'Content-Type':'application/json',...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,300)))}})});r.on('error',rej);if(payload)r.write(payload);r.end()})}
async function zoneId(name){const r=await cf('GET',`/zones?name=${encodeURIComponent(name)}`);if(!r.success||!r.result.length)throw new Error(`zone ${name} not found`);return r.result[0].id}

async function ensureProxiedPlaceholder(zid,name){
  const ex=await cf('GET',`/zones/${zid}/dns_records?name=${encodeURIComponent(name)}`)
  if(ex.success&&ex.result.length){ const cur=ex.result[0]; if(cur.proxied){console.log(`  = ${name} record exists & proxied`);return} 
    const up=await cf('PUT',`/zones/${zid}/dns_records/${cur.id}`,{type:'A',name,content:'192.0.2.1',ttl:1,proxied:true});console.log(up.success?`  ~ ${name} -> proxied placeholder`:`  ✗ ${name}: ${JSON.stringify(up.errors)}`);return }
  const cr=await cf('POST',`/zones/${zid}/dns_records`,{type:'A',name,content:'192.0.2.1',ttl:1,proxied:true})
  console.log(cr.success?`  + ${name} proxied placeholder A created`:`  ✗ ${name}: ${JSON.stringify(cr.errors)}`)
}
async function upsertRule(zid,desc,expression,targetBase){
  const rule={action:'redirect',action_parameters:{from_value:{status_code:301,target_url:{expression:`concat("${targetBase}", http.request.uri.path)`},preserve_query_string:true}},expression,description:desc,enabled:true}
  const ep=await cf('GET',`/zones/${zid}/rulesets/phases/http_request_dynamic_redirect/entrypoint`)
  let rules=[]
  if(ep.success&&ep.result&&Array.isArray(ep.result.rules)) rules=ep.result.rules.filter(r=>r.description!==desc)
  rules.push(rule)
  const put=await cf('PUT',`/zones/${zid}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,{rules})
  console.log(put.success?`  + rule: ${desc}`:`  ✗ rule ${desc}: ${JSON.stringify(put.errors)}`)
}
;(async()=>{
  const zSpeech=await zoneId('smadavspeech.com')
  console.log('### smadavspeech.com')
  await ensureProxiedPlaceholder(zSpeech,'www.smadavspeech.com')
  await upsertRule(zSpeech,'www redirect www.smadavspeech.com','(http.host eq "www.smadavspeech.com")','https://1.smadavspeech.com')

  const zHost=await zoneId('smadavhost.com')
  console.log('### smadavhost.com')
  await ensureProxiedPlaceholder(zHost,'www.smadavhost.com')
  await ensureProxiedPlaceholder(zHost,'smadavhost.com')
  await upsertRule(zHost,'www+root redirect smadavhost.com','(http.host eq "www.smadavhost.com" or http.host eq "smadavhost.com")','https://1.panel.smadavhost.com')
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
