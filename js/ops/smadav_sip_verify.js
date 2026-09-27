#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY verify of SMADAV SIP providers, using SAMDAV's own Railway secrets (never printed). */
const fs = require('fs')
const path = require('path')
const https = require('https')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const local=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
const RTOKEN=process.env.RAILWAY_TOKEN||local.API_KEY_RAILWAY
const PROJECT='0f41a48b-d2f6-4be5-acbd-524c6df6d2c6', ENVIRON='b9a9e5d2-0f71-42c4-925b-ac843adcb656', SERVICE='6d40a2dd-dfdf-4d05-9c68-4962a065885c'
function rgql(q,v){const b=JSON.stringify({query:q,variables:v||{}});return new Promise((res,rej)=>{const r=https.request('https://backboard.railway.com/graphql/v2',{method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':RTOKEN,Authorization:`Bearer ${RTOKEN}`,'Content-Length':Buffer.byteLength(b)}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))}})});r.on('error',rej);r.write(b);r.end()})}
function req(opts,body){return new Promise((res,rej)=>{const r=https.request(opts,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}))});r.on('error',rej);if(body)r.write(body);r.end()})}

;(async()=>{
  const vr=await rgql(`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,{p:PROJECT,e:ENVIRON,s:SERVICE})
  const V=vr.data.variables
  const TELNYX_KEY=V.TELNYX_API_KEY, CONN=V.TELNYX_SIP_CONNECTION_ID
  const TW_SID=V.TWILIO_ACCOUNT_SID, TW_TOK=V.TWILIO_AUTH_TOKEN, TW_PREFIX=(V.TWILIO_SIP_DOMAIN_PREFIX||'')

  // ── Telnyx: credential connection ──
  console.log('=== Telnyx credential_connection', CONN, '===')
  try {
    const r=await req({hostname:'api.telnyx.com',path:`/v2/credential_connections/${CONN}`,method:'GET',headers:{Authorization:`Bearer ${TELNYX_KEY}`}})
    if(r.status===200){ const d=JSON.parse(r.body).data; console.log('  OK: name=%s active=%s user_name=%s sip_uri_calling_pref=%s', d.connection_name, d.active, d.user_name, d.sip_uri_calling_preference)
      console.log('  outbound_voice_profile_id=%s webhook=%s', d.outbound&&d.outbound.outbound_voice_profile_id, d.webhook_event_url) }
    else console.log('  HTTP', r.status, r.body.slice(0,200))
  } catch(e){ console.log('  ERR', e.message) }

  // ── Telnyx: how many numbers on this account ──
  try {
    const r=await req({hostname:'api.telnyx.com',path:`/v2/phone_numbers?page[size]=1`,method:'GET',headers:{Authorization:`Bearer ${TELNYX_KEY}`}})
    if(r.status===200){ const j=JSON.parse(r.body); console.log('  telnyx phone_numbers total_results=%s', j.meta&&j.meta.total_results) }
    else console.log('  numbers HTTP', r.status)
  } catch(e){ console.log('  numbers ERR', e.message) }

  // ── Twilio: SIP domains + credential lists ──
  console.log('\n=== Twilio SIP domains (prefix "%s") ===', TW_PREFIX)
  try {
    const auth='Basic '+Buffer.from(`${TW_SID}:${TW_TOK}`).toString('base64')
    const r=await req({hostname:'api.twilio.com',path:`/2010-04-01/Accounts/${TW_SID}/SIP/Domains.json?PageSize=50`,method:'GET',headers:{Authorization:auth}})
    if(r.status===200){ const d=JSON.parse(r.body).domains||[]; for(const dm of d) console.log('  domain: %s  friendly=%s  voiceUrl=%s', dm.domain_name, dm.friendly_name, dm.voice_url) ; if(!d.length) console.log('  (none)') }
    else console.log('  HTTP', r.status, r.body.slice(0,200))
    const cr=await req({hostname:'api.twilio.com',path:`/2010-04-01/Accounts/${TW_SID}/SIP/CredentialLists.json?PageSize=50`,method:'GET',headers:{Authorization:auth}})
    if(cr.status===200){ const cl=JSON.parse(cr.body).credential_lists||[]; console.log('  credential lists:', cl.map(c=>c.friendly_name).join(' | ')||'(none)') }
  } catch(e){ console.log('  ERR', e.message) }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
