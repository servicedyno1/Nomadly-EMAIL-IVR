// Auto-Promo System — Sends 1 daily promotional message to bot users
// 6 themed days: Mon=CloudPhone, Tue=AntiRed, Wed=Leads, Thu=Domains, Fri=Digital, Sat=Cards/Bundles
// Sunday = rest day (no promo). AI-powered dynamic messages with static fallback + daily coupons.

const schedule = require('node-schedule')
const { log } = require('console')
const BROADCAST_CONFIG = require('./broadcast-config.js')

// OpenAI — optional (graceful fallback if missing)
let OpenAI = null
try { OpenAI = require('openai') } catch { log('[AutoPromo] openai package not installed, using static messages only') }

let openai = null
function getOpenAI() {
  if (!openai && OpenAI && process.env.APP_OPEN_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.APP_OPEN_API_KEY })
  }
  return openai
}

const LANG_NAMES = { en: 'English', fr: 'French', zh: 'Chinese (Simplified)', hi: 'Hindi' }

// ─── Service Context for AI Generation ────────────────────────────────
const SERVICE_CONTEXT = {
  cloudphone: {
    services: 'CloudPhone by SpeechCue — virtual phone numbers',
    details: [
      'Virtual phone numbers in 30+ countries — no SIM, no contract',
      'Custom IVR greetings — sound like a real business',
      'Receive calls, SMS, voicemail anywhere in the world',
      'SIP integration for advanced setups',
      'Call forwarding to any number globally',
      'Plans from $50/month with included minutes & SMS',
    ],
    cta: '/start → 📞 Cloud IVR + SIP',
  },
  antired_hosting: {
    services: 'Anti-Red Hosting — DMCA-ignored offshore hosting',
    details: [
      'DMCA-ignored offshore servers — zero takedowns',
      'Anti-Red scanner automatically blocks threats',
      'Premium domain options available with every plan',
      'Full cPanel access with one-click setup',
      'Weekly plans from $30, monthly from $75',
      '99.9% uptime — content stays LIVE no matter what',
    ],
    cta: '/start → 🛡️🔥 Anti-Red Hosting',
  },
  leads_validation: {
    services: 'Phone Leads & CNAM Validation',
    details: [
      'Bulk phone leads by country, area code & carrier',
      'CNAM lookup — get the actual NAME behind each number',
      'Real-time validation — only live, active numbers',
      'Export in any format you need',
      'Leads from $0.025 each, CNAM from $0.015',
      'Results delivered in minutes, not days',
    ],
    cta: '/start → 🎯 Leads & Validation',
  },
  domains_shortener: {
    services: 'Bulletproof Domains + Shortit URL Shortener',
    details: [
      'Register bulletproof domains across 400+ TLDs',
      'DMCA-ignored — content stays yours, no censorship',
      'Premium features included with hosting plans',
      'Cloudflare DNS integration built-in',
      'Shortit: 5 FREE branded short links to start',
      'Click tracking & analytics on every link',
      'Use YOUR own domain as the short URL',
    ],
    cta: '/start → 🌐 Bulletproof Domains',
  },
  digital_products: {
    services: 'Premium Digital Products — instant delivery',
    details: [
      'Twilio accounts — Main $450, Sub $200',
      'Telnyx accounts — Main $400, Sub $150',
      'AWS accounts — Main $350, Sub $150',
      'Google Cloud — $300',
      'Google Workspace — from $100',
      'Zoho Mail — from $100',
      'eSIM T-Mobile — $60',
      'eSIM Airvoice (AT&T) — from $70',
      'All fully verified & delivered in 30 minutes via Telegram',
    ],
    cta: '/start → 🛒 Digital Products',
  },
  cards_bundles: {
    services: 'Virtual Cards, Shipping Labels, Bundles & Reseller Program',
    details: [
      'Virtual cards for online payments & verifications',
      'Shipping labels — generate & track instantly',
      'Service bundles — save big when you combine services',
      'Become a Reseller — earn commission on every referral',
      'All managed from one Telegram bot',
    ],
    cta: '/start to explore everything',
  },
  email_validation: {
    services: 'Email Validation — 7-layer deep verification',
    details: [
      '97%+ accuracy with 7-layer verification engine',
      'Gmail, Yahoo, Hotmail, Outlook + private domain emails',
      'Get a campaign-ready deliverable file instantly',
      'Free 50-email trial — no payment needed to start',
      'Bulk validation up to 100K emails',
      'SMTP-level verification, catch-all detection, disposable filtering',
      'Tiered pricing from $0.003/email for large lists',
    ],
    cta: '/start → 📧 Email Validation',
  },
  marketplace: {
    services: 'P2P Marketplace — buy & sell securely',
    details: [
      'List digital goods, tools & services for sale',
      'Built-in escrow — funds held until delivery confirmed',
      'Chat directly with buyers and sellers inside Telegram',
      'Browse by category — digital goods, tools & more',
      'Up to 10 active listings per seller',
      'Anti-scam protection — payment pattern detection',
      'New listings broadcast to all bot users automatically',
    ],
    cta: '/start → 🏪 Marketplace',
  },
  vps_rdp: {
    services: 'VPS & RDP Servers — Port 25 Open, DMCA-Ignored',
    details: [
      'Linux VPS or Windows RDP — choose your OS',
      'Port 25 open by default — send emails without restrictions',
      'DMCA-ignored offshore hosting on premium cloud infrastructure',
      'Full root/admin access — install anything you need',
      'Plans from $20/month with SSD storage',
      'Instant provisioning — server ready in minutes',
      'Multiple regions: US, EU, Asia',
      'Upgrade RAM, CPU, disk anytime without data loss',
    ],
    cta: '/start → 🖥️ VPS/RDP',
  },
  bulksms_app: {
    services: 'Nomadly BulkSMS App — Send mass SMS campaigns from your Android phone',
    details: [
      'Full-featured Android app for mass SMS campaigns',
      'Send from YOUR phone number — no shared sender IDs',
      'Multi-device support — use up to unlimited devices on Monthly plan',
      'Device limits: Trial = 1 device, Daily = 3 devices, Weekly = 10 devices, Monthly = Unlimited',
      'Schedule campaigns — set exact date & time for delivery',
      'Smart SMS gap timing — control delay between messages for natural delivery',
      'Import contacts from CSV or paste directly',
      'Real-time campaign analytics — sent, failed, pending counts',
      'Free trial: 100 SMS messages — no subscription required to start',
      'Activate with your Telegram bot chat ID — instant setup',
      'Campaign management — create, edit, pause, resume, delete',
      'Works alongside Telegram bot — manage campaigns from either',
      'Daily plan ($50): 3 devices, Weekly ($100): 10 devices, Monthly ($200): unlimited devices',
    ],
    cta: '/start → 📧 BulkSMS (or download from bot menu)',
  },
  email_blast: {
    services: 'Email Blast — Send mass email campaigns directly from Telegram',
    details: [
      'Create and send email campaigns entirely from Telegram — no external tools',
      'Custom subject lines and full HTML body support',
      'Upload contacts via CSV or paste email list',
      'Real-time sending progress — track sent, failed, pending',
      'Built-in SMTP integration — no configuration needed',
      'Schedule campaigns or send immediately',
      'Campaign history and analytics',
      'Affordable pricing — pay per campaign from wallet',
    ],
    cta: '/start → 📧 Email Blast',
  },
  refer_earn: {
    services: 'Refer & Earn — Invite friends and earn real money',
    details: [
      'Share your unique referral link with friends and contacts',
      'Earn commission on every purchase your referrals make',
      'Commissions credited directly to your wallet — withdraw anytime',
      'Works across ALL Nomadly services — Cloud IVR, Hosting, Domains, VPS, BulkSMS, etc.',
      'No cap on earnings — the more you refer, the more you earn',
      'Track your referrals and earnings in real-time',
      'Referral link never expires',
    ],
    cta: '/start → 🤝 Refer & Earn',
  },
}

// ─── Sanitize AI output for Telegram HTML ─────────────────────────────
function sanitizeForTelegram(text) {
  let s = text
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/__(.+?)__/g, '<b>$1</b>')
  s = s.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>')
  s = s.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>')
  s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>')
  s = s.replace(/^#{1,3}\s+/gm, '')
  s = s.replace(/<(?!\/?(?:b|i|u|s|code|pre|a)\b)[^>]*>/gi, '')
  for (const tag of ['b', 'i', 'code']) {
    const opens = (s.match(new RegExp(`<${tag}>`, 'gi')) || []).length
    const closes = (s.match(new RegExp(`</${tag}>`, 'gi')) || []).length
    for (let i = 0; i < opens - closes; i++) s += `</${tag}>`
    if (closes > opens) {
      let excess = closes - opens
      s = s.replace(new RegExp(`</${tag}>`, 'gi'), (match) => {
        if (excess > 0) { excess--; return '' }
        return match
      })
    }
  }
  return s.trim()
}

// ─── AI Dynamic Promo Generation ──────────────────────────────────────
async function generateDynamicPromo(theme, lang) {
  const ai = getOpenAI()
  if (!ai) return null

  const ctx = SERVICE_CONTEXT[theme]
  if (!ctx) return null
  const langName = LANG_NAMES[lang] || 'English'

  const prompt = `You are a top Telegram bot copywriter. Create a UNIQUE, colorful, and highly persuasive promotional message for: ${ctx.services}.

Key details:
${ctx.details.map(d => '- ' + d).join('\n')}

STRICT Requirements:
- Write in ${langName}
- Use ONLY <b>bold</b> and <code>code</code> HTML tags
- Use emojis LIBERALLY throughout — make it colorful and eye-catching (🔥🚀💰✅🎯📞🛡️🌐 etc.)
- Start with a POWERFUL emoji-rich headline that creates curiosity or addresses a pain point
- Focus on ONE key BENEFIT (what the user GAINS), not just features
- Include a social proof or urgency element (e.g. "hundreds already using this", "limited spots")
- Keep under 500 characters
- End with clear CTA: ${ctx.cta}
- Be creative — vary tone, angle, and hook each time
- Do NOT mention VPS, RDP, email blast, or @hostbay_bot
- Sound exciting, not corporate

Return ONLY the promotional message text.`

  try {
    const res = await ai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.95,
    })
    let content = res.choices?.[0]?.message?.content?.trim()
    if (!content || content.length < 30) return null
    content = sanitizeForTelegram(content)
    if (content.length <= 1024) return content
    const truncated = content.substring(0, 600)
    const lastNewline = truncated.lastIndexOf('\n')
    return sanitizeForTelegram(lastNewline > 200 ? truncated.substring(0, lastNewline) : truncated)
  } catch (error) {
    log(`[AutoPromo] OpenAI error for ${theme}/${lang}: ${error.message}`)
    return null
  }
}

// ─── Timezone & Schedule Config ───────────────────────────────────────
const TIMEZONE_OFFSETS = { en: 0, fr: 1, zh: 8, hi: 5.5 }
const LOCAL_TIMES = [{ hour: 10, minute: 0 }, { hour: 19, minute: 0 }] // Morning hero + Evening cross-sell
const THEMES = ['cloudphone', 'antired_hosting', 'leads_validation', 'domains_shortener', 'digital_products', 'cards_bundles', 'email_validation', 'marketplace', 'vps_rdp', 'bulksms_app', 'email_blast', 'refer_earn']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ─── BulkSMS Footer Variations (appended to every promo) ─────────────
const BULKSMS_FOOTER = {
  en: [
    `━━━━━━━━━━━━━━━\n<b>📩 Daily BulkSMS Sendout</b>\nReach thousands instantly — minimum 2,000 messages with <b>98% delivery rate</b>.\nContact Admin: @onarrival1 or @Hostbay_support`,
    `━━━━━━━━━━━━━━━\n<b>📩 BulkSMS That Actually Delivers</b>\n2,000+ messages daily with a <b>98% delivery rate</b> — no wasted sends.\nDM @onarrival1 or @Hostbay_support to start`,
    `━━━━━━━━━━━━━━━\n<b>📩 Need Mass SMS?</b>\nDaily BulkSMS sendout — min. 2,000 messages, <b>98% delivered</b>. Fast & reliable.\nReach out: @onarrival1 or @Hostbay_support`,
  ],
  fr: [
    `━━━━━━━━━━━━━━━\n<b>📩 Envoi BulkSMS Quotidien</b>\nTouchez des milliers de personnes — minimum 2 000 messages avec un <b>taux de livraison de 98%</b>.\nContactez : @onarrival1 ou @Hostbay_support`,
    `━━━━━━━━━━━━━━━\n<b>📩 BulkSMS Fiable & Efficace</b>\n2 000+ messages par jour avec <b>98% de taux de livraison</b> — aucun envoi perdu.\nÉcrivez à @onarrival1 ou @Hostbay_support`,
    `━━━━━━━━━━━━━━━\n<b>📩 Besoin d'envois SMS en masse ?</b>\nEnvoi quotidien — min. 2 000 SMS, <b>98% livrés</b>. Rapide & fiable.\nContact : @onarrival1 ou @Hostbay_support`,
  ],
  zh: [
    `━━━━━━━━━━━━━━━\n<b>📩 每日群发短信服务</b>\n即时触达数千人 — 最低2,000条，<b>98%送达率</b>。\n联系管理员：@onarrival1 或 @Hostbay_support`,
    `━━━━━━━━━━━━━━━\n<b>📩 高效群发短信</b>\n每日2,000+条短信，<b>98%送达率</b> — 零浪费发送。\n私信 @onarrival1 或 @Hostbay_support 开始`,
    `━━━━━━━━━━━━━━━\n<b>📩 需要大量发送短信？</b>\n每日群发 — 最低2,000条，<b>98%成功送达</b>。快速可靠。\n联系：@onarrival1 或 @Hostbay_support`,
  ],
  hi: [
    `━━━━━━━━━━━━━━━\n<b>📩 दैनिक BulkSMS सेवा</b>\nहज़ारों लोगों तक तुरंत पहुँचें — न्यूनतम 2,000 संदेश, <b>98% डिलीवरी दर</b>।\nसंपर्क करें: @onarrival1 या @Hostbay_support`,
    `━━━━━━━━━━━━━━━\n<b>📩 BulkSMS जो सच में डिलीवर होता है</b>\nरोज़ाना 2,000+ मैसेज, <b>98% डिलीवरी रेट</b> — कोई बर्बादी नहीं।\nDM करें @onarrival1 या @Hostbay_support`,
    `━━━━━━━━━━━━━━━\n<b>📩 बल्क SMS चाहिए?</b>\nदैनिक भेजें — न्यूनतम 2,000 SMS, <b>98% डिलीवर</b>। तेज़ और भरोसेमंद।\nसंपर्क: @onarrival1 या @Hostbay_support`,
  ],
}

function getBulkSmsFooter(lang) {
  const footers = BULKSMS_FOOTER[lang] || BULKSMS_FOOTER.en
  return footers[Math.floor(Math.random() * footers.length)]
}

// ─── Private SMTP Footer (appended to every promo before DynoPay) ──
const SMTP_FOOTER = {
  en: [
    `📧 <b>Private SMTP Server</b> — dedicated rotating IP + warming for email inboxing.\nDM @onarrival1 or @Hostbay_support`,
    `📧 <b>Set up your own SMTP server</b> — rotating IP & warming included for max inboxing.\nDM @onarrival1 or @Hostbay_support`,
    `📧 <b>Dedicated SMTP with rotating IP</b> — warming built-in for reliable email delivery.\nDM @onarrival1 or @Hostbay_support`,
  ],
  fr: [
    `📧 <b>Serveur SMTP privé</b> — IP rotative dédiée + préchauffage pour la boîte de réception.\nDM @onarrival1 ou @Hostbay_support`,
    `📧 <b>Configurez votre serveur SMTP</b> — IP rotative & préchauffage inclus pour un inboxing optimal.\nDM @onarrival1 ou @Hostbay_support`,
    `📧 <b>SMTP dédié avec IP rotative</b> — préchauffage intégré pour une livraison fiable.\nDM @onarrival1 ou @Hostbay_support`,
  ],
  zh: [
    `📧 <b>私有SMTP服务器</b> — 专属轮换IP + 预热，确保邮件进入收件箱。\n私信 @onarrival1 或 @Hostbay_support`,
    `📧 <b>搭建您的SMTP服务器</b> — 轮换IP和预热功能，最大化收件率。\n私信 @onarrival1 或 @Hostbay_support`,
    `📧 <b>专属SMTP + 轮换IP</b> — 内置预热，确保邮件可靠投递。\n私信 @onarrival1 或 @Hostbay_support`,
  ],
  hi: [
    `📧 <b>प्राइवेट SMTP सर्वर</b> — डेडिकेटेड रोटेटिंग IP + वार्मिंग, ईमेल इनबॉक्सिंग के लिए।\nDM करें @onarrival1 या @Hostbay_support`,
    `📧 <b>अपना SMTP सर्वर सेटअप करें</b> — रोटेटिंग IP और वार्मिंग शामिल, बेहतर इनबॉक्सिंग।\nDM करें @onarrival1 या @Hostbay_support`,
    `📧 <b>डेडिकेटेड SMTP + रोटेटिंग IP</b> — बिल्ट-इन वार्मिंग, भरोसेमंद ईमेल डिलीवरी।\nDM करें @onarrival1 या @Hostbay_support`,
  ],
}

function getSmtpFooter(lang) {
  const footers = SMTP_FOOTER[lang] || SMTP_FOOTER.en
  return footers[Math.floor(Math.random() * footers.length)]
}

// ─── DynoPay Crypto Footer removed from promo messages (2026-04-20) ──
// Previously appended a dynopay.com advertisement to every promo. Kept this
// note so anyone re-reading the promo pipeline immediately sees why there's
// no DynoPay footer call between the SMTP footer and the BulkSMS footer.

function getOptOutFooter(lang) {
  const footers = {
    en: '💬 Tap /stoppromos to unsubscribe from promotional messages',
    fr: '💬 Tapez /stoppromos pour vous désabonner des messages promotionnels',
    zh: '💬 发送 /stoppromos 取消订阅促销消息',
    hi: '💬 प्रचार संदेशों से सदस्यता समाप्त करने के लिए /stoppromos टैप करें'
  }
  return footers[lang] || footers.en
}

function getOptOutButtonText(lang) {
  const buttons = {
    en: '🔕 Stop Promos',
    fr: '🔕 Arrêter les promos',
    zh: '🔕 停止促销',
    hi: '🔕 प्रोमो बंद करें'
  }
  return buttons[lang] || buttons.en
}

// ═══════════════════════════════════════════════════════════════════════
//  PROMO MESSAGES — 6 themes × 3 variations × 4 languages = 72 ads
// ═══════════════════════════════════════════════════════════════════════

const promoMessages = {

  // ═══════════════════ ENGLISH ═══════════════════

  en: {
    cloudphone: [
      `📞 <b>VIRTUAL PHONE NUMBERS — 30+ COUNTRIES</b>

Pick your plan. Get your number in 60 seconds.

💡 <b>Starter</b> — $50/mo (100 min + 50 SMS)
   Call forwarding + SMS to Telegram

⭐ <b>Pro</b> — $75/mo (500 min + 200 SMS)
   + Voicemail + SIP + Webhooks + IVR Campaigns

👑 <b>Business</b> — $120/mo (Unlimited + 1000 SMS)
   + Auto-Attendant + Call Recording + Scheduling

No contracts. Cancel anytime 🌎

Type <b>/start</b> → 📞 Cloud IVR`,

      `🎙️ <b>SOUND LIKE A REAL BUSINESS WITH CLOUD IVR</b>

"Press 1 for Sales, 2 for Support" — fully automated.

📞 Virtual numbers in 30+ countries
🔐 100% private — no ID required
⚡ Active in 60 seconds

<b>3 Plans Available:</b>
💡 Basic ($50) — Forwarding + SMS
⭐ Pro ($75) — + Voicemail + SIP + IVR
👑 Business ($120) — + Auto-Attendant + Recording

🔥 500+ numbers activated this month

Type <b>/start</b> → 📞 Cloud IVR`,

      `🌍 <b>GET A LOCAL NUMBER IN ANY COUNTRY</b>

Customers call local. You answer from anywhere.

✅ US, UK, CA, DE, AU, NZ + 25 more
✅ Call forwarding anywhere globally
✅ SMS forwarding to Telegram

<b>Scale with Your Needs:</b>
→ Starter: Basic calling ($50/mo)
→ Pro: Add SIP + IVR campaigns ($75/mo)
→ Business: Full automation + recording ($120/mo)

Already trusted by 500+ businesses worldwide 📈

Type <b>/start</b> → 📞 Cloud IVR`,
    ],

    antired_hosting: [
      `🛡️🔥 <b>TIRED OF YOUR SITE GETTING TAKEN DOWN?</b>

Anti-Red Hosting keeps your content LIVE — no matter what.

🔒 DMCA-ignored offshore servers
🔥 Anti-Red scanner blocks threats before they hit
⚡ cPanel access + one-click setup
🛡️ 99.9% uptime guarantee

💰 Weekly plans from <b>$30</b> | Monthly from <b>$75</b>

Your competitors are already hosted offshore.
Don't be the last one without protection 🏴‍☠️

Type <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>BULLETPROOF YOUR WEBSITE. ZERO TAKEDOWNS.</b>

While others get shut down, your site stays UP.

🛡️ <b>Anti-Red Hosting</b> includes:
• DMCA-ignored offshore servers
• Real-time Anti-Red threat scanner
• Full cPanel with file manager
• Weekly or monthly plans

💰 From just <b>$30/week</b>

⚠️ Content removals are at an all-time high.
Protect yourself BEFORE it's too late.

Type <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `⚡ <b>YOUR CONTENT. YOUR RULES. ZERO CENSORSHIP.</b>

Anti-Red Hosting = offshore + anti-scanner protection.

🔒 No DMCA takedowns — ever
🛡️ Anti-Red blocker shields your site 24/7
🖥️ Full cPanel — manage everything yourself
📈 99.9% uptime SLA

💰 <b>$30/week</b> or <b>$75/month</b>

Hundreds of sites already protected ✅
Join them before the next wave of takedowns hits.

Type <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🎯🔥 <b>WANT REAL PHONE LEADS WITH OWNER NAMES?</b>

Stop wasting time on dead numbers.

📋 Bulk phone leads by country, area code & carrier
👤 CNAM lookup — get the actual NAME behind each number
✅ Real-time validation — only live, active numbers
📊 Export in any format you need
⚡ Results delivered in minutes, not days

💰 Leads from <b>$0.025</b> each | CNAM from <b>$0.015</b>

Marketers & sales teams love this. You will too 🚀

Type <b>/start</b> → 🎯 Leads & Validation`,

      `📊 <b>STOP CALLING DEAD NUMBERS.</b>

Every bad lead = wasted time + money. Fix that now.

🎯 <b>Phone Leads:</b> Fresh numbers by country & carrier
✅ <b>Validation:</b> Instantly verify if a number is LIVE
👤 <b>CNAM:</b> See the real name of the phone owner
📋 <b>Export:</b> CSV, JSON — whatever you need

💰 From <b>$0.025/lead</b> | CNAM <b>$0.015/lookup</b>

⚡ Thousands of leads validated daily on this bot.

Type <b>/start</b> → 🎯 Leads & Validation`,

      `👤 <b>KNOW WHO'S BEHIND EVERY PHONE NUMBER</b>

CNAM + validated leads = unstoppable outreach.

🎯 Targeted leads — pick your country, area & carrier
📞 Only verified, active numbers delivered
👤 CNAM reveals the REAL owner name
📊 Bulk processing — thousands at once
💨 Lightning-fast delivery to your Telegram

💰 Leads: <b>$0.025</b> | CNAM: <b>$0.015</b>

Your competitors already have this data. Do you? 🤔

Type <b>/start</b> → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌐🔥 <b>YOUR DOMAIN. YOUR RULES. ZERO CENSORSHIP.</b>

Register bulletproof domains across 400+ TLDs.

🔒 DMCA-ignored — content stays yours forever
🌍 Offshore nameservers included
☁️ Cloudflare DNS integration built-in

<b>PLUS:</b> ✂️ Shortit URL Shortener
🔗 5 FREE branded short links to start
📊 Click tracking & analytics on every link
🌐 Use YOUR domain as the short URL

💰 Domains from <b>$3</b> | Shortener <b>FREE</b> to start

Type <b>/start</b> → 🌐 Bulletproof Domains`,

      `🔗 <b>TURN ANY LONG URL INTO A BRANDED SHORT LINK</b>

Shortit URL Shortener — free, fast & trackable.

✂️ 5 FREE trial links — no signup needed
🌐 Use your OWN custom domain as the link
📊 Real-time click analytics
🔒 Links never expire

<b>NEED A DOMAIN?</b>
🌐 400+ TLDs available — bulletproof & offshore
☁️ Cloudflare DNS included

💰 Short links: <b>FREE</b> | Domains from <b>$3</b>

Start shortening now — type <b>/start</b> → 🔗 URL Shortener`,

      `🏴‍☠️ <b>BULLETPROOF DOMAINS — 400+ TLDs AVAILABLE</b>

Your content should NEVER be at the mercy of registrars.

🌐 Register across .com, .net, .org + 400 more
🔒 DMCA-ignored — no forced takedowns
☁️ Cloudflare DNS + offshore NS options

✂️ <b>Bonus:</b> Shortit gives you 5 FREE branded short URLs!

💰 Domains from <b>$3</b>

Thousands of domains registered through this bot 🚀

Type <b>/start</b> → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🛒🔥 <b>PREMIUM ACCOUNTS — DELIVERED IN 30 MINUTES</b>

No waiting. No verification headaches. Just plug & play.

📞 Twilio — Main <b>$450</b> | Sub <b>$200</b>
📡 Telnyx — Main <b>$400</b> | Sub <b>$150</b>
☁️ AWS — Main <b>$350</b> | Sub <b>$150</b>
🌐 Google Cloud — <b>$300</b>
📧 Google Workspace — from <b>$100</b>
📮 Zoho Mail — from <b>$100</b>
📱 eSIM T-Mobile — <b>$60</b>
📱 eSIM Airvoice (AT&T) — from <b>$70</b>

✅ All fully verified & ready to use
💳 Pay with crypto or bank transfer
🤖 Instant delivery right here in Telegram

Hundreds of accounts delivered this month 🚀

Type <b>/start</b> → 🛒 Digital Products`,

      `⚡ <b>NEED A TWILIO, AWS OR GOOGLE CLOUD ACCOUNT?</b>

Get it in <b>30 minutes</b>. Fully verified. Ready to go.

🔥 <b>Most Popular:</b>
📞 Twilio Sub — <b>$200</b>
📡 Telnyx Sub — <b>$150</b>
☁️ AWS Sub — <b>$150</b>
📱 eSIM T-Mobile — <b>$60</b>
📱 eSIM Airvoice (AT&T) — from <b>$70</b>

🏷️ <b>Premium:</b>
📞 Twilio Main — <b>$450</b>
☁️ AWS Main — <b>$350</b>
🌐 Google Cloud — <b>$300</b>

💳 Crypto & bank payments accepted
📦 Delivered straight to your Telegram

Why wait days when you can have it in minutes? ⏱️

Type <b>/start</b> → 🛒 Digital Products`,

      `🎯 <b>STOP WASTING TIME ON ACCOUNT VERIFICATION</b>

We handle the hassle. You get a working account.

📞 Twilio — verified & funded
📡 Telnyx — SIP-ready instantly
☁️ AWS — full access, no restrictions
🌐 Google Cloud — ready for deployment
📧 Workspace & Zoho — business email in minutes
📱 eSIM — T-Mobile <b>$60</b> | Airvoice AT&T from <b>$70</b>

💰 Starting from just <b>$60</b>
⚡ Average delivery: <b>30 minutes</b>
💳 Pay with crypto or bank

Trusted by hundreds of developers & businesses 🛠️

Type <b>/start</b> → 🛒 Digital Products`,
    ],

    cards_bundles: [
      `💳🔥 <b>VIRTUAL CARDS. SHIPPING LABELS. ALL IN ONE BOT.</b>

Everything you need — one Telegram bot.

💳 <b>Virtual Cards</b> — for online payments & verifications
📦 <b>Shipping Labels</b> — generate & track instantly
🎁 <b>Service Bundles</b> — save BIG when you combine services
💼 <b>Become a Reseller</b> — earn commission on every referral

💰 Cards from <b>$5</b> | Labels from <b>$10</b>
🎁 Bundles save <b>20%+</b>

Why use 10 different platforms?
Nomadly has it ALL in one place ⚡

Type <b>/start</b> to explore everything`,

      `🚀 <b>ONE BOT. EVERY DIGITAL TOOL YOU NEED.</b>

Stop switching between platforms. Get it all here:

💳 Virtual Cards — instant online payments
📦 Shipping Labels — create & track in seconds
📞 Cloud Phone — virtual numbers in 30+ countries
🌐 Bulletproof Domains — 400+ TLDs
🛡️ Anti-Red Hosting — zero takedowns
🛒 Digital Products — Twilio, AWS & more
🎯 Phone Leads — targeted & validated

💼 <b>Want to earn?</b> Join our Reseller Program!

💰 Something for every budget — starting from <b>$3</b>

Type <b>/start</b> to see everything we offer`,

      `💼 <b>EARN MONEY WITH EVERY REFERRAL</b>

Join the Nomadly Reseller Program & build your income.

✅ Sell any service on the bot to YOUR customers
💰 Earn commission on every single sale
🔄 Automated delivery — you don't lift a finger
📊 Track earnings in real-time

<b>What you can resell:</b>
📞 CloudPhone | 🌐 Domains | 🛡️ Hosting
🛒 Digital Products | 💳 Virtual Cards | 📦 Labels

🔥 Our top resellers earn <b>$500+/month</b>

Type <b>/start</b> → 💼 Reseller`,
    ],

    email_validation: [
      `📧🔥 <b>CLEAN YOUR EMAIL LIST — 97% ACCURACY GUARANTEED</b>

Your campaign is only as good as your list.

🔍 7-layer deep verification engine
✅ Gmail, Yahoo, Hotmail, Outlook + private domains
📬 Get a <b>campaign-ready deliverable file</b> instantly
🚫 Remove invalid, disposable & risky emails
⚡ Process up to <b>100K emails</b> per batch

🎁 <b>FREE 50-email trial</b> — no payment needed

Stop wasting money sending to dead inboxes 💀

Type <b>/start</b> → 📧 Email Validation`,

      `🎯 <b>VALIDATE BEFORE YOU BLAST — SAVE MONEY & REPUTATION</b>

Sending to invalid emails = bounces, spam flags & wasted budget.

Our 7-layer engine catches:
❌ Invalid & non-existent addresses
🚫 Disposable & temporary emails
⚠️ Catch-all & risky domains
🔒 Role-based addresses (info@, admin@)

📬 You get a clean <b>deliverable file</b> ready for your campaign.

💰 From just <b>$0.003/email</b> at scale
🎁 Start with <b>50 FREE emails</b>

Type <b>/start</b> → 📧 Email Validation`,

      `⚡ <b>BULK EMAIL VALIDATION — FAST, ACCURATE, AFFORDABLE</b>

Upload your list. Get results in minutes.

📊 <b>What you get:</b>
📬 Campaign-ready deliverable file (use this for blasts)
❌ Invalid & risky emails filtered out
📋 Full report with scores & details

🏷️ <b>Pricing:</b>
1-1K emails: $0.005/ea
1K-10K: $0.004/ea
10K-50K: $0.003/ea

🎁 First <b>50 emails FREE</b> — try it right now!

Type <b>/start</b> → 📧 Email Validation`,
    ],

    marketplace: [
      `🏪🔥 <b>BUY & SELL SECURELY — RIGHT HERE IN TELEGRAM</b>

No middlemen. No sketchy websites. Just direct P2P trades.

🛒 Browse digital goods, tools & services
💰 <b>Built-in escrow</b> — funds held until you confirm delivery
💬 Chat with sellers & buyers directly
🔒 Anti-scam protection built in

📦 List up to <b>10 products</b> — start selling today!
🔍 Browse by category — find exactly what you need

Zero listing fees. Zero commission on first 5 sales.

Type <b>/start</b> → 🏪 Marketplace`,

      `💰 <b>GOT SOMETHING TO SELL? LIST IT IN 60 SECONDS.</b>

Our P2P Marketplace lets you sell to thousands of bot users.

🖼️ Upload photos of your product
📝 Set title, description & price
🌍 Buyers discover it through category browse
💬 Chat relay — stay anonymous until you're ready
🔐 Escrow guarantees you get paid

Digital goods, tools, accounts, services — anything goes.

Type <b>/start</b> → 🏪 Marketplace`,

      `🛒 <b>MARKETPLACE — TRUSTED P2P TRADING ON TELEGRAM</b>

Why risk trading in random groups?

✅ <b>Escrow protection</b> — no scams, guaranteed
💬 <b>In-bot chat</b> — communicate without sharing contacts
📦 <b>Order tracking</b> — from payment to delivery
⭐ <b>Seller ratings</b> — trade with confidence

💰 List products for <b>FREE</b>
🔥 Thousands of active buyers

Build your reputation. Grow your business.

Type <b>/start</b> → 🏪 Marketplace`,
    ],

    vps_rdp: [
      `🖥️🔥 <b>VPS & RDP SERVERS — PORT 25 OPEN, READY TO SEND</b>

Need a server that doesn't block your emails? We got you.

🐧 <b>Linux VPS</b> — full root access, run anything
🪟 <b>Windows RDP</b> — remote desktop, GUI included
📬 <b>Port 25 OPEN</b> by default — no restrictions
🛡️ DMCA-ignored offshore infrastructure
⚡ Instant provisioning — server ready in minutes

💰 Plans from <b>$20/month</b> with SSD storage

Stop fighting with providers that block your ports 🚫

Type <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🚀 <b>DEPLOY YOUR OWN SERVER IN MINUTES — NOT DAYS</b>

No tickets. No waiting. No port restrictions.

🖥️ Choose your OS: Ubuntu, Debian, CentOS, Windows Server
💪 Full root/admin access — install what YOU need
📬 Port 25 open — send emails directly from your server
🌍 Multiple regions: US, Europe, Asia
📈 Upgrade RAM, CPU, disk anytime — zero downtime

💰 Starting at just <b>$20/month</b>

Perfect for email servers, bots, scraping, VPNs & more 🔧

Type <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💼 <b>YOUR OWN PRIVATE SERVER — NO RULES, NO LIMITS</b>

Tired of shared hosting restrictions?

✅ Full root/admin access
✅ Port 25 open for email sending
✅ DMCA-ignored — your content stays up
✅ SSD storage for fast performance
✅ Linux VPS or Windows RDP — your choice

🏷️ <b>Pricing:</b>
🐧 Linux VPS from $20/mo
🪟 Windows RDP from $30/mo

Deploy now. No questions asked.

Type <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `📱🔥 <b>BULKSMS APP — SEND MASS SMS FROM YOUR PHONE</b>

Turn your Android into a bulk SMS powerhouse.

📩 <b>Send from YOUR number</b> — no shared sender IDs
📊 Real-time analytics — track sent, failed & pending
⏰ Schedule campaigns — set exact date & time
🔄 Smart gap timing — natural delivery pacing
📋 Import contacts from CSV or paste directly

<b>📱 Multi-Device Support:</b>
💡 Daily ($50) — 3 devices
⭐ Weekly ($100) — 10 devices
👑 Monthly ($200) — UNLIMITED devices

🆓 <b>Start FREE</b> — 100 SMS trial, no card needed!

Type <b>/start</b> → 📧 BulkSMS`,

      `📲 <b>REACH THOUSANDS WITH ONE TAP — BULKSMS APP</b>

Download the app. Enter your bot code. Start sending.

✅ Send SMS from your own phone number
✅ Create & manage campaigns in seconds
✅ Schedule sends for peak engagement times
✅ Import unlimited contacts via CSV
✅ Real-time delivery tracking

<b>🔥 Why use the app?</b>
→ Messages come from YOUR number — higher trust & replies
→ No API keys or technical setup needed
→ Works alongside the Telegram bot seamlessly

📱 <b>Multi-Device:</b> Use up to UNLIMITED phones on Monthly plan

🆓 Try it free — <b>100 SMS</b> on us!

Type <b>/start</b> → 📧 BulkSMS`,

      `💬 <b>STOP PAYING FOR SMS GATEWAYS — USE YOUR OWN PHONE</b>

Why pay $0.01+ per SMS when you can send for FREE from your number?

📱 <b>Nomadly BulkSMS App</b>:
• Mass SMS campaigns from your Android
• YOUR phone number = higher delivery & trust
• Schedule, pause, resume campaigns anytime
• Smart gap timing prevents carrier throttling
• Full analytics dashboard

<b>💰 Plans with Multi-Device:</b>
Daily ($50): 3 phones | Weekly ($100): 10 phones | Monthly ($200): Unlimited phones

Already have a subscription? BulkSMS is INCLUDED! 🎉

Get the app: Type <b>/start</b> → 📧 BulkSMS`,
    ],

    email_blast: [
      `📧 <b>MASS EMAIL CAMPAIGNS — FROM TELEGRAM</b>

Send thousands of emails without leaving Telegram.

✍️ Custom subject + full HTML body
📋 Upload contacts via CSV or paste
📊 Real-time progress tracking
⏰ Schedule or send now

No external tools needed. Pay per campaign from your wallet.

Type <b>/start</b> → 📧 Email Blast`,

      `🚀 <b>EMAIL BLAST — REACH EVERY INBOX</b>

Your next email campaign is 3 steps away:
1️⃣ Write subject + message
2️⃣ Upload your email list
3️⃣ Hit send — track in real-time

✅ Built-in SMTP — zero config
✅ HTML support for professional emails
✅ Campaign history & analytics

Already have a wallet? You're ready to blast 📨

Type <b>/start</b> → 📧 Email Blast`,

      `💌 <b>STOP PAYING FOR MAILCHIMP</b>

Send mass emails directly from Telegram — simple, fast, affordable.

📧 Custom subject lines & HTML body
📊 Live sending progress
💰 Pay from wallet — no monthly subscription
📋 CSV upload or paste contacts

Hundreds of campaigns already sent this month 📈

Type <b>/start</b> → 📧 Email Blast`,
    ],

    refer_earn: [
      `🤝 <b>EARN MONEY WHILE YOU SLEEP</b>

Share Nomadly → your friends buy → you get paid. Simple.

💰 Commission on EVERY purchase your referrals make
🔗 One link — works across ALL services
💳 Earnings go straight to your wallet
📊 Track referrals & earnings in real-time

No cap. No expiry. Pure passive income 🚀

Type <b>/start</b> → 🤝 Refer & Earn`,

      `💸 <b>YOUR NETWORK = YOUR NET WORTH</b>

Every person you refer to Nomadly earns you real money.

✅ Cloud IVR, Hosting, Domains, VPS, BulkSMS — ALL count
✅ Commission credited instantly to wallet
✅ Withdraw anytime — no minimum

Top referrers are earning $100+ monthly 📈

Grab your link: <b>/start</b> → 🤝 Refer & Earn`,

      `🔥 <b>REFER FRIENDS. GET PAID. REPEAT.</b>

Nomadly's referral program pays you for every sale:

🤝 Share your unique link
💰 Friend buys ANY service → you earn commission
💳 Withdraw from wallet anytime

Works with ALL Nomadly services — the more you share, the more you make.

Start now: <b>/start</b> → 🤝 Refer & Earn`,
    ],
  },

  // ═══════════════════ FRENCH ═══════════════════

  fr: {
    cloudphone: [
      `📞 <b>NUMÉROS VIRTUELS — 30+ PAYS</b>

Choisissez votre plan. Numéro actif en 60 secondes.

💡 <b>Starter</b> — 50$/mois (100 min + 50 SMS)
   Transfert d'appels + SMS vers Telegram

⭐ <b>Pro</b> — 75$/mois (500 min + 200 SMS)
   + Messagerie vocale + SIP + Webhooks + IVR

👑 <b>Business</b> — 120$/mois (Illimité + 1000 SMS)
   + Standard auto + Enregistrement + Planification

Sans contrat. Annulation à tout moment 🌎

Tapez <b>/start</b> → 📞 Cloud IVR`,

      `🎙️ <b>SONNEZ PROFESSIONNEL AVEC CLOUD IVR</b>

"Appuyez 1 pour ventes, 2 pour support" — entièrement automatisé.

📞 Numéros virtuels dans 30+ pays
🔐 100% privé — aucune pièce d'identité
⚡ Actif en 60 secondes

<b>3 Plans Disponibles:</b>
💡 Basic (50$) — Transfert + SMS
⭐ Pro (75$) — + Messagerie + SIP + IVR
👑 Business (120$) — + Standard auto + Enregistrement

🔥 500+ numéros activés ce mois

Tapez <b>/start</b> → 📞 Cloud IVR`,

      `🌍 <b>NUMÉRO LOCAL DANS N'IMPORTE QUEL PAYS</b>

Clients appellent en local. Vous répondez de partout.

✅ US, UK, CA, DE, AU, NZ + 25 autres
✅ Transfert d'appels mondial
✅ Transfert SMS vers Telegram

<b>Évoluez selon vos besoins:</b>
→ Starter: Appels de base (50$/mois)
→ Pro: + SIP + Campagnes IVR (75$/mois)
→ Business: Automatisation complète (120$/mois)

Déjà 500+ entreprises nous font confiance 📈

Tapez <b>/start</b> → 📞 Cloud IVR`,
    ],

    antired_hosting: [
      `🛡️🔥 <b>MARRE QUE VOTRE SITE SOIT SUPPRIMÉ ?</b>

L'hébergement Anti-Red garde votre contenu EN LIGNE — quoi qu'il arrive.

🔒 Serveurs offshore ignorant le DMCA
🔥 Scanner Anti-Red bloque les menaces automatiquement
⚡ Accès cPanel + installation en un clic
🛡️ Garantie de disponibilité 99.9%

💰 Plans hebdomadaires à partir de <b>30$</b> | Mensuels à partir de <b>75$</b>

Vos concurrents sont déjà hébergés offshore 🏴‍☠️

Tapez <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>BLINDEZ VOTRE SITE. ZÉRO SUPPRESSION.</b>

Pendant que d'autres se font fermer, votre site reste EN LIGNE.

🛡️ <b>Anti-Red Hosting</b> inclut :
• Serveurs offshore DMCA-ignorés
• Scanner anti-menaces en temps réel
• cPanel complet avec gestionnaire de fichiers

💰 À partir de <b>30$/semaine</b>

⚠️ Les suppressions de contenu sont au plus haut niveau.
Protégez-vous AVANT qu'il ne soit trop tard.

Tapez <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `⚡ <b>VOTRE CONTENU. VOS RÈGLES. ZÉRO CENSURE.</b>

Anti-Red Hosting = offshore + protection anti-scanner.

🔒 Aucune suppression DMCA — jamais
🛡️ Bloqueur Anti-Red protège 24/7
🖥️ cPanel complet

💰 <b>30$/semaine</b> ou <b>75$/mois</b>

Des centaines de sites déjà protégés ✅

Tapez <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🎯🔥 <b>VOULEZ-VOUS DES LEADS TÉLÉPHONIQUES AVEC LES NOMS DES PROPRIÉTAIRES ?</b>

Arrêtez de perdre du temps sur des numéros morts.

📋 Leads téléphoniques par pays, indicatif et opérateur
👤 Recherche CNAM — obtenez le vrai NOM derrière chaque numéro
✅ Validation en temps réel — seulement des numéros actifs
📊 Export dans le format de votre choix

💰 Leads à partir de <b>0.025$</b> | CNAM à partir de <b>0.015$</b>

Les équipes marketing adorent ça. Vous aussi 🚀

Tapez <b>/start</b> → 🎯 Leads & Validation`,

      `📊 <b>ARRÊTEZ D'APPELER DES NUMÉROS MORTS.</b>

Chaque mauvais lead = du temps et de l'argent perdus.

🎯 Leads frais par pays et opérateur
✅ Vérification instantanée des numéros
👤 CNAM : voyez le vrai nom du propriétaire
📋 Export CSV, JSON — comme vous voulez

💰 À partir de <b>0.025$/lead</b>

⚡ Des milliers de leads validés chaque jour sur ce bot.

Tapez <b>/start</b> → 🎯 Leads & Validation`,

      `👤 <b>SACHEZ QUI EST DERRIÈRE CHAQUE NUMÉRO</b>

CNAM + leads validés = prospection imbattable.

🎯 Leads ciblés — choisissez pays et opérateur
📞 Seulement des numéros vérifiés et actifs
👤 CNAM révèle le vrai nom du propriétaire
💨 Livraison ultra-rapide sur Telegram

💰 Leads : <b>0.025$</b> | CNAM : <b>0.015$</b>

Vos concurrents ont déjà ces données. Et vous ? 🤔

Tapez <b>/start</b> → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌐🔥 <b>VOTRE DOMAINE. VOS RÈGLES. ZÉRO CENSURE.</b>

Enregistrez des domaines blindés parmi 400+ TLDs.

🔒 DMCA-ignoré — votre contenu reste le vôtre
☁️ Intégration Cloudflare DNS incluse

<b>EN PLUS :</b> ✂️ Raccourcisseur Shortit
🔗 5 liens courts gratuits pour commencer
📊 Suivi des clics en temps réel
🌐 Utilisez VOTRE domaine comme URL courte

💰 Domaines à partir de <b>3$</b> | Raccourcisseur <b>GRATUIT</b>

Tapez <b>/start</b> → 🌐 Bulletproof Domains`,

      `🔗 <b>TRANSFORMEZ N'IMPORTE QUELLE URL EN LIEN COURT DE MARQUE</b>

Shortit — gratuit, rapide et traçable.

✂️ 5 liens gratuits — aucune inscription
🌐 Utilisez votre PROPRE domaine
📊 Analytics de clics en temps réel

<b>BESOIN D'UN DOMAINE ?</b>
🌐 400+ TLDs disponibles — blindés et offshore

💰 Liens courts : <b>GRATUIT</b> | Domaines à partir de <b>3$</b>

Tapez <b>/start</b> → 🔗 Raccourcisseur URL`,

      `🏴‍☠️ <b>DOMAINES BLINDÉS — 400+ TLDs DISPONIBLES</b>

Votre contenu ne devrait JAMAIS dépendre des registraires.

🌐 .com, .net, .org + 400 de plus
🔒 DMCA-ignoré — aucune suppression forcée
☁️ Cloudflare DNS + NS offshore

✂️ <b>Bonus :</b> 5 URLs courtes de marque GRATUITES !

💰 Domaines à partir de <b>3$</b>

Tapez <b>/start</b> → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🛒🔥 <b>COMPTES PREMIUM — LIVRÉS EN 30 MINUTES</b>

Aucune attente. Aucun problème de vérification. Prêt à l'emploi.

📞 Twilio — Main <b>450$</b> | Sub <b>200$</b>
📡 Telnyx — Main <b>400$</b> | Sub <b>150$</b>
☁️ AWS — Main <b>350$</b> | Sub <b>150$</b>
🌐 Google Cloud — <b>300$</b>
📧 Google Workspace — à partir de <b>100$</b>
📮 Zoho Mail — à partir de <b>100$</b>
📱 eSIM T-Mobile — <b>60$</b>
📱 eSIM Airvoice (AT&T) — à partir de <b>70$</b>

✅ Tous vérifiés et prêts à utiliser
💳 Crypto ou virement bancaire
🤖 Livraison instantanée sur Telegram

Des centaines de comptes livrés ce mois-ci 🚀

Tapez <b>/start</b> → 🛒 Produits Digitaux`,

      `⚡ <b>BESOIN D'UN COMPTE TWILIO, AWS OU GOOGLE CLOUD ?</b>

Obtenez-le en <b>30 minutes</b>. Vérifié. Prêt à l'emploi.

🔥 <b>Les plus populaires :</b>
📞 Twilio Sub — <b>200$</b>
📡 Telnyx Sub — <b>150$</b>
☁️ AWS Sub — <b>150$</b>
📱 eSIM T-Mobile — <b>60$</b>
📱 eSIM Airvoice (AT&T) — à partir de <b>70$</b>

💳 Crypto et virement acceptés
📦 Livré directement sur votre Telegram

Pourquoi attendre des jours ? ⏱️

Tapez <b>/start</b> → 🛒 Produits Digitaux`,

      `🎯 <b>ARRÊTEZ DE PERDRE DU TEMPS SUR LA VÉRIFICATION</b>

On gère la galère. Vous recevez un compte fonctionnel.

📞 Twilio — vérifié et financé
☁️ AWS — accès complet, sans restrictions
📧 Workspace & Zoho — email pro en minutes
📱 eSIM — T-Mobile <b>60$</b> | Airvoice AT&T à partir de <b>70$</b>

💰 À partir de <b>60$</b>
⚡ Livraison moyenne : <b>30 minutes</b>

Tapez <b>/start</b> → 🛒 Produits Digitaux`,
    ],

    cards_bundles: [
      `💳🔥 <b>CARTES VIRTUELLES. ÉTIQUETTES D'EXPÉDITION. TOUT EN UN BOT.</b>

Tout ce dont vous avez besoin — un seul bot Telegram.

💳 <b>Cartes Virtuelles</b> — paiements en ligne et vérifications
📦 <b>Étiquettes d'Expédition</b> — créez et suivez instantanément
🎁 <b>Packs Services</b> — économisez en combinant les services
💼 <b>Devenez Revendeur</b> — gagnez une commission sur chaque vente

💰 Cartes à partir de <b>5$</b> | Étiquettes à partir de <b>10$</b>
🎁 Packs : économisez <b>20%+</b>

Pourquoi utiliser 10 plateformes ? Nomadly a TOUT ⚡

Tapez <b>/start</b> pour tout explorer`,

      `🚀 <b>UN BOT. TOUS LES OUTILS DIGITAUX.</b>

Arrêtez de switcher entre les plateformes :

💳 Cartes Virtuelles — paiements instantanés
📦 Étiquettes d'Expédition — créez et suivez
📞 Cloud Phone — numéros dans 30+ pays
🌐 Domaines Blindés — 400+ TLDs
🛡️ Hébergement Anti-Red — zéro suppression
🛒 Produits Digitaux — Twilio, AWS et plus

💼 <b>Envie de gagner ?</b> Rejoignez le Programme Revendeur !

💰 À partir de <b>3$</b>

Tapez <b>/start</b> pour tout voir`,

      `💼 <b>GAGNEZ DE L'ARGENT AVEC CHAQUE PARRAINAGE</b>

Rejoignez le Programme Revendeur Nomadly.

✅ Vendez n'importe quel service à VOS clients
💰 Commission sur chaque vente
🔄 Livraison automatisée
📊 Suivi des revenus en temps réel

🔥 Nos meilleurs revendeurs gagnent <b>500$+/mois</b>

Tapez <b>/start</b> → 💼 Revendeur`,
    ],

    email_validation: [
      `📧🔥 <b>NETTOYEZ VOTRE LISTE D'EMAILS — 97% DE PRÉCISION</b>

Votre campagne dépend de la qualité de votre liste.

🔍 Moteur de vérification en 7 couches
✅ Gmail, Yahoo, Hotmail, Outlook + domaines privés
📬 Fichier <b>prêt pour campagne</b> livré instantanément
🚫 Suppression des emails invalides, jetables et risqués
⚡ Jusqu'à <b>100K emails</b> par lot

🎁 <b>50 emails GRATUITS</b> — sans paiement

Arrêtez d'envoyer dans le vide 💀

Tapez <b>/start</b> → 📧 Validation d'Emails`,

      `🎯 <b>VALIDEZ AVANT D'ENVOYER — ÉCONOMISEZ & PROTÉGEZ VOTRE RÉPUTATION</b>

Envoyer à des emails invalides = bounces, spam & budget gaspillé.

Notre moteur détecte :
❌ Adresses invalides & inexistantes
🚫 Emails jetables & temporaires
⚠️ Domaines catch-all & risqués

📬 Recevez un fichier <b>livrable</b> prêt pour votre campagne.

💰 À partir de <b>0,003$/email</b>
🎁 <b>50 emails GRATUITS</b> pour commencer

Tapez <b>/start</b> → 📧 Validation d'Emails`,

      `⚡ <b>VALIDATION D'EMAILS EN MASSE — RAPIDE & ABORDABLE</b>

Uploadez votre liste. Résultats en minutes.

📊 <b>Vous recevez :</b>
📬 Fichier livrable prêt pour vos campagnes
❌ Emails invalides & risqués filtrés
📋 Rapport complet avec scores

🏷️ <b>Tarifs :</b>
1-1K : 0,005$/ea | 1K-10K : 0,004$/ea | 10K+ : 0,003$/ea

🎁 <b>50 emails GRATUITS</b> — essayez maintenant !

Tapez <b>/start</b> → 📧 Validation d'Emails`,
    ],

    marketplace: [
      `🏪🔥 <b>ACHETEZ & VENDEZ EN TOUTE SÉCURITÉ — ICI SUR TELEGRAM</b>

Pas d'intermédiaire. Pas de sites douteux. Du P2P direct.

🛒 Parcourez produits digitaux, outils & services
💰 <b>Escrow intégré</b> — fonds bloqués jusqu'à confirmation
💬 Chattez directement avec vendeurs & acheteurs
🔒 Protection anti-arnaque intégrée

📦 Listez jusqu'à <b>10 produits</b> — commencez à vendre !

Tapez <b>/start</b> → 🏪 Marketplace`,

      `💰 <b>UN PRODUIT À VENDRE ? LISTEZ-LE EN 60 SECONDES.</b>

Notre Marketplace P2P vous connecte à des milliers d'utilisateurs.

🖼️ Uploadez des photos
📝 Titre, description & prix
💬 Chat anonyme — restez protégé
🔐 Escrow garanti — vous êtes toujours payé

Produits digitaux, outils, comptes, services — tout est possible.

Tapez <b>/start</b> → 🏪 Marketplace`,

      `🛒 <b>MARKETPLACE — COMMERCE P2P SÉCURISÉ SUR TELEGRAM</b>

Pourquoi risquer de trader dans des groupes aléatoires ?

✅ <b>Protection escrow</b> — zéro arnaque
💬 <b>Chat in-bot</b> — sans partager vos contacts
📦 <b>Suivi de commande</b> — du paiement à la livraison

💰 Listez vos produits <b>GRATUITEMENT</b>

Tapez <b>/start</b> → 🏪 Marketplace`,
    ],

    vps_rdp: [
      `🖥️🔥 <b>SERVEURS VPS & RDP — PORT 25 OUVERT, PRÊT À ENVOYER</b>

Besoin d'un serveur qui ne bloque pas vos emails ? On a ce qu'il faut.

🐧 <b>VPS Linux</b> — accès root complet
🪟 <b>RDP Windows</b> — bureau à distance inclus
📬 <b>Port 25 OUVERT</b> par défaut — aucune restriction
🛡️ Infrastructure offshore ignorant le DMCA
⚡ Provisionnement instantané — serveur prêt en minutes

💰 À partir de <b>20$/mois</b> avec stockage SSD

Arrêtez de vous battre avec les hébergeurs qui bloquent vos ports 🚫

Tapez <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🚀 <b>DÉPLOYEZ VOTRE SERVEUR EN MINUTES — PAS EN JOURS</b>

Pas de tickets. Pas d'attente. Aucune restriction de port.

🖥️ Choisissez votre OS : Ubuntu, Debian, CentOS, Windows Server
💪 Accès root/admin complet — installez ce que VOUS voulez
📬 Port 25 ouvert — envoyez des emails directement
🌍 Plusieurs régions : US, Europe, Asie
📈 Upgrader RAM, CPU, disque à tout moment

💰 À partir de seulement <b>20$/mois</b>

Parfait pour serveurs email, bots, scraping, VPN & plus 🔧

Tapez <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💼 <b>VOTRE PROPRE SERVEUR PRIVÉ — SANS RÈGLES, SANS LIMITES</b>

Marre des restrictions d'hébergement partagé ?

✅ Accès root/admin complet
✅ Port 25 ouvert pour l'envoi d'emails
✅ DMCA-ignoré — votre contenu reste en ligne
✅ Stockage SSD performant
✅ VPS Linux ou RDP Windows — à vous de choisir

🏷️ <b>Tarifs :</b>
🐧 VPS Linux à partir de 20$/mois
🪟 RDP Windows à partir de 30$/mois

Déployez maintenant. Sans questions.

Tapez <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `📱🔥 <b>APP BULKSMS — ENVOYEZ DES SMS EN MASSE DEPUIS VOTRE TÉLÉPHONE</b>

Transformez votre Android en machine à SMS.

📩 <b>Envoyez depuis VOTRE numéro</b> — pas de numéros partagés
📊 Analyses en temps réel — suivez envoyés, échoués & en attente
⏰ Programmez vos campagnes — date et heure exactes
🔄 Espacement intelligent — livraison naturelle
📋 Importez des contacts par CSV ou collez directement

<b>📱 Support Multi-Appareils :</b>
💡 Journalier (50$) — 3 appareils
⭐ Hebdomadaire (100$) — 10 appareils
👑 Mensuel (200$) — appareils ILLIMITÉS

🆓 <b>Essai GRATUIT</b> — 100 SMS offerts !

Tapez <b>/start</b> → 📧 BulkSMS`,

      `📲 <b>ATTEIGNEZ DES MILLIERS EN UN CLIC — APP BULKSMS</b>

Téléchargez l'app. Entrez votre code. Commencez à envoyer.

✅ SMS depuis votre propre numéro
✅ Créez et gérez des campagnes en secondes
✅ Programmez pour un engagement optimal
✅ Importation illimitée de contacts CSV
✅ Suivi de livraison en temps réel

📱 <b>Multi-Appareils :</b> Jusqu'à ILLIMITÉ avec l'abonnement Mensuel

🆓 Essayez gratuitement — <b>100 SMS</b> offerts !

Tapez <b>/start</b> → 📧 BulkSMS`,

      `💬 <b>ARRÊTEZ DE PAYER LES PASSERELLES SMS — UTILISEZ VOTRE TÉLÉPHONE</b>

Pourquoi payer 0,01$+ par SMS quand vous pouvez envoyer GRATUITEMENT ?

📱 <b>App Nomadly BulkSMS</b> :
• Campagnes SMS en masse depuis votre Android
• VOTRE numéro = meilleure livraison & confiance
• Programmez, mettez en pause, reprenez à tout moment
• Espacement intelligent anti-blocage opérateur
• Tableau de bord analytique complet

<b>💰 Abonnements Multi-Appareils :</b>
Jour (50$) : 1 tél | Semaine (100$) : 2 tél | Mois (200$) : Illimité

Déjà abonné ? BulkSMS est INCLUS ! 🎉

Tapez <b>/start</b> → 📧 BulkSMS`,
    ],

    email_blast: [
      `📧 <b>CAMPAGNES EMAIL EN MASSE — DEPUIS TELEGRAM</b>

Envoyez des milliers d'emails sans quitter Telegram.

✍️ Objet personnalisé + corps HTML complet
📋 Importez des contacts par CSV ou collez-les
📊 Suivi en temps réel
⏰ Planifiez ou envoyez immédiatement

Aucun outil externe requis. Payez par campagne depuis votre portefeuille.

Tapez <b>/start</b> → 📧 Email Blast`,

      `🚀 <b>EMAIL BLAST — ATTEIGNEZ CHAQUE BOÎTE</b>

Votre prochaine campagne en 3 étapes :
1️⃣ Rédigez l'objet + le message
2️⃣ Importez votre liste
3️⃣ Envoyez — suivez en direct

✅ SMTP intégré — zéro configuration
✅ Support HTML pour des emails pros
✅ Historique et statistiques

Tapez <b>/start</b> → 📧 Email Blast`,

      `💌 <b>ARRÊTEZ DE PAYER POUR MAILCHIMP</b>

Envoyez des emails en masse depuis Telegram — simple, rapide, abordable.

📧 Objets personnalisés & corps HTML
📊 Progression en direct
💰 Payez depuis votre portefeuille — pas d'abonnement
📋 Import CSV ou copier-coller

Tapez <b>/start</b> → 📧 Email Blast`,
    ],

    refer_earn: [
      `🤝 <b>GAGNEZ DE L'ARGENT EN DORMANT</b>

Partagez Nomadly → vos amis achètent → vous êtes payé. Simple.

💰 Commission sur CHAQUE achat de vos filleuls
🔗 Un lien — fonctionne pour TOUS les services
💳 Gains versés directement dans votre portefeuille
📊 Suivez vos filleuls et gains en temps réel

Sans limite. Sans expiration. Revenus passifs purs 🚀

Tapez <b>/start</b> → 🤝 Refer & Earn`,

      `💸 <b>VOTRE RÉSEAU = VOTRE RICHESSE</b>

Chaque personne que vous recommandez vous rapporte de l'argent.

✅ Cloud IVR, Hosting, Domaines, VPS, BulkSMS — TOUT compte
✅ Commission créditée instantanément
✅ Retirez quand vous voulez — pas de minimum

Tapez <b>/start</b> → 🤝 Refer & Earn`,

      `🔥 <b>PARRAINEZ. GAGNEZ. RÉPÉTEZ.</b>

Le programme de parrainage Nomadly vous paie à chaque vente :

🤝 Partagez votre lien unique
💰 Votre ami achète N'IMPORTE QUEL service → vous gagnez
💳 Retirez depuis votre portefeuille à tout moment

Tapez <b>/start</b> → 🤝 Refer & Earn`,
    ],
  },

  zh: {
    cloudphone: [
      `📞 <b>虚拟电话号码 — 30+国家</b>

选择套餐，60秒内激活号码。

💡 <b>入门版</b> — $50/月 (100分钟 + 50短信)
   呼叫转移 + 短信转发至Telegram

⭐ <b>专业版</b> — $75/月 (500分钟 + 200短信)
   + 语音信箱 + SIP + Webhooks + IVR活动

👑 <b>商务版</b> — $120/月 (无限通话 + 1000短信)
   + 自动应答 + 通话录音 + 调度

无合同，随时取消 🌎

输入 <b>/start</b> → 📞 Cloud IVR`,

      `🎙️ <b>Cloud IVR 打造专业形象</b>

"按1转销售，按2转客服" — 全自动化。

📞 30+国家虚拟号码
🔐 100%隐私 — 无需身份验证
⚡ 60秒内激活

<b>3种套餐可选:</b>
💡 基础版 ($50) — 转移 + 短信
⭐ 专业版 ($75) — + 语音信箱 + SIP + IVR
👑 商务版 ($120) — + 自动应答 + 录音

🔥 本月已激活500+号码

输入 <b>/start</b> → 📞 Cloud IVR`,

      `🌍 <b>获取任意国家的本地号码</b>

客户拨打本地号码，您在任何地方接听。

✅ 美国、英国、加拿大、德国、澳洲 + 25国
✅ 全球呼叫转移
✅ 短信转发至Telegram

<b>根据需求升级:</b>
→ 入门版: 基础通话 ($50/月)
→ 专业版: + SIP + IVR活动 ($75/月)
→ 商务版: 完全自动化 + 录音 ($120/月)

已有500+企业信赖 📈

输入 <b>/start</b> → 📞 Cloud IVR`,
    ],

    antired_hosting: [
      `🛡️🔥 <b>厌倦了网站被关停？</b>

Anti-Red托管让您的内容永远在线 — 无论如何。

🔒 无视DMCA的离岸服务器
🔥 Anti-Red扫描器自动拦截威胁
⚡ cPanel访问 + 一键安装
🛡️ 99.9%正常运行时间保证

💰 周计划 <b>$30</b> 起 | 月计划 <b>$75</b> 起

您的竞争对手已经使用离岸托管了 🏴‍☠️

输入 <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>让您的网站坚不可摧。零关停。</b>

当别人被关闭时，您的网站保持在线。

🛡️ <b>Anti-Red托管</b>包含：
• 无视DMCA的离岸服务器
• 实时威胁扫描器
• 完整的cPanel文件管理器

💰 仅需 <b>$30/周</b> 起

⚠️ 内容删除处于历史最高水平。
在为时已晚之前保护自己。

输入 <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `⚡ <b>您的内容。您的规则。零审查。</b>

Anti-Red = 离岸托管 + 反扫描保护。

🔒 永远不会有DMCA删除
🛡️ Anti-Red全天候保护
🖥️ 完整cPanel

💰 <b>$30/周</b> 或 <b>$75/月</b>

数百个网站已受保护 ✅

输入 <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🎯🔥 <b>想要带有机主姓名的真实电话线索？</b>

别再浪费时间在无效号码上了。

📋 按国家、区号和运营商获取批量电话线索
👤 CNAM查询 — 获取号码背后的真实姓名
✅ 实时验证 — 只提供活跃号码
📊 支持任何格式导出

💰 线索 <b>$0.025</b>/条 | CNAM <b>$0.015</b>/次

营销团队都在用。你也会爱上它 🚀

输入 <b>/start</b> → 🎯 Leads & Validation`,

      `📊 <b>别再拨打无效号码了。</b>

每个坏线索 = 浪费的时间和金钱。

🎯 按国家和运营商获取新鲜线索
✅ 即时验证号码是否有效
👤 CNAM：查看号码真实机主
📋 CSV、JSON — 随您导出

💰 <b>$0.025/条</b> 起

⚡ 每天在此机器人上验证数千条线索。

输入 <b>/start</b> → 🎯 Leads & Validation`,

      `👤 <b>了解每个电话号码背后的人</b>

CNAM + 验证线索 = 势不可挡的营销。

🎯 定向线索 — 选择国家、区号和运营商
📞 只交付验证过的活跃号码
👤 CNAM揭示真实机主姓名
💨 闪电般的Telegram交付

💰 线索：<b>$0.025</b> | CNAM：<b>$0.015</b>

您的竞争对手已经拥有这些数据。您呢？🤔

输入 <b>/start</b> → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌐🔥 <b>您的域名。您的规则。零审查。</b>

在400+ TLD中注册防弹域名。

🔒 无视DMCA — 内容永远属于您
☁️ 内置Cloudflare DNS集成

<b>另外：</b> ✂️ Shortit短链接
🔗 5个免费品牌短链接
📊 每个链接的点击追踪分析
🌐 使用您自己的域名作为短URL

💰 域名 <b>$3</b> 起 | 短链接 <b>免费</b>

输入 <b>/start</b> → 🌐 Bulletproof Domains`,

      `🔗 <b>将任何长URL变成品牌短链接</b>

Shortit — 免费、快速、可追踪。

✂️ 5个免费试用链接
🌐 使用您自己的域名
📊 实时点击分析

<b>需要域名？</b>
🌐 400+ TLD可选 — 防弹离岸

💰 短链接：<b>免费</b> | 域名 <b>$3</b> 起

输入 <b>/start</b> → 🔗 URL缩短器`,

      `🏴‍☠️ <b>防弹域名 — 400+ TLD可选</b>

您的内容不应受制于注册商。

🌐 .com、.net、.org + 400更多
🔒 无视DMCA — 无强制删除
☁️ Cloudflare DNS + 离岸NS

✂️ <b>额外奖励：</b>5个免费品牌短URL！

💰 域名 <b>$3</b> 起

输入 <b>/start</b> → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🛒🔥 <b>高级账户 — 30分钟内交付</b>

无需等待。无需验证烦恼。即插即用。

📞 Twilio — Main <b>$450</b> | Sub <b>$200</b>
📡 Telnyx — Main <b>$400</b> | Sub <b>$150</b>
☁️ AWS — Main <b>$350</b> | Sub <b>$150</b>
🌐 Google Cloud — <b>$300</b>
📧 Google Workspace — <b>$100</b> 起
📮 Zoho Mail — <b>$100</b> 起
📱 eSIM T-Mobile — <b>$60</b>
📱 eSIM Airvoice (AT&T) — <b>$70</b> 起

✅ 全部验证完毕，即可使用
💳 支持加密货币或银行转账
🤖 直接在Telegram即时交付

本月已交付数百个账户 🚀

输入 <b>/start</b> → 🛒 Digital Products`,

      `⚡ <b>需要Twilio、AWS或Google Cloud账户？</b>

<b>30分钟</b>内获取。完全验证。即可使用。

🔥 <b>最受欢迎：</b>
📞 Twilio Sub — <b>$200</b>
📡 Telnyx Sub — <b>$150</b>
☁️ AWS Sub — <b>$150</b>
📱 eSIM T-Mobile — <b>$60</b>
📱 eSIM Airvoice (AT&T) — <b>$70</b> 起

💳 支持加密货币和银行转账
📦 直接交付到您的Telegram

何必等几天？分钟即可拥有 ⏱️

输入 <b>/start</b> → 🛒 Digital Products`,

      `🎯 <b>别再浪费时间在账户验证上</b>

我们处理麻烦。您获得可用账户。

📞 Twilio — 已验证并充值
☁️ AWS — 完全访问，无限制
📧 Workspace & Zoho — 分钟内拥有商务邮箱
📱 eSIM — T-Mobile <b>$60</b> | Airvoice AT&T <b>$70</b> 起

💰 <b>$60</b> 起
⚡ 平均交付：<b>30分钟</b>

输入 <b>/start</b> → 🛒 Digital Products`,
    ],

    cards_bundles: [
      `💳🔥 <b>虚拟卡。运输标签。一个机器人搞定。</b>

您需要的一切 — 一个Telegram机器人。

💳 <b>虚拟卡</b> — 在线支付和验证
📦 <b>运输标签</b> — 即时生成和追踪
🎁 <b>服务套餐</b> — 组合购买享大折扣
💼 <b>成为经销商</b> — 每笔推荐赚取佣金

💰 卡片 <b>$5</b> 起 | 标签 <b>$10</b> 起
🎁 套餐节省 <b>20%+</b>

为什么使用10个平台？Nomadly全部搞定 ⚡

输入 <b>/start</b> 探索所有功能`,

      `🚀 <b>一个机器人。所有数字工具。</b>

不再在平台之间切换：

💳 虚拟卡 — 即时在线支付
📦 运输标签 — 秒级创建和追踪
📞 云电话 — 30+国家虚拟号码
🌐 防弹域名 — 400+ TLD
🛡️ Anti-Red托管 — 零关停
🛒 数字产品 — Twilio、AWS等

💼 <b>想赚钱？</b>加入经销商计划！

💰 <b>$3</b> 起

输入 <b>/start</b> 查看所有服务`,

      `💼 <b>每次推荐都能赚钱</b>

加入Nomadly经销商计划，建立您的收入。

✅ 将机器人上的任何服务卖给您的客户
💰 每笔销售赚取佣金
🔄 自动化交付 — 您无需动手
📊 实时追踪收入

🔥 顶级经销商月入 <b>$500+</b>

输入 <b>/start</b> → 💼 Reseller`,
    ],

    email_validation: [
      `📧🔥 <b>清洗邮件列表 — 97%准确率保证</b>

你的营销效果取决于列表质量。

🔍 7层深度验证引擎
✅ Gmail、Yahoo、Hotmail、Outlook + 私有域名
📬 即时获得<b>可投递邮件文件</b>
🚫 移除无效、一次性和高风险邮件
⚡ 单批最多处理 <b>10万封</b>

🎁 <b>免费验证50封邮件</b> — 无需付款

别再浪费钱发到无效邮箱了 💀

输入 <b>/start</b> → 📧 邮件验证`,

      `🎯 <b>发送前先验证 — 省钱又保护声誉</b>

发送到无效邮箱 = 退信、垃圾邮件标记、预算浪费。

我们的引擎检测：
❌ 无效和不存在的地址
🚫 一次性和临时邮箱
⚠️ Catch-all和高风险域名

📬 获得干净的<b>可投递文件</b>，直接用于营销。

💰 低至 <b>$0.003/封</b>
🎁 前 <b>50封免费</b>

输入 <b>/start</b> → 📧 邮件验证`,

      `⚡ <b>批量邮件验证 — 快速、准确、实惠</b>

上传列表，几分钟出结果。

📊 <b>你将收到：</b>
📬 营销就绪的可投递文件
❌ 无效和高风险邮件已过滤
📋 带评分的完整报告

🏷️ <b>价格：</b>
1-1K: $0.005/封 | 1K-10K: $0.004/封 | 10K+: $0.003/封

🎁 <b>50封免费</b> — 立即试用！

输入 <b>/start</b> → 📧 邮件验证`,
    ],

    marketplace: [
      `🏪🔥 <b>安全买卖 — 就在Telegram里</b>

没有中间商。没有可疑网站。直接P2P交易。

🛒 浏览数字商品、工具和服务
💰 <b>内置托管</b> — 确认交付后才释放资金
💬 与卖家和买家直接聊天
🔒 内置防诈骗保护

📦 上架最多 <b>10个商品</b> — 今天就开始卖！

输入 <b>/start</b> → 🏪 市场`,

      `💰 <b>有东西要卖？60秒上架。</b>

我们的P2P市场连接数千名机器人用户。

🖼️ 上传商品照片
📝 设置标题、描述和价格
💬 匿名聊天 — 保护你的隐私
🔐 托管保证 — 一定会收到付款

数字商品、工具、账户、服务 — 都可以卖。

输入 <b>/start</b> → 🏪 市场`,

      `🛒 <b>市场 — Telegram上的安全P2P交易</b>

为什么要在随机群组里冒险交易？

✅ <b>托管保护</b> — 零诈骗
💬 <b>机器人内聊天</b> — 无需分享联系方式
📦 <b>订单追踪</b> — 从付款到交付

💰 <b>免费</b>上架商品

输入 <b>/start</b> → 🏪 市场`,
    ],

    vps_rdp: [
      `🖥️🔥 <b>VPS和RDP服务器 — 25端口开放，随时发送</b>

需要不封锁邮件的服务器？我们帮你搞定。

🐧 <b>Linux VPS</b> — 完整root权限，运行任何程序
🪟 <b>Windows RDP</b> — 远程桌面，图形界面
📬 <b>25端口默认开放</b> — 无任何限制
🛡️ 忽略DMCA的离岸基础设施
⚡ 即时部署 — 服务器几分钟就绪

💰 套餐仅需 <b>$20/月</b> 含SSD存储

别再跟封端口的供应商较劲了 🚫

输入 <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🚀 <b>几分钟部署你的服务器 — 不是几天</b>

无需工单。无需等待。无端口限制。

🖥️ 选择系统：Ubuntu、Debian、CentOS、Windows Server
💪 完整root/admin权限 — 安装你需要的一切
📬 25端口开放 — 直接从服务器发送邮件
🌍 多个地区：美国、欧洲、亚洲
📈 随时升级内存、CPU、磁盘 — 零停机

💰 仅需 <b>$20/月</b> 起

适合邮件服务器、机器人、爬虫、VPN等 🔧

输入 <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💼 <b>你自己的私人服务器 — 无规则，无限制</b>

厌倦了共享主机的限制？

✅ 完整root/admin权限
✅ 25端口开放发送邮件
✅ 忽略DMCA — 内容永不下架
✅ SSD高速存储
✅ Linux VPS 或 Windows RDP — 你来选

🏷️ <b>价格：</b>
🐧 Linux VPS $20/月起
🪟 Windows RDP $30/月起

立即部署。无需问答。

输入 <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `📱🔥 <b>BULKSMS应用 — 从手机发送群发短信</b>

将您的安卓手机变成群发短信利器。

📩 <b>使用您自己的号码发送</b> — 非共享号码
📊 实时分析 — 追踪已发送、失败和待处理
⏰ 预约活动 — 设置精确的日期和时间
🔄 智能间隔 — 自然投递节奏
📋 从CSV导入联系人或直接粘贴

<b>📱 多设备支持：</b>
💡 日套餐（$50）— 3台设备
⭐ 周套餐（$100）— 10台设备
👑 月套餐（$200）— 无限设备

🆓 <b>免费开始</b> — 100条短信试用！

输入 <b>/start</b> → 📧 BulkSMS`,

      `📲 <b>一键触达千人 — BULKSMS应用</b>

下载应用。输入您的机器人代码。开始发送。

✅ 使用您自己的手机号发送短信
✅ 秒级创建和管理活动
✅ 预约最佳时间发送
✅ CSV无限联系人导入
✅ 实时投递追踪

📱 <b>多设备：</b>月套餐可使用无限台手机

🆓 免费试用 — <b>100条短信</b>送您！

输入 <b>/start</b> → 📧 BulkSMS`,

      `💬 <b>别再付短信网关费用 — 用您自己的手机</b>

📱 <b>Nomadly BulkSMS应用</b>：
• 安卓手机群发短信
• 您的号码 = 更高送达率和信任度
• 随时预约、暂停、恢复活动
• 智能间隔防止运营商限速
• 完整分析面板

<b>💰 多设备套餐：</b>
日（$50）：3台 | 周（$100）：10台 | 月（$200）：无限台

已订阅？BulkSMS已包含！🎉

输入 <b>/start</b> → 📧 BulkSMS`,
    ],

    email_blast: [
      `📧 <b>群发邮件 — 从Telegram直接发送</b>

无需离开Telegram即可发送数千封邮件。

✍️ 自定义主题 + HTML正文
📋 CSV导入或粘贴联系人
📊 实时发送进度
⏰ 定时发送或立即发送

无需外部工具，从钱包按活动付费。

输入 <b>/start</b> → 📧 Email Blast`,

      `🚀 <b>EMAIL BLAST — 触达每个收件箱</b>

3步完成邮件活动：
1️⃣ 编写主题 + 内容
2️⃣ 上传邮件列表
3️⃣ 发送 — 实时追踪

✅ 内置SMTP — 零配置
✅ HTML支持专业邮件
✅ 活动历史和分析

输入 <b>/start</b> → 📧 Email Blast`,

      `💌 <b>不要再为Mailchimp付费了</b>

从Telegram直接群发邮件 — 简单、快速、实惠。

📧 自定义主题和HTML内容
📊 实时发送进度
💰 钱包付费 — 无月费
📋 CSV上传或粘贴联系人

输入 <b>/start</b> → 📧 Email Blast`,
    ],

    refer_earn: [
      `🤝 <b>睡觉也能赚钱</b>

分享Nomadly → 朋友购买 → 你赚钱。就这么简单。

💰 推荐人每笔购买你都有佣金
🔗 一个链接 — 适用于所有服务
💳 收益直接进钱包
📊 实时追踪推荐和收益

无上限。无期限。纯被动收入 🚀

输入 <b>/start</b> → 🤝 Refer & Earn`,

      `💸 <b>你的人脉 = 你的财富</b>

你推荐的每个人都为你赚取真金白银。

✅ Cloud IVR、Hosting、域名、VPS、BulkSMS — 全都算
✅ 佣金即时到账
✅ 随时提现 — 无最低额度

输入 <b>/start</b> → 🤝 Refer & Earn`,

      `🔥 <b>推荐朋友。获得报酬。重复。</b>

Nomadly推荐计划为每笔交易付费：

🤝 分享你的专属链接
💰 朋友购买任何服务 → 你赚佣金
💳 随时从钱包提现

适用于所有Nomadly服务 — 分享越多，赚得越多。

输入 <b>/start</b> → 🤝 Refer & Earn`,
    ],
  },

  hi: {
    cloudphone: [
      `📞 <b>वर्चुअल फोन नंबर — 30+ देश</b>

प्लान चुनें। 60 सेकंड में नंबर एक्टिव।

💡 <b>Starter</b> — $50/माह (100 मिनट + 50 SMS)
   कॉल फॉरवर्डिंग + SMS से Telegram

⭐ <b>Pro</b> — $75/माह (500 मिनट + 200 SMS)
   + वॉइसमेल + SIP + Webhooks + IVR

👑 <b>Business</b> — $120/माह (असीमित + 1000 SMS)
   + ऑटो-अटेंडेंट + रिकॉर्डिंग + शेड्यूलिंग

कोई कॉन्ट्रैक्ट नहीं। कभी भी रद्द करें 🌎

<b>/start</b> टाइप करें → 📞 Cloud IVR`,

      `🎙️ <b>Cloud IVR से प्रोफेशनल दिखें</b>

"1 दबाएं सेल्स, 2 सपोर्ट" — पूरी तरह स्वचालित।

📞 30+ देशों में वर्चुअल नंबर
🔐 100% प्राइवेट — ID नहीं चाहिए
⚡ 60 सेकंड में एक्टिव

<b>3 प्लान उपलब्ध:</b>
💡 Basic ($50) — फॉरवर्डिंग + SMS
⭐ Pro ($75) — + वॉइसमेल + SIP + IVR
👑 Business ($120) — + ऑटो-अटेंडेंट + रिकॉर्डिंग

🔥 इस माह 500+ नंबर एक्टिव

<b>/start</b> टाइप करें → 📞 Cloud IVR`,

      `🌍 <b>किसी भी देश में लोकल नंबर पाएं</b>

ग्राहक लोकल कॉल करें। आप कहीं से भी उत्तर दें।

✅ US, UK, CA, DE, AU, NZ + 25 और
✅ वैश्विक कॉल फॉरवर्डिंग
✅ SMS Telegram पर

<b>जरूरत के अनुसार बढ़ाएं:</b>
→ Starter: बेसिक कॉलिंग ($50/माह)
→ Pro: + SIP + IVR कैंपेन ($75/माह)
→ Business: पूर्ण ऑटोमेशन ($120/माह)

पहले से 500+ कंपनियों का भरोसा 📈

<b>/start</b> टाइप करें → 📞 Cloud IVR`,
    ],

    antired_hosting: [
      `🛡️🔥 <b>आपकी साइट बार-बार हटाई जा रही है?</b>

Anti-Red Hosting आपका कंटेंट हमेशा LIVE रखता है।

🔒 DMCA-इग्नोर्ड ऑफशोर सर्वर
🔥 Anti-Red स्कैनर ऑटोमैटिक खतरे ब्लॉक करता है
⚡ cPanel एक्सेस + वन-क्लिक सेटअप
🛡️ 99.9% अपटाइम गारंटी

💰 साप्ताहिक <b>$30</b> से | मासिक <b>$75</b> से

आपके प्रतिस्पर्धी पहले से ऑफशोर हैं 🏴‍☠️

<b>/start</b> टाइप करें → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>अपनी वेबसाइट को बुलेटप्रूफ बनाएं। ज़ीरो टेकडाउन।</b>

जब दूसरे बंद हो जाते हैं, आपकी साइट चालू रहती है।

🛡️ <b>Anti-Red Hosting</b> में शामिल:
• DMCA-इग्नोर्ड ऑफशोर सर्वर
• रियल-टाइम थ्रेट स्कैनर
• पूरा cPanel फाइल मैनेजर

💰 सिर्फ <b>$30/सप्ताह</b> से

⚠️ कंटेंट हटाने की दर रिकॉर्ड स्तर पर है।
देर होने से पहले सुरक्षित हो जाएं।

<b>/start</b> टाइप करें → 🛡️🔥 Anti-Red Hosting`,

      `⚡ <b>आपका कंटेंट। आपके नियम। ज़ीरो सेंसरशिप।</b>

Anti-Red = ऑफशोर + एंटी-स्कैनर प्रोटेक्शन।

🔒 कभी DMCA टेकडाउन नहीं
🛡️ Anti-Red ब्लॉकर 24/7 सुरक्षा
🖥️ पूरा cPanel

💰 <b>$30/सप्ताह</b> या <b>$75/महीना</b>

सैकड़ों साइट्स पहले से सुरक्षित ✅

<b>/start</b> टाइप करें → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🎯🔥 <b>मालिक के नाम वाले असली फोन लीड्स चाहिए?</b>

बेकार नंबरों पर समय बर्बाद करना बंद करें।

📋 देश, एरिया कोड और कैरियर के अनुसार बल्क लीड्स
👤 CNAM लुकअप — हर नंबर के पीछे का असली नाम जानें
✅ रियल-टाइम वैलिडेशन — सिर्फ लाइव नंबर
📊 किसी भी फॉर्मेट में एक्सपोर्ट

💰 लीड्स <b>$0.025</b>/प्रति | CNAM <b>$0.015</b>/प्रति

मार्केटर्स इसे पसंद करते हैं। आप भी करेंगे 🚀

<b>/start</b> टाइप करें → 🎯 Leads & Validation`,

      `📊 <b>डेड नंबरों पर कॉल करना बंद करें।</b>

हर खराब लीड = बर्बाद समय + पैसा।

🎯 देश और कैरियर के अनुसार फ्रेश लीड्स
✅ तुरंत वेरिफाई करें कि नंबर LIVE है
👤 CNAM: फोन मालिक का असली नाम देखें
📋 CSV, JSON — जो चाहें एक्सपोर्ट करें

💰 <b>$0.025/लीड</b> से

⚡ इस बॉट पर रोज़ हज़ारों लीड्स वैलिडेट होते हैं।

<b>/start</b> टाइप करें → 🎯 Leads & Validation`,

      `👤 <b>हर फोन नंबर के पीछे कौन है, जानें</b>

CNAM + वैलिडेटेड लीड्स = अजेय आउटरीच।

🎯 टार्गेटेड लीड्स — देश, एरिया और कैरियर चुनें
📞 सिर्फ वेरिफाइड, एक्टिव नंबर
👤 CNAM से असली मालिक का नाम
💨 Telegram पर लाइटनिंग-फास्ट डिलीवरी

💰 लीड्स: <b>$0.025</b> | CNAM: <b>$0.015</b>

आपके प्रतिस्पर्धियों के पास ये डेटा है। क्या आपके पास है? 🤔

<b>/start</b> टाइप करें → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌐🔥 <b>आपका डोमेन। आपके नियम। ज़ीरो सेंसरशिप।</b>

400+ TLDs में बुलेटप्रूफ डोमेन रजिस्टर करें।

🔒 DMCA-इग्नोर्ड — कंटेंट हमेशा आपका
🆓 होस्टिंग प्लान के साथ मुफ्त 
☁️ बिल्ट-इन Cloudflare DNS इंटीग्रेशन

<b>साथ में:</b> ✂️ Shortit URL शॉर्टनर
🔗 शुरुआत के लिए 5 मुफ्त ब्रांडेड शॉर्ट लिंक
📊 हर लिंक पर क्लिक ट्रैकिंग
🌐 अपने खुद के डोमेन को शॉर्ट URL के रूप में उपयोग करें

💰 डोमेन <b>$3</b> से | शॉर्टनर <b>मुफ्त</b>

<b>/start</b> टाइप करें → 🌐 Bulletproof Domains`,

      `🔗 <b>किसी भी लंबे URL को ब्रांडेड शॉर्ट लिंक में बदलें</b>

Shortit — मुफ्त, तेज़ और ट्रैक करने योग्य।

✂️ 5 मुफ्त ट्रायल लिंक
🌐 अपने खुद के डोमेन का उपयोग करें
📊 रियल-टाइम क्लिक एनालिटिक्स

<b>डोमेन चाहिए?</b>
🌐 400+ TLD उपलब्ध — बुलेटप्रूफ और ऑफशोर
🆓 होस्टिंग के साथ मुफ्त 

💰 शॉर्ट लिंक: <b>मुफ्त</b> | डोमेन <b>$3</b> से

<b>/start</b> टाइप करें → 🔗 URL शॉर्टनर`,

      `🏴‍☠️ <b>बुलेटप्रूफ डोमेन — 400+ TLD उपलब्ध</b>

आपका कंटेंट कभी रजिस्ट्रार की दया पर नहीं होना चाहिए।

🌐 .com, .net, .org + 400 और
🔒 DMCA-इग्नोर्ड — कोई जबरन हटाना नहीं
☁️ Cloudflare DNS + ऑफशोर NS
🆓 होस्टिंग लेने पर मुफ्त 

✂️ <b>बोनस:</b> 5 मुफ्त ब्रांडेड शॉर्ट URLs!

💰 डोमेन <b>$3</b> से

<b>/start</b> टाइप करें → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🛒🔥 <b>प्रीमियम अकाउंट — 30 मिनट में डिलीवर</b>

कोई इंतज़ार नहीं। कोई वेरिफिकेशन झंझट नहीं। बस प्लग एंड प्ले।

📞 Twilio — Main <b>$450</b> | Sub <b>$200</b>
📡 Telnyx — Main <b>$400</b> | Sub <b>$150</b>
☁️ AWS — Main <b>$350</b> | Sub <b>$150</b>
🌐 Google Cloud — <b>$300</b>
📧 Google Workspace — <b>$100</b> से
📮 Zoho Mail — <b>$100</b> से
📱 eSIM T-Mobile — <b>$60</b>
📱 eSIM Airvoice (AT&T) — <b>$70</b> से

✅ सभी पूर्ण रूप से वेरिफाइड और उपयोग के लिए तैयार
💳 क्रिप्टो या बैंक ट्रांसफर से भुगतान

इस महीने सैकड़ों अकाउंट डिलीवर हुए 🚀

<b>/start</b> टाइप करें → 🛒 Digital Products`,

      `⚡ <b>Twilio, AWS या Google Cloud अकाउंट चाहिए?</b>

<b>30 मिनट</b> में पाएं। पूरी तरह वेरिफाइड। तैयार।

🔥 <b>सबसे लोकप्रिय:</b>
📞 Twilio Sub — <b>$200</b>
📡 Telnyx Sub — <b>$150</b>
☁️ AWS Sub — <b>$150</b>
📱 eSIM T-Mobile — <b>$60</b>
📱 eSIM Airvoice (AT&T) — <b>$70</b> से

💳 क्रिप्टो और बैंक पेमेंट स्वीकार्य
📦 सीधे आपके Telegram पर डिलीवर

दिनों का इंतज़ार क्यों? मिनटों में पाएं ⏱️

<b>/start</b> टाइप करें → 🛒 Digital Products`,

      `🎯 <b>अकाउंट वेरिफिकेशन पर समय बर्बाद करना बंद करें</b>

हम झंझट संभालते हैं। आपको चालू अकाउंट मिलता है।

📞 Twilio — वेरिफाइड और फंडेड
☁️ AWS — पूर्ण एक्सेस, कोई प्रतिबंध नहीं
📧 Workspace & Zoho — मिनटों में बिज़नेस ईमेल
📱 eSIM — T-Mobile <b>$60</b> | Airvoice AT&T <b>$70</b> से

💰 <b>$60</b> से शुरू
⚡ औसत डिलीवरी: <b>30 मिनट</b>

<b>/start</b> टाइप करें → 🛒 Digital Products`,
    ],

    cards_bundles: [
      `💳🔥 <b>वर्चुअल कार्ड। शिपिंग लेबल। सब एक बॉट में।</b>

आपको जो चाहिए वो सब — एक Telegram बॉट।

💳 <b>वर्चुअल कार्ड</b> — ऑनलाइन पेमेंट और वेरिफिकेशन
📦 <b>शिपिंग लेबल</b> — तुरंत जनरेट और ट्रैक करें
🎁 <b>सर्विस बंडल</b> — कॉम्बो में बड़ी बचत
💼 <b>रिसेलर बनें</b> — हर रेफरल पर कमीशन कमाएं

💰 कार्ड <b>$5</b> से | लेबल <b>$10</b> से
🎁 बंडल में <b>20%+</b> बचत

10 प्लेटफॉर्म क्यों? Nomadly में सब है ⚡

<b>/start</b> टाइप करें`,

      `🚀 <b>एक बॉट। हर डिजिटल टूल।</b>

प्लेटफॉर्म्स के बीच स्विच करना बंद करें:

💳 वर्चुअल कार्ड — इंस्टेंट ऑनलाइन पेमेंट
📦 शिपिंग लेबल — सेकंड में बनाएं और ट्रैक करें
📞 क्लाउड फोन — 30+ देशों में वर्चुअल नंबर
🌐 बुलेटप्रूफ डोमेन — 400+ TLD
🛡️ Anti-Red होस्टिंग — ज़ीरो टेकडाउन
🛒 डिजिटल प्रोडक्ट्स — Twilio, AWS और बहुत कुछ

💼 <b>कमाना चाहते हैं?</b> रिसेलर प्रोग्राम जॉइन करें!

💰 <b>$3</b> से शुरू

<b>/start</b> टाइप करें`,

      `💼 <b>हर रेफरल से पैसे कमाएं</b>

Nomadly रिसेलर प्रोग्राम जॉइन करें और आय बनाएं।

✅ बॉट पर कोई भी सर्विस अपने ग्राहकों को बेचें
💰 हर बिक्री पर कमीशन
🔄 ऑटोमेटेड डिलीवरी — आपको कुछ नहीं करना
📊 रियल-टाइम में कमाई ट्रैक करें

🔥 हमारे टॉप रिसेलर <b>$500+/महीना</b> कमाते हैं

<b>/start</b> टाइप करें → 💼 Reseller`,
    ],

    email_validation: [
      `📧🔥 <b>ईमेल लिस्ट साफ करें — 97% सटीकता गारंटी</b>

आपका कैंपेन आपकी लिस्ट जितना ही अच्छा है।

🔍 7-लेयर डीप वेरिफिकेशन इंजन
✅ Gmail, Yahoo, Hotmail, Outlook + प्राइवेट डोमेन
📬 तुरंत <b>कैंपेन-रेडी डिलीवरेबल फाइल</b> पाएं
🚫 इनवैलिड, डिस्पोजेबल और रिस्की ईमेल हटाएं
⚡ एक बैच में <b>100K ईमेल</b> तक

🎁 <b>50 ईमेल मुफ्त</b> — बिना पेमेंट के शुरू करें

डेड इनबॉक्स में पैसे बर्बाद करना बंद करें 💀

<b>/start</b> टाइप करें → 📧 Email Validation`,

      `🎯 <b>भेजने से पहले वैलिडेट करें — पैसे और रेपुटेशन बचाएं</b>

इनवैलिड ईमेल पर भेजना = बाउंस, स्पैम फ्लैग और बर्बाद बजट।

हमारा इंजन पकड़ता है:
❌ इनवैलिड और गैर-मौजूद पते
🚫 डिस्पोजेबल और टेम्पररी ईमेल
⚠️ Catch-all और रिस्की डोमेन

📬 क्लीन <b>डिलीवरेबल फाइल</b> मिलेगी — सीधे कैंपेन में इस्तेमाल करें।

💰 सिर्फ <b>$0.003/ईमेल</b> से शुरू
🎁 <b>50 ईमेल मुफ्त</b>

<b>/start</b> टाइप करें → 📧 Email Validation`,

      `⚡ <b>बल्क ईमेल वैलिडेशन — तेज, सटीक, किफायती</b>

अपनी लिस्ट अपलोड करें। मिनटों में रिजल्ट पाएं।

📊 <b>आपको मिलेगा:</b>
📬 कैंपेन-रेडी डिलीवरेबल फाइल
❌ इनवैलिड और रिस्की ईमेल फिल्टर किए गए
📋 स्कोर के साथ पूरी रिपोर्ट

🏷️ <b>प्राइसिंग:</b>
1-1K: $0.005/ea | 1K-10K: $0.004/ea | 10K+: $0.003/ea

🎁 पहले <b>50 ईमेल मुफ्त</b> — अभी ट्राई करें!

<b>/start</b> टाइप करें → 📧 Email Validation`,
    ],

    marketplace: [
      `🏪🔥 <b>सुरक्षित खरीदें और बेचें — यहीं Telegram पर</b>

कोई बिचौलिया नहीं। कोई शंकास्पद वेबसाइट नहीं। सीधा P2P ट्रेड।

🛒 डिजिटल गुड्स, टूल्स और सर्विसेज ब्राउज करें
💰 <b>बिल्ट-इन एस्क्रो</b> — डिलीवरी कन्फर्म होने तक फंड होल्ड
💬 सीधे सेलर्स और बायर्स से चैट करें
🔒 एंटी-स्कैम प्रोटेक्शन बिल्ट-इन

📦 <b>10 प्रोडक्ट</b> तक लिस्ट करें — आज ही बेचना शुरू करें!

<b>/start</b> टाइप करें → 🏪 Marketplace`,

      `💰 <b>कुछ बेचना है? 60 सेकंड में लिस्ट करें।</b>

हमारा P2P Marketplace आपको हजारों बॉट यूजर्स से जोड़ता है।

🖼️ प्रोडक्ट की फोटो अपलोड करें
📝 टाइटल, डिस्क्रिप्शन और प्राइस सेट करें
💬 एनॉनिमस चैट — प्राइवेसी सुरक्षित
🔐 एस्क्रो गारंटी — पेमेंट पक्की

<b>/start</b> टाइप करें → 🏪 Marketplace`,

      `🛒 <b>MARKETPLACE — Telegram पर सुरक्षित P2P ट्रेडिंग</b>

रैंडम ग्रुप्स में ट्रेड करके क्यों रिस्क लें?

✅ <b>एस्क्रो प्रोटेक्शन</b> — कोई स्कैम नहीं
💬 <b>इन-बॉट चैट</b> — कॉन्टैक्ट शेयर किए बिना
📦 <b>ऑर्डर ट्रैकिंग</b> — पेमेंट से डिलीवरी तक

💰 प्रोडक्ट <b>मुफ्त</b> में लिस्ट करें

<b>/start</b> टाइप करें → 🏪 Marketplace`,
    ],

    vps_rdp: [
      `🖥️🔥 <b>VPS और RDP सर्वर — पोर्ट 25 ओपन, भेजने के लिए तैयार</b>

ऐसा सर्वर चाहिए जो आपकी ईमेल ब्लॉक न करे? हम आपके लिए लाए हैं।

🐧 <b>Linux VPS</b> — पूरा root एक्सेस, कुछ भी चलाएं
🪟 <b>Windows RDP</b> — रिमोट डेस्कटॉप, GUI शामिल
📬 <b>पोर्ट 25 डिफ़ॉल्ट ओपन</b> — कोई पाबंदी नहीं
🛡️ DMCA-इग्नोर ऑफशोर इंफ्रास्ट्रक्चर
⚡ तुरंत प्रोविज़निंग — मिनटों में सर्वर तैयार

💰 प्लान सिर्फ <b>$20/महीने</b> से SSD स्टोरेज के साथ

पोर्ट ब्लॉक करने वाले प्रोवाइडर्स से लड़ना बंद करें 🚫

<b>/start</b> टाइप करें → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🚀 <b>अपना सर्वर मिनटों में डिप्लॉय करें — दिनों में नहीं</b>

कोई टिकट नहीं। कोई इंतज़ार नहीं। कोई पोर्ट प्रतिबंध नहीं।

🖥️ अपना OS चुनें: Ubuntu, Debian, CentOS, Windows Server
💪 पूरा root/admin एक्सेस — जो चाहें इंस्टॉल करें
📬 पोर्ट 25 ओपन — सीधे सर्वर से ईमेल भेजें
🌍 कई क्षेत्र: US, यूरोप, एशिया
📈 कभी भी RAM, CPU, डिस्क अपग्रेड करें

💰 सिर्फ <b>$20/महीने</b> से शुरू

ईमेल सर्वर, बॉट्स, स्क्रैपिंग, VPN और बहुत कुछ के लिए 🔧

<b>/start</b> टाइप करें → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💼 <b>अपना खुद का प्राइवेट सर्वर — कोई नियम नहीं, कोई सीमा नहीं</b>

शेयर्ड होस्टिंग की पाबंदियों से थक गए?

✅ पूरा root/admin एक्सेस
✅ ईमेल भेजने के लिए पोर्ट 25 ओपन
✅ DMCA-इग्नोर — आपका कंटेंट ऑनलाइन रहेगा
✅ फास्ट SSD स्टोरेज
✅ Linux VPS या Windows RDP — आपकी पसंद

🏷️ <b>कीमत:</b>
🐧 Linux VPS $20/महीने से
🪟 Windows RDP $30/महीने से

अभी डिप्लॉय करें। कोई सवाल नहीं।

<b>/start</b> टाइप करें → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `📱🔥 <b>BULKSMS ऐप — अपने फोन से बल्क SMS भेजें</b>

अपने एंड्रॉइड को बल्क SMS मशीन बनाएं।

📩 <b>अपने नंबर से भेजें</b> — कोई शेयर्ड नंबर नहीं
📊 रियल-टाइम एनालिटिक्स — भेजे गए, फेल और पेंडिंग ट्रैक करें
⏰ कैंपेन शेड्यूल करें — सही तारीख और समय सेट करें
🔄 स्मार्ट गैप टाइमिंग — नेचुरल डिलीवरी
📋 CSV से कॉन्टैक्ट्स इम्पोर्ट करें

<b>📱 मल्टी-डिवाइस सपोर्ट:</b>
💡 डेली ($50) — 3 डिवाइस
⭐ वीकली ($100) — 10 डिवाइस
👑 मंथली ($200) — अनलिमिटेड डिवाइस

🆓 <b>फ्री शुरू करें</b> — 100 SMS ट्रायल!

<b>/start</b> टाइप करें → 📧 BulkSMS`,

      `📲 <b>एक टैप में हज़ारों तक पहुंचें — BULKSMS ऐप</b>

ऐप डाउनलोड करें। अपना बॉट कोड डालें। भेजना शुरू करें।

✅ अपने नंबर से SMS भेजें
✅ सेकंड्स में कैंपेन बनाएं और मैनेज करें
✅ बेस्ट टाइम पर शेड्यूल करें
✅ CSV से अनलिमिटेड कॉन्टैक्ट्स इम्पोर्ट
✅ रियल-टाइम डिलीवरी ट्रैकिंग

📱 <b>मल्टी-डिवाइस:</b> मंथली प्लान में अनलिमिटेड फोन

🆓 फ्री में आज़माएं — <b>100 SMS</b> आपके लिए!

<b>/start</b> टाइप करें → 📧 BulkSMS`,

      `💬 <b>SMS गेटवे पर पैसे खर्च करना बंद करें — अपना फोन इस्तेमाल करें</b>

📱 <b>Nomadly BulkSMS ऐप</b>:
• एंड्रॉइड से बल्क SMS कैंपेन
• आपका नंबर = बेहतर डिलीवरी और भरोसा
• कभी भी शेड्यूल, पॉज, रिज्यूम करें
• स्मार्ट गैप — कैरियर थ्रॉटलिंग से बचें
• फुल एनालिटिक्स डैशबोर्ड

<b>💰 मल्टी-डिवाइस प्लान:</b>
डेली ($50): 3 फोन | वीकली ($100): 10 फोन | मंथली ($200): अनलिमिटेड

पहले से सब्सक्राइब हैं? BulkSMS शामिल है! 🎉

<b>/start</b> टाइप करें → 📧 BulkSMS`,
    ],

    email_blast: [
      `📧 <b>मास ईमेल कैंपेन — टेलीग्राम से सीधे</b>

टेलीग्राम छोड़े बिना हज़ारों ईमेल भेजें।

✍️ कस्टम सब्जेक्ट + पूरा HTML बॉडी
📋 CSV से कॉन्टैक्ट्स इम्पोर्ट करें या पेस्ट करें
📊 रियल-टाइम प्रोग्रेस ट्रैकिंग
⏰ शेड्यूल करें या तुरंत भेजें

कोई बाहरी टूल नहीं चाहिए। वॉलेट से प्रति कैंपेन भुगतान।

<b>/start</b> टाइप करें → 📧 Email Blast`,

      `🚀 <b>EMAIL BLAST — हर इनबॉक्स तक पहुँचें</b>

3 स्टेप में ईमेल कैंपेन:
1️⃣ सब्जेक्ट + मैसेज लिखें
2️⃣ ईमेल लिस्ट अपलोड करें
3️⃣ भेजें — लाइव ट्रैक करें

✅ बिल्ट-इन SMTP — ज़ीरो कॉन्फिग
✅ HTML सपोर्ट — प्रोफेशनल ईमेल
✅ कैंपेन हिस्ट्री और एनालिटिक्स

<b>/start</b> टाइप करें → 📧 Email Blast`,

      `💌 <b>MAILCHIMP के लिए पैसे बर्बाद मत करो</b>

टेलीग्राम से सीधे बल्क ईमेल भेजें — सिंपल, फास्ट, सस्ता।

📧 कस्टम सब्जेक्ट और HTML कंटेंट
📊 लाइव सेंडिंग प्रोग्रेस
💰 वॉलेट से भुगतान — कोई मंथली फीस नहीं
📋 CSV अपलोड या पेस्ट

<b>/start</b> टाइप करें → 📧 Email Blast`,
    ],

    refer_earn: [
      `🤝 <b>सोते-सोते पैसे कमाएं</b>

Nomadly शेयर करें → दोस्त खरीदें → आप कमाएं। बस इतना।

💰 आपके रेफरल की हर खरीदारी पर कमीशन
🔗 एक लिंक — सभी सर्विसेज पर काम करता है
💳 कमाई सीधे वॉलेट में
📊 रेफरल और कमाई रियल-टाइम ट्रैक करें

कोई लिमिट नहीं। कोई एक्सपायरी नहीं। शुद्ध पैसिव इनकम 🚀

<b>/start</b> टाइप करें → 🤝 Refer & Earn`,

      `💸 <b>आपका नेटवर्क = आपकी कमाई</b>

आप जिसे भी Nomadly का रेफरल देंगे, आपको असली पैसा मिलेगा।

✅ Cloud IVR, Hosting, Domains, VPS, BulkSMS — सब काउंट होता है
✅ कमीशन तुरंत क्रेडिट
✅ कभी भी निकालें — कोई मिनिमम नहीं

<b>/start</b> टाइप करें → 🤝 Refer & Earn`,

      `🔥 <b>रेफर करो। कमाओ। दोहराओ।</b>

Nomadly का रेफरल प्रोग्राम हर सेल पर पैसे देता है:

🤝 अपना यूनिक लिंक शेयर करें
💰 दोस्त कोई भी सर्विस खरीदे → आप कमाएं
💳 वॉलेट से कभी भी निकालें

सभी Nomadly सर्विसेज पर काम करता है।

<b>/start</b> टाइप करें → 🤝 Refer & Earn`,
    ],
  },
}

const crossSellMessages = {

  // ═══════════════════ ENGLISH CROSS-SELL ═══════════════════

  en: {
    cloudphone: [
      `🌙📞 <b>GOT LEADS? NOW CALL THEM.</b>

Get a virtual phone number and start calling your leads today.

📞 30+ countries | 🎙️ Custom IVR | 💬 SMS included
💰 From <b>$50/mo</b>

Turn data into conversations 🔥

Type <b>/start</b> → 📞 Cloud IVR + SIP`,

      `💡 <b>YOUR LEADS ARE USELESS IF YOU CAN'T CALL THEM</b>

Pick up a virtual number — any country, no SIM needed.

✅ Instant activation
✅ Call forwarding + voicemail
✅ SIP integration

💰 <b>$50/month</b> — start calling tonight

Type <b>/start</b> → 📞 Cloud IVR + SIP`,

      `📞 <b>ADD A PHONE NUMBER TO YOUR TOOLKIT</b>

Every business needs a reachable number.

🌍 30+ countries | 🔐 100% private | 📱 No SIM
🎙️ Professional IVR greeting included

💰 Plans from <b>$50/mo</b>

Type <b>/start</b> → 📞 Cloud IVR + SIP`,
    ],

    antired_hosting: [
      `🌙🛡️ <b>GOT A DOMAIN? HOST IT BULLETPROOF.</b>

Don't register a domain just to get it taken down.

🛡️ Anti-Red Hosting = DMCA-ignored + threat scanner
🌐 Free domain included | ⚡ cPanel access

💰 From <b>$30/week</b>

Protect what you build 🔒

Type <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🔥 <b>YOUR SITE NEEDS A BULLETPROOF HOME</b>

Anti-Red Hosting: offshore, DMCA-ignored, zero takedowns.

🛡️ Anti-Red scanner | 🌐 Free domain | ⚡ cPanel
💰 Weekly from <b>$30</b> | Monthly from <b>$75</b>

Hundreds of sites already protected ✅

Type <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>HOSTING THAT NEVER GOES DOWN</b>

Offshore servers + Anti-Red protection = unstoppable.

✅ 99.9% uptime | 🔒 DMCA-ignored | 🌐 Free domain
💰 From <b>$30/week</b>

Type <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🌙🎯 <b>YOUR SITE IS LIVE — NOW GET LEADS TO IT.</b>

Targeted phone leads delivered in minutes.

📋 By country, area code & carrier
👤 CNAM = real names behind numbers
✅ Only verified, active numbers

💰 From <b>$0.025/lead</b>

Fill your pipeline tonight 🚀

Type <b>/start</b> → 🎯 Leads & Validation`,

      `📊 <b>TRAFFIC IS GREAT. LEADS ARE BETTER.</b>

Get bulk phone leads with owner names — ready for outreach.

🎯 Pick your country & carrier
👤 CNAM lookup included
⚡ Delivered in minutes

💰 Leads <b>$0.025</b> | CNAM <b>$0.015</b>

Type <b>/start</b> → 🎯 Leads & Validation`,

      `🎯 <b>NEED FRESH LEADS? WE'VE GOT THOUSANDS.</b>

Validated phone numbers + owner names.

📋 Bulk export | ✅ Only live numbers | 👤 Real names
💰 From <b>$0.025</b> each

Type <b>/start</b> → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌙🌐 <b>GOT A NUMBER? NOW BRAND IT WITH A DOMAIN.</b>

A custom domain makes everything look professional.

🌐 400+ TLDs | 🔒 DMCA-proof | ☁️ Cloudflare DNS
✂️ Plus: branded short links FREE

💰 Domains from <b>$3</b>

Look legit. Type <b>/start</b> → 🌐 Domains`,

      `🔗 <b>LONG URLS LOOK SKETCHY. FIX THAT.</b>

Shortit: turn any link into a branded short URL.

✂️ 5 FREE links | 📊 Click tracking | 🌐 Your own domain
💰 Shortener = <b>FREE</b> | Domains from <b>$3</b>

Type <b>/start</b> → 🔗 URL Shortener`,

      `🌐 <b>YOUR CONTENT NEEDS A BULLETPROOF ADDRESS</b>

Register a domain that can't be seized or taken down.

🔒 DMCA-ignored | 🌍 400+ TLDs | ☁️ Cloudflare
💰 From <b>$3</b>

Type <b>/start</b> → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🌙🛒 <b>WANT TO RESELL? START WITH THE PRODUCTS.</b>

Premium verified accounts — instant delivery.

📞 Twilio from <b>$200</b> | ☁️ AWS from <b>$150</b>
📱 eSIM from <b>$60</b> | 📧 Workspace from <b>$100</b>

⚡ Delivered in 30 minutes

Type <b>/start</b> → 🛒 Digital Products`,

      `⚡ <b>NEED AN ACCOUNT? DON'T WASTE DAYS VERIFYING.</b>

Twilio, AWS, Google Cloud — all pre-verified.

💰 Starting from <b>$60</b>
🤖 Delivered via Telegram in minutes
💳 Crypto & bank accepted

Type <b>/start</b> → 🛒 Digital Products`,

      `🛒 <b>PLUG & PLAY ACCOUNTS — 30 MIN DELIVERY</b>

📞 Twilio | 📡 Telnyx | ☁️ AWS | 📱 eSIM
All verified. All ready. All here.

💰 From <b>$60</b>

Type <b>/start</b> → 🛒 Digital Products`,
    ],

    cards_bundles: [
      `🌙💳 <b>NEED TO PAY ONLINE? VIRTUAL CARDS READY.</b>

Instant virtual cards for payments & verifications.

💳 Cards from <b>$5</b>
📦 Shipping labels from <b>$10</b>
🎁 Bundles save <b>20%+</b>

All in one bot ⚡ Type <b>/start</b>`,

      `🎁 <b>SAVE BIG WITH SERVICE BUNDLES</b>

Combine any services and get <b>20%+ off</b>.

📞 Phone + 🌐 Domain + 🛡️ Hosting = one bundle
💳 Virtual cards for instant checkout

💰 Bundles from <b>$50</b>

Type <b>/start</b> → 📦 Service Bundles`,

      `💼 <b>TURN THIS BOT INTO YOUR BUSINESS</b>

Join the Reseller Program — earn on every sale.

✅ Sell any service to your clients
💰 Commission on every transaction
🔄 Automated delivery

🔥 Top resellers earn <b>$500+/mo</b>

Type <b>/start</b> → 💼 Reseller`,
    ],

    email_validation: [
      `🌙📧 <b>GOT AN EMAIL LIST? VALIDATE IT FIRST.</b>

Before you blast, make sure your list is clean.

📬 Campaign-ready deliverable file
🔍 7-layer deep verification
🎁 <b>50 emails FREE</b> to start

💰 From <b>$0.003/email</b> at scale

Clean lists = better deliverability 🚀

Type <b>/start</b> → 📧 Email Validation`,

      `💡 <b>YOUR EMAIL LIST IS COSTING YOU MONEY</b>

Dead emails = bounces = spam flags = wasted budget.

✅ Remove invalids, disposables & catch-alls
📬 Get a clean deliverable file
🎁 <b>50 FREE emails</b> — try it now

Type <b>/start</b> → 📧 Email Validation`,

      `📧 <b>CLEAN LIST = BETTER CAMPAIGNS</b>

97%+ accuracy. Results in minutes.

📬 Deliverable file ready for your campaign
❌ Invalid & risky emails removed
💰 From <b>$0.003/email</b>

Type <b>/start</b> → 📧 Email Validation`,
    ],

    marketplace: [
      `🌙🏪 <b>CHECK OUT THE MARKETPLACE</b>

Buy & sell digital goods, tools & services — directly in Telegram.

🔐 Escrow protection on every trade
💬 Chat with sellers without sharing contacts
📦 Browse by category

Type <b>/start</b> → 🏪 Marketplace`,

      `💡 <b>GOT SOMETHING TO SELL? THE MARKETPLACE IS OPEN.</b>

List your products in 60 seconds. Reach thousands of buyers.

💰 Zero listing fees
🔐 Built-in escrow
📦 Up to 10 active listings

Type <b>/start</b> → 🏪 Marketplace`,

      `🛒 <b>MARKETPLACE — TRUSTED P2P TRADES</b>

Stop trading in random groups. Use our secure marketplace.

✅ Escrow | 💬 In-bot chat | 📦 Order tracking

Type <b>/start</b> → 🏪 Marketplace`,
    ],

    vps_rdp: [
      `🌙🖥️ <b>NEED A SERVER? DEPLOY IN MINUTES.</b>

Linux VPS or Windows RDP — Port 25 open, DMCA-ignored.

🐧 VPS from $20/mo | 🪟 RDP from $30/mo | 📬 Port 25 open
⚡ Instant setup — no waiting

Type <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💡 <b>SENDING EMAILS? YOU NEED YOUR OWN SERVER.</b>

Shared hosting blocks Port 25. Our VPS doesn't.

✅ Full root access | ✅ Port 25 open | ✅ DMCA-ignored
💰 From <b>$20/mo</b>

Type <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🔥 <b>VPS & RDP — YOUR PRIVATE SERVER, YOUR RULES</b>

No restrictions. No port blocks. No questions asked.

🖥️ Linux or Windows | 📬 Port 25 open | 🛡️ Offshore
💰 Starting <b>$20/mo</b>

Type <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `🌙📱 <b>GOT CONTACTS? BLAST THEM ALL VIA SMS.</b>

Skip the gateway fees. Send from your own phone.

📩 Your number = trust | ⏰ Schedule sends | 📱 Multi-device
🆓 <b>100 free SMS</b> to try!

Type <b>/start</b> → 📧 BulkSMS`,

      `💡 <b>TIRED OF PAYING PER-SMS? THERE'S A BETTER WAY.</b>

Nomadly BulkSMS App — mass SMS from your Android, YOUR number.

📱 Up to UNLIMITED devices on Monthly plan
✅ Schedule, import CSV, real-time tracking

Type <b>/start</b> → 📧 BulkSMS`,

      `🔥 <b>BULKSMS — THE APP YOUR CAMPAIGNS NEED</b>

Send thousands of SMS from your phone. No gateways. No per-message fees.

📱 Multi-device support | ⏰ Scheduling | 📊 Analytics
🆓 Start with 100 FREE messages!

Type <b>/start</b> → 📧 BulkSMS`,
    ],

    email_blast: [
      `🌙📧 <b>GOT AN EMAIL LIST? BLAST IT NOW.</b>

Send mass emails right from Telegram — no tools, no config.

📧 HTML emails + custom subjects
📊 Real-time tracking
💰 Pay per campaign

Type <b>/start</b> → 📧 Email Blast`,

      `🌙💌 <b>YOUR EMAIL LIST IS COLLECTING DUST</b>

Turn contacts into conversions with Email Blast.

✍️ Write → Upload → Send → Track
All from Telegram. All from your wallet.

Type <b>/start</b> → 📧 Email Blast`,

      `🌙🚀 <b>QUICK EMAIL CAMPAIGN?</b>

3 minutes to blast your entire list.

📧 Full HTML | 📊 Live tracking | 💰 Wallet pay

Type <b>/start</b> → 📧 Email Blast`,
    ],

    refer_earn: [
      `🌙🤝 <b>SHARE NOMADLY. EARN WHILE OTHERS BUY.</b>

Your referral link covers ALL services.
One share = recurring commissions 💰

Type <b>/start</b> → 🤝 Refer & Earn`,

      `🌙💸 <b>PASSIVE INCOME — 1 LINK AWAY</b>

Every friend you bring to Nomadly = money in YOUR wallet.
No limit. No expiry.

Grab your link: <b>/start</b> → 🤝 Refer & Earn`,

      `🌙🔥 <b>TOP REFERRERS EARN $100+/MONTH</b>

Just share your link. We handle the rest.
Commission on every sale. Withdraw anytime.

Type <b>/start</b> → 🤝 Refer & Earn`,
    ],
  },

  // ═══════════════════ FRENCH CROSS-SELL ═══════════════════

  fr: {
    cloudphone: [
      `🌙📞 <b>VOUS AVEZ DES LEADS ? APPELEZ-LES MAINTENANT.</b>

Obtenez un numéro virtuel et commencez à appeler.

📞 30+ pays | 🎙️ IVR personnalisé | 💬 SMS inclus
💰 À partir de <b>50$/mois</b>

Transformez vos données en conversations 🔥

Tapez <b>/start</b> → 📞 Cloud IVR + SIP`,

      `💡 <b>VOS LEADS NE SERVENT À RIEN SI VOUS NE POUVEZ PAS APPELER</b>

Numéro virtuel — n'importe quel pays, sans carte SIM.

✅ Activation instantanée | ✅ Transfert d'appels | ✅ SIP
💰 <b>50$/mois</b>

Tapez <b>/start</b> → 📞 Cloud IVR + SIP`,

      `📞 <b>AJOUTEZ UN NUMÉRO À VOTRE ARSENAL</b>

Chaque business a besoin d'un numéro joignable.

🌍 30+ pays | 🔐 100% privé | 📱 Sans SIM
💰 À partir de <b>50$/mois</b>

Tapez <b>/start</b> → 📞 Cloud IVR + SIP`,
    ],

    antired_hosting: [
      `🌙🛡️ <b>VOUS AVEZ UN DOMAINE ? HÉBERGEZ-LE BLINDÉ.</b>

Anti-Red Hosting = DMCA-ignoré + scanner de menaces.

🛡️ Serveurs offshore | 🌐 Domaine gratuit | ⚡ cPanel
💰 À partir de <b>30$/semaine</b>

Protégez ce que vous construisez 🔒

Tapez <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🔥 <b>VOTRE SITE A BESOIN D'UN HÉBERGEMENT BLINDÉ</b>

Offshore, DMCA-ignoré, zéro suppression.

🛡️ Scanner Anti-Red | 🌐 Domaine gratuit | ⚡ cPanel
💰 À partir de <b>30$/semaine</b>

Tapez <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>HÉBERGEMENT QUI NE TOMBE JAMAIS</b>

Serveurs offshore + protection Anti-Red = imbattable.

✅ 99.9% uptime | 🔒 DMCA-ignoré
💰 À partir de <b>30$/semaine</b>

Tapez <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🌙🎯 <b>VOTRE SITE EST EN LIGNE — OBTENEZ DES LEADS.</b>

Leads téléphoniques ciblés livrés en minutes.

📋 Par pays et opérateur | 👤 Noms réels | ✅ Numéros vérifiés
💰 À partir de <b>0.025$/lead</b>

Tapez <b>/start</b> → 🎯 Leads & Validation`,

      `📊 <b>LE TRAFIC C'EST BIEN. LES LEADS C'EST MIEUX.</b>

Leads téléphoniques avec noms de propriétaires.

🎯 Choisissez pays et opérateur | ⚡ Livraison rapide
💰 Leads <b>0.025$</b> | CNAM <b>0.015$</b>

Tapez <b>/start</b> → 🎯 Leads & Validation`,

      `🎯 <b>BESOIN DE LEADS FRAIS ? ON EN A DES MILLIERS.</b>

Numéros validés + noms de propriétaires.

📋 Export en masse | ✅ Seulement des numéros actifs
💰 À partir de <b>0.025$</b>

Tapez <b>/start</b> → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌙🌐 <b>VOUS AVEZ UN NUMÉRO ? BRANDEZ-LE AVEC UN DOMAINE.</b>

Un domaine personnalisé rend tout professionnel.

🌐 400+ TLDs | 🔒 DMCA-proof | ✂️ Liens courts GRATUITS
💰 Domaines à partir de <b>3$</b>

Tapez <b>/start</b> → 🌐 Domaines`,

      `🔗 <b>LES URLs LONGUES FONT PEU SÉRIEUX. CORRIGEZ ÇA.</b>

Shortit : liens courts de marque gratuits.

✂️ 5 liens GRATUITS | 📊 Tracking | 🌐 Votre domaine
💰 Domaines à partir de <b>3$</b>

Tapez <b>/start</b> → 🔗 Raccourcisseur URL`,

      `🌐 <b>VOTRE CONTENU A BESOIN D'UNE ADRESSE BLINDÉE</b>

Domaines inviolables. 400+ TLDs.

🔒 DMCA-ignoré | ☁️ Cloudflare | 💰 À partir de <b>3$</b>

Tapez <b>/start</b> → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🌙🛒 <b>ENVIE DE REVENDRE ? COMMENCEZ PAR LES PRODUITS.</b>

Comptes premium vérifiés — livraison instantanée.

📞 Twilio <b>200$</b> | ☁️ AWS <b>150$</b> | 📱 eSIM <b>60$</b>
⚡ Livré en 30 minutes

Tapez <b>/start</b> → 🛒 Produits Digitaux`,

      `⚡ <b>NE PERDEZ PAS DES JOURS À VÉRIFIER DES COMPTES</b>

Twilio, AWS, Google Cloud — tous pré-vérifiés.

💰 À partir de <b>60$</b> | 🤖 Livraison Telegram
Tapez <b>/start</b> → 🛒 Produits Digitaux`,

      `🛒 <b>COMPTES PLUG & PLAY — LIVRAISON 30 MIN</b>

📞 Twilio | ☁️ AWS | 📡 Telnyx | 📱 eSIM
Tous vérifiés. Tous prêts. 💰 À partir de <b>60$</b>

Tapez <b>/start</b> → 🛒 Produits Digitaux`,
    ],

    cards_bundles: [
      `🌙💳 <b>BESOIN DE PAYER EN LIGNE ? CARTES VIRTUELLES PRÊTES.</b>

💳 Cartes à partir de <b>5$</b> | 📦 Étiquettes <b>10$</b>
🎁 Packs : économisez <b>20%+</b>

Tout en un seul bot ⚡ Tapez <b>/start</b>`,

      `🎁 <b>ÉCONOMISEZ GROS AVEC LES PACKS SERVICES</b>

📞 Phone + 🌐 Domaine + 🛡️ Hosting = un pack
💰 Économisez <b>20%+</b> en combinant

Tapez <b>/start</b> → 📦 Packs Services`,

      `💼 <b>TRANSFORMEZ CE BOT EN BUSINESS</b>

Rejoignez le Programme Revendeur — gagnez sur chaque vente.

✅ Commission automatique | 🔥 Top revendeurs : <b>500$+/mois</b>

Tapez <b>/start</b> → 💼 Revendeur`,
    ],

    email_validation: [
      `🌙📧 <b>AVEZ-VOUS UNE LISTE D'EMAILS ? VALIDEZ-LA D'ABORD.</b>

Avant de lancer votre campagne, nettoyez votre liste.

📬 Fichier livrable prêt pour campagne
🔍 Vérification en 7 couches
🎁 <b>50 emails GRATUITS</b>

💰 À partir de <b>0,003$/email</b>

Tapez <b>/start</b> → 📧 Validation d'Emails`,

      `💡 <b>VOTRE LISTE D'EMAILS VOUS COÛTE DE L'ARGENT</b>

Emails morts = bounces = spam = budget gaspillé.

✅ Supprimez invalides et jetables
📬 Fichier livrable propre
🎁 <b>50 emails GRATUITS</b>

Tapez <b>/start</b> → 📧 Validation d'Emails`,

      `📧 <b>LISTE PROPRE = MEILLEURES CAMPAGNES</b>

97%+ de précision. Résultats en minutes.

📬 Fichier livrable prêt
💰 À partir de <b>0,003$/email</b>

Tapez <b>/start</b> → 📧 Validation d'Emails`,
    ],

    marketplace: [
      `🌙🏪 <b>DÉCOUVREZ LE MARKETPLACE</b>

Achetez et vendez des produits digitaux — directement sur Telegram.

🔐 Protection escrow sur chaque transaction
💬 Chattez sans partager vos contacts

Tapez <b>/start</b> → 🏪 Marketplace`,

      `💡 <b>UN PRODUIT À VENDRE ? LE MARKETPLACE EST OUVERT.</b>

Listez en 60 secondes. Touchez des milliers d'acheteurs.

💰 Zéro frais | 🔐 Escrow intégré

Tapez <b>/start</b> → 🏪 Marketplace`,

      `🛒 <b>MARKETPLACE — COMMERCE P2P SÉCURISÉ</b>

Arrêtez de trader dans des groupes aléatoires.

✅ Escrow | 💬 Chat in-bot | 📦 Suivi

Tapez <b>/start</b> → 🏪 Marketplace`,
    ],

    vps_rdp: [
      `🌙🖥️ <b>BESOIN D'UN SERVEUR ? DÉPLOYEZ EN MINUTES.</b>

VPS Linux ou RDP Windows — Port 25 ouvert, DMCA-ignoré.

🐧 VPS dès 20$/mois | 🪟 RDP dès 30$/mois | 📬 Port 25 ouvert
⚡ Installation instantanée

Tapez <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💡 <b>VOUS ENVOYEZ DES EMAILS ? IL VOUS FAUT VOTRE PROPRE SERVEUR.</b>

L'hébergement partagé bloque le Port 25. Pas notre VPS.

✅ Accès root | ✅ Port 25 ouvert | ✅ DMCA-ignoré
💰 À partir de <b>20$/mois</b>

Tapez <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🔥 <b>VPS & RDP — VOTRE SERVEUR PRIVÉ, VOS RÈGLES</b>

Aucune restriction. Aucun blocage de port.

🖥️ Linux ou Windows | 📬 Port 25 ouvert | 🛡️ Offshore
💰 À partir de <b>20$/mois</b>

Tapez <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `🌙📱 <b>DES CONTACTS ? ENVOYEZ-LEUR UN SMS EN MASSE.</b>

Oubliez les passerelles. Envoyez depuis votre propre téléphone.

📩 Votre numéro = confiance | ⏰ Programmation | 📱 Multi-appareils
🆓 <b>100 SMS gratuits</b> pour essayer !

Tapez <b>/start</b> → 📧 BulkSMS`,

      `💡 <b>MARRE DE PAYER PAR SMS ? IL Y A MIEUX.</b>

App Nomadly BulkSMS — SMS en masse depuis votre Android.

📱 Jusqu'à ILLIMITÉ d'appareils avec l'abonnement Mensuel

Tapez <b>/start</b> → 📧 BulkSMS`,

      `🔥 <b>BULKSMS — L'APP QUE VOS CAMPAGNES MÉRITENT</b>

Envoyez des milliers de SMS depuis votre téléphone. Sans passerelle.

📱 Multi-appareils | ⏰ Programmation | 📊 Analyses
🆓 Commencez avec 100 SMS GRATUITS !

Tapez <b>/start</b> → 📧 BulkSMS`,
    ],

    email_blast: [
      `🌙📧 <b>VOUS AVEZ UNE LISTE EMAIL ? ENVOYEZ MAINTENANT.</b>

Envoyez en masse depuis Telegram — aucun outil externe.

📧 HTML + objets personnalisés
📊 Suivi en direct
💰 Payez par campagne

Tapez <b>/start</b> → 📧 Email Blast`,

      `🌙💌 <b>VOTRE LISTE EMAIL PREND LA POUSSIÈRE</b>

Transformez vos contacts en conversions.

✍️ Rédigez → Importez → Envoyez → Suivez
Tout depuis Telegram.

Tapez <b>/start</b> → 📧 Email Blast`,

      `🌙🚀 <b>CAMPAGNE EMAIL RAPIDE ?</b>

3 minutes pour envoyer à toute votre liste.

📧 HTML complet | 📊 Suivi live | 💰 Portefeuille

Tapez <b>/start</b> → 📧 Email Blast`,
    ],

    refer_earn: [
      `🌙🤝 <b>PARTAGEZ NOMADLY. GAGNEZ QUAND D'AUTRES ACHÈTENT.</b>

Votre lien couvre TOUS les services.
Un partage = commissions récurrentes 💰

Tapez <b>/start</b> → 🤝 Refer & Earn`,

      `🌙💸 <b>REVENUS PASSIFS — À 1 LIEN DE DISTANCE</b>

Chaque ami que vous amenez = argent dans VOTRE portefeuille.
Sans limite. Sans expiration.

Tapez <b>/start</b> → 🤝 Refer & Earn`,

      `🌙🔥 <b>LES TOP PARRAINS GAGNENT 100$+/MOIS</b>

Partagez votre lien. On s'occupe du reste.
Commission sur chaque vente. Retirez quand vous voulez.

Tapez <b>/start</b> → 🤝 Refer & Earn`,
    ],
  },

  // ═══════════════════ CHINESE CROSS-SELL ═══════════════════

  zh: {
    cloudphone: [
      `🌙📞 <b>有了线索？现在就打电话。</b>

获取虚拟电话号码，今天就开始联系你的潜在客户。

📞 30+国家 | 🎙️ 自定义IVR | 💬 短信包含
💰 <b>$50/月</b> 起

将数据转化为对话 🔥

输入 <b>/start</b> → 📞 Cloud IVR + SIP`,

      `💡 <b>不能打电话，线索有何用？</b>

虚拟号码 — 任何国家，无需SIM卡。

✅ 即时开通 | ✅ 呼叫转移 | ✅ SIP集成
💰 <b>$50/月</b>

输入 <b>/start</b> → 📞 Cloud IVR + SIP`,

      `📞 <b>为你的工具箱添加一个电话号码</b>

每个业务都需要一个可联系的号码。

🌍 30+国家 | 🔐 100%隐私 | 📱 无需SIM
💰 <b>$50/月</b> 起

输入 <b>/start</b> → 📞 Cloud IVR + SIP`,
    ],

    antired_hosting: [
      `🌙🛡️ <b>有域名了？用防弹服务器托管它。</b>

Anti-Red托管 = 无视DMCA + 威胁扫描器。

🛡️ 离岸服务器 | 🌐 免费域名 | ⚡ cPanel
💰 <b>$30/周</b> 起

保护你的成果 🔒

输入 <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🔥 <b>你的网站需要防弹之家</b>

离岸、无视DMCA、零关停。

🛡️ Anti-Red扫描 | 🌐 免费域名 | ⚡ cPanel
💰 <b>$30/周</b> 起

输入 <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>永不宕机的托管</b>

离岸服务器 + Anti-Red保护 = 势不可挡。

✅ 99.9%正常运行 | 🔒 无视DMCA
💰 <b>$30/周</b> 起

输入 <b>/start</b> → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🌙🎯 <b>网站已上线 — 现在获取线索。</b>

定向电话线索，分钟内送达。

📋 按国家和运营商 | 👤 真实姓名 | ✅ 已验证号码
💰 <b>$0.025/条</b> 起

输入 <b>/start</b> → 🎯 Leads & Validation`,

      `📊 <b>流量很好。线索更好。</b>

批量电话线索 + 机主姓名。

🎯 选择国家和运营商 | ⚡ 快速交付
💰 线索 <b>$0.025</b> | CNAM <b>$0.015</b>

输入 <b>/start</b> → 🎯 Leads & Validation`,

      `🎯 <b>需要新鲜线索？我们有成千上万条。</b>

验证过的电话号码 + 机主姓名。

📋 批量导出 | ✅ 只有活跃号码
💰 <b>$0.025</b>/条 起

输入 <b>/start</b> → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌙🌐 <b>有号码了？用域名打造品牌。</b>

自定义域名让一切看起来更专业。

🌐 400+ TLD | 🔒 防DMCA | ✂️ 免费品牌短链接
💰 域名 <b>$3</b> 起

输入 <b>/start</b> → 🌐 域名`,

      `🔗 <b>长URL看起来不靠谱。修好它。</b>

Shortit：将任何链接变成品牌短URL。

✂️ 5个免费链接 | 📊 点击追踪 | 🌐 自己的域名
💰 域名 <b>$3</b> 起

输入 <b>/start</b> → 🔗 URL缩短器`,

      `🌐 <b>你的内容需要一个防弹地址</b>

注册不会被查封的域名。400+ TLD。

🔒 无视DMCA | ☁️ Cloudflare | 💰 <b>$3</b> 起

输入 <b>/start</b> → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🌙🛒 <b>想要转售？从产品开始。</b>

高级验证账户 — 即时交付。

📞 Twilio <b>$200</b> | ☁️ AWS <b>$150</b> | 📱 eSIM <b>$60</b>
⚡ 30分钟交付

输入 <b>/start</b> → 🛒 Digital Products`,

      `⚡ <b>不要浪费时间验证账户</b>

Twilio、AWS、Google Cloud — 全部预验证。

💰 <b>$60</b> 起 | 🤖 Telegram交付

输入 <b>/start</b> → 🛒 Digital Products`,

      `🛒 <b>即插即用账户 — 30分钟交付</b>

📞 Twilio | ☁️ AWS | 📡 Telnyx | 📱 eSIM
全部验证。全部就绪。💰 <b>$60</b> 起

输入 <b>/start</b> → 🛒 Digital Products`,
    ],

    cards_bundles: [
      `🌙💳 <b>需要在线支付？虚拟卡已就绪。</b>

💳 卡片 <b>$5</b> 起 | 📦 标签 <b>$10</b> 起
🎁 套餐节省 <b>20%+</b>

一个机器人搞定一切 ⚡ 输入 <b>/start</b>`,

      `🎁 <b>服务套餐大省钱</b>

📞 电话 + 🌐 域名 + 🛡️ 托管 = 一个套餐
💰 组合节省 <b>20%+</b>

输入 <b>/start</b> → 📦 服务套餐`,

      `💼 <b>把这个机器人变成你的生意</b>

加入经销商计划 — 每笔销售赚佣金。

✅ 自动佣金 | 🔥 顶级经销商：<b>$500+/月</b>

输入 <b>/start</b> → 💼 Reseller`,
    ],

    email_validation: [
      `🌙📧 <b>有邮件列表？先验证一下。</b>

发送前确保列表干净。

📬 营销就绪的可投递文件
🔍 7层深度验证
🎁 <b>50封免费</b>

💰 低至 <b>$0.003/封</b>

输入 <b>/start</b> → 📧 邮件验证`,

      `💡 <b>你的邮件列表在浪费钱</b>

无效邮件 = 退信 = 垃圾标记 = 预算浪费。

✅ 移除无效和一次性邮箱
📬 干净的可投递文件
🎁 <b>50封免费</b>

输入 <b>/start</b> → 📧 邮件验证`,

      `📧 <b>干净列表 = 更好的营销</b>

97%+ 准确率。几分钟出结果。

📬 可投递文件
💰 低至 <b>$0.003/封</b>

输入 <b>/start</b> → 📧 邮件验证`,
    ],

    marketplace: [
      `🌙🏪 <b>看看市场吧</b>

在Telegram里直接买卖数字商品和工具。

🔐 每笔交易都有托管保护
💬 无需分享联系方式

输入 <b>/start</b> → 🏪 市场`,

      `💡 <b>有东西要卖？市场已开放。</b>

60秒上架。触达数千买家。

💰 零上架费 | 🔐 内置托管

输入 <b>/start</b> → 🏪 市场`,

      `🛒 <b>市场 — 安全P2P交易</b>

别在随机群组里冒险交易了。

✅ 托管 | 💬 机器人内聊天 | 📦 订单追踪

输入 <b>/start</b> → 🏪 市场`,
    ],

    vps_rdp: [
      `🌙🖥️ <b>需要服务器？几分钟部署。</b>

Linux VPS 或 Windows RDP — 25端口开放，忽略DMCA。

🐧 VPS $20/月起 | 🪟 RDP $30/月起 | 📬 25端口开放
⚡ 即时安装 — 无需等待

输入 <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💡 <b>发邮件？你需要自己的服务器。</b>

共享主机封锁25端口。我们的VPS不会。

✅ 完整root权限 | ✅ 25端口开放 | ✅ 忽略DMCA
💰 仅需 <b>$20/月</b>

输入 <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🔥 <b>VPS & RDP — 你的私人服务器，你的规则</b>

无限制。不封端口。不问问题。

🖥️ Linux或Windows | 📬 25端口开放 | 🛡️ 离岸
💰 <b>$20/月</b> 起

输入 <b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `🌙📱 <b>有联系人？群发短信给他们。</b>

跳过网关费。从自己的手机发送。

📩 你的号码=信任 | ⏰ 预约发送 | 📱 多设备
🆓 <b>100条免费短信</b>试用！

输入 <b>/start</b> → 📧 BulkSMS`,

      `💡 <b>厌倦了按条付费？有更好的方法。</b>

Nomadly BulkSMS应用 — 安卓群发短信。

📱 月套餐可用无限台设备

输入 <b>/start</b> → 📧 BulkSMS`,

      `🔥 <b>BULKSMS — 你的活动需要这个应用</b>

从手机发送上千条短信。无需网关。

📱 多设备 | ⏰ 预约 | 📊 分析
🆓 免费100条短信开始！

输入 <b>/start</b> → 📧 BulkSMS`,
    ],

    email_blast: [
      `🌙📧 <b>有邮件列表？立即群发。</b>

从Telegram直接群发 — 无需外部工具。

📧 HTML + 自定义主题
📊 实时追踪
💰 按活动付费

输入 <b>/start</b> → 📧 Email Blast`,

      `🌙💌 <b>你的邮件列表在吃灰</b>

用Email Blast把联系人变成转化。

✍️ 写 → 上传 → 发送 → 追踪
全在Telegram里完成。

输入 <b>/start</b> → 📧 Email Blast`,

      `🌙🚀 <b>快速邮件活动？</b>

3分钟发送给整个列表。

📧 完整HTML | 📊 实时追踪 | 💰 钱包付费

输入 <b>/start</b> → 📧 Email Blast`,
    ],

    refer_earn: [
      `🌙🤝 <b>分享Nomadly，别人买你赚。</b>

你的推荐链接覆盖所有服务。
一次分享 = 持续佣金 💰

输入 <b>/start</b> → 🤝 Refer & Earn`,

      `🌙💸 <b>被动收入 — 只差一个链接</b>

你带来的每个朋友 = 你钱包里的钱。
无上限。无期限。

输入 <b>/start</b> → 🤝 Refer & Earn`,

      `🌙🔥 <b>顶级推荐者月入$100+</b>

只需分享链接，我们处理其余。
每笔交易有佣金。随时提现。

输入 <b>/start</b> → 🤝 Refer & Earn`,
    ],
  },

  // ═══════════════════ HINDI CROSS-SELL ═══════════════════

  hi: {
    cloudphone: [
      `🌙📞 <b>लीड्स हैं? अब उन्हें कॉल करें।</b>

वर्चुअल फोन नंबर लें और आज ही कॉल शुरू करें।

📞 30+ देश | 🎙️ कस्टम IVR | 💬 SMS शामिल
💰 <b>$50/महीना</b> से

डेटा को बातचीत में बदलें 🔥

<b>/start</b> → 📞 Cloud IVR + SIP`,

      `💡 <b>कॉल नहीं कर सकते तो लीड्स बेकार हैं</b>

वर्चुअल नंबर — कोई भी देश, SIM नहीं चाहिए।

✅ तुरंत एक्टिवेशन | ✅ कॉल फॉरवर्डिंग | ✅ SIP
💰 <b>$50/महीना</b>

<b>/start</b> → 📞 Cloud IVR + SIP`,

      `📞 <b>अपने टूलकिट में फोन नंबर जोड़ें</b>

हर बिज़नेस को एक संपर्क नंबर चाहिए।

🌍 30+ देश | 🔐 100% प्राइवेट | 📱 बिना SIM
💰 <b>$50/महीना</b> से

<b>/start</b> → 📞 Cloud IVR + SIP`,
    ],

    antired_hosting: [
      `🌙🛡️ <b>डोमेन है? बुलेटप्रूफ होस्ट करें।</b>

Anti-Red Hosting = DMCA-इग्नोर्ड + थ्रेट स्कैनर।

🛡️ ऑफशोर सर्वर | 🌐 मुफ्त डोमेन | ⚡ cPanel
💰 <b>$30/सप्ताह</b> से

जो बनाया है उसे सुरक्षित रखें 🔒

<b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🔥 <b>आपकी साइट को बुलेटप्रूफ घर चाहिए</b>

ऑफशोर, DMCA-इग्नोर्ड, ज़ीरो टेकडाउन।

🛡️ Anti-Red स्कैनर | 🌐 मुफ्त डोमेन
💰 <b>$30/सप्ताह</b> से

<b>/start</b> → 🛡️🔥 Anti-Red Hosting`,

      `🏴‍☠️ <b>होस्टिंग जो कभी डाउन नहीं होती</b>

ऑफशोर + Anti-Red = अजेय।

✅ 99.9% अपटाइम | 🔒 DMCA-इग्नोर्ड
💰 <b>$30/सप्ताह</b> से

<b>/start</b> → 🛡️🔥 Anti-Red Hosting`,
    ],

    leads_validation: [
      `🌙🎯 <b>साइट लाइव है — अब लीड्स लाएं।</b>

टार्गेटेड फोन लीड्स मिनटों में।

📋 देश और कैरियर के अनुसार | 👤 असली नाम | ✅ वेरिफाइड
💰 <b>$0.025/लीड</b> से

<b>/start</b> → 🎯 Leads & Validation`,

      `📊 <b>ट्रैफिक अच्छा है। लीड्स बेहतर हैं।</b>

बल्क फोन लीड्स + मालिक के नाम।

🎯 देश और कैरियर चुनें | ⚡ तेज़ डिलीवरी
💰 लीड्स <b>$0.025</b> | CNAM <b>$0.015</b>

<b>/start</b> → 🎯 Leads & Validation`,

      `🎯 <b>फ्रेश लीड्स चाहिए? हमारे पास हज़ारों हैं।</b>

वैलिडेटेड नंबर + मालिक के नाम।

📋 बल्क एक्सपोर्ट | ✅ सिर्फ एक्टिव नंबर
💰 <b>$0.025</b>/लीड से

<b>/start</b> → 🎯 Leads & Validation`,
    ],

    domains_shortener: [
      `🌙🌐 <b>नंबर मिल गया? डोमेन से ब्रांड बनाएं।</b>

कस्टम डोमेन सब कुछ प्रोफेशनल बनाता है।

🌐 400+ TLD | 🔒 DMCA-प्रूफ | ✂️ मुफ्त शॉर्ट लिंक
💰 डोमेन <b>$3</b> से

<b>/start</b> → 🌐 Domains`,

      `🔗 <b>लंबे URL संदिग्ध लगते हैं। ठीक करें।</b>

Shortit: ब्रांडेड शॉर्ट URL मुफ्त।

✂️ 5 मुफ्त लिंक | 📊 क्लिक ट्रैकिंग
💰 डोमेन <b>$3</b> से

<b>/start</b> → 🔗 URL शॉर्टनर`,

      `🌐 <b>आपके कंटेंट को बुलेटप्रूफ एड्रेस चाहिए</b>

ऐसा डोमेन जो जब्त न हो सके। 400+ TLD।

🔒 DMCA-इग्नोर्ड | ☁️ Cloudflare | 💰 <b>$3</b> से

<b>/start</b> → 🌐 Bulletproof Domains`,
    ],

    digital_products: [
      `🌙🛒 <b>रीसेल करना है? प्रोडक्ट्स से शुरू करें।</b>

प्रीमियम वेरिफाइड अकाउंट — इंस्टेंट डिलीवरी।

📞 Twilio <b>$200</b> | ☁️ AWS <b>$150</b> | 📱 eSIM <b>$60</b>
⚡ 30 मिनट में डिलीवर

<b>/start</b> → 🛒 Digital Products`,

      `⚡ <b>अकाउंट वेरिफाई करने में दिन बर्बाद न करें</b>

Twilio, AWS, Google Cloud — सब प्री-वेरिफाइड।

💰 <b>$60</b> से | 🤖 Telegram पर डिलीवरी

<b>/start</b> → 🛒 Digital Products`,

      `🛒 <b>प्लग एंड प्ले अकाउंट — 30 मिनट डिलीवरी</b>

📞 Twilio | ☁️ AWS | 📡 Telnyx | 📱 eSIM
सब वेरिफाइड। सब तैयार। 💰 <b>$60</b> से

<b>/start</b> → 🛒 Digital Products`,
    ],

    cards_bundles: [
      `🌙💳 <b>ऑनलाइन पेमेंट? वर्चुअल कार्ड तैयार।</b>

💳 कार्ड <b>$5</b> से | 📦 लेबल <b>$10</b> से
🎁 बंडल में <b>20%+</b> बचत

एक बॉट में सब कुछ ⚡ <b>/start</b> टाइप करें`,

      `🎁 <b>सर्विस बंडल से बड़ी बचत</b>

📞 फोन + 🌐 डोमेन + 🛡️ होस्टिंग = एक बंडल
💰 <b>20%+</b> बचत

<b>/start</b> → 📦 Service Bundles`,

      `💼 <b>इस बॉट को अपना बिज़नेस बनाएं</b>

रिसेलर प्रोग्राम — हर बिक्री पर कमाएं।

✅ ऑटो कमीशन | 🔥 टॉप रिसेलर: <b>$500+/महीना</b>

<b>/start</b> → 💼 Reseller`,
    ],

    email_validation: [
      `🌙📧 <b>ईमेल लिस्ट है? पहले वैलिडेट करें।</b>

भेजने से पहले लिस्ट साफ करें।

📬 कैंपेन-रेडी डिलीवरेबल फाइल
🔍 7-लेयर डीप वेरिफिकेशन
🎁 <b>50 ईमेल मुफ्त</b>

💰 सिर्फ <b>$0.003/ईमेल</b> से

<b>/start</b> → 📧 Email Validation`,

      `💡 <b>आपकी ईमेल लिस्ट पैसे बर्बाद कर रही है</b>

डेड ईमेल = बाउंस = स्पैम = बर्बाद बजट।

✅ इनवैलिड और डिस्पोजेबल हटाएं
📬 क्लीन डिलीवरेबल फाइल
🎁 <b>50 ईमेल मुफ्त</b>

<b>/start</b> → 📧 Email Validation`,

      `📧 <b>क्लीन लिस्ट = बेहतर कैंपेन</b>

97%+ सटीकता। मिनटों में रिजल्ट।

📬 डिलीवरेबल फाइल
💰 <b>$0.003/ईमेल</b> से

<b>/start</b> → 📧 Email Validation`,
    ],

    marketplace: [
      `🌙🏪 <b>MARKETPLACE देखें</b>

Telegram पर सीधे डिजिटल गुड्स और टूल्स खरीदें-बेचें।

🔐 हर ट्रेड पर एस्क्रो प्रोटेक्शन
💬 कॉन्टैक्ट शेयर किए बिना चैट

<b>/start</b> → 🏪 Marketplace`,

      `💡 <b>कुछ बेचना है? MARKETPLACE खुला है।</b>

60 सेकंड में लिस्ट करें। हजारों बायर्स तक पहुंचें।

💰 ज़ीरो फीस | 🔐 बिल्ट-इन एस्क्रो

<b>/start</b> → 🏪 Marketplace`,

      `🛒 <b>MARKETPLACE — सुरक्षित P2P ट्रेड</b>

रैंडम ग्रुप्स में ट्रेड करना बंद करें।

✅ एस्क्रो | 💬 इन-बॉट चैट | 📦 ट्रैकिंग

<b>/start</b> → 🏪 Marketplace`,
    ],

    vps_rdp: [
      `🌙🖥️ <b>सर्वर चाहिए? मिनटों में डिप्लॉय करें।</b>

Linux VPS या Windows RDP — पोर्ट 25 ओपन, DMCA-इग्नोर।

🐧 VPS $20/महीने से | 🪟 RDP $30/महीने से | 📬 पोर्ट 25 ओपन
⚡ तुरंत सेटअप

<b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `💡 <b>ईमेल भेज रहे हैं? अपना खुद का सर्वर चाहिए।</b>

शेयर्ड होस्टिंग पोर्ट 25 ब्लॉक करती है। हमारा VPS नहीं।

✅ पूरा root एक्सेस | ✅ पोर्ट 25 ओपन | ✅ DMCA-इग्नोर
💰 सिर्फ <b>$20/महीने</b>

<b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,

      `🔥 <b>VPS & RDP — आपका प्राइवेट सर्वर, आपके नियम</b>

कोई पाबंदी नहीं। कोई पोर्ट ब्लॉक नहीं।

🖥️ Linux या Windows | 📬 पोर्ट 25 ओपन | 🛡️ ऑफशोर
💰 <b>$20/महीने</b> से

<b>/start</b> → 🖥️ VPS/RDP — Port 25 Open🛡️`,
    ],

    bulksms_app: [
      `🌙📱 <b>कॉन्टैक्ट्स हैं? SMS से ब्लास्ट करें।</b>

गेटवे फीस छोड़ें। अपने फोन से भेजें।

📩 आपका नंबर = भरोसा | ⏰ शेड्यूल | 📱 मल्टी-डिवाइस
🆓 <b>100 फ्री SMS</b> ट्राई करें!

<b>/start</b> → 📧 BulkSMS`,

      `💡 <b>SMS पर पैसे बर्बाद करना बंद करें।</b>

Nomadly BulkSMS ऐप — एंड्रॉइड से बल्क SMS।

📱 मंथली प्लान में अनलिमिटेड डिवाइस

<b>/start</b> → 📧 BulkSMS`,

      `🔥 <b>BULKSMS — आपके कैंपेन की ज़रूरत</b>

हज़ारों SMS अपने फोन से। बिना गेटवे।

📱 मल्टी-डिवाइस | ⏰ शेड्यूल | 📊 एनालिटिक्स
🆓 100 फ्री SMS से शुरू!

<b>/start</b> → 📧 BulkSMS`,
    ],

    email_blast: [
      `🌙📧 <b>ईमेल लिस्ट है? अभी ब्लास्ट करो।</b>

टेलीग्राम से सीधे मास ईमेल भेजें — कोई बाहरी टूल नहीं।

📧 HTML + कस्टम सब्जेक्ट
📊 लाइव ट्रैकिंग
💰 प्रति कैंपेन भुगतान

<b>/start</b> → 📧 Email Blast`,

      `🌙💌 <b>तुम्हारी ईमेल लिस्ट धूल खा रही है</b>

Email Blast से कॉन्टैक्ट्स को कन्वर्ज़न में बदलो।

✍️ लिखो → अपलोड → भेजो → ट्रैक करो
सब टेलीग्राम से।

<b>/start</b> → 📧 Email Blast`,

      `🌙🚀 <b>क्विक ईमेल कैंपेन?</b>

3 मिनट में पूरी लिस्ट को ब्लास्ट।

📧 फुल HTML | 📊 लाइव ट्रैकिंग | 💰 वॉलेट पे

<b>/start</b> → 📧 Email Blast`,
    ],

    refer_earn: [
      `🌙🤝 <b>Nomadly शेयर करो। दूसरे खरीदें, तुम कमाओ।</b>

तुम्हारा रेफरल लिंक सभी सर्विसेज पर काम करता है।
एक शेयर = बार-बार कमीशन 💰

<b>/start</b> → 🤝 Refer & Earn`,

      `🌙💸 <b>पैसिव इनकम — बस 1 लिंक दूर</b>

तुम जो भी दोस्त लाओगे = तुम्हारे वॉलेट में पैसा।
कोई लिमिट नहीं। कोई एक्सपायरी नहीं।

<b>/start</b> → 🤝 Refer & Earn`,

      `🌙🔥 <b>टॉप रेफरर $100+/महीना कमाते हैं</b>

बस लिंक शेयर करो। बाकी हम संभालेंगे।
हर सेल पर कमीशन। कभी भी निकालो।

<b>/start</b> → 🤝 Refer & Earn`,
    ],
  },
}

// ═══════════════════════════════════════════════════════════════════════

function localToUtc(localHour, localMinute, offsetHours) {
  let utcHour = localHour - Math.floor(offsetHours)
  let utcMinute = localMinute - Math.round((offsetHours % 1) * 60)
  if (utcMinute < 0) { utcMinute += 60; utcHour -= 1 }
  if (utcMinute >= 60) { utcMinute -= 60; utcHour += 1 }
  if (utcHour < 0) utcHour += 24
  if (utcHour >= 24) utcHour -= 24
  return { hour: utcHour, minute: utcMinute }
}

// ── Promo cadence: escalating re-test back-off for repeat blockers (2026-08-20)
// The more times a user blocks the bot, the LESS often we retry them:
//   user_deactivated → never (permanent)
//   chat_not_found   → 14 days
//   bot_blocked      → 7d after 1st block, 30d after 2nd, then NEVER (3+ = eased off)
//   other            → 7 days
// Returns a TTL in days, or Infinity meaning "never re-test" (stay opted out).
function _promoRetestTtlDays(reason, blockCount) {
  if (reason === 'user_deactivated') return Infinity
  if (reason === 'bot_target') return Infinity   // a bot target can never receive — never re-test
  if (reason === 'chat_not_found') return 14
  if (reason === 'bot_blocked') {
    const b = blockCount || 1
    if (b <= 1) return 7
    if (b === 2) return 30
    return Infinity
  }
  return 7
}

// ── Pre-blast block-rate report (admin-facing, 2026-08-20) ─────────────────
// Quick health snapshot sent to the admin BEFORE each broadcast so they can see
// how many users are dead/opted-out (and why) vs. how many will receive it.
function _buildBlockRateReport({ theme, lang, slot, totalUsers, targets, dead, deadByReason, inactive }) {
  const total = totalUsers || 0
  const d = dead || 0
  const rate = total > 0 ? ((d / total) * 100).toFixed(1) : '0.0'
  const br = deadByReason || {}
  return `📊 <b>Pre-blast report</b> — ${theme}/${lang} (${slot})\n` +
    `👥 Users: <b>${total}</b>\n` +
    `🎯 Will send: <b>${targets || 0}</b>\n` +
    `🚫 Dead / opted-out: <b>${d}</b> (${rate}%)\n` +
    `   • blocked: ${br.bot_blocked || 0} · deactivated: ${br.user_deactivated || 0} · not-found: ${br.chat_not_found || 0}\n` +
    `😴 Inactive 30d+ skipped: ${inactive || 0}`
}

// ─── Initialize Auto-Promo System ─────────────────────────────────────
function initAutoPromo(bot, db, nameOf, stateCol, lifecycleDiet = null) {
  const promoTracker = db.collection('promoTracker')
  const promoOptOut = db.collection('promoOptOut')
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

  // ── Per-blast lift window (#18): count /start + hub taps within 45 min ──
  const LIFT_WINDOW_MS = 45 * 60 * 1000

  let dailyCouponSystem = null
  function setDailyCouponSystem(sys) { dailyCouponSystem = sys }

  function alertAdmin(msg) {
    if (adminChatId) bot.sendMessage(adminChatId, `[AutoPromo Alert] ${msg}`).catch(() => {})
  }

  async function getRotationIndex(theme, lang, customKey) {
    const trackerId = customKey || `${theme}_${lang}`
    const tracker = await promoTracker.findOne({ _id: trackerId })
    const currentIndex = tracker?.index || 0
    // Use crossSellMessages for evening keys, promoMessages for morning
    const isEvening = trackerId.includes('_evening_')
    const msgPool = isEvening ? crossSellMessages : promoMessages
    const variations = msgPool[lang]?.[theme] || msgPool.en?.[theme] || promoMessages.en[theme] || []
    const totalVariations = variations.length || 1
    const nextIndex = (currentIndex + 1) % totalVariations
    await promoTracker.updateOne({ _id: trackerId }, { $set: { index: nextIndex, lastSent: new Date() } }, { upsert: true })
    return currentIndex
  }

  const OPTOUT_TTL_DAYS = 7
  // Only user_deactivated is truly permanent — chat_not_found can be temporary (rate limits, Telegram glitches)
  const PERMANENT_OPTOUT_REASONS = ['user_deactivated']
  // Require this many consecutive broadcast failures before marking a user as dead
  const DEAD_THRESHOLD = 3

  async function isOptedOut(chatId) {
    const record = await promoOptOut.findOne({ _id: chatId })
    if (!record?.optedOut) return false
    if (PERMANENT_OPTOUT_REASONS.includes(record.reason)) return true
    // Escalating back-off: repeat blockers are re-tested less and less often
    // (and never after 3+ blocks). See _promoRetestTtlDays.
    const ttlDays = _promoRetestTtlDays(record.reason, record.blockCount)
    if (ttlDays === Infinity) return true   // eased off — stay opted out
    if (record.updatedAt) {
      const daysSinceOptOut = (Date.now() - new Date(record.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceOptOut >= ttlDays) {
        await promoOptOut.updateOne({ _id: chatId }, { $set: { optedOut: false, updatedAt: new Date(), reOptInReason: 'ttl_expired', failCount: 0 } })
        log(`[AutoPromo] Re-opted-in ${chatId} after ${Math.floor(daysSinceOptOut)}d TTL (was: ${record.reason || 'unknown'}, blocks: ${record.blockCount || 0})`)
        return false
      }
    }
    return true
  }

  async function setOptOut(chatId, optedOut, reason = 'unknown') {
    await promoOptOut.updateOne({ _id: chatId }, { $set: { optedOut, reason, updatedAt: new Date() } }, { upsert: true })
  }

  // Increment fail count and only mark as dead after DEAD_THRESHOLD consecutive failures
  // EXCEPTION: bot_blocked is set immediately — Telegram 403 means the user explicitly
  // blocked the bot, no point retrying for 2 more broadcasts. The 7-day TTL above will
  // still re-test them later in case they unblock.
  async function recordSendFailure(chatId, reason) {
    if (reason === 'bot_blocked') {
      await promoOptOut.updateOne(
        { _id: chatId },
        { $set: { optedOut: true, reason, updatedAt: new Date() }, $inc: { failCount: 1, blockCount: 1 } },
        { upsert: true }
      )
      const rec = await promoOptOut.findOne({ _id: chatId }).catch(() => null)
      const bc = rec?.blockCount || 1
      const ttl = _promoRetestTtlDays('bot_blocked', bc)
      log(`[AutoPromo] User ${chatId} marked dead (bot_blocked #${bc}) — re-test in ${ttl === Infinity ? 'never (eased off)' : ttl + 'd'}`)
      return
    }
    await promoOptOut.updateOne(
      { _id: chatId },
      { $set: { reason, updatedAt: new Date() }, $inc: { failCount: 1 } },
      { upsert: true }
    )
    const record = await promoOptOut.findOne({ _id: chatId })
    if (record?.failCount >= DEAD_THRESHOLD) {
      await promoOptOut.updateOne({ _id: chatId }, { $set: { optedOut: true } })
      log(`[AutoPromo] User ${chatId} marked dead after ${record.failCount} consecutive failures (${reason})`)
    }
  }

  async function getAllChatIds() {
    try {
      const users = await nameOf.find({}).toArray()
      return users
        .map(u => u._id)
        .filter(id => id != null && (typeof id === 'string' || typeof id === 'number'))
        .map(id => String(id))
    } catch (error) {
      log(`[AutoPromo] Error fetching chat IDs: ${error.message}`)
      return []
    }
  }

  async function getUserLanguage(chatId) {
    try {
      const userState = await stateCol.findOne({ _id: chatId })
      const lang = userState?.userLanguage || 'en'
      return promoMessages[lang] ? lang : 'en'
    } catch { return 'en' }
  }

  function isUnreachableError(error) {
    const msg = error.message || ''
    return msg.includes('chat not found') || msg.includes('user is deactivated') || msg.includes('bot was blocked') || msg.includes('have no rights to send a message')
  }

  function classifyOptOutReason(error) {
    const msg = error.message || ''
    if (msg.includes('chat not found')) return 'chat_not_found'
    if (msg.includes('user is deactivated')) return 'user_deactivated'
    if (msg.includes('bot was blocked')) return 'bot_blocked'
    if (msg.includes('have no rights to send a message')) return 'no_rights'
    return 'unknown'
  }

  // GIF assets for visual promos
  const path = require('path')
  const SHOWCASE_GIF = path.join(__dirname, 'assets', 'nomadly-showcase-promo.gif')
  const CLOUDPHONE_GIF = path.join(__dirname, 'assets', 'cloudphone-business-promo.gif')

  // Themes that use GIF banners (sends as animation with caption)
  const GIF_THEMES = {
    cloudphone: CLOUDPHONE_GIF,
    antired_hosting: SHOWCASE_GIF,
    cards_bundles: SHOWCASE_GIF,
  }

  const PROMO_SEND_RETRIES = 2
  const PROMO_RETRY_DELAY = 2000

  // Soft length cap for the promo BODY (excluding coupon + opt-out footer).
  // Based on UX audit on 2026-05-03 — pre-change captions ran 700-900 chars,
  // with the coupon and opt-out info drowned under piggy-backed SMTP/BulkSMS
  // ads. We now keep the body lean; any variation that exceeds the cap is
  // trimmed at the nearest sentence/word boundary with a single trailing "…".
  const PROMO_BODY_MAX_CHARS = 420

  function _trimPromoBody(raw) {
    if (typeof raw !== 'string') return raw
    // Measure plain-text length (strip HTML tags) so Telegram's *visible*
    // char count is what we guard against, not the raw string length.
    const plain = raw.replace(/<[^>]+>/g, '')
    if (plain.length <= PROMO_BODY_MAX_CHARS) return raw
    // Walk back from the cap until we hit whitespace or sentence end. Use
    // the raw string so HTML tags aren't broken mid-attribute.
    let cutoff = PROMO_BODY_MAX_CHARS
    // Prefer last sentence end before cutoff
    const sentenceEnd = Math.max(raw.lastIndexOf('. ', cutoff), raw.lastIndexOf('! ', cutoff), raw.lastIndexOf('? ', cutoff), raw.lastIndexOf('\n', cutoff))
    if (sentenceEnd > cutoff - 120) cutoff = sentenceEnd
    else {
      const wordEnd = raw.lastIndexOf(' ', cutoff)
      if (wordEnd > 0) cutoff = wordEnd
    }
    return raw.slice(0, cutoff).replace(/[\s,;—-]+$/, '') + ' …'
  }

  async function sendPromoToUser(chatId, theme, variationIndex, lang, dynamicMessage, couponLine, isEvening = false) {
    try {
      if (await isOptedOut(chatId)) return { success: true, skipped: true }
      const msgPool = isEvening ? crossSellMessages : promoMessages
      const variations = msgPool[lang]?.[theme] || msgPool.en?.[theme] || promoMessages[lang]?.[theme] || promoMessages.en?.[theme]
      if (!variations || variations.length === 0) {
        log(`[AutoPromo] No variations found for ${isEvening ? 'evening' : 'morning'} theme=${theme} lang=${lang}, skipping ${chatId}`)
        return { success: false, error: 'no variations' }
      }
      // Caption assembly (2026-05-03 rewrite):
      //   1. Coupon line FIRST  — it's the highest-converting hook and was
      //      previously buried under 3 footers. Moved to the very top so the
      //      Telegram notification preview shows "🎁 TODAY 10% OFF…" instead
      //      of the marketing intro.
      //   2. Body (trimmed to ~400 chars).
      //   3. Opt-out footer last (required for unsubscribe hygiene).
      //   4. SMTP + BulkSMS footers DROPPED — those products already have
      //      dedicated weekly auto-promo slots; stacking them on every other
      //      promo was noise, not signal.
      const body = _trimPromoBody(dynamicMessage || variations[variationIndex % variations.length])
      let caption = ''
      if (couponLine) caption += couponLine + '\n\n'
      caption += body
      caption += '\n\n' + getOptOutFooter(lang)

      const trySend = async (useHtml) => {
        const opts = useHtml ? { parse_mode: 'HTML' } : {}
        
        // Add inline keyboard with opt-out button
        opts.reply_markup = {
          inline_keyboard: [[
            { text: getOptOutButtonText(lang), callback_data: 'promo_optout' }
          ]]
        }
        
        const gifPath = !isEvening ? GIF_THEMES[theme] : null // No GIFs for evening (text-only, quick)

        // Try sending with GIF for morning visual themes
        if (gifPath) {
          try {
            const fs = require('fs')
            if (fs.existsSync(gifPath)) {
              await bot.sendAnimation(chatId, gifPath, { caption, ...opts })
              return
            }
          } catch (gifErr) {
            if (isUnreachableError(gifErr)) throw gifErr
            // 429 here is recoverable — the text fallback below works.
            // Only log non-rate-limit GIF failures to keep the top-of-hour
            // log readable; rate-limit metrics are reported in the batch
            // digest at the end of broadcastPromoForLang().
            const _code = gifErr.response?.statusCode
            const _is429 = _code === 429 || /too many requests/i.test(gifErr.message || '')
            if (!_is429) {
              log(`[AutoPromo] GIF failed for ${chatId}, text fallback: ${gifErr.message}`)
            }
          }
        }

        // Text-only fallback
        await bot.sendMessage(chatId, caption, { ...opts, disable_web_page_preview: true })
      }

      // Retry loop — don't kill users on first failure
      for (let attempt = 1; attempt <= PROMO_SEND_RETRIES; attempt++) {
        try {
          try { await trySend(true) }
          catch (parseErr) {
            if (isUnreachableError(parseErr)) throw parseErr
            if (parseErr.message?.includes('parse') || parseErr.response?.statusCode === 400) {
              log(`[AutoPromo] HTML parse error for ${chatId}, retrying plain`)
              await trySend(false)
            } else throw parseErr
          }
          // Success! Reset fail count so user stays healthy
          await promoOptOut.updateOne({ _id: chatId }, { $set: { failCount: 0 } }).catch(() => {})
          if (lifecycleDiet?.markUnsolicitedSent) lifecycleDiet.markUnsolicitedSent(chatId, isEvening ? 'autopromo_evening' : 'autopromo_morning').catch(() => {})
          return { success: true }
        } catch (error) {
          const code = error.response?.statusCode
          const errMsg = (error.message || '').toLowerCase()
          const isTrulyPermanent = errMsg.includes('user is deactivated')

          // user_deactivated is truly permanent — mark immediately
          if (isTrulyPermanent) {
            await setOptOut(chatId, true, 'user_deactivated')
            log(`[AutoPromo] User ${chatId} deactivated — permanently opted out`)
            return { success: false, error: error.message }
          }

          // 429 = rate limited — do NOT penalize the user, pause & retry
          if (code === 429) {
            const retryAfter = error.response?.body?.parameters?.retry_after || parseInt((error.message.match(/retry after (\d+)/i) || [])[1]) || 30
            log(`[AutoPromo] Rate limited on ${chatId}, waiting ${retryAfter}s before continuing`)
            await sleep(retryAfter * 1000)
            // Retry this user once after waiting
            try {
              await trySend(true)
              await promoOptOut.updateOne({ _id: chatId }, { $set: { failCount: 0 } }).catch(() => {})
              if (lifecycleDiet?.markUnsolicitedSent) lifecycleDiet.markUnsolicitedSent(chatId, isEvening ? 'autopromo_evening' : 'autopromo_morning').catch(() => {})
              return { success: true, retryAfterWait: true }
            } catch (retryErr) {
              log(`[AutoPromo] Still rate limited on ${chatId} after wait, skipping`)
              return { success: false, error: 'rate_limited', rateLimited: true }
            }
          }

          // For chat_not_found, bot_blocked etc — retry first
          if (attempt < PROMO_SEND_RETRIES) {
            await sleep(PROMO_RETRY_DELAY * attempt)
            continue
          }

          // Final attempt failed — record failure but DON'T immediately mark as dead
          // recordSendFailure uses failCount threshold (DEAD_THRESHOLD=3)
          if (code === 403 || isUnreachableError(error)) {
            const reason = classifyOptOutReason(error)
            await recordSendFailure(chatId, reason)
            // De-dupe log: recordSendFailure() already logs the primary
            // "User X marked dead (bot_blocked #N)" line for bot_blocked/deactivated.
            // Only log the extra "Unreachable" line for non-terminal reasons or on verbose.
            const alreadyLoggedByRecord = reason === 'bot_blocked' || reason === 'user_deactivated'
            if (!alreadyLoggedByRecord || process.env.AUTOPROMO_VERBOSE === '1') {
              log(`[AutoPromo] Unreachable ${chatId}: ${reason} (${error.message?.substring(0, 80)})`)
            }
          } else {
            log(`[AutoPromo] Failed ${chatId}: [${code || 'unknown'}] ${error.message}`)
          }
          return { success: false, error: error.message }
        }
      }
      return { success: false, error: 'exhausted retries' }
    } catch (error) {
      log(`[AutoPromo] Unexpected error for ${chatId}: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  async function broadcastPromoForLang(themeIndex, lang, slotType = 'morning') {
    if (themeIndex === undefined || themeIndex === null) {
      log(`[AutoPromo] Skipping ${slotType} broadcast for ${lang} — no theme index (likely rest day)`)
      return
    }
    const theme = THEMES[themeIndex]
    if (!theme) {
      log(`[AutoPromo] Skipping ${slotType} broadcast for ${lang} — invalid theme index: ${themeIndex}`)
      return
    }
    const isEvening = slotType === 'evening'
    const messagePool = isEvening ? 'crossSell' : 'hero'
    const rotationKey = isEvening ? `${theme}_evening_${lang}` : `${theme}_${lang}`
    const variationIndex = await getRotationIndex(theme, lang, rotationKey)
    const allChatIds = await getAllChatIds()
    if (allChatIds.length === 0) return log(`[AutoPromo] No users found`)

    const permanentlyDead = await promoOptOut.find({
      optedOut: true,
      reason: { $in: ['chat_not_found', 'user_deactivated', 'bot_blocked'] }
    }).toArray()
    const deadSet = new Set(permanentlyDead.map(r => r._id))

    const targetChatIds = []
    let skippedDead = 0
    let skippedInactive = 0
    const now = new Date()
    const DAYS_30 = 30 * 24 * 60 * 60 * 1000
    const DAYS_7 = 7 * 24 * 60 * 60 * 1000
    
    for (const chatId of allChatIds) {
      if (deadSet.has(chatId)) { skippedDead++; continue }
      
      // Activity-based filtering — skip users inactive for 30+ days
      try {
        const userState = await stateCol.findOne({ _id: chatId })
        if (userState?.lastActiveAt) {
          const daysSinceActive = (now - new Date(userState.lastActiveAt)) / (1000 * 60 * 60 * 24)
          if (daysSinceActive > 30) {
            skippedInactive++
            continue // Skip users inactive for 30+ days
          }
        }
      } catch (e) { /* ignore - include user if we can't check activity */ }
      
      const userLang = await getUserLanguage(chatId)
      if (userLang === lang) targetChatIds.push(chatId)
    }

    // ── Lifecycle Diet (#18): suppress marketing to (a) users messaged in the
    //    last 24h, (b) users < 72h old (still in the welcome sequence), and
    //    (c) users who hit a balance wall and haven't deposited since. Sets are
    //    computed in bulk so this stays O(1) per user.
    let dietCap = 0, dietWelcome = 0, dietWall = 0
    const preDietCount = targetChatIds.length
    if (lifecycleDiet?.buildSuppressionSets) {
      try {
        const sets = await lifecycleDiet.buildSuppressionSets(targetChatIds)
        const kept = []
        for (const cid of targetChatIds) {
          if (sets.capped.has(cid)) { dietCap++; continue }
          if (sets.welcome.has(cid)) { dietWelcome++; continue }
          if (sets.balanceWall.has(cid)) { dietWall++; continue }
          kept.push(cid)
        }
        targetChatIds.length = 0
        targetChatIds.push(...kept)
      } catch (e) { log(`[AutoPromo] Lifecycle-diet filter error (sending unfiltered): ${e.message}`) }
    }

    if (targetChatIds.length === 0) return log(`[AutoPromo] No ${lang} users for ${theme} (${skippedDead} dead, ${skippedInactive} inactive; diet: cap=${dietCap} welcome=${dietWelcome} wall=${dietWall} skipped)`)
    log(`[AutoPromo] Targeting ${targetChatIds.length}/${preDietCount} active ${lang} users (diet suppressed cap=${dietCap} welcome=${dietWelcome} wall=${dietWall}; ${skippedDead} dead, ${skippedInactive} inactive)`)

    // ── Pre-blast block-rate report to admin (2026-08-20) ──────────────────
    // Send a quick health snapshot BEFORE the blast so the admin can see the
    // block/dead rate for this audience versus how many will actually receive.
    try {
      if (adminChatId && bot?.sendMessage) {
        const deadByReason = {}
        for (const r of permanentlyDead) { const k = r.reason || 'unknown'; deadByReason[k] = (deadByReason[k] || 0) + 1 }
        const report = _buildBlockRateReport({
          theme, lang, slot: isEvening ? 'evening' : 'morning',
          totalUsers: allChatIds.length, targets: targetChatIds.length,
          dead: deadSet.size, deadByReason, inactive: skippedInactive,
        })
        await bot.sendMessage(adminChatId, report, { parse_mode: 'HTML' }).catch(() => {})
      }
    } catch (e) { log(`[AutoPromo] block-rate report error: ${e.message}`) }

    let dynamicMessage = null
    let usedAI = false
    // Only use AI for morning hero ads — evening cross-sells use static (short & punchy)
    if (!isEvening) {
      try {
        dynamicMessage = await generateDynamicPromo(theme, lang)
        if (dynamicMessage) { usedAI = true; log(`[AutoPromo] AI ${theme}/${lang} (${dynamicMessage.length} chars)`) }
      } catch (err) { log(`[AutoPromo] AI fail: ${err.message}`) }

      if (!dynamicMessage) {
        log(`[AutoPromo] Static fallback for ${theme}/${lang}`)
        alertAdmin(`OpenAI failed for ${theme}/${lang}. Using static fallback.`)
      }
    }

    log(`[AutoPromo] Broadcasting ${theme} ${isEvening ? '🌙evening' : '🌅morning'} (${usedAI ? 'AI' : 'static #' + (variationIndex + 1)}) to ${targetChatIds.length} ${lang} users (${skippedDead} permanently dead pre-filtered)`)

    let couponLine = null
    if (dailyCouponSystem) {
      try {
        const codes = await dailyCouponSystem.getTodayCoupons()
        const entries = Object.entries(codes)
        if (entries.length > 0) {
          // Now that only one code exists per day (as of 2026-05-03), this is
          // effectively deterministic; kept as random for safety when legacy
          // 2-code documents are still present in the DB.
          const [code, info] = entries[Math.floor(Math.random() * entries.length)]
          // New header-style line — appears at the TOP of the caption so it
          // dominates the Telegram push preview instead of being hidden under
          // footers. Keep it short (one line): users should see the code +
          // discount before they even expand the message.
          couponLine = `🎁 <b>TODAY ${info.discount}% OFF</b> — code <code>${code}</code>`
        }
      } catch (err) { log(`[AutoPromo] Coupon error: ${err.message}`) }
    }

    const { BATCH_SIZE, DELAY_BETWEEN_BATCHES, DELAY_BETWEEN_MESSAGES } = BROADCAST_CONFIG
    let successCount = 0, errorCount = 0, skippedCount = 0

    // GIF themes need slower pacing to avoid Telegram 429 rate limits on media
    const hasGif = !isEvening && GIF_THEMES[theme]
    const batchSize = hasGif ? Math.min(BATCH_SIZE, 10) : BATCH_SIZE
    const msgDelay = hasGif ? Math.max(DELAY_BETWEEN_MESSAGES, 200) : DELAY_BETWEEN_MESSAGES
    const batchDelay = hasGif ? Math.max(DELAY_BETWEEN_BATCHES, 3000) : DELAY_BETWEEN_BATCHES

    // ── Fix Railway-log issue #17: collect per-chatId failure details so we
    //    can investigate ~5% delivery error rate (was previously hidden).
    const failedDetails = []      // [{chatId, error, code}]
    const errorReasonCounts = {}  // { 'TIMEOUT': 3, '403': 2, ... }
    for (let i = 0; i < targetChatIds.length; i += batchSize) {
      const batch = targetChatIds.slice(i, i + batchSize)
      const results = await Promise.allSettled(batch.map(async (chatId, index) => {
        await sleep(index * msgDelay)
        const r = await sendPromoToUser(chatId, theme, variationIndex, lang, dynamicMessage, couponLine, isEvening)
        return { chatId, ...r }
      }))
      let batchRateLimited = false
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value?.skipped) skippedCount++
          else if (result.value?.success) successCount++
          else {
            errorCount++
            if (result.value?.rateLimited) batchRateLimited = true
            const errMsg = (result.value?.error || 'unknown').substring(0, 120)
            // Bucket key: first token (e.g. "ETELEGRAM" / "EFATAL" / "TIMEOUT" / status code)
            const bucket = (errMsg.match(/^[A-Z0-9_]+/) || ['other'])[0]
            errorReasonCounts[bucket] = (errorReasonCounts[bucket] || 0) + 1
            if (failedDetails.length < 50) failedDetails.push({ chatId: result.value?.chatId, error: errMsg })
          }
        } else {
          errorCount++
          const errMsg = (result.reason?.message || String(result.reason || 'rejected')).substring(0, 120)
          const bucket = (errMsg.match(/^[A-Z0-9_]+/) || ['rejected'])[0]
          errorReasonCounts[bucket] = (errorReasonCounts[bucket] || 0) + 1
          if (failedDetails.length < 50) failedDetails.push({ chatId: 'unknown', error: errMsg })
        }
      }
      // If any send in this batch was rate-limited, add extra cooldown before next batch
      const nextDelay = batchRateLimited ? Math.max(batchDelay, 5000) : batchDelay
      if (i + batchSize < targetChatIds.length) await sleep(nextDelay)
    }

    const stats = { theme, lang, slot: isEvening ? 'evening' : 'morning', variation: usedAI ? 'ai' : variationIndex + 1, usedAI, total: targetChatIds.length, success: successCount, errors: errorCount, skipped: skippedCount, errorBreakdown: errorReasonCounts, timestamp: new Date().toISOString(), sentAt: new Date(), diet: { cap: dietCap, welcome: dietWelcome, balanceWall: dietWall }, liftStartCount: 0, liftHubTapCount: 0, liftUserIds: [], liftWindowMs: LIFT_WINDOW_MS, liftEvaluated: false }
    log(`[AutoPromo] Done:`, JSON.stringify(stats))
    if (errorCount > 0) {
      const breakdownStr = Object.entries(errorReasonCounts).map(([k,v]) => `${k}=${v}`).join(' ')
      log(`[AutoPromo] Error breakdown for ${theme}/${lang}/${isEvening ? 'evening' : 'morning'}: ${breakdownStr}`)
      // Log up to first 10 failed chatIds with their error so we can investigate.
      for (const f of failedDetails.slice(0, 10)) {
        log(`[AutoPromo]   ↳ failed chatId=${f.chatId} error="${f.error}"`)
      }
    }
    const _statsRes = await db.collection('promoStats').insertOne(stats)
    // Evaluate this blast's lift just after the 45-min window closes.
    if (_statsRes?.insertedId) {
      setTimeout(() => { evaluateBlastLift(_statsRes.insertedId).catch(() => {}) }, LIFT_WINDOW_MS + 60 * 1000)
    }
  }

  // ─── Day-of-week → Theme mapping (Morning Hero + Evening Cross-sell) ──
  // Optimized based on log analysis:
  //   - Marketplace is hottest (most clicks) → 3 slots/week
  //   - Sunday now has a light promo (was rest day — missed weekend shoppers)
  //   - Cross-sell pairings based on actual user journeys
  const DAY_SCHEDULE = {
    0: [7, 3],                // Sun: marketplace(7) morning, domains_shortener(3) evening — light weekend promo
    1: [0, 8],                // Mon: cloudphone(0), vps_rdp(8)
    2: [1, 6],                // Tue: antired_hosting(1), email_validation(6)
    3: [8, 2],                // Wed: vps_rdp(8), leads_validation(2)
    4: [3, 1],                // Thu: domains_shortener(3), antired_hosting(1)
    5: [7, 4],                // Fri: marketplace(7), digital_products(4)
    6: [5, 8],                // Sat: cards_bundles(5), vps_rdp(8)
  }

  function getTodayThemes() {
    const day = new Date().getDay()
    return DAY_SCHEDULE[day] || []
  }

  const supportedLangs = Object.keys(TIMEZONE_OFFSETS)
  let scheduledCount = 0

  for (const lang of supportedLangs) {
    const offset = TIMEZONE_OFFSETS[lang]
    LOCAL_TIMES.forEach((localTime, slotIndex) => {
      const utcTime = localToUtc(localTime.hour, localTime.minute, offset)
      const cronExpr = `${utcTime.minute} ${utcTime.hour} * * *`
      const slotType = slotIndex === 0 ? 'morning' : 'evening'
      schedule.scheduleJob(cronExpr, () => {
        const todayThemes = getTodayThemes()
        const themeIndex = todayThemes[slotIndex]
        if (themeIndex === undefined) {
          log(`[AutoPromo] Skipping ${lang} ${slotType} — no promo today (rest day)`)
          return
        }
        log(`[AutoPromo] Triggered ${THEMES[themeIndex]} ${slotType === 'evening' ? '🌙evening' : '🌅morning'} for ${lang} (local ${localTime.hour}:${String(localTime.minute).padStart(2, '0')})`)
        broadcastPromoForLang(themeIndex, lang, slotType).catch(err => log(`[AutoPromo] Broadcast error: ${err.message}`))
      })
      log(`[AutoPromo] Scheduled ${slotType} for ${lang.toUpperCase()} at local ${localTime.hour}:${String(localTime.minute).padStart(2, '0')} (UTC ${utcTime.hour}:${String(utcTime.minute).padStart(2, '0')})`)
      scheduledCount++
    })
  }

  log(`[AutoPromo] Initialized — ${scheduledCount} jobs (${supportedLangs.length} langs × ${LOCAL_TIMES.length} slots/day), ${THEMES.length} themes: ${THEMES.join(', ')}`)
  log(`[AutoPromo] Schedule: 🌅 Morning hero (10am) + 🌙 Evening cross-sell (7pm), 7 days/week`)

  // ─── Resurrection Scan ─────────────────────────────────────────────────
  // Periodically re-test "dead" users via Telegram getChat() to see if they're reachable
  // Runs every 6 hours, tests 200 users per batch to stay within API limits
  const RESURRECT_BATCH_SIZE = 200
  const RESURRECT_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

  async function runResurrectionScan() {
    try {
      // Find users marked as chat_not_found (not user_deactivated — those are truly gone)
      // Prioritize those who were recently active or have low failCount
      const candidates = await promoOptOut.find({
        optedOut: true,
        reason: { $in: ['chat_not_found', 'bot_blocked'] }
      }).sort({ failCount: 1, updatedAt: 1 }).limit(RESURRECT_BATCH_SIZE).toArray()

      if (!candidates.length) {
        log(`[ResurrectionScan] No candidates to test`)
        return { tested: 0, resurrected: 0 }
      }

      log(`[ResurrectionScan] Testing ${candidates.length} dead users...`)
      let resurrected = 0
      let stillDead = 0

      for (const user of candidates) {
        try {
          await bot.getChat(user._id)
          // getChat succeeded — user is reachable!
          await promoOptOut.updateOne({ _id: user._id }, {
            $set: { optedOut: false, updatedAt: new Date(), reOptInReason: 'resurrection_scan', failCount: 0 }
          })
          resurrected++
        } catch (err) {
          stillDead++
          // Update failCount to push truly dead users to the back of the queue
          await promoOptOut.updateOne({ _id: user._id }, {
            $inc: { failCount: 1 },
            $set: { updatedAt: new Date() }
          }).catch(() => {})
        }
        // Small delay to avoid rate limiting
        await sleep(100)
      }

      const stats = { tested: candidates.length, resurrected, stillDead, timestamp: new Date().toISOString() }
      log(`[ResurrectionScan] Done: ${JSON.stringify(stats)}`)
      await db.collection('resurrectionStats').insertOne(stats)
      return stats
    } catch (error) {
      log(`[ResurrectionScan] Error: ${error.message}`)
      return { error: error.message }
    }
  }

  // Schedule resurrection scan every 6 hours
  setInterval(() => {
    runResurrectionScan().catch(err => log(`[ResurrectionScan] Unhandled: ${err.message}`))
  }, RESURRECT_INTERVAL_MS)

  // Run first scan 5 minutes after startup
  setTimeout(() => {
    runResurrectionScan().catch(err => log(`[ResurrectionScan] Initial scan error: ${err.message}`))
  }, 5 * 60 * 1000)
  log(`[AutoPromo] Resurrection scan enabled — every 6h, ${RESURRECT_BATCH_SIZE} users/batch`)

  // ─── Promo Response Tracking ───────────────────────────────────────────
  // Track when users interact with the bot within 60 min after receiving a promo
  const PROMO_RESPONSE_WINDOW_MS = 60 * 60 * 1000 // 60 minutes

  async function trackPromoResponse(chatId) {
    try {
      // Check if this user received a promo recently
      const recentPromo = await db.collection('promoStats').findOne({
        timestamp: { $gte: new Date(Date.now() - PROMO_RESPONSE_WINDOW_MS).toISOString() }
      })
      if (!recentPromo) return

      await db.collection('promoResponses').updateOne(
        { chatId, date: new Date().toISOString().slice(0, 10) },
        { $set: { chatId, respondedAt: new Date(), theme: recentPromo.theme }, $inc: { responseCount: 1 } },
        { upsert: true }
      )
    } catch (err) {
      // Silent — tracking shouldn't break the main flow
    }
  }

  // ─── Per-blast Lift Metric (#18) ──────────────────────────────────────
  // A user who does /start or taps a hub deep link within 45 min of a blast
  // counts as "returned". Deduped to one lift/user/blast.
  async function recordPromoLift(chatId, kind = 'start') {
    try {
      const cid = String(chatId)
      const since = new Date(Date.now() - LIFT_WINDOW_MS)
      const userLang = await getUserLanguage(cid)
      const blast = await db.collection('promoStats')
        .find({ sentAt: { $gte: since }, lang: userLang })
        .sort({ sentAt: -1 }).limit(1).next()
      if (!blast) return
      if (Array.isArray(blast.liftUserIds) && blast.liftUserIds.includes(cid)) return // 1 lift/user/blast
      const incField = kind === 'hubtap' ? 'liftHubTapCount' : 'liftStartCount'
      const update = { $inc: { [incField]: 1 } }
      if (!Array.isArray(blast.liftUserIds) || blast.liftUserIds.length < 2000) {
        update.$addToSet = { liftUserIds: cid }
      }
      await db.collection('promoStats').updateOne({ _id: blast._id }, update)
    } catch (_) { /* metric only — never break the main flow */ }
  }

  async function evaluateBlastLift(statsId) {
    try {
      const doc = await db.collection('promoStats').findOne({ _id: statsId })
      if (!doc || doc.liftEvaluated) return
      const returned = Array.isArray(doc.liftUserIds) ? doc.liftUserIds.length : 0
      const delivered = doc.success || 0
      const liftRate = delivered > 0 ? +((returned / delivered) * 100).toFixed(2) : 0
      await db.collection('promoStats').updateOne(
        { _id: statsId },
        { $set: { liftEvaluated: true, liftReturnedUsers: returned, liftRate } }
      )
      log(`[AutoPromo][Lift] ${doc.theme}/${doc.lang}/${doc.slot}: ${returned} returned of ${delivered} delivered (${liftRate}% lift, starts=${doc.liftStartCount || 0} hubtaps=${doc.liftHubTapCount || 0})`)
      // Report/flag zero-lift blasts to admin (no auto-disabling per product decision).
      if (returned === 0 && delivered >= 20) {
        alertAdmin(`⚠️ Zero-lift blast: <b>${doc.theme}/${doc.lang}/${doc.slot}</b> — 0 returns from ${delivered} delivered. Consider dropping this theme/slot.`)
      }
    } catch (e) { log(`[AutoPromo][Lift] eval error: ${e.message}`) }
  }

  return {
    setOptOut,
    isOptedOut,
    recordSendFailure,
    broadcastPromoForLang,
    setDailyCouponSystem,
    runResurrectionScan,
    trackPromoResponse,
    recordPromoLift,
    evaluateBlastLift,
    getPromoMessages: () => promoMessages,
    getCrossSellMessages: () => crossSellMessages,
    getThemes: () => THEMES,
  }
}

module.exports = { initAutoPromo, promoMessages, crossSellMessages, _promoRetestTtlDays, _buildBlockRateReport }
