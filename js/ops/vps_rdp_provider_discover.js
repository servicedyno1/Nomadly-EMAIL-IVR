#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY: VPS/RDP provider config for both brands + DO account identity + golden image + droplet inventory. */
const fs = require('fs')
const path = require('path')
const https = require('https')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const N=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
function req(opts,body){return new Promise(res=>{const r=https.request(opts,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}))});r.on('error',e=>res({status:0,body:String(e.message)}));if(body)r.write(body);r.setTimeout(30000,()=>{r.destroy();res({status:0,body:'timeout'})});r.end()})}
function railwayVars(){const b=JSON.stringify({query:`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,variables:{p:'0f41a48b-d2f6-4be5-acbd-524c6df6d2c6',e:'b9a9e5d2-0f71-42c4-925b-ac843adcb656',s:'6d40a2dd-dfdf-4d05-9c68-4962a065885c'}});return req({hostname:'backboard.railway.com',path:'/graphql/v2',method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':N.API_KEY_RAILWAY,'Content-Length':Buffer.byteLength(b)}},b).then(r=>JSON.parse(r.body).data.variables)}
function doGet(token,pathname){return req({hostname:'api.digitalocean.com',path:pathname,method:'GET',headers:{Authorization:`Bearer ${token}`}})}

function providerSummary(label,V){
  const keys=['VPS_DEFAULT_PROVIDER','VPS_RDP_PROVIDER','VPS_CONTABO_FALLBACK_ENABLED','OVH_DRY_RUN']
  console.log(`\n### ${label} provider config`)
  for(const k of keys) if(V[k]!==undefined) console.log(`  ${k} = ${V[k]}`)
  const present=['DIGITALOCEAN_API_TOKEN','CONTABO_CLIENT_ID','CONTABO_CLIENT_SECRET','OVH_APP_KEY','OVH_CONSUMER_KEY'].filter(k=>V[k]).map(k=>k.replace(/_API_TOKEN|_CLIENT_ID|_APP_KEY|_CONSUMER_KEY/,''))
  console.log(`  providers with creds present: ${[...new Set(present)].join(', ')||'(none)'}`)
}
async function doIdentity(label,token){
  if(!token){console.log(`  ${label}: no DO token`);return null}
  const a=await doGet(token,'/v2/account')
  try{const acc=JSON.parse(a.body).account;console.log(`  ${label} DO account: ${acc.email} uuid=${acc.uuid} status=${acc.status} droplet_limit=${acc.droplet_limit}`);return acc.uuid}catch{console.log(`  ${label} DO account:`,a.status,a.body.slice(0,120));return null}
}
async function doInventory(token){
  const imgs=await doGet(token,'/v2/images?type=custom&per_page=100')
  let golden=[]
  try{golden=(JSON.parse(imgs.body).images||[]).filter(i=>/golden|nomadly|rdp/i.test(i.name)).map(i=>`${i.name}[${i.id}] status=${i.status} regions=${(i.regions||[]).length}`)}catch{}
  const drops=await doGet(token,'/v2/droplets?per_page=200')
  let dl=[]
  try{dl=(JSON.parse(drops.body).droplets||[]).map(d=>`${d.name}[${d.id}] ${d.status} ${(d.region&&d.region.slug)}`)}catch{}
  console.log(`  golden custom images (${golden.length}):`); golden.forEach(g=>console.log('     '+g))
  console.log(`  live droplets (${dl.length}):`); dl.slice(0,40).forEach(d=>console.log('     '+d))
}
;(async()=>{
  providerSummary('NOMADLY', N)
  const S=await railwayVars()
  providerSummary('SMADAV', S)
  console.log('\n### DigitalOcean account identity')
  const nu=await doIdentity('NOMADLY', N.DIGITALOCEAN_API_TOKEN)
  const su=await doIdentity('SMADAV', S.DIGITALOCEAN_API_TOKEN)
  console.log(`  -> same DO account? ${nu&&su?(nu===su?'YES (shared)':'NO (separate)'):'unknown'}`)
  console.log('\n### DO inventory (NOMADLY token)'); await doInventory(N.DIGITALOCEAN_API_TOKEN)
  if(su&&su!==nu){ console.log('\n### DO inventory (SMADAV token)'); await doInventory(S.DIGITALOCEAN_API_TOKEN) }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
