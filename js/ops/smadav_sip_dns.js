#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* Add the Telnyx SIP DNS records for sip.smadavspeech.com, mirroring the working sip.speechcue.com set.
 * A -> 192.76.120.10 ; SRV _sip._tcp/_udp (5060) + _sips._tcp (5061) -> sip.telnyx.com. Idempotent. */
const fs = require('fs')
const path = require('path')
const https = require('https')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const local=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
const CF_KEY=local.CLOUDFLARE_API_KEY, CF_EMAIL=local.CLOUDFLARE_EMAIL
function cf(method,pathname,body){const payload=body?JSON.stringify(body):null;return new Promise((res,rej)=>{const r=https.request('https://api.cloudflare.com/client/v4'+pathname,{method,headers:{'X-Auth-Email':CF_EMAIL,'X-Auth-Key':CF_KEY,'Content-Type':'application/json',...(payload?{'Content-Length':Buffer.byteLength(payload)}:{})}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,300)))}})});r.on('error',rej);if(payload)r.write(payload);r.end()})}

const ZONE='smadavspeech.com'
const HOST='sip.smadavspeech.com'
const RECORDS=[
  { type:'A', name:HOST, content:'192.76.120.10', ttl:300, proxied:false },
  { type:'SRV', name:`_sip._tcp.${HOST}`, ttl:1, data:{ service:'_sip', proto:'_tcp', name:HOST, priority:10, weight:10, port:5060, target:'sip.telnyx.com' } },
  { type:'SRV', name:`_sip._udp.${HOST}`, ttl:1, data:{ service:'_sip', proto:'_udp', name:HOST, priority:10, weight:10, port:5060, target:'sip.telnyx.com' } },
  { type:'SRV', name:`_sips._tcp.${HOST}`, ttl:1, data:{ service:'_sips', proto:'_tcp', name:HOST, priority:10, weight:10, port:5061, target:'sip.telnyx.com' } },
]
;(async()=>{
  const z=await cf('GET',`/zones?name=${ZONE}`); if(!z.success||!z.result.length)throw new Error('zone not found')
  const zid=z.result[0].id
  for(const rec of RECORDS){
    const ex=await cf('GET',`/zones/${zid}/dns_records?type=${rec.type}&name=${encodeURIComponent(rec.name)}`)
    const payload={ type:rec.type, name:rec.name, ttl:rec.ttl }
    if(rec.content!==undefined) payload.content=rec.content
    if(rec.data!==undefined) payload.data=rec.data
    if(rec.type==='A') payload.proxied=!!rec.proxied
    if(ex.success&&ex.result.length){
      const cur=ex.result[0]
      const up=await cf('PUT',`/zones/${zid}/dns_records/${cur.id}`,payload)
      console.log(up.success?`~ ${rec.type} ${rec.name} updated`:`✗ ${rec.type} ${rec.name}: ${JSON.stringify(up.errors)}`)
    } else {
      const cr=await cf('POST',`/zones/${zid}/dns_records`,payload)
      console.log(cr.success?`+ ${rec.type} ${rec.name} created`:`✗ ${rec.type} ${rec.name}: ${JSON.stringify(cr.errors)}`)
    }
  }
  console.log('\n=== readback (sip.* in zone) ===')
  const rr=await cf('GET',`/zones/${zid}/dns_records?per_page=200`)
  for(const r of rr.result) if(/sip/i.test(r.name)&&!/_railway-verify/.test(r.name)) console.log(`  ${r.type.padEnd(5)} ${r.name} -> ${r.content}`)
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
