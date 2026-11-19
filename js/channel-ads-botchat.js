'use strict'
// Premium animated @Nomadlybot chat videos for channel ads: a real-looking Telegram chat on a phone,
// using the bot's real menu labels. Each flow: user taps → bot types → bot replies with buttons → …
const u = require('./lang/en.js')?.en?.u || {}
const L = (k, d) => u[k] || d

const MAIN = [[L('hostingDomainsRedirect', '🛡️ Anti-Red Hosting'), L('domainNames', '🌐 Bulletproof Domains')], [L('cloudPhone', '📞 Cloud IVR + SIP'), L('vpsPlans', '🖥️ VPS / RDP')], [L('bulkSmsNew', '📲 BulkSMS 🇺🇸🇨🇦'), L('esimMain', '📱 USA eSIM')], [L('digitalProducts', '🛒 Digital Products'), L('wallet', '👛 Wallet')]]

// steps: { me } = user message, { bot, buttons? } = bot reply, { tap } = highlight a button then send it
const FLOWS = {
  'nm-hosting': [{ tap: L('hostingDomainsRedirect', '🛡️ Anti-Red Hosting') }, { bot: 'Hosting that stays online. Every plan includes scanner cloaking, honeypots, IP bans and a WAF.', buttons: [[L('freeTrialMenuButton', '🚀 Free Trial (12 Hours)')], [L('premiumWeekly', '⚡ Premium Anti-Red (1-Week)')], [L('premiumCpanel', '🔷 Premium Anti-Red HostPanel (30 Days)')], [L('goldenCpanel', '👑 Golden Anti-Red HostPanel (30 Days)')]] }, { tap: L('goldenCpanel', '👑 Golden Anti-Red HostPanel (30 Days)') }, { bot: '👑 Golden adds visitor captcha and geo-blocking on top of full protection.\n\nPay from your wallet — your panel is ready in minutes.', buttons: [['🛒 Buy Golden HostPanel']] }],
  'nm-hosting-gold': 'nm-hosting',
  'nm-domains': [{ tap: L('domainNames', '🌐 Bulletproof Domains') }, { bot: 'Register and manage bulletproof domains — full DNS control and privacy included.', buttons: [[L('buyDomainName', '🛒🌐 Buy Domain Names')], [L('viewDomainNames', '📂 My Domain Names')], [L('dnsManagement', '🔧 DNS Management')]] }, { tap: L('buyDomainName', '🛒🌐 Buy Domain Names') }, { bot: 'Type the domain you want 👇' }, { me: 'mybrand.com' }, { bot: '✅ mybrand.com is available.\nPrivacy protection and branded nameservers included.', buttons: [['💳 Pay from Wallet']] }],
  'nm-vps': [{ tap: L('vpsPlans', '🖥️ VPS / RDP') }, { bot: 'Deploy a server worldwide — SSD, your choice of OS. From $5/month.', buttons: [[L('buyVpsPlan', '⚙️ Create VPS / RDP')], [L('manageVpsPlan', '🖥️ Manage my servers')]] }, { tap: L('buyVpsPlan', '⚙️ Create VPS / RDP') }, { bot: 'Linux or Windows?', buttons: [[L('buyLinuxVpsBtn', '🐧 Create Linux VPS')], [L('buyRdpBtn', '🪟 Create Windows RDP')]] }, { tap: L('buyLinuxVpsBtn', '🐧 Create Linux VPS') }, { bot: 'Pick a region, an OS and a size.\nYour server is online in minutes 🚀' }],
  'nm-leads': [{ tap: L('buyLeads', '🎯 Buy Phone Leads') }, { bot: 'Targeted US phone leads by area code and niche. Which area code?' }, { me: '305' }, { bot: 'Great — now pick an industry.', buttons: [['🏠 Real estate', '🚗 Auto'], ['💼 Business', '🏥 Health']] }, { tap: '🏠 Real estate' }, { bot: '✅ Your lead list is ready to download.' }],
  'nm-sms': [{ tap: L('bulkSmsNew', '📲 BulkSMS 🇺🇸🇨🇦') }, { bot: 'Send SMS campaigns to US and Canada numbers.', buttons: [[L('smsCreateCampaign', '📱 Create Campaign')], [L('smsMyCampaigns', '📋 My Campaigns')], [L('smsHowItWorks', '❓ How It Works')]] }, { tap: L('smsCreateCampaign', '📱 Create Campaign') }, { bot: 'Upload your list, write your message, press send. That’s it 📲' }],
  'nm-esim': [{ tap: L('esimMain', '📱 USA eSIM') }, { bot: 'USA eSIM — data, calls and texts on T-Mobile.\n$50/month. Activate on your phone in minutes.', buttons: [['🛒 Get my eSIM']] }, { tap: '🛒 Get my eSIM' }, { bot: '✅ Done! Scan your QR code in Settings → Mobile → Add eSIM.' }],
  'nm-digital': [{ tap: L('digitalProducts', '🛒 Digital Products') }, { bot: 'Ready-to-use accounts, delivered in the chat.', buttons: [['📧 Google Workspace'], ['☁️ Google Cloud'], ['✉️ Zoho Mail'], ['📮 IONOS SMTP']] }, { tap: '📧 Google Workspace' }, { bot: 'Pay from your wallet and your login arrives right here ✅' }],
  'nm-shortener': [{ tap: L('urlShortenerMain', '🔗 URL Shortener') }, { bot: 'Short links on your own domain, with analytics.', buttons: [[L('shortenLink', '✂️ Shorten a Link')], [L('viewShortLinks', '📊 View Shortlink Analytics')]] }, { tap: L('shortenLink', '✂️ Shorten a Link') }, { me: 'https://mystore.com/summer-sale' }, { bot: '✅ Short link ready — clicks are tracked in Analytics.' }],
  'nm-all-in-one': [{ me: '/start' }, { bot: 'Welcome to Nomadly 👋\nHosting, domains, numbers, SMS, VPS and more — all in one bot.', keyboard: MAIN }, { tap: L('cloudPhone', '📞 Cloud IVR + SIP') }, { bot: 'Business numbers with keypad menus and an AI receptionist — set up right here in the chat.' }],
  'nm-reseller': 'nm-hosting',
  'nm-startup': 'nm-all-in-one',
  'nm-nomad': 'nm-esim',
}
const flowFor = (id) => { let f = FLOWS[id] || FLOWS['nm-all-in-one']; if (typeof f === 'string') f = FLOWS[f]; return f }

const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Total run time of a flow in ms (matches the in-page timeline below).
const duration = (steps) => 1200 + steps.reduce((t, s) => t + (s.bot ? 1900 + Math.min(2600, s.bot.length * 22) : s.tap ? 1500 : 1150 + Math.max(700, s.me.length * 28)), 0) + 1800

function chatHtml(steps, theme = { glow: '#3b82f6' }, manual = false) {
  return `<!doctype html><html><head><meta name="viewport" content="width=390,initial-scale=1">${manual ? '<style>html{zoom:2}</style>' : ''}<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700&display=block" rel="stylesheet"><style>
*{margin:0;box-sizing:border-box}html,body{width:390px;height:844px;overflow:hidden;font-family:'Inter Tight',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{background:#0e1621;color:#f5f7fa;display:flex;flex-direction:column}
.top{height:96px;padding:46px 14px 0;display:flex;align-items:center;gap:11px;background:rgba(23,33,43,.92);backdrop-filter:blur(16px);border-bottom:1px solid #ffffff10;z-index:3}
.back{color:${theme.glow};font-size:26px;margin-right:2px}
.av{width:38px;height:38px;border-radius:50%;background:radial-gradient(circle at 30% 30%,${theme.glow},#0b1220);display:grid;place-items:center;font-weight:700;font-size:17px;box-shadow:0 0 18px ${theme.glow}66}
.nm b{display:block;font-size:16px;font-weight:700}.nm span{font-size:12.5px;color:#7f91a4}
.wall{flex:1;position:relative;overflow:hidden;background:radial-gradient(600px 400px at 80% 0%,${theme.glow}22,transparent 60%),radial-gradient(500px 500px at 0% 100%,#22c55e14,transparent 60%),#0e1621}
.wall:before{content:'';position:absolute;inset:0;background-image:radial-gradient(#ffffff0d 1px,transparent 1.2px);background-size:22px 22px}
.feed{position:absolute;left:0;right:0;bottom:0;padding:12px 10px 14px;display:flex;flex-direction:column;gap:8px;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.m{max-width:82%;padding:9px 12px 7px;border-radius:16px;font-size:15px;line-height:1.38;white-space:pre-line;opacity:0;transform:translateY(14px) scale(.96);animation:pop .38s cubic-bezier(.2,.9,.3,1.2) forwards;box-shadow:0 2px 10px #0004}
.m.b{align-self:flex-start;background:#182533;border-bottom-left-radius:5px}
.m.me{align-self:flex-end;background:linear-gradient(135deg,${theme.glow},#2b5278);border-bottom-right-radius:5px}
.m i{display:block;text-align:right;font-style:normal;font-size:11px;color:#ffffff80;margin-top:2px}
.kb{display:flex;flex-direction:column;gap:5px;margin-top:-3px;max-width:82%;opacity:0;animation:pop .4s .15s cubic-bezier(.2,.9,.3,1.2) forwards}
.kb div{display:flex;gap:5px}.kb span,.rk span{flex:1;text-align:center;padding:10px 8px;border-radius:12px;background:#ffffff14;backdrop-filter:blur(10px);font-size:13.5px;font-weight:600;transition:background .2s,transform .2s}
.kb span.hit,.rk span.hit{background:${theme.glow};transform:scale(.95);box-shadow:0 0 22px ${theme.glow}aa}
.typing{align-self:flex-start;background:#182533;border-radius:16px;padding:12px 14px;display:flex;gap:4px;opacity:0;animation:pop .3s forwards}
.typing b{width:7px;height:7px;border-radius:50%;background:#7f91a4;animation:dot 1s infinite}.typing b:nth-child(2){animation-delay:.15s}.typing b:nth-child(3){animation-delay:.3s}
.rk{background:#17212b;padding:7px 7px 26px;display:grid;gap:6px;transform:translateY(100%);transition:transform .45s cubic-bezier(.2,.8,.2,1)}.rk.on{transform:none}.rk div{display:flex;gap:6px}
.bar{height:54px;background:#17212b;display:flex;align-items:center;gap:10px;padding:0 12px 6px;border-top:1px solid #ffffff0d}
.bar .in{flex:1;height:38px;border-radius:19px;background:#242f3d;color:#7f91a4;font-size:15px;display:flex;align-items:center;padding:0 14px;overflow:hidden;white-space:nowrap}
.bar .in.typed{color:#f5f7fa}.bar .send{width:38px;height:38px;border-radius:50%;background:${theme.glow};display:grid;place-items:center;font-size:17px}
.ripple{position:fixed;width:60px;height:60px;border-radius:50%;border:2px solid #fff;pointer-events:none;animation:rip .6s forwards;z-index:9}
@keyframes pop{to{opacity:1;transform:none}}@keyframes dot{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}@keyframes rip{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}
</style></head><body>
<div class="top"><span class="back">‹</span><div class="av">N</div><div class="nm"><b>Nomadly</b><span>bot · @Nomadlybot</span></div></div>
<div class="wall"><div class="feed" id="feed"></div></div>
<div class="rk" id="rk"></div>
<div class="bar"><div class="in" id="in">Message</div><div class="send">➤</div></div>
<script>
const steps=${JSON.stringify(steps)};const feed=document.getElementById('feed'),rk=document.getElementById('rk'),inp=document.getElementById('in');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const t=()=>new Date().toTimeString().slice(0,5);
const e=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let lastKb=null;
function add(html){const d=document.createElement('div');d.innerHTML=html;const n=d.firstElementChild;feed.appendChild(n);return n}
function ripple(el){const r=el.getBoundingClientRect(),x=document.createElement('div');x.className='ripple';x.style.left=(r.left+r.width/2)+'px';x.style.top=(r.top+r.height/2)+'px';document.body.appendChild(x);setTimeout(()=>x.remove(),700)}
function me(text){add('<div class="m me">'+e(text)+'<i>'+t()+' ✓✓</i></div>')}
const play=async()=>{await sleep(1200);
for(const s of steps){
 if(s.me){for(let i=1;i<=s.me.length;i++){inp.textContent=s.me.slice(0,i);inp.classList.add('typed');await sleep(Math.max(28,700/s.me.length))}await sleep(250);inp.textContent='Message';inp.classList.remove('typed');me(s.me);await sleep(900)}
 else if(s.tap){const all=[...(lastKb?lastKb.querySelectorAll('span'):[]),...rk.querySelectorAll('span')];const el=all.find(x=>x.textContent===s.tap);if(el){el.classList.add('hit');ripple(el);await sleep(550)}rk.classList.remove('on');me(s.tap);await sleep(950)}
 else if(s.bot){const ty=add('<div class="typing"><b></b><b></b><b></b></div>');await sleep(900);ty.remove();add('<div class="m b">'+e(s.bot)+'<i>'+t()+'</i></div>');
  if(s.buttons){lastKb=add('<div class="kb">'+s.buttons.map(r=>'<div>'+r.map(b=>'<span>'+e(b)+'</span>').join('')+'</div>').join('')+'</div>')}else lastKb=null;
  if(s.keyboard){rk.innerHTML=s.keyboard.map(r=>'<div>'+r.map(b=>'<span>'+e(b)+'</span>').join('')+'</div>').join('');await sleep(200);rk.classList.add('on')}
  await sleep(1000+Math.min(2600,s.bot.length*22))}
}};
${manual ? 'window.__play=play' : 'play()'};
</script></body></html>`
}

module.exports = { FLOWS, flowFor, chatHtml, duration, esc }
