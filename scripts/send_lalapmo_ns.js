// Resend Cloudflare nameserver setup instructions to @lalapmo (chatId 1615382593)
// via the PRODUCTION Nomadly bot. Reads TELEGRAM_BOT_TOKEN_PROD from app-main/.env.
const fs = require('fs')
const https = require('https')
function readEnv(f){const o={};for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const env = readEnv('/opt/nomadly/app-main/backend/.env')
const TOKEN = env.TELEGRAM_BOT_TOKEN_PROD || env.TELEGRAM_BOT_TOKEN
const CHAT = '1615382593'
const DOMAIN = 'claimoffericers.online'
const NS = ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com']

const text =
  `🔧 <b>Nameserver Setup — ${DOMAIN}</b>\n\n` +
  `Your Anti-Red hosting is ready, but your domain still needs to point to our network. ` +
  `At your <b>domain registrar</b> (where you bought <b>${DOMAIN}</b>), set these <b>Cloudflare nameservers</b>:\n\n` +
  `<code>${NS[0]}</code>\n<code>${NS[1]}</code>\n\n` +
  `<b>Steps</b>\n` +
  `1️⃣ Log in to your domain registrar\n` +
  `2️⃣ Open the domain's <b>Nameserver / DNS</b> settings\n` +
  `3️⃣ <b>Replace ALL</b> existing nameservers with the two above\n` +
  `4️⃣ Save — propagation takes 1–24h (up to 48h)\n\n` +
  `⚠️ Copy the names <b>exactly</b> as shown (e.g. <code>${NS[1]}</code>). Don't add an extra <code>ns1./ns2.</code> prefix.\n\n` +
  `Once the nameservers update, your site and Anti-Red protection go live automatically. Reply here if you need a hand. 🛡️`

const payload = JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true })
const req = https.request(
  { hostname: 'api.telegram.org', path: `/bot${TOKEN}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
  (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ try{const j=JSON.parse(b); console.log('ok:', j.ok, 'message_id:', j.result && j.result.message_id, j.ok?'':('err:'+JSON.stringify(j)))}catch{console.log('resp:',b)} }) }
)
req.on('error', e => console.error('send error', e.message))
req.write(payload); req.end()
