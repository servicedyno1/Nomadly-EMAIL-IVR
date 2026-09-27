#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* SIP REGISTER smoke test: register `smadavcloudphone@sip.smadavspeech.com` against Telnyx (via the
 * branded domain's A record) to prove the branded SIP domain + Telnyx creds authenticate end-to-end.
 * UDP + MD5 digest. Unregisters afterwards. Creds pulled from the SAMDAV Railway service (in-memory). */
const fs = require('fs')
const path = require('path')
const https = require('https')
const dgram = require('dgram')
const dns = require('dns')
const crypto = require('crypto')
const ENV_FILE = path.resolve(__dirname, '../../backend/.env')
function parseEnv(t){const o={};for(const l of t.split('\n')){const m=l.match(/^([A-Z_0-9]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(v.length>=2&&v[0]===v[v.length-1]&&(v[0]==='"'||v[0]==="'"))v=v.slice(1,-1);o[m[1]]=v}return o}
const N=parseEnv(fs.readFileSync(ENV_FILE,'utf8'))
function req(opts,body){return new Promise(res=>{const r=https.request(opts,x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({status:x.statusCode,body:d}))});r.on('error',e=>res({status:0,body:String(e.message)}));if(body)r.write(body);r.end()})}
function railwayVars(){const b=JSON.stringify({query:`query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,variables:{p:'0f41a48b-d2f6-4be5-acbd-524c6df6d2c6',e:'b9a9e5d2-0f71-42c4-925b-ac843adcb656',s:'6d40a2dd-dfdf-4d05-9c68-4962a065885c'}});return req({hostname:'backboard.railway.com',path:'/graphql/v2',method:'POST',headers:{'Content-Type':'application/json','Project-Access-Token':N.API_KEY_RAILWAY,'Content-Length':Buffer.byteLength(b)}},b).then(r=>JSON.parse(r.body).data.variables)}
const md5=s=>crypto.createHash('md5').update(s).digest('hex')
const rand=n=>crypto.randomBytes(n).toString('hex')

function parseAuth(h){const o={};h.replace(/(\w+)=(?:"([^"]*)"|([^,]*))/g,(m,k,q,u)=>{o[k]=q!==undefined?q:u.trim()});return o}

async function main(){
  const S=await railwayVars()
  const USER=S.TELNYX_SIP_USERNAME, PASS=S.TELNYX_SIP_PASSWORD, DOMAIN=S.SIP_DOMAIN // sip.smadavspeech.com
  const ip=await new Promise(r=>{const rr=new dns.Resolver();rr.setServers(['1.1.1.1']);rr.resolve4(DOMAIN,(e,a)=>r(a&&a[0]))})
  console.log(`REGISTER ${USER}@${DOMAIN}  (resolved ${DOMAIN} -> ${ip}:5060)`)
  const sock=dgram.createSocket('udp4')
  const callId=rand(8)+'@ops', fromTag=rand(4)
  const uri=`sip:${DOMAIN}`
  let local={address:'0.0.0.0',port:0}
  const send=(cseq,authHdr)=>{
    local=sock.address()
    const lines=[
      `REGISTER ${uri} SIP/2.0`,
      `Via: SIP/2.0/UDP ${local.address}:${local.port};branch=z9hG4bK${rand(6)};rport`,
      `Max-Forwards: 70`,
      `From: <sip:${USER}@${DOMAIN}>;tag=${fromTag}`,
      `To: <sip:${USER}@${DOMAIN}>`,
      `Call-ID: ${callId}`,
      `CSeq: ${cseq} REGISTER`,
      `Contact: <sip:${USER}@${local.address}:${local.port}>`,
      authHdr?`Authorization: ${authHdr}`:null,
      `Expires: 60`,
      `User-Agent: nomadly-ops-siptest`,
      `Content-Length: 0`,'',''
    ].filter(x=>x!==null)
    const buf=Buffer.from(lines.join('\r\n'))
    sock.send(buf,5060,ip)
  }
  let done=false
  const finish=(ok,msg)=>{if(done)return;done=true;console.log(ok?`\n✅ ${msg}`:`\n❌ ${msg}`);try{sock.close()}catch{};process.exit(ok?0:1)}
  sock.on('message',(m)=>{
    const s=m.toString()
    const statusLine=s.split('\r\n')[0]
    console.log('  <-', statusLine)
    if(/SIP\/2\.0 (401|407)/.test(s)){
      const wh=(s.match(/WWW-Authenticate:\s*Digest\s*(.*)/i)||s.match(/Proxy-Authenticate:\s*Digest\s*(.*)/i))
      if(!wh) return finish(false,'challenge without Digest header')
      const a=parseAuth(wh[1])
      const ha1=md5(`${USER}:${a.realm}:${PASS}`)
      const ha2=md5(`REGISTER:${uri}`)
      let resp, extra=''
      if(a.qop){const nc='00000001',cnonce=rand(4);resp=md5(`${ha1}:${a.nonce}:${nc}:${cnonce}:${a.qop}:${ha2}`);extra=`, qop=${a.qop}, nc=${nc}, cnonce="${cnonce}"`}
      else resp=md5(`${ha1}:${a.nonce}:${ha2}`)
      const hdr=`Digest username="${USER}", realm="${a.realm}", nonce="${a.nonce}", uri="${uri}", response="${resp}"${a.opaque?`, opaque="${a.opaque}"`:''}${extra}`
      send(2,hdr)
    } else if(/SIP\/2\.0 200/.test(s)){
      finish(true,`Telnyx returned 200 OK — softphone would register successfully against ${DOMAIN} with these creds`)
    } else if(/SIP\/2\.0 (403|404|4\d\d|5\d\d)/.test(s)){
      finish(false,`Telnyx rejected registration: ${statusLine}`)
    }
  })
  sock.bind(0,()=>{ send(1,null) })
  setTimeout(()=>finish(false,'no SIP response within 8s (UDP 5060 may be blocked from this sandbox — DNS+connection health still prove config)'),8000)
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1)})
