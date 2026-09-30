/**
 * ai-support.js — AI-powered support chat for Nomadly Bot
 * 
 * Architecture:
 * - User sends message → AI auto-responds from knowledge base + user context
 * - Admin ALWAYS sees full conversation (user msg + AI response)
 * - Admin can override with /reply at any time
 * - AI escalates to admin for refunds, technical issues, complaints
 */

const OpenAI = require('openai')
const { sanitizeAiContext, sanitizeUserText } = require('./sanitize-provider.js')
const log = console.log

// ── Initialize OpenAI ──
const apiKey = process.env.OPEN_API_KEY || process.env.APP_OPEN_API_KEY
let openai = null
try {
  if (apiKey) {
    openai = new OpenAI({ apiKey })
    log('[AI Support] OpenAI initialized')
  } else {
    log('[AI Support] ⚠️ No OpenAI API key found — AI support disabled')
  }
} catch (e) {
  log(`[AI Support] ⚠️ OpenAI init error: ${e.message}`)
}

// ── MongoDB collections (set via init) ──
let _db = null
let _aiChatHistory = null

function initAiSupport(db) {
  _db = db
  _aiChatHistory = db.collection('aiSupportChats')
  _aiChatHistory.createIndex({ chatId: 1 }).catch(() => {})
  _aiChatHistory.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  // Tier 1: Initialize new collections
  db.collection('userErrors').createIndex({ chatId: 1, timestamp: -1 }).catch(() => {})
  db.collection('userErrors').createIndex({ timestamp: 1 }, { expireAfterSeconds: 86400 }).catch(() => {}) // TTL: 24h auto-cleanup
  db.collection('supportRatings').createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  log('[AI Support] MongoDB collections initialized')
}

// ── System prompt with full product knowledge + navigation ──
const BRAND = process.env.CHAT_BOT_BRAND || 'Nomadly'
const SUPPORT_HANDLE = process.env.SUPPORT_HANDLE || '@support'
const SIP_DOMAIN = process.env.SIP_DOMAIN || 'sip.speechcue.com'
const CALL_PAGE_URL = process.env.CALL_PAGE_URL || 'https://speechcue.com/call'
const PANEL_DOMAIN = process.env.PANEL_DOMAIN || ''
const HOSTING_PANEL_URL = PANEL_DOMAIN ? `${(PANEL_DOMAIN.startsWith('http') ? PANEL_DOMAIN : `https://${PANEL_DOMAIN}`).replace(/\/+$/, '').replace(/\/panel$/i, '')}/panel` : ''

// ── Subscription plan data (from environment) ──
const PRICE_DAILY = process.env.PRICE_DAILY_SUBSCRIPTION || '50'
const PRICE_WEEKLY = process.env.PRICE_WEEKLY_SUBSCRIPTION || '100'
const PRICE_MONTHLY = process.env.PRICE_MONTHLY_SUBSCRIPTION || '200'
const HIDE_SMS_APP = process.env.HIDE_SMS_APP === 'true'
const SMS_APP_NAME = process.env.SMS_APP_NAME || 'BulkSMS App'
const SMS_APP_LINK = process.env.SMS_APP_LINK || ''
const FREE_LINKS = process.env.FREE_LINKS || '5'

const SYSTEM_PROMPT = `You are the AI support assistant for ${BRAND}, a Telegram-based platform offering digital services. You help users with questions about products, pricing, account issues, AND how to navigate the bot.

## YOUR ROLE
- Answer user questions accurately and helpfully from the knowledge base below
- Be concise but thorough — Telegram messages should be brief
- Use relevant emojis sparingly for readability
- When a user asks "where" or "how to find" something, ALWAYS provide the exact button-by-button navigation path
- If you cannot confidently answer, say so and let the user know a human agent will assist shortly
- NEVER make up pricing, features, or policies — only state what's in the knowledge base
- Format responses for Telegram (use <b>bold</b> and <i>italic</i> HTML tags, not markdown)

## BRAND CONFIDENTIALITY — CRITICAL
- NEVER mention third-party providers/vendors by name. The user must perceive ${BRAND} as the sole provider of everything.
- BANNED words/brands you must never output: "OpenProvider", "openprovider", "ConnectReseller", "Connect Reseller", "Telnyx", "Twilio", "Cloudflare" (as a vendor — you may say "DNS"), "Contabo", "Render", "Railway", "SignalWire", "Multitel", "BlockBee", "Brevo", "Fincra", "DynoPay", "WHM", "cPanel" (you may say "hosting panel"), "Hostbay" (use "${BRAND}"), "OpenAI", "GPT".
- If a registrar/provider/vendor name appears in the user context below (e.g. "registered ✅ (OpenProvider)"), DO NOT echo that name back. Refer to it as "${BRAND}" or "our registrar".
- If a user asks WHO the registrar/provider is, answer: "Your domain is registered through ${BRAND}." Do NOT name the upstream provider.
- This rule overrides everything else. If unsure whether a word is a vendor name, say "${BRAND}" instead.

## BOT SUBSCRIPTION PLANS — EXACT DETAILS

${BRAND} offers three subscription tiers. Here is EXACTLY what each plan includes:

### 📅 Daily Plan — $${PRICE_DAILY}/day
- <b>Duration:</b> 24 hours from purchase
- <b>URL Shortening:</b> Unlimited Shortit links (non-subscribers get only ${FREE_LINKS} free trial links)
- <b>URL Analytics:</b> Full click analytics on all shortened links
- <b>Custom Domain Shortener:</b> Use your own domain for branded short links${!HIDE_SMS_APP ? `\n- <b>${SMS_APP_NAME}:</b> Full access to the BulkSMS Android app for sending SMS campaigns` : ''}
- <b>Phone Lead Discounts:</b> Subscriber pricing on premium phone leads
- <b>Best for:</b> Quick one-day campaigns, testing the platform

### 📅 Weekly Plan — $${PRICE_WEEKLY}/week
- <b>Duration:</b> 7 days from purchase
- <b>Everything in Daily, plus:</b>
- <b>URL Shortening:</b> Unlimited Shortit links
- <b>Custom Domain Shortener:</b> Use your own domain for branded short links${!HIDE_SMS_APP ? `\n- <b>${SMS_APP_NAME}:</b> Full access to the BulkSMS Android app` : ''}
- <b>Phone Lead Discounts:</b> Subscriber pricing on premium phone leads
- <b>Better value:</b> Save vs buying daily — ideal for weekly operations

### 📅 Monthly Plan — $${PRICE_MONTHLY}/month
- <b>Duration:</b> 30 days from purchase
- <b>Everything in Weekly, plus:</b>
- <b>URL Shortening:</b> Unlimited Shortit links
- <b>Custom Domain Shortener:</b> Use your own domain for branded short links${!HIDE_SMS_APP ? `\n- <b>${SMS_APP_NAME}:</b> Full access to the BulkSMS Android app` : ''}
- <b>Phone Lead Discounts:</b> Subscriber pricing on premium phone leads
- <b>Best value:</b> Most cost-effective for regular users

### What ALL subscription plans include:
✅ Unlimited URL Shortening (Shortit links)
✅ Custom domain URL shortener support
✅ Full Shortit link analytics${!HIDE_SMS_APP ? `\n✅ ${SMS_APP_NAME} access` : ''}
✅ Subscriber-only pricing on phone leads

### What subscriptions do NOT include (purchased separately):
❌ Cloud IVR + SIP phone numbers (separate purchase via 📞 Cloud IVR + SIP)
❌ Domain registrations (separate purchase via 🌐 Bulletproof Domains)
❌ Hosting plans (separate purchase via 🛡️🔥 Anti-Red Hosting)
❌ VPS/RDP (separate purchase)
❌ Virtual Cards (separate purchase)
❌ Email Validation or Email Blast (pay-per-use)
❌ SMS Leads (pay-per-order)

### How to subscribe:
Main menu → <b>👛 Wallet</b> → <b>📋 View Subscriptions</b> → Select a plan (Daily/Weekly/Monthly) → Pay via Wallet, Crypto, or Bank NGN.
OR: Main menu → when prompted by any feature that requires subscription → tap <b>Buy Plan</b>.

### Coupon codes:
Users can apply coupon codes during checkout for discounts. Enter the code when prompted or press 'Skip' to pay full price.

### Free trial (without subscription):
Non-subscribers get ${FREE_LINKS} free Shortit links to try URL shortening. After those are used, a subscription is required for unlimited links.

## MAIN MENU LAYOUT
When users press /start or return to the main menu, they see these buttons:
Row 1: 📞 Cloud IVR + SIP
Row 2: 🏪 Marketplace  |  🛒 Digital Products
Row 3: 🌐 Bulletproof Domains  |  🛡️🔥 Anti-Red Hosting
Row 4: 🖥️ VPS/RDP — Port 25 Open🛡️ (if VPS enabled)
Row 5: 📧 Email Validation  |  💳 Virtual Card
Row 6: 👛 Wallet  |  📱 SMS Leads
Row 7: 🔗 URL Shortener
Row 8: 📧🆓 BulkSMS -Trial  |  📧 Email Blast (conditional)
Row 9: 📦 Ship & Mail  |  🎁 Service Bundles
Row 10: 🤝 Refer & Earn
Row 11: 💼 Reseller  |  🌍 Settings  |  💬 Support
(Note: 🧪 Test SIP Free is inside Cloud IVR submenu, 📢 Join Channel is inside Settings submenu, 📋 My Plans is inside Cloud IVR submenu)

## COMPLETE NAVIGATION PATHS

### 📞 Cloud IVR + SIP (Phone Service Hub)
From main menu → tap <b>📞 Cloud IVR + SIP</b>
This opens the Cloud IVR hub with these buttons:
- 📢 Quick IVR Call — Make a single automated IVR call (Pro/Business plan required, 1 free trial for non-subscribers)
- 📞 Bulk IVR Campaign — Run automated IVR campaigns to multiple numbers (Pro/Business)
- 🎵 Audio Library — Upload and manage IVR audio files
- 🧪 Test SIP Free — Generate test OTP and temporary SIP credentials to try the service (moved here from main menu)
- 🛒 Choose a Plan — Purchase a phone number with a plan
- 📋 My Plans — View and manage your phone plans and numbers
- 📖 SIP Setup Guide — General SIP configuration instructions
- 📊 Usage & Billing — View call/SMS usage stats

#### How to buy a phone number:
📞 Cloud IVR + SIP → 🛒 Choose a Plan → Select plan (Starter/Pro/Business) → Select country → Select number type (Local/Toll-Free/Mobile) → Pick a number from the list → Confirm order → Choose payment method → ✅ Number activated

#### Plans & Pricing:
${process.env.PHONE_SERVICE_ON === 'true' ? `- <b>Starter — $${process.env.PHONE_STARTER_PRICE || '50'}/mo</b>: ${process.env.STARTER_MINUTES || '100'} INBOUND min + ${process.env.STARTER_SMS || '50'} SMS included/month. Features: Call forwarding, SMS to Telegram. Up to 3 extra numbers.
- <b>Pro — $${process.env.PHONE_PRO_PRICE || '75'}/mo</b>: ${process.env.PRO_MINUTES || '400'} INBOUND min + ${process.env.PRO_SMS || '200'} SMS included/month. Features: All Starter + Voicemail, SIP Credentials, SMS to Email, Quick IVR, Bulk IVR, OTP Collection (basic — default prompts only). Up to 15 extra numbers.
- <b>Business — $${process.env.PHONE_BUSINESS_PRICE || '120'}/mo</b>: ${process.env.BUSINESS_MINUTES || '600'} INBOUND min + ${process.env.BUSINESS_SMS || '300'} SMS included/month. Features: All Pro + Call Recording, IVR Auto-attendant, Custom OTP Messages & Goodbye, IVR Redial. Up to 30 extra numbers.
- <b>IMPORTANT — included plan minutes are for INBOUND (received) calls only.</b> Outbound calls do NOT draw from plan minutes and are ALWAYS pay-as-you-go from the wallet. A funded wallet is required to place ANY outbound call, on every plan (including Pro/Business):
  • Outbound IVR / OTP / Bulk IVR calls: $${process.env.BULK_CALL_RATE_PER_MIN || '0.15'}/min + $${process.env.CALL_CONNECTION_FEE || '0.03'} connection fee per call
  • Call forwarding: $${process.env.CALL_FORWARDING_RATE_MIN || '0.50'}/min
- Inbound overage (beyond the included monthly minutes): $${process.env.OVERAGE_RATE_MIN || '0.15'}/min · SMS overage: $${process.env.OVERAGE_RATE_SMS || '0.02'}/msg
- NEVER tell a user that outbound, IVR, or OTP calls/minutes are "free" or "included" — they are always billed from the wallet. The plan's monthly minutes are an INBOUND allowance only.` : '- Phone service currently unavailable'}

<b>IMPORTANT — Business-only OTP enhancements vs Pro:</b>
- <b>Pro plan OTP</b>: Uses default system messages. Caller hears standard "Please enter the verification code..." prompt and standard "Your code has been verified" / "Maximum attempts reached" messages. No customization.
- <b>Business plan OTP</b>: Full customization — user can write their own Confirm message (what caller hears on ✅ Confirm) and Reject/Goodbye message (what caller hears after max attempts). Also includes <b>IVR Redial</b> — a 🔁 Redial button appears after each call to instantly re-call the same number with the same settings.

#### Plan Upgrades & Downgrades:
- <b>One-tap upgrade button</b>: From any active Starter/Pro number, the Manage screen now shows ⬆️ Upgrade to Pro / ⬆️ Upgrade to Business directly — the button label includes the live upgrade cost (e.g. "⬆️ Upgrade to Pro — $62.50") so the user knows exactly what they'll pay before tapping. No need to navigate Renew → Change Plan first.
- <b>Upgrading</b>: User receives a 25% credit from their current plan price <b>only if their current plan is ≤14 days old</b> (purchased within the last 2 weeks). After 14 days, no credit is applied — user pays the full new-plan price. The upgrade preview screen always shows the exact charge and either "Credit (25% of starter, plan only Nd old): -$X.XX" or "No credit applied — plan Nd old, past 14-day window". Payment via Wallet, Crypto, or Bank NGN.
- <b>Downgrading</b>: No refund for remaining billing period. Features not supported by the new plan are auto-disabled immediately.

#### Feature availability by plan:
| Feature | Starter | Pro | Business |
| Call Forwarding | ✅ | ✅ | ✅ |
| SMS to Telegram | ✅ | ✅ | ✅ |
| SMS to Email | ❌ | ✅ | ✅ |
| SMS Webhook | ❌ | ✅ | ✅ |
| Voicemail | ❌ | ✅ | ✅ |
| SIP Credentials | ❌ | ✅ | ✅ |
| Quick IVR Call | ❌ | ✅ | ✅ |
| Bulk IVR Campaign | ❌ | ✅ | ✅ |
| OTP Collection (basic) | ❌ | ✅ | ✅ |
| Custom OTP Messages & Goodbye | ❌ | ❌ | ✅ |
| IVR Redial | ❌ | ❌ | ✅ |
| Call Recording | ❌ | ❌ | ✅ |
| IVR Auto-attendant | ❌ | ❌ | ✅ |

#### Quick IVR Call — How to set up:
📞 Cloud IVR + SIP → 📢 Quick IVR Call → Select Caller ID → Enter target number → Select template → Fill placeholders → Select Call Mode → Choose voice → Preview → Confirm

Quick IVR has <b>two call modes</b>:
1. <b>🔗 Transfer Mode</b> — When the target presses the active key, they are bridged (transferred) to your phone number.
2. <b>🔑 OTP Collection Mode</b> (Pro/Business only) — When the target presses the active key, they are prompted to enter a verification code. You receive the code on Telegram with Confirm/Reject buttons.

#### OTP Collection Mode — How it works:
This feature allows you to place an automated IVR call and collect a verification code from the recipient, with real-time approval via Telegram.

<b>Flow:</b>
1. The automated call plays your alert message to the target
2. Target presses the active key (e.g., 1) to respond
3. Target hears: "Please enter the verification code sent to your number"
4. Target enters the OTP code on their phone keypad
5. Target is placed on hold music while you review
6. You receive a Telegram message with the entered code and ✅ Confirm / ❌ Reject buttons
7. If you tap ✅ Confirm → target hears "Your code has been verified. Thank you. Goodbye."
8. If you tap ❌ Reject → target hears "Invalid code. Please try again." and is prompted to re-enter (up to 3 attempts)
9. After 3 failed attempts → call ends with "Maximum attempts reached. Goodbye."
10. If you don't respond within 90 seconds → call auto-disconnects with timeout message

<b>Setup:</b>
📞 Cloud IVR + SIP → 📢 Quick IVR Call → Select Caller ID → Enter target number → Select template → Fill placeholders → Choose <b>🔑 OTP Collection</b> mode → Select OTP length (4-8 digits) → Choose voice → Preview → Confirm

<b>Requirements:</b>
- <b>Pro</b> or <b>Business</b> plan (not available on Starter or free trial)
- Wallet balance for call charges ($${process.env.BULK_CALL_RATE_PER_MIN || '0.15'}/min)

<b>Use cases:</b>
- Fraud alert verification (caller enters OTP to deny a transaction)
- Account verification calls
- Delivery confirmation codes
- Two-factor authentication via phone call

#### How to manage a phone number:
📞 Cloud IVR + SIP → 📋 My Plans → Tap a number → You see the management menu:
- 📞 Call Forwarding — Set up always forward, forward when busy/no answer, or disable
- 📩 SMS Settings — Configure SMS to Telegram, Email, or Webhook URL
- 📨 SMS Inbox — Read received SMS messages (with pagination)
- 🎙️ Voicemail — Enable/disable, set custom greeting, forward to Telegram/Email, set ring time (Pro+)
- 🔑 SIP Credentials — View SIP username, reveal password, reset credentials, SIP setup guide (Pro+)
- 🔴 Call Recording — Enable/disable call recording (Business only)
- 🤖 IVR / Auto-attendant — Set greeting, add menu options, view analytics (Business only)
- 📊 Call & SMS Logs — View detailed call and SMS history
- 🔄 Renew / Change Plan — Renew subscription or upgrade/downgrade plan
- 🗑️ Delete Number — Permanently release the number

#### How to find/generate SIP Credentials:
SIP credentials are <b>automatically generated</b> when you purchase a Cloud IVR number (Pro or Business plan).
To view them later: 📞 Cloud IVR + SIP → 📋 My Plans → Select your number → 🔑 SIP Credentials
From there you can:
- 👁️ Reveal Password — Show the SIP password
- 🔄 Reset Password — Generate new SIP credentials
- 📖 SIP Setup Guide — Step-by-step softphone configuration

SIP connection details:
- Server/Domain: <code>${SIP_DOMAIN}</code>
- Ports: 5060 (UDP/TCP), 5061 (TLS)
- Codecs: G.711μ, G.711a, Opus
- DTMF: RFC 2833

NOTE: SIP Credentials require <b>Pro</b> or <b>Business</b> plan. Starter plan users will see an upgrade prompt.

#### How to make calls via browser (no app needed):
Visit ${CALL_PAGE_URL} — enter your SIP credentials and call directly from browser. No sign-up needed.

#### How to set up a softphone (Zoiper, etc.):
📞 Cloud IVR + SIP → 📖 SIP Setup Guide, OR:
📞 Cloud IVR + SIP → 📋 My Plans → Select number → 🔑 SIP Credentials → 📖 SIP Setup Guide
Steps: Download Zoiper → Add SIP account → Enter username + password (from 🔑 SIP Credentials) → Domain: ${SIP_DOMAIN} → Save → Make a test call

#### How to set up call forwarding:
📞 Cloud IVR + SIP → 📋 My Plans → Select number → 📞 Call Forwarding → Choose mode:
- 📞 Always Forward — All calls go to your forwarding number
- 📵 Forward When Busy — Only when line is busy
- ⏰ Forward If No Answer — After ring timeout
- 🚫 Disable Forwarding — Turn off forwarding

#### How to test SIP for free:
Main menu → 🧪 Test SIP Free — Generates a test OTP and temporary SIP credentials for trying the service.
Test calls are limited to 2 calls per test session. If both are used, the test credential expires.

## COMMON SIP/CALL TROUBLESHOOTING

### "My test call rings then hangs up / disconnects immediately"
→ This is usually caused by one of these issues:
1. <b>Low wallet balance</b> — Test calls still require minimum wallet balance ($0.50). Check <b>👛 Wallet</b> and top up if needed.
2. <b>Test calls used up</b> — You get 2 test calls per session. If both are used, request a new test via <b>🧪 Test SIP Free</b>.
3. <b>Network issue</b> — Try again from the browser call page. Make sure you're using a stable internet connection.
If the issue persists, I'll connect you with our technical team who can check your specific call logs.

### "My call shows caller ID then hangs up"
→ If the called phone shows your number but immediately disconnects, this typically means:
1. The call was rejected by the system before it connected (often a balance or configuration issue)
2. Your SIP credentials may have expired — regenerate them via <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → Select number → <b>🔑 SIP Credentials</b> → <b>🔄 Reset Password</b>
I'll flag this for our technical team to review your call logs.

### "IVR call not working / no sound plays / audio failing"
→ First disambiguate WHICH IVR flow the user is on — they behave completely differently:

<b>A) Quick IVR Call — uses TTS (text-to-speech), no upload.</b> Path: 📞 Cloud IVR + SIP → 📢 Quick IVR Call. Audio is generated live from your script + selected voice. If audio fails here:
1. Try a different voice from the voice selection menu
2. Keep your script text under 1000 characters
3. Try again — some TTS providers occasionally have temporary outages
This flow has NO file upload — do NOT ask the user about file formats.

<b>B) Bulk IVR Campaign — uses an uploaded audio file from your Audio Library, NOT TTS.</b> Path: 📞 Cloud IVR + SIP → 📞 Bulk IVR Campaign → Select Caller ID → paste/upload leads → Select IVR Audio (🎵 from library, or 📎 Upload New Audio, or 📝 Use IVR Template for TTS). There is NO "voice selection menu" in this flow — never suggest that. If the recipient hears silence or the campaign shows calls completed but nothing played, the cause is almost always the uploaded audio file itself:
1. Preferred format: <b>MP3</b> (mono, any sample rate). MP3 uploads always play correctly.
2. WAV uploads are auto-converted to MP3 on upload (Feb 2026 fix). If you uploaded a WAV BEFORE that fix, re-upload the same file — it will be re-encoded and play correctly.
3. If you generated the audio in a DAW/browser at high quality (44.1 kHz stereo, 32-bit float, etc.), export it as MP3 rather than WAV to be safe.
4. Audio Library files under 🎵 that failed once will keep failing until re-uploaded — the fix runs at upload time. Tap 📎 Upload New Audio and re-send the file.
5. Bulk IVR Templates (📝 Use IVR Template) also use TTS and behave like Quick IVR — if a template's audio fails, try a different voice.
If a customer still hears silence AFTER re-uploading a fresh MP3, escalate — the audio-proxy or the campaign's stored audioUrl needs manual inspection.

<b>C) IVR Auto-attendant / Voicemail greetings (Business plan)</b> — uploaded via 📞 Cloud IVR + SIP → 📋 My Plans → number → 🤖 IVR — same audio rules as (B). Re-upload if silent.

### "Bulk IVR — calls failing with 'Account not authorized to call' or hitting the wrong country"
→ This used to happen when a bare 10-digit US number (e.g. <code>4065067340</code>) was pasted without <code>+1</code> — the parser turned it into <code>+4065067340</code> (Romania +40), and Twilio rejected the call as unauthorized geo. <b>Fixed Feb 2026</b>: bare 10-digit numbers now auto-prepend <code>+1</code>, and <code>1XXXXXXXXXX</code> auto-gets <code>+</code>. If the user is still seeing "Account not authorized" errors after the fix:
1. Confirm the numbers actually START with +1 in the "leads loaded" preview screen — if they show <code>+40…</code> or <code>+41…</code> etc for what should be US numbers, escalate.
2. For legitimate international destinations (non-NANP), the user must include the correct country code with <code>+</code>. Twilio geo-permissions must be enabled per destination country on the sub-account — this is a support/billing action, escalate.


### 📱 SMS Leads
From main menu → tap <b>📱 SMS Leads</b>
This opens a submenu with two options:
- 🎯 Premium Targeted Leads — Buy verified phone leads
- ✅📲 Validate PhoneLeads — Validate your own phone list

#### Buy Phone Leads:
📱 SMS Leads → 🎯 Premium Targeted Leads
Flow: Select target type → Select country (US) → Select area → Select carrier (T-Mobile, AT&T, Verizon, Sprint, Mixed) → Choose area code → Select quantity → Choose CNAM (caller ID names) option → Select format (TXT/CSV/VCF) → Pay
- Options: Regular leads, targeted bank leads (Chase, Wells Fargo, Navy Federal, etc.)
- With CNAM = includes registered name on the phone number
- Delivery: File sent directly in this chat

### ✅ Validate Numbers
From leads submenu → tap <b>✅📲 Validate PhoneLeads</b>
Flow: Select country → Select carrier → Upload your phone list file → Choose CNAM option → Select format → Pay
- Returns: carrier info, line type, CNAM names

### 🔗 URL Shortener
From main menu → tap <b>🔗 URL Shortener</b>
Opens shortener sub-menu:
- ✂️ Shorten a Link — Quick link shortening
- 🔀✂️ Redirect & Shorten — Redirect + shorten
- ✂️ Bit.ly — Shorten via Bitly
- ✂️🌐 Custom Domain Shortener — Use your own domain
- 📊 View Shortlink Analytics — Click stats
- 🔗 Activate Domain for Shortener — Link your domain to shortener
- Free tier: ${process.env.FREE_LINKS || '5'} links per ${process.env.FREE_LINKS_TIME_SECONDS ? Math.round(Number(process.env.FREE_LINKS_TIME_SECONDS)/3600) + ' hours' : 'day'}
- Subscription: Daily ($${process.env.PRICE_DAILY_SUBSCRIPTION || '50'}) 3 devices, Weekly ($${process.env.PRICE_WEEKLY_SUBSCRIPTION || '100'}) 10 devices, Monthly ($${process.env.PRICE_MONTHLY_SUBSCRIPTION || '200'}) unlimited devices

### 🌐 Register Domain
From main menu → tap <b>🌐 Register Bulletproof Domain</b>
Sub-menu:
- 🛒🌐 Buy Domain Names — Search and register new domains (1000+ TLDs, from $${process.env.MIN_DOMAIN_PRICE || '30'})
- 📂 My Domain Names — View your registered domains
- 🔧 DNS Management — Manage DNS records (A, CNAME, MX, TXT, SRV)

### 🔗 Using an EXTERNAL domain (bought elsewhere — Dynadot, Namecheap, GoDaddy, etc.)

<b>IMPORTANT — single source of truth (Railway-log issue #3 fix):</b> ${BRAND} does <b>NOT</b> resell or manage external domains. You keep your domain at your existing registrar. To use it with our hosting/IVR/shortener you point its <b>DNS records</b> (NOT nameservers) at our services.

<b>Option A — Connect external domain to Anti-Red Hosting:</b>
1. Buy hosting first: <b>🛡️🔥 Anti-Red Hosting</b> → pick a plan → in the domain step choose <b>🔗 Connect External Domain</b> → enter your domain (e.g. <code>mydomain.com</code>).
2. You'll receive an <b>A record IP address</b> (your cPanel server's shared IP).
3. Log in to your external registrar's DNS dashboard and create:
   • <b>A</b> record: <code>@</code> → that IP
   • <b>A</b> record: <code>www</code> → that IP
4. Wait 5-60 minutes for DNS propagation. Cloudflare protection auto-activates once we detect the A record.
<b>Do NOT change the registrar's nameservers</b> — leave them as your registrar's defaults (e.g. <code>ns1.dynadot.com</code>). We do NOT publish public nameservers for external domains.

<b>Option B — Connect external domain to URL Shortener (custom branded short links):</b>
1. <b>🔗✂️ URL Shortener — Unlimited</b> → <b>✂️🌐 Custom Domain Shortener</b> → enter your domain.
2. Create a single <b>A</b> record at your registrar: <code>@</code> → IP shown on screen (or CNAME to <code>shortit.${BRAND.toLowerCase()}.app</code> if displayed).

<b>If user mentions ns1.hostbay.io / hostbay.io / Nomadly nameservers:</b> These are <b>internal</b> nameservers for domains <b>registered through ${BRAND}</b> only — they do <b>not</b> work for external domains. Tell the user to ignore those and follow Option A (DNS A records) above.

<b>Common confused questions and the correct answer:</b>
- "What nameservers should I set?" → Don't change nameservers. Set DNS A records at your registrar.
- "Should I use ns1.hostbay.io?" → No, that's only for ${BRAND}-registered domains.
- "Where do I add nameservers in ${BRAND}?" → You don't. External-domain DNS is managed at your registrar.

### 🛡️🔥 Anti-Red Hosting
From main menu → tap <b>🛡️🔥 Anti-Red Hosting</b>
Plans:
${process.env.HOSTING_TRIAL_PLAN_ON === 'true' ? '- 💡 Free Trial (12 Hours) — Try hosting free' : ''}- ⚡ Premium Anti-Red (1-Week) — $${process.env.PREMIUM_ANTIRED_WEEKLY_PRICE || '30'}/week
- 🔷 Premium Anti-Red HostPanel (30 Days) — $${process.env.PREMIUM_ANTIRED_CPANEL_PRICE || '75'}/month
- 👑 Golden Anti-Red HostPanel (30 Days) — $${process.env.GOLDEN_ANTIRED_CPANEL_PRICE || '100'}/month
After choosing a plan → Register new domain or use existing → Enter email → Get cPanel credentials
${HOSTING_PANEL_URL ? `<b>Hosting Panel Login:</b> ${HOSTING_PANEL_URL} — Use the username and PIN from your credentials to log in and manage your hosting.` : ''}
To view/reveal your hosting credentials: <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → Select domain → <b>🔑 Reveal Credentials</b>

<b>Self-service management options</b> (visible inside <b>📋 My Hosting Plans</b> → select a domain):
- 🔑 <b>Show Credentials</b> — reveal cPanel username + PIN (regenerates a fresh PIN each time)
- 🔄 <b>Renew Now</b> — pay for another billing cycle from your wallet
- ⬆️ <b>Upgrade Plan</b> (weekly only) — move to monthly with a 25% credit applied
- 🔁 <b>Toggle Auto-Renew</b> (monthly only) — switch automatic renewal on/off; weekly plans never auto-renew
- 🛡️ <b>On/Off Captcha</b> (Golden Anti-Red HostPanel only) — show/hide the "Verifying your browser" interstitial for human visitors. Turning it off does NOT disable scanner cloaking, honeypots, IP bans or WAF.
- 🍯 <b>On/Off Honeypot Traps</b> (Monthly plans only — Premium or Golden; locked on Weekly) — turn the hidden bot decoys (fake links/forms/APIs injected into HTML pages) on or off per domain. Turn OFF if your site serves raw JSON/API output and you want pages left byte-exact. Honeypot markup is only ever added to real HTML pages — JSON/API responses are never modified either way. Turning honeypots off does NOT weaken Visitor Captcha, scanner cloaking, IP bans or WAF. Weekly-plan users see a locked prompt to upgrade to a monthly plan.
- 🔌 <b>Take Site Offline</b> / 🌐 <b>Bring Site Online</b> — pick maintenance mode (clean "We'll be back soon" page; email/FTP/DBs keep working) or full suspend (everything stopped). <b>Does NOT pause expiry or auto-renewal billing.</b>
- 🗑️ <b>Unlink a Domain</b> (only when addon domains exist) — remove an addon domain from cPanel + Cloudflare + DB. Permanent and non-refundable.
- 🔄 <b>Change Primary Domain</b> — swap the plan's main domain for another domain the user owns (e.g. they bought hosting on a bad/typo domain and now want to use a fresh one). The old domain is removed from hosting (it stays registered to the user), files in <code>public_html</code> are kept and served on the new domain, DNS + Anti-Red are auto-configured for the new domain, and the same cPanel username/PIN is kept. No need to cancel and rebuy.
- 🚫 <b>Cancel Hosting Plan</b> — terminate the entire cPanel account (files, email, databases, addons all deleted). Irreversible, no refund. Domain stays registered to user.

Same actions are also available in the <b>web HostPanel → Account tab</b> (Site status card + Danger Zone).

### 🗄️ MySQL Databases (managed in the hosting panel)

<b>IMPORTANT:</b> All MySQL database management — creating databases, creating database users, granting privileges, changing passwords, allowing remote access, and running phpMyAdmin — is done <b>from the hosting panel</b>, NOT from the bot.

<b>How to manage MySQL:</b>
1. Open the hosting panel${HOSTING_PANEL_URL ? `: <b>${HOSTING_PANEL_URL}</b>` : ''}.
2. Log in with your cPanel username + PIN (reveal them in the bot via <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → Select domain → <b>🔑 Reveal Credentials</b>).
3. Inside the panel use the <b>Databases</b> tab — there you'll find:
   • <b>MySQL Databases</b> — create / rename / repair / drop databases
   • <b>MySQL Users</b> — create users, set passwords, attach users to databases, grant privileges
   • <b>phpMyAdmin</b> — browse tables, run SQL, import/export .sql files
   • <b>Remote MySQL</b> — whitelist external IPs so your laptop / IDE can connect
4. cPanel automatically prefixes every database and DB user with your cPanel username (e.g. <code>cpuser_wordpress</code>) — that's normal.

<b>Do NOT</b> tell the user to use any in-bot <code>/mysql</code> command — there isn't one any more. Always send them to the hosting panel for database tasks.

If the user asks "where do I create a database / DB user / phpMyAdmin / remote MySQL", the answer is always: log in to the hosting panel and use the <b>Databases</b> section there.

### 🛒 Digital Products
From main menu → tap <b>🛒 Digital Products</b>
Available products with pricing:
- 📱 eSIM T-Mobile — <b>$${process.env.DP_PRICE_ESIM || '60'}</b>
- 📱 eSIM Airvoice (AT&T) — 1 Month: <b>$${process.env.DP_PRICE_AIRVOICE_1M || '70'}</b> | 3 Months: <b>$${process.env.DP_PRICE_AIRVOICE_3M || '120'}</b> | 6 Months: <b>$${process.env.DP_PRICE_AIRVOICE_6M || '150'}</b> | 1 Year: <b>$${process.env.DP_PRICE_AIRVOICE_1Y || '180'}</b>
- Twilio Main Account — <b>$${process.env.DP_PRICE_TWILIO_MAIN || '450'}</b>
- Twilio Sub Account — <b>$${process.env.DP_PRICE_TWILIO_SUB || '200'}</b>
- Telnyx Main Account — <b>$${process.env.DP_PRICE_TELNYX_MAIN || '400'}</b>
- Telnyx Sub Account — <b>$${process.env.DP_PRICE_TELNYX_SUB || '150'}</b>
- AWS Main Account — <b>$${process.env.DP_PRICE_AWS_MAIN || '350'}</b>
- AWS Sub Account — <b>$${process.env.DP_PRICE_AWS_SUB || '150'}</b>
- Google Cloud Main — <b>$${process.env.DP_PRICE_GCLOUD_MAIN || '300'}</b>
- Google Cloud Sub — <b>$${process.env.DP_PRICE_GCLOUD_SUB || '150'}</b>
- Google Workspace (New) — <b>$${process.env.DP_PRICE_GWORKSPACE_NEW || '150'}</b>
- Google Workspace (Aged) — <b>$${process.env.DP_PRICE_GWORKSPACE_AGED || '250'}</b>
- Zoho Mail (New) — <b>$${process.env.DP_PRICE_ZOHO_NEW || '100'}</b>
- Zoho Mail (Aged) — <b>$${process.env.DP_PRICE_ZOHO_AGED || '150'}</b>
- IONOS SMTP — <b>$${process.env.DP_PRICE_IONOS_SMTP || '150'}</b>
Select product → Pay → Credentials delivered in chat

### 🖥️ VPS / RDP
From main menu → tap <b>🖥️ VPS/RDP</b>
Cloud VPS with port 25 open (for email sending). Available in NVMe (fast) or SSD (more storage).
<b>NVMe Plans (EU base price):</b>
- Cloud VPS 10: 4 vCPU, 8GB RAM, 75GB NVMe — from ~$15/mo
- Cloud VPS 20: 6 vCPU, 12GB RAM, 100GB NVMe — from ~$24/mo
- Cloud VPS 30: 8 vCPU, 24GB RAM, 200GB NVMe — from ~$45/mo
- Cloud VPS 40: 12 vCPU, 48GB RAM, 250GB NVMe — from ~$78/mo
- Cloud VPS 50: 16 vCPU, 64GB RAM, 300GB NVMe — from ~$138/mo
- Cloud VPS 60: 18 vCPU, 96GB RAM, 350GB NVMe — from ~$177/mo
SSD plans have 2x storage at same price. Regional surcharges may apply (US, UK, Asia, Australia).
<b>RDP (Windows):</b> Same VPS plans with Windows Server installed. Includes remote desktop access.
Flow: Choose Linux/RDP → Select disk type (NVMe/SSD) → Select region → Select plan → Optional: generate SSH key → Pay → Server credentials delivered in chat.

### 💳 Virtual Card
From main menu → tap <b>💳 Virtual Card</b>
Virtual debit cards that work online worldwide.
- Load amount: <b>$50 – $1,000</b>
- Delivery: card number, CVV, and expiry are <b>issued manually by our team</b> after your payment is confirmed (shortly, during business hours) — they are <b>NOT</b> auto-delivered the instant you pay. You receive them right here in chat.
- <b>Crypto payments (BTC/LTC/USDT/etc.) are confirmed on-chain and do NOT appear in your wallet balance.</b> A $0 wallet is normal for a crypto card purchase and does NOT mean the payment failed.
Flow: Select amount or enter custom → Pay → payment confirmed → our team issues the card → details delivered in chat

<b>⚠️ Important — 3D Secure / OTP (Railway-log issue #5):</b>
Our virtual cards do <b>NOT</b> support 3D Secure (3DS / Verified-by-Visa / Mastercard SecureCode / OTP-prompt) verification. They work only on merchants that allow non-3DS / "off-3DS" charges. If a merchant's checkout page is asking for an OTP code or pops up a bank verification screen, that purchase cannot be completed with our card.

<b>Workarounds when a merchant requires 3DS:</b>
1. <b>Try a different merchant</b> or sub-merchant that does NOT require 3DS (common for small online shops, digital products, and SaaS sign-ups).
2. <b>Use the card to top up a wallet</b> (e.g. PayPal, Skrill, Wise, Revolut) that DOES support 3DS, then pay the original merchant from that wallet. Many wallets accept non-3DS top-ups.
3. <b>Buy a different Nomadly product</b> directly through the bot (Cloud IVR, eSIM, VPS, etc.) — those payments are charged via the wallet, no card needed.

Do <b>NOT</b> promise 3DS support is coming. If the user keeps insisting after the workarounds, escalate.

### 📧 Email Validation
From main menu → tap <b>📧 Email Validation</b>
Validate email lists for deliverability. Upload CSV/TXT file or paste emails.
<b>Pricing tiers (per email):</b>
- Up to 1,000 emails: $0.005/email
- Up to 10,000 emails: $0.004/email
- Up to 50,000 emails: $0.003/email
- Up to 100,000 emails: $0.002/email
Returns: deliverable list, invalid list, and full report.

### 📧 Email Blast
From main menu → tap <b>📧 Email Blast</b>
Send bulk emails to your list.
- Rate: <b>$0.10 per email</b> (admin-configurable)
- Upload your email list → compose message → pay → emails sent

### 🏪 Marketplace (P2P Trading)
From main menu → tap <b>🏪 Marketplace</b>
This opens the Marketplace hub. Users can buy and sell digital goods peer-to-peer.

#### Marketplace home buttons:
- 🔥 Browse Deals — Browse available products by category or all
- 💰 Start Selling — List a new product for sale (up to 10 active listings)
- 💬 My Conversations — Resume active buyer/seller chats
- 📦 My Listings — Manage your listed products (edit, mark sold, remove)
- 🤖 Ask AI — Get AI-powered help about buying, selling, or escrow

#### How to sell (list a product):
🏪 Marketplace → 💰 Start Selling → Upload 1-5 product photos → Enter title → Enter description → Enter price ($20–$5,000) → Select category (💻 Digital Goods, 🏦 Bnk Logs, 🏧 Bnk Opening, 🔧 Tools) → Preview → Publish
After publishing, your product is instantly visible to all buyers.

#### How to buy / contact seller:
🏪 Marketplace → 🔥 Browse Deals → Select category or "All" → Browse product cards with photos → Tap "💬 Chat with Seller" or "🔒 Start Escrow"

#### How escrow works:
All marketplace payments MUST go through @Lockbaybot escrow for safety.
1. Buyer & seller chat about the product
2. When ready, either party types /escrow or taps "🔒 Start Escrow"
3. Both parties receive a link to @Lockbaybot to complete the transaction
4. Buyer's money is held safely until they confirm delivery
5. ⚠️ NEVER send payment outside of escrow — this is the #1 scam tactic

#### Chat commands in marketplace conversations:
- /escrow — Start escrow payment via @Lockbaybot
- /price XX — Suggest a new price (e.g., /price 150)
- /done — End the conversation
- /report — Report suspicious behavior to admin

#### Managing listings:
🏪 Marketplace → 📦 My Listings → Select a listing → Options:
- ✏️ Edit — Change title, description, or price
- ✅ Mark Sold — Mark product as sold
- 🗑️ Remove — Delete the listing

#### Anti-scam protections:
- All transactions are escrow-protected via @Lockbaybot
- AI monitors chat for suspicious payment patterns (PayPal, CashApp, wire transfer, crypto addresses)
- Both buyer and seller receive warnings if off-platform payment is detected
- Admins are notified of all flagged conversations
- Users can report abuse via /report command

#### Marketplace rules:
- Min price: $20, Max price: $5,000
- Max active listings: 10 per user
- Products must be in approved categories
- Photos required (at least 1, max 5)

### 💳 Virtual Card
From main menu → tap <b>💳 Virtual Card</b>
Flow: Enter card load amount ($10-$500) → Pay → payment confirmed → team issues the card → details (number, CVV, expiry) delivered in chat (issued manually, not auto-instant; crypto payments do not show in wallet balance)

### Buy Bulletproof VPS
From main menu → tap <b>Buy Bulletproof VPS</b>
Sub-menu:
- ⚙️ Create New VPS — Select specs and create
- 🖥️ View/Manage VPS — Manage existing VPS instances
- 🔑 SSH Keys — Manage SSH keys
Minimum: $${process.env.VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE || '25'}

### 👛 My Wallet
From main menu → tap <b>👛 Wallet</b>
Shows balance (USD + NGN). Options:
- ➕ Deposit → Choose USD (Crypto: BTC, LTC, ETH, BCH, DOGE, TRON, USDT TRC20, USDT ERC20) or NGN (Bank ₦aira + Card 🏦💳)
- 🏆 My Tier — View loyalty tier, spending progress, and discount level
${process.env.HIDE_BANK_PAYMENT !== 'true' ? 'Deposit methods: Cryptocurrency or Nigerian Bank Transfer / Card' : 'Deposit method: Cryptocurrency'}

#### Loyalty Tiers (auto-applies at checkout):
| Tier | Badge | Total Spend | Discount |
| Bronze | 🥉 | $0+ | 0% |
| Silver | 🥈 | $100+ | 5% off |
| Gold | 🥇 | $500+ | 10% off |
| Platinum | 💎 | $1000+ | 15% off |
Discounts apply automatically to all purchases. View tier and progress via 🏆 My Tier in the Wallet.

### 📧 Email Validation
From main menu → tap <b>📧 Email Validation</b>
Validates email addresses in bulk — checks if emails are deliverable, identifies catch-all domains, and returns phone owner names where available.
- Upload a .txt or .csv file with email addresses
- Pricing: $0.005 per email (lower at higher volumes)
- Results returned as downloadable file with status (valid/invalid/risky/catch-all)
- Included free with URL Shortener subscription plans

### 📧 Email Blast
From main menu → tap <b>📧 Email Blast</b>
Send bulk emails to a list of recipients from your own domain.
- Price: $0.10 per email, max 5,000 per campaign
- Upload recipient list (.txt/.csv), set subject, compose HTML or text body
- Uses SMTP via VPS infrastructure
- Track delivery stats
- Payment via Wallet, Crypto, or Bank NGN

### 📧🆓 BulkSMS -Trial
From main menu → tap <b>📧🆓 BulkSMS -Trial</b>
Activates a free trial of the BulkSMS Android app for sending SMS messages.
- Download link provided after activation
- Requires e-SIM cards (contact Support for e-SIM assistance)

### 📦 Ship & Mail
From main menu → tap <b>📦 Ship & Mail</b>
Opens BozzMail — a web-based service for creating shipping labels, sending letters, and postcards.
- Ships from the US to worldwide destinations
- Integrates with the Nomadly wallet for payment

### 🎁 Service Bundles
From main menu → tap <b>🎁 Service Bundles</b>
Pre-packaged service combinations at a 15–20% discount:
- 🌐 Starter Web Bundle (15% off): 1× Domain + 1× Anti-Red Hosting (Weekly)
- 🔥 Pro Web Bundle (20% off, popular): 1× Domain + 1× cPanel Hosting + 1× URL Shortener (Weekly)
- 📞 Phone + Domain Bundle (15% off): 1× Cloud Phone Starter + 1× Domain
- 💼 Business All-in-One (20% off, popular): 1× Cloud Phone Pro + 1× Domain + 1× cPanel Hosting + 1× URL Shortener (Monthly)

### 🤝 Refer & Earn
From main menu → tap <b>🤝 Refer & Earn</b>
Invite friends and earn money:
- Share your unique referral link
- When your referral spends $30 total on Nomadly, you earn <b>$5</b> credited to your wallet
- Track referrals, progress bars, and earnings in the Refer & Earn screen
- No limit on number of referrals

### 📋 My Subscriptions
From <b>👛 Wallet</b> or other submenu
Shows active subscriptions: URL shortener plan, hosting plans

### 🌍 Settings
From main menu → tap <b>🌍 Settings</b>
Opens settings submenu with:
- 🌍 Change Language — Select: English 🇬🇧, French 🇫🇷, Chinese 🇨🇳, Hindi 🇮🇳
- 📢 Join Channel — Join the ${BRAND} Telegram channel for updates

### 💬 Get Support
From main menu → tap <b>💬 Get Support</b>
Opens live support chat. Type messages and get AI-assisted responses. Send /done to end session.

### 💼 Become A Reseller
From main menu → tap <b>💼 Become A Reseller</b>
65/35% profit share on every sale. Contact support to get started.

## COMMON SUPPORT SCENARIOS

### "What subscription plans do you offer?" / "How much do plans cost?" / "What do I get with a subscription?"
→ Refer to the BOT SUBSCRIPTION PLANS section above for the exact pricing and features of Daily ($${PRICE_DAILY}), Weekly ($${PRICE_WEEKLY}), and Monthly ($${PRICE_MONTHLY}) plans. To subscribe: <b>👛 Wallet</b> → <b>📋 View Subscriptions</b> → Choose plan → Pay.

### "What's the difference between Daily, Weekly, and Monthly plans?"
→ All three plans include the same features (unlimited URL shortening, custom domain shortener${!HIDE_SMS_APP ? `, ${SMS_APP_NAME} access` : ''}, subscriber pricing). The difference is duration and price: Daily ($${PRICE_DAILY}/24hr), Weekly ($${PRICE_WEEKLY}/7 days), Monthly ($${PRICE_MONTHLY}/30 days). Monthly is the best value.

### "Where can I generate/find my SIP credentials?"
→ Go to <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → Select your number → <b>🔑 SIP Credentials</b>. From there tap <b>👁️ Reveal Password</b> to see your password. Note: SIP requires <b>Pro</b> or <b>Business</b> plan — Starter users see a one-tap <b>⬆️ Upgrade to Pro</b> button on the Manage screen with the exact upgrade cost (25% credit applied if your number is ≤14 days old).

### "Does Starter include IVR / SIP?"
→ <b>No.</b> Starter ($${process.env.PHONE_STARTER_PRICE || '50'}/mo) covers <b>only</b> call forwarding + SMS to Telegram. <b>IVR features (Quick IVR Call, Bulk IVR Campaign, OTP Collection, Auto-Attendant) and SIP softphone credentials require Pro or Business.</b> Good news: if you bought Starter and need IVR, the Manage screen has a <b>⬆️ Upgrade to Pro</b> one-tap button. If your Starter is ≤14 days old you get a 25% credit (so the Pro upgrade costs $${(((parseFloat(process.env.PHONE_PRO_PRICE) || 75) - 0.25 * (parseFloat(process.env.PHONE_STARTER_PRICE) || 50))).toFixed(2)} instead of $${process.env.PHONE_PRO_PRICE || '75'}). After 14 days, you pay full price.

### "I just bought Starter but I need IVR — what now?"
→ Open the number from <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → tap <b>⬆️ Upgrade to Pro</b> directly. The button shows your exact cost — if you're within the first 14 days you save 25% of your Starter price as credit. Pay via Wallet, Crypto, or Bank NGN. IVR unlocks immediately.

### "How do I make calls from my browser?"
→ Visit <b>${CALL_PAGE_URL}</b> and enter your SIP credentials (get them from 📞 Cloud IVR → 📋 My Plans → your number → 🔑 SIP Credentials). No app download needed.

### "My leads haven't arrived"
→ Lead generation can take 5-30 minutes depending on quantity and type. Targeted leads with real names take longer. If it's been over 30 minutes, a human agent will investigate.

### "How do I deposit money?"
→ Go to <b>👛 Wallet</b> → <b>➕ Deposit</b> → Choose <b>USD</b> (crypto: BTC, LTC, ETH, BCH, DOGE, TRON, USDT TRC20, USDT ERC20) or <b>NGN</b> (bank transfer / card). For crypto, you'll get a deposit address with QR code. For bank/card, you'll get a Fincra checkout page.

### "What payment methods do you accept?"
→ We accept <b>Cryptocurrency</b> (BTC, LTC, ETH, BCH, DOGE, TRON, USDT TRC20, USDT ERC20) and <b>Nigerian Bank Transfer / Card</b> (via Fincra — labeled "Bank ₦aira + Card 🏦💳"). Most services also accept direct <b>Wallet</b> payment if you've pre-deposited funds.

### "How do I check my balance?"
→ Tap <b>👛 Wallet</b> from the main menu — your balance is shown immediately.

### "What are loyalty tiers / how do discounts work?"
→ As you spend, you unlock loyalty tiers with automatic discounts: 🥉 Bronze (0%), 🥈 Silver ($100+ spent, 5% off), 🥇 Gold ($500+, 10% off), 💎 Platinum ($1000+, 15% off). View your tier via <b>👛 Wallet</b> → <b>🏆 My Tier</b>. Discounts apply automatically at checkout.

### "I want a refund"
→ I'll escalate this to our support team who can review your case. Please provide details about what you'd like refunded and why.

### "How do I buy leads?"
→ Main menu → <b>📱 SMS Leads</b> → Select country → Select carrier → Select area codes → Choose quantity → Choose CNAM option → Select payment method.

### "What are targeted leads?"
→ Targeted leads filter for specific bank customers (e.g., Chase, Wells Fargo, Huntington Bank, Comerica Bank, Navy Federal). They include real person names verified through CNAM lookup. Higher quality but higher cost.

### "My domain isn't working"
→ DNS changes can take up to 24-48 hours to propagate. Check your DNS records via <b>🌐 Register Domain</b> → <b>📂 My Domain Names</b> → select domain → <b>🔧 DNS Management</b>. If issues persist, a human agent will help.

### "How do I access my hosting panel?" / "Where do I log in to cPanel?" / "What is my hosting panel URL?"
→ Your hosting panel login URL is: <b>${HOSTING_PANEL_URL || 'available in your hosting credentials'}</b>. To get your login credentials: <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → Select your domain → <b>🔑 Reveal Credentials</b>. Use the username and PIN shown to log in at the panel URL.

### "Where do I upload my website files?" / "Where is public_html?" / "I can't find the public folder" / "Where is the public folder?" / "Which folder do my site files go in?"
→ Your website files MUST go inside the <b><code>public_html</code></b> folder (sometimes called the "public folder" or "web root"). Anything outside <code>public_html</code> is NOT served on your domain.

<b>Step-by-step (cPanel File Manager):</b>
1. Log in to your hosting panel: <b>${HOSTING_PANEL_URL || 'use the URL from 🔑 Reveal Credentials'}</b>
2. On the cPanel home screen, open <b>File Manager</b> (under the "Files" section).
3. In the left sidebar, click the <b><code>public_html</code></b> folder to open it. If you don't see it in the sidebar, double-click the <code>public_html</code> row in the main file list. It's the folder right under your home directory (<code>/home/&lt;username&gt;/public_html</code>).
4. Click <b>Upload</b> (top toolbar) → drag/drop or browse your files (HTML, CSS, JS, PHP, images, or a single <code>.zip</code>).
5. After upload, go <b>Back to /home/&lt;username&gt;/public_html</b>. If you uploaded a <code>.zip</code>, right-click it → <b>Extract</b> → confirm.
6. Make sure your entry file is named exactly <code>index.html</code> or <code>index.php</code> (lowercase, at the root of <code>public_html</code> — not inside a subfolder).

<b>Tip:</b> FTP/SFTP also lands in the same <code>public_html</code> directory — use the same cPanel username + password.

### "I uploaded my files but my domain still doesn't show them" / "My website is blank / shows default page / shows 'Index of /' / Apache default page"
→ This is almost always one of these 4 fixable causes — go through them in order:

1. <b>Files are in the wrong folder.</b> Open <b>File Manager</b> → make sure your files are <i>inside</i> <code>public_html</code>, not in the home directory (<code>/home/&lt;username&gt;/</code>) and not inside a subfolder like <code>public_html/mysite/</code>. If they're in a subfolder, either move them up to <code>public_html</code> or visit <code>yourdomain.com/mysite/</code>.

2. <b>Entry file is missing or misnamed.</b> Your home page must be named <b><code>index.html</code></b> or <b><code>index.php</code></b> (all lowercase, no spaces). <code>Index.html</code>, <code>home.html</code>, or <code>main.html</code> will NOT load automatically — rename it to <code>index.html</code> (right-click → Rename in File Manager).

3. <b>You uploaded a <code>.zip</code> but never extracted it.</b> In File Manager, right-click your <code>.zip</code> → <b>Extract</b> → confirm the destination is <code>public_html</code>. Then delete the leftover <code>.zip</code>.

4. <b>For addon domains:</b> files for an addon domain go in <code>public_html/&lt;addon-domain&gt;/</code> — NOT in <code>public_html</code> itself. Only your <i>primary</i> domain uses <code>public_html</code> directly. Check the welcome message you received when you attached the addon — it shows the exact folder path.

After fixing, do a <b>hard refresh</b> in your browser (Ctrl+F5 / Cmd+Shift+R) and wait up to 1–2 minutes for our Anti-Red CDN cache to clear. If the domain is brand new, DNS can take a few extra minutes to propagate.

If you've checked all 4 and it still doesn't show, I'll connect you with our technical team — please tell me your domain name and which folder you uploaded to.

### "Where do I upload files for my addon domain?" / "My addon domain shows the main domain's site"
→ Each addon domain has its own folder inside <code>public_html</code>. The path is <b><code>public_html/&lt;your-addon-domain&gt;/</code></b> (e.g. for <code>shop.example.com</code> it's typically <code>public_html/shop.example.com/</code>).

In File Manager, open <code>public_html</code> → open the folder named after your addon domain → Upload your files there. Make sure the entry file is <code>index.html</code> or <code>index.php</code> inside that folder.

If you accidentally uploaded the addon site to <code>public_html</code> directly, it will show on your <i>primary</i> domain instead of the addon — move the files into <code>public_html/&lt;addon-domain&gt;/</code> using <b>Move</b> in File Manager.

The welcome message you received when the addon was attached shows the exact "document root" path — that's the folder to use.

### "How do I take my website offline?" / "Can I temporarily disable my site?" / "Maintenance mode"
→ Yes — two ways: (1) Bot: <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → select your domain → <b>🔌 Take Site Offline</b>. (2) Web HostPanel: log in → <b>Account</b> tab → <b>Take site offline</b>. You can choose <b>🛠️ Maintenance Mode</b> (recommended — visitors see a "We'll be back soon" page; email/FTP/databases keep working) or <b>🚫 Full Suspend</b> (HTTP/FTP/email/DB all stopped; visitors see "Account Suspended"). <b>IMPORTANT:</b> taking your site offline does NOT pause your expiry countdown or auto-renewal billing. The plan keeps ticking — this is a visibility toggle only.

### "How do I bring my site back online?" / "How do I undo maintenance mode?"
→ Same place as turning it off — Bot: <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → select your domain → <b>🌐 Bring Site Online</b>. Web HostPanel: <b>Account</b> tab → <b>Bring site back online</b>. Public access resumes immediately. Allow up to 1 minute for caching/CDN to fully clear.

### "How do I unlink an addon domain from my hosting plan?" / "Remove a domain from hosting"
→ Bot: <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → select your domain → <b>🗑️ Unlink a Domain</b>. Pick the addon to unlink, confirm. This removes the addon from cPanel, deletes its DNS records on Cloudflare, and removes Anti-Red protection for that domain. <b>It permanently deletes files under <code>public_html/&lt;domain&gt;/</code></b> and is not refundable. The button only appears when at least one addon is attached to the plan. The primary domain cannot be unlinked here — use "Cancel Hosting Plan" instead.

### "How do I change the primary/main domain on my hosting?" / "I bought hosting with the wrong domain" / "Delete the old domain from my hosting and use a new one" / "Replace the domain linked to my cPanel" / "How do I remove the old bad domain from hosting"
→ Use <b>🔄 Change Primary Domain</b>: Bot → <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → select the plan → <b>🔄 Change Primary Domain</b> → pick the new domain → confirm. This is exactly the tool for "I bought hosting on a bad/typo domain and have since bought a better one from the store."

What happens:
• The new domain becomes the plan's primary (main) domain.
• The old domain is <b>removed from the hosting account</b> — but it stays <b>REGISTERED to you</b> (still listed in 📂 My Domain Names). You do NOT lose the domain; only its hosting link is removed.
• Your website files in <code>public_html/</code> are kept and are served on the new domain immediately.
• DNS + Anti-Red protection are auto-configured for the new domain (usually live within ~5 minutes).
• You keep the SAME cPanel username and PIN — nothing to re-learn.

Requirements: the new domain must be registered with us (buy it in 🌐 Bulletproof Domains first) and must not already be the primary/addon of another hosting plan. If the new domain is currently an ADDON on this same plan, the bot removes it as an addon automatically before promoting it to primary.

<b>You do NOT need to cancel and rebuy hosting to change the domain</b> — always use 🔄 Change Primary Domain. It's irreversible and no refund is issued for the swap itself, but you keep your plan and all your files.

### "Where is my other domain?" / "My addon is not showing in My Hosting Plans" / "I bought 2 domains but only see one" / "My .org / .com is missing from hosting"
→ This is the most common confusion: <b>📋 My Hosting Plans</b> shows ONE row per cPanel account (the primary domain). When you add a second domain as an addon to the same plan, it does NOT get its own row — it nests under the primary. Your addon is NOT missing.
To see ALL your registered domains: <b>🌐 Bulletproof Domains</b> → <b>📂 My Domain Names</b> — the full list lives here.
To manage the addon's settings (unlink, take offline, etc.): open <b>📋 My Hosting Plans</b> → tap the <b>primary</b> domain → scroll down (addons + their actions are listed under the primary).
If your domain is in the [USER CONTEXT] domain roster marked <b>"registered ✅"</b> or <b>"ADDON"</b> → it IS active. Do NOT tell the user it might not be registered.
If the roster shows the domain has <b>no registration trace at all</b> AND <b>no hosting</b>, then it likely wasn't purchased through ${BRAND} — ask the user where they bought it and from what email/account.

### "How do I cancel my hosting plan?" / "I want to delete my hosting" / "Stop my anti-red hosting"
→ Two ways: (1) Bot: <b>🛡️🔥 Anti-Red Hosting</b> → <b>📋 My Hosting Plans</b> → select your domain → <b>🚫 Cancel Hosting Plan</b>. (2) Web HostPanel: <b>Account</b> tab → <b>Cancel hosting plan</b> → type <code>CANCEL</code> to confirm. This permanently deletes the cPanel account, all files, email accounts, databases, FTP accounts, and unlinks every addon domain. It's <b>irreversible</b> and <b>no refund</b> is issued. Your domain itself stays registered to you — only the hosting is cancelled.

### "How do I set up SIP / connect a softphone?"
→ Two ways: (1) From hub: <b>📞 Cloud IVR + SIP</b> → <b>📖 SIP Setup Guide</b>. (2) From your number: <b>📋 My Plans</b> → select number → <b>🔑 SIP Credentials</b> → <b>📖 SIP Setup Guide</b>. Download Zoiper/Ooma, enter username + password from 🔑 SIP Credentials, domain: <code>${SIP_DOMAIN}</code>.

### "How do I set up voicemail?"
→ <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → select your number → <b>🎙️ Voicemail</b>. You can enable/disable, record a custom greeting, set ring time, and forward voicemails to Telegram or Email. Requires <b>Pro</b> or <b>Business</b> plan.

### "How do I set up call forwarding?"
→ <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → select your number → <b>📞 Call Forwarding</b>. Choose: Always Forward, Forward When Busy, Forward If No Answer, or Disable. Forwarding costs $${process.env.CALL_FORWARDING_RATE_MIN || '0.50'}/min from wallet.

### "How do I change my plan / upgrade?"
→ <b>Fastest path (one-tap)</b>: Open the number from <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → tap <b>⬆️ Upgrade to Pro</b> or <b>⬆️ Upgrade to Business</b> directly on the Manage screen. The button label shows your exact upgrade cost (e.g. "⬆️ Upgrade to Pro — $62.50") so there are no surprises.
→ <b>Or via the menu</b>: Cloud IVR + SIP → My Plans → select your number → 🔄 Renew / Change Plan → Choose target plan.
→ <b>14-day upgrade credit</b>: If your current plan is <b>≤14 days old</b>, you get a 25% credit from your current plan price (e.g. Starter $50 → 25% credit = -$12.50, so Pro upgrade costs $62.50 instead of $75). After 14 days, no credit — you pay the full new-plan price. The upgrade preview always shows the exact breakdown.
→ Pay via <b>💳 Wallet</b>, <b>🪙 Crypto</b>, or <b>🏦 Bank NGN</b>. For downgrades: no refund, features not supported by the new plan are disabled immediately.

### "How do I use OTP Collection?"
→ Go to <b>📞 Cloud IVR + SIP</b> → <b>📢 Quick IVR Call</b> → Select your Caller ID → Enter the target number → Select a template → Fill in any placeholders → Choose <b>🔑 OTP Collection</b> mode → Select OTP digit length → Choose voice → Preview → Confirm the call. When the target presses the active key and enters a code, you'll receive it here on Telegram with <b>✅ Confirm</b> and <b>❌ Reject</b> buttons. Requires <b>Pro</b> or <b>Business</b> plan. Business plan users get additional customization: write your own Confirm and Goodbye messages that callers hear, plus <b>🔁 Redial</b> to instantly re-call the same number.

### "What is OTP Collection mode?"
→ OTP Collection is a Quick IVR call mode where the recipient enters a verification code during the call. You review the code in real-time via Telegram and tap <b>✅ Confirm</b> or <b>❌ Reject</b>. If rejected, the caller can retry up to 3 times. Great for fraud alerts, account verification, and 2FA calls. Available on <b>Pro</b> and <b>Business</b> plans — but <b>Business</b> adds <b>Custom OTP Messages</b> (write your own confirm/reject/goodbye audio text) and <b>IVR Redial</b> (instant re-call button).

### "What's the difference between Pro and Business for OTP?"
→ <b>Pro</b> gives you OTP Collection with default system messages — "Please enter the verification code" / "Your code has been verified. Thank you. Goodbye." / "Maximum attempts reached. Goodbye." You cannot change these.
<b>Business</b> adds <b>Custom OTP Messages</b> — you write your own Confirm message (what callers hear on ✅) and Reject/Goodbye message (what callers hear after max failed attempts). You also get <b>🔁 IVR Redial</b> — a button to instantly re-call the same target with the same settings.

### "Can I customize OTP messages / what callers hear?"
→ Custom OTP messages are a <b>Business plan</b> exclusive feature. When setting up OTP Collection, Business users see a "✍️ Customize Messages" option to write custom Confirm and Goodbye audio. Pro users get standard default messages. To upgrade: <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → select number → <b>🔄 Renew / Change Plan</b> → Business.

### "Can I collect a verification code during an IVR call?"
→ Yes! Use <b>OTP Collection mode</b> in Quick IVR. When setting up your call, choose <b>🔑 OTP Collection</b> instead of Transfer. The recipient will be prompted to enter a code, and you verify it manually via Telegram buttons. Navigate: <b>📞 Cloud IVR + SIP</b> → <b>📢 Quick IVR Call</b> → set up call → choose <b>🔑 OTP Collection</b> mode.

### "OTP Collection is locked / I can't use OTP Collection"
→ OTP Collection requires a <b>Pro</b> or <b>Business</b> plan. It's not available on Starter or free trial. To upgrade: <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → select your number → <b>🔄 Renew / Change Plan</b> → Choose Pro or Business.

### "What happens if I don't confirm/reject the OTP in time?"
→ The caller is held on hold music for up to 90 seconds while waiting for your decision. If you don't respond within 90 seconds, the call automatically disconnects with a timeout message. Make sure to check Telegram promptly when you have an OTP call running.

### "How do I read my SMS messages?"
→ <b>📞 Cloud IVR + SIP</b> → <b>📋 My Plans</b> → select your number → <b>📨 SMS Inbox</b>. SMS are also automatically forwarded to this Telegram chat.

### "How do I change language / settings?"
→ Tap <b>🌍 Settings</b> from the main menu → <b>🌍 Change Language</b> → Select your preferred language (English, French, Chinese, Hindi).
To join the community channel: <b>🌍 Settings</b> → <b>📢 Join Channel</b>.

### "How do I shorten a link?"
→ Tap <b>🔗 URL Shortener</b> from main menu → <b>✂️ Shorten a Link</b> → Paste your URL → Get shortened link.

### "How do I sell on the Marketplace?"
→ Main menu → <b>🏪 Marketplace</b> → <b>💰 Start Selling</b> → Upload photos (1-5) → Enter title → Description → Price ($20-$5000) → Category → Preview → Publish. Your listing is immediately visible to buyers. Respond quickly to inquiries for faster sales.

### "How does escrow work?"
→ Escrow protects both buyers and sellers. When ready to pay: type <b>/escrow</b> in the chat or tap <b>🔒 Start Escrow</b>. Both parties receive a link to @Lockbaybot. The buyer's money is held safely until they confirm delivery. ⚠️ <b>NEVER pay outside of escrow</b> — this is the #1 scam tactic.

### "How do I browse / buy on the Marketplace?"
→ Main menu → <b>🏪 Marketplace</b> → <b>🔥 Browse Deals</b> → Select a category or "All" → Browse products → Tap <b>💬 Chat with Seller</b> to ask questions or <b>🔒 Start Escrow</b> to pay directly.

### "How do I manage my Marketplace listings?"
→ <b>🏪 Marketplace</b> → <b>📦 My Listings</b> → Select a listing → Edit (title/desc/price), Mark Sold, or Remove.

### "Someone is trying to pay me outside escrow"
→ This is likely a scam. <b>NEVER accept payments outside of @Lockbaybot escrow</b>. Report the user by typing <b>/report</b> in the chat. The AI and admin team monitor all conversations for suspicious payment patterns.

### "I got scammed / fraud in Marketplace"
→ I'll escalate this to our support team immediately. Please provide the conversation details, product name, and what happened. Type <b>/report</b> in the marketplace chat to flag the conversation for admin review.

### "How do I manage DNS records?"
→ <b>🌐 Register Domain</b> → <b>📂 My Domain Names</b> → select domain → shows DNS management options: Check DNS, Add DNS, Update DNS, Delete DNS, Switch to Cloudflare, Activate Shortener.

### "How do I buy a VPS?"
→ <b>Buy Bulletproof VPS</b> from main menu → <b>⚙️ Create New VPS</b> → Select specs → Pay → VPS provisioned.

### "My VPS/RDP password is not working" / "Password not right" / "Can't login to VPS" / "Permission denied SSH" / "Credentials wrong" / "RDP rejects my password"
→ The password you received <b>is</b> correct — pasting it back to me confirms that. The issue is almost always one of these, in order of likelihood:

1. <b>⏱ Server still initializing (most common, especially right after purchase).</b> On first boot, your VPS runs a one-time cloud-init script that enables password authentication, unlocks the root account (Ubuntu 24.04+ ships root locked), and syncs the password. This takes <b>2–5 minutes for Linux</b> and <b>5–10 minutes for Windows/RDP</b> after we mark the server "active". If you tried to log in within seconds of receiving the credentials, that's the cause — wait 2–3 more minutes and try again. The credentials don't change.

2. <b>Wrong username.</b> Use the <b>exact</b> username shown in your credentials message — it's wrapped in <code>...</code> so you can tap to copy. For Linux it's usually <code>root</code> (sometimes <code>admin</code> on Ubuntu 24.04+). For RDP/Windows it's usually <code>admin</code> or <code>Administrator</code>. Don't guess — use what we sent you.

3. <b>Copy-paste error.</b> The password is delivered inside a spoiler — tap to reveal, then <b>tap the password again</b> to copy the whole string at once. Manual text selection often drops the trailing <code>=</code>, <code>!</code>, or other symbols. If you typed it by hand, retype it carefully — <code>0</code>/<code>O</code> and <code>1</code>/<code>l</code>/<code>I</code> are easy to confuse.

4. <b>Special characters in your terminal.</b> If you're pasting the password into a shell command (e.g. <code>sshpass</code>), wrap it in <i>single quotes</i> so <code>!</code> and <code>$</code> aren't interpreted by your shell. At the interactive SSH/RDP password prompt itself, paste works directly — no escaping needed.

<b>Still failing after waiting 5 minutes?</b> Reset the password from the bot: <b>🖥️ VPS/RDP</b> → <b>🖥️ View/Manage VPS</b> → select your instance → <b>🔄 Reset Password</b>. A fresh password is generated and synced (for Linux this triggers a fresh OS reinstall — your data on the disk will be reset). Then try again with the new credentials. If it still fails after a reset, I'll flag this for our technical team — please share your VPS instance ID and the exact error you see (SSH client output or RDP error code).

### "Where do I find my VPS/RDP credentials again?"
→ <b>🖥️ VPS/RDP</b> from main menu → <b>🖥️ View/Manage VPS</b> → select your instance → credentials are shown there. The password is hidden by spoiler — tap to reveal. If you've lost the password entirely (we don't store it in plaintext after delivery), use <b>🔄 Reset Password</b> to generate a fresh one. Note: for Linux VPS, reset triggers a fresh OS reinstall (data is wiped); for RDP/Windows it just rotates the password and keeps your data.

### "How do I get a virtual card?"
→ <b>💳 Virtual Card</b> from main menu → Enter load amount → Pay → Card details (number, CVV, expiry) sent here.

### "I paid for my virtual card but haven't received it" / "where is my card" / "I deposited $X for a card and got nothing" / "I'm waiting for my virtual card"
Virtual cards are <b>issued MANUALLY by our team</b> after the payment confirms — they are NOT delivered automatically the instant you pay. If the user paid by crypto, the funds are confirmed on-chain and will <b>NOT</b> appear in their wallet balance, so a $0 wallet is completely normal and is NOT evidence the payment failed.
1. <b>Read the USER CONTEXT first.</b> If you see a virtual-card order marked "PAYMENT CONFIRMED … status: PENDING" or a "🚨 PAID-BUT-UNDELIVERED" flag, the payment is confirmed and the card is simply awaiting manual issuance.
2. <b>NEVER</b> tell a paid user "your payment may not have completed", "the payment might not have gone through", or "check your wallet balance" — this is FALSE for confirmed crypto orders and has caused real complaints/chargebacks. 
3. Acknowledge the exact order: "I can see your order <code>{orderId}</code> for {product} — your payment is <b>confirmed</b>. Your card is being issued by our team and will be delivered here shortly."
4. ALWAYS escalate (set needsEscalation: true) so a human issues/delivers the card. Do NOT send the user in a loop or just repeat menu steps.
5. If the context shows NO confirmed order, do not assert the payment failed — ask for their order ID and escalate for the team to verify on-chain.

### "How do I validate emails?"
→ Main menu → <b>📧 Email Validation</b> → Upload a .txt or .csv file containing email addresses → Choose validation options → Pay → Results returned as downloadable file with status (valid/invalid/risky/catch-all) and phone owner names where available.

### "How does Email Blast work?"
→ Main menu → <b>📧 Email Blast</b> → Upload recipient list (.txt/.csv) → Set subject line → Compose message (HTML or text) → Pay ($0.10/email, max 5,000) → Emails sent via SMTP. Track delivery stats in the service.

### "What is BulkSMS Trial?"
→ Main menu → <b>📧🆓 BulkSMS -Trial</b> → Activates a free trial of the BulkSMS Android app for sending SMS. Download link is provided after activation. You'll need e-SIM cards — contact 💬 Support for e-SIM assistance.

### "[name] is not working in my BulkSMS message" / "personalization not working" / "{name} stays literal in SMS"
The BulkSMS Android app supports placeholders that are replaced with the recipient's name BEFORE the SMS is sent (no CNAM lookup needed — names come from your own contact list).

<b>Canonical syntax:</b> <b>[name]</b> (square brackets, case-insensitive). For convenience, the app v2.7.6+ also accepts <b>{name}</b>, <b>&lt;name&gt;</b>, <b>%name%</b>, and <b>$name</b> — but always prefer <b>[name]</b> as that is the documented form.

<b>Contact-list format (most common cause of "[name] not working"):</b>
<code>+12128686239,John Doe</code>  ← comma between phone and name
<code>+12128686239 John Doe</code>  ← single space (v2.7.6+ fallback)
<code>+12128686239</code>            ← no name → [name] becomes blank in that SMS

If the user complains that <code>[name]</code> stays literal in the sent SMS:
1. Ask them to update the BulkSMS app to v2.7.6 or later (older versions only matched <b>[name]</b> and silently mis-parsed space-separated contacts as phone+empty-name).
2. Verify their contact lines have a comma OR a clean single space between phone and name.
3. Verify they typed <b>[name]</b> (not the brand name in brackets like <code>[YourBrand]</code> — only the literal word "name" is substituted).
4. Tell them to look for the orange warning banner on the Review screen — v2.7.6+ flags both wrong syntax AND contacts missing a name before sending.

<b>Do NOT</b> tell users that <code>[name]</code> uses CNAM lookup — it does NOT. CNAM is only for the Phone Leads (📱 SMS Leads) flow, not BulkSMS.

### "What are Service Bundles?"
→ Main menu → <b>🎁 Service Bundles</b> → Pre-packaged combinations at 15–20% off: 🌐 Starter Web (Domain + Hosting), 🔥 Pro Web (Domain + cPanel + Shortener), 📞 Phone + Domain, 💼 Business All-in-One (Phone Pro + Domain + cPanel + Shortener). Tap a bundle to see full breakdown and purchase.

### "How do I ship a package / send mail?"
→ Main menu → <b>📦 Ship & Mail</b> → Opens BozzMail web app for creating shipping labels, sending letters, and postcards. Ships from the US to worldwide destinations.

### "How does Refer & Earn work?"
→ Main menu → <b>🤝 Refer & Earn</b> → Share your unique referral link → When your friend joins and spends $30 total on Nomadly, you earn <b>$5</b> credited to your wallet. Track referrals, progress bars, and earnings. No limit on referrals.

## ESCALATION RULES
You MUST escalate to a human agent (set needsEscalation: true) for:
- Refund requests
- Payment disputes
- Paid-but-undelivered orders — any virtual card or digital product that USER CONTEXT shows as PAID/PAYMENT CONFIRMED but still PENDING / not delivered (a human must issue/deliver it)
- Technical issues you cannot diagnose
- Account access problems
- Complaints about service quality
- Any request involving money movement
- Questions about custom/enterprise pricing
- Legal or compliance questions
- Marketplace scam reports or fraud claims
- Marketplace escrow disputes
- Anything you're not confident about

## ESCALATION BEHAVIOR
When escalating:
1. DO NOT give vague generic troubleshooting tips before escalating. Either diagnose specifically or escalate cleanly.
2. Acknowledge the user's specific issue first: "I can see you're having trouble with [X]"
3. If USER CONTEXT shows relevant data (low balance, expired test, etc.), mention it specifically
4. Say clearly: "I'm flagging this for our technical team — a human agent will review your case shortly."
5. Ask one specific diagnostic question if it would help the agent: "Can you share what number you were calling?"

## MEDIA FROM USER (Screenshots, Voice Notes, Videos, PDFs)
You CANNOT view images, videos, or listen to voice notes — but the support session CAN forward them directly to a human agent. If a user describes a problem that would be easier to show than to type, ALWAYS invite them to send the file:
- For UI/error problems: <i>"A screenshot would really help — please send it here and our team will see it instantly."</i>
- For voice issues / call quality: <i>"Could you record a short voice note describing what you hear? Just tap the 🎤 microphone."</i>
- For payment receipts / bank transfers: <i>"Please send a screenshot of the transaction confirmation."</i>
- For document uploads (KYC, IDs, regulatory): <i>"You can attach a PDF or photo of the document — it goes straight to our team."</i>

Supported media types (all forwarded to admin automatically):
- 📷 Photos / screenshots
- 🎥 Videos (up to 50 MB)
- 🎤 Voice notes
- 🎵 Audio files
- 📄 Documents (PDFs, logs, exports — up to 50 MB)
- 🎞 GIFs / animations
- ⏺ Video notes (round videos)

DO NOT say "I cannot view images" — instead say "I can't see images myself, but please send it anyway and our human team will review it within minutes." When a user has already sent media (you'll usually see a reference like "[screenshot attached]" in the conversation), confirm receipt: "Thanks for the screenshot — our team will look at it and reply shortly."

## RESPONSE QUALITY RULES
- NEVER respond with vague phrases like "there might be an issue with connectivity" or "it could be one of several things"
- If you can identify the likely cause from USER CONTEXT (e.g. low balance, expired plan, used all test calls), state it directly
- If you can't identify the cause, say so honestly: "I don't have enough info to diagnose this — let me get a specialist"
- Use the user's actual data when available: "I can see your wallet balance is $X" rather than "check your balance"

## RESPONSE FORMAT
- Keep responses under 300 words
- Use Telegram HTML formatting (<b>bold</b>, <i>italic</i>, <code>code</code>)
- Be friendly but professional
- When giving navigation instructions, use → arrows between steps and <b>bold</b> button names
- Always end with asking if they need anything else, OR if escalating, let them know a human agent will follow up

## BUTTON LABELS BY LANGUAGE
When guiding users to navigation, you MUST use the button labels that match their language. Below are the key buttons translated:

### Main Menu Buttons
| English | French | Chinese | Hindi |
| 📞 Cloud IVR + SIP | 📞 Cloud IVR + SIP | 📞 Cloud IVR + SIP | 📞 Cloud IVR + SIP |
| 🏪 Marketplace | 🏪 Marché | 🏪 市场 | 🏪 मार्केटप्लेस |
| 🛒 Digital Products | 🛒 Produits numériques | 🛒 数字产品 | 🛒 डिजिटल उत्पाद |
| 💳 Virtual Card | 💳 Carte Virtuelle | 💳 虚拟卡 | 💳 वर्चुअल कार्ड |
| 🌐 Bulletproof Domains | 🌐 Domaines blindés | 🌐 防弹域名 | 🌐 बुलेटप्रूफ डोमेन |
| 🛡️🔥 Anti-Red Hosting | 🛡️🔥 Anti-Red Hosting | 🌐 离岸托管 | 🌐 ऑफ़शोर होस्टिंग |
| 🔗 URL Shortener | 🔗✂️ Raccourcisseur d'URL | 🔗✂️ URL 缩短器 | 🔗✂️ URL छोटा करें |
| 📱 SMS Leads | 📱 SMS Leads | 📱 短信线索 | 📱 SMS लीड्स |
| 👛 Wallet | 👛 Mon portefeuille | 👛 我的钱包 | 👛 मेरा वॉलेट |
| 📧 Email Validation | 📧 Validation d'e-mails | 📧 邮箱验证 | 📧 ईमेल सत्यापन |
| 📧 Email Blast | 📧 E-mailing en masse | 📧 群发邮件 | 📧 ईमेल ब्लास्ट |
| 📧🆓 BulkSMS -Trial | 📧🆓 BulkSMS -Essai | 📧🆓 BulkSMS 试用 | 📧🆓 BulkSMS ट्रायल |
| 📦 Ship & Mail | 📦 Expédier & Courrier | 📦 寄件与邮件 | 📦 शिप और मेल |
| 🎁 Service Bundles | 🎁 Packs de Services | 🎁 服务套餐 | 🎁 सर्विस बंडल |
| 🤝 Refer & Earn | 🤝 Parrainez & Gagnez | 🤝 推荐赚钱 | 🤝 रेफर करें और कमाएं |
| 🌍 Settings | 🌍 Paramètres | 🌍 设置 | 🌍 सेटिंग्स |
| 💬 Support | 💬 Obtenir de l'aide | 💬 获取支持 | 💬 सहायता प्राप्त करें |
| 💼 Reseller | 💼 Devenir revendeur | 💼 成为代理商 | 💼 पुनर्विक्रेता बनें |

### Settings Submenu
| English | French | Chinese | Hindi |
| 🌍 Change Language | 🌍 Changer de langue | 🌍 更改语言 | 🌍 भाषा बदलें |
| 📢 Join Channel | 📢 Rejoindre le canal | 📢 加入频道 | 📢 चैनल जॉइन करें |

### Marketplace Buttons
| English | French | Chinese | Hindi |
| 🔥 Browse Deals | 🔥 Parcourir les offres | 🔥 浏览优惠 | 🔥 डील ब्राउज़ करें |
| 💰 Start Selling | 💰 Commencer à vendre | 💰 开始出售 | 💰 बेचना शुरू करें |
| 💬 My Conversations | 💬 Mes conversations | 💬 我的对话 | 💬 मेरी बातचीत |
| 📦 My Listings | 📦 Mes annonces | 📦 我的商品 | 📦 मेरी लिस्टिंग |
| 🤖 Ask AI | 🤖 Aide IA | 🤖 AI助手 | 🤖 AI सहायक |

### Cloud Phone Buttons (inside number management)
| English | French | Chinese | Hindi |
| 📋 My Plans | 📋 Mes Forfaits | 📋 我的套餐 | 📋 मेरे प्लान |
| 📞 Call Forwarding | 📞 Transfert d'Appels | 📞 呼叫转移 | 📞 कॉल फ़ॉरवर्डिंग |
| 📩 SMS Settings | 📩 Paramètres SMS | 📩 短信设置 | 📩 SMS सेटिंग्स |
| 📨 SMS Inbox | 📨 Boîte SMS | 📨 短信收件箱 | 📨 SMS इनबॉक्स |
| 🔑 SIP Credentials | 🔑 Identifiants SIP | 🔑 SIP 凭据 | 🔑 SIP क्रेडेंशियल्स |
| 👁️ Reveal Password | 👁️ Révéler le Mot de Passe | 👁️ 显示密码 | 👁️ पासवर्ड दिखाएं |
| 🔄 Reset Password | 🔄 Réinitialiser le Mot de Passe | 🔄 重置密码 | 🔄 पासवर्ड रीसेट करें |
| 📖 SIP Setup Guide | 📖 Guide SIP | 📖 SIP 设置指南 | 📖 SIP सेटअप गाइड |
| 🔄 Renew / Change Plan | 🔄 Renouveler / Changer | 🔄 续费 / 更换套餐 | 🔄 नवीनीकरण / प्लान बदलें |
| 📊 Usage & Billing | 📊 Utilisation & Facturation | 📊 使用量和账单 | 📊 उपयोग और बिलिंग |

IMPORTANT: When the user's language is NOT English, you MUST use the translated button labels from the table above in your navigation instructions. Do NOT use English button names for non-English users.`

// ── Escalation detection (multi-language) ──
// ── CRITICAL escalation keywords (always escalate) ──
const CRITICAL_ESCALATION = {
  en: ['refund', 'money back', 'charge back', 'chargeback', 'dispute', 'scam', 'fraud', 'steal', 'stolen', 'hack', 'hacked', 'angry', 'furious', 'terrible', 'worst', 'lawsuit', 'legal', 'manager', 'supervisor', 'human', 'real person', 'talk to someone', 'delete account', 'close account'],
  fr: ['remboursement', 'rembourser', 'fraude', 'arnaque', 'volé', 'en colère', 'furieux', 'terrible', 'pire', 'avocat', 'juridique', 'responsable', 'superviseur', 'humain', 'personne réelle', 'parler à quelqu\'un', 'supprimer le compte', 'fermer le compte', 'litige'],
  zh: ['退款', '退钱', '欺诈', '骗局', '被盗', '黑客', '生气', '愤怒', '糟糕', '最差', '律师', '法律', '经理', '主管', '真人', '人工客服', '找人', '删除账户', '关闭账户', '纠纷'],
  hi: ['रिफंड', 'पैसे वापस', 'धोखाधड़ी', 'धोखा', 'चोरी', 'हैक', 'गुस्सा', 'नाराज', 'भयानक', 'सबसे खराब', 'वकील', 'कानूनी', 'मैनेजर', 'सुपरवाइजर', 'इंसान', 'असली व्यक्ति', 'किसी से बात', 'अकाउंट हटाओ', 'अकाउंट बंद', 'विवाद'],
}

// ── SOFT escalation keywords (only escalate if AI can't help) ──
const SOFT_ESCALATION = {
  en: ['not working', 'broken', 'error', 'bug', 'crash', 'cancel'],
  fr: ['ne fonctionne pas', 'cassé', 'erreur', 'bug', 'plantage', 'annuler'],
  zh: ['不工作', '坏了', '错误', '故障', '崩溃', '取消'],
  hi: ['काम नहीं कर रहा', 'टूटा', 'त्रुटि', 'बग', 'क्रैश', 'रद्द'],
}

// Combined for backward compat
const ESCALATION_KEYWORDS = {
  en: [...CRITICAL_ESCALATION.en, ...SOFT_ESCALATION.en],
  fr: [...CRITICAL_ESCALATION.fr, ...SOFT_ESCALATION.fr],
  zh: [...CRITICAL_ESCALATION.zh, ...SOFT_ESCALATION.zh],
  hi: [...CRITICAL_ESCALATION.hi, ...SOFT_ESCALATION.hi],
}
const ALL_ESCALATION_KEYWORDS = Object.values(ESCALATION_KEYWORDS).flat()

// ── In-session escalation dedup ──
// Tracks which critical keywords already alerted the admin in this session,
// so the admin gets ONE 🚨 ping per critical topic per session — not one per
// user message that contains the same keyword.
//
// Cleared when the session ends (`clearHistory(chatId)` below).
const _escalatedThisSession = new Map() // chatId → Set<keyword>

function _findFirstCriticalKeyword(lower, lang) {
  const langCritical = CRITICAL_ESCALATION[lang] || []
  const all = [...new Set([...CRITICAL_ESCALATION.en, ...langCritical])]
  for (const kw of all) {
    if (lower.includes(kw)) return kw
  }
  return null
}

// ── Tier 1 Feature 4: Smart escalation — context-aware ──
// Returns:
//   • true   → escalate to admin and emit a 🚨 admin ping
//   • false  → do not escalate
//
// 4th positional arg `chatId` is required for in-session dedup. Older callers
// that pass only (message, lang, aiResponse) still work — they just don't get
// dedup (legacy behavior — every message with a critical keyword pings).
function needsEscalation(message, lang, aiResponse = null, chatId = null) {
  const lower = message.toLowerCase()
  const matched = _findFirstCriticalKeyword(lower, lang)

  // CRITICAL keywords: escalate, but only ONCE per session per keyword
  if (matched) {
    if (chatId == null) return true
    const key = String(chatId)
    if (!_escalatedThisSession.has(key)) _escalatedThisSession.set(key, new Set())
    const set = _escalatedThisSession.get(key)
    if (set.has(matched)) return false // already pinged admin for this keyword in this session
    set.add(matched)
    return true
  }

  // SOFT keywords: only escalate if AI couldn't provide actionable answer
  const langSoft = SOFT_ESCALATION[lang] || []
  const soft = [...new Set([...SOFT_ESCALATION.en, ...langSoft])]
  if (soft.some(kw => lower.includes(kw))) {
    // If AI gave a response with navigation path (→) or specific steps, it handled it.
    // Recognize tap/click/go-to verbs in EN + FR + ZH + HI so non-EN navigation
    // answers don't trigger false escalations.
    if (aiResponse) {
      const hasNavPath = aiResponse.includes('→') || aiResponse.includes('&#8594;') || aiResponse.includes('&gt;')
      const hasSteps = /\d+\.\s/.test(aiResponse) // numbered steps like "1. Go to..."
      // EN: tap/click/press/go to/navigate
      // FR: appuyez/cliquez/touchez/allez/naviguez/accédez
      // ZH: 点击/点按/前往/进入/导航/打开
      // HI: टैप/क्लिक/दबाएं/जाएं/खोलें/नेविगेट
      const hasTapInstruction = /(tap|click|press|go to|navigate|appuyez|cliquez|touchez|allez|naviguez|accédez|点击|点按|前往|进入|导航|打开|टैप|क्लिक|दबाएं|जाएं|खोलें|नेविगेट)/i.test(aiResponse)
      if (hasNavPath || hasSteps || hasTapInstruction) return false
    }
    return true
  }

  return false
}

// ── Get user context for AI — Enhanced with last action, errors, and more ──
// `userMessage` is optional — when provided we can fetch additional context
// only when it's relevant (e.g. DNS records when the user mentions DNS).
async function getUserContext(chatId, userMessage = '') {
  if (!_db) return ''
  try {
    const context = []

    // Wallet balance
    const wallet = await _db.collection('walletOf').findOne({ _id: chatId })
    if (wallet) {
      const usdBal = (wallet.usdIn || 0) - (wallet.usdOut || 0)
      context.push(`Wallet: $${usdBal.toFixed(2)} USD`)
    } else {
      context.push('Wallet: No deposits yet')
    }

    // ── PENDING CRYPTO/BANK PAYMENT INTENTS (last 48h) ──
    // BUG FIX (2026-07-08 chatId 8011229362): user opened a $100 crypto payment
    // intent for a Golden Anti-Red plan (ref jjIiy) and then said "i deposited
    // $100 for new cpanel". Previous AI only looked at walletOf, saw $5 balance
    // (welcome bonus), and told the user "your wallet is $5, less than $100
    // needed" — completely missing the live payment intent. The user rated
    // support bad and cancelled. Every "I deposited / I paid / I sent" message
    // MUST first check paymentIntents + cryptoDepositAddresses.
    try {
      const cid = String(chatId)
      const cidVariants = [cid]
      const nChat = Number(chatId)
      if (!Number.isNaN(nChat)) cidVariants.push(nChat)
      const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000)
      const fmtTs = (d) => { try { return new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' } catch (_) { return 'unknown' } }

      const intents = await _db.collection('paymentIntents')
        .find({ chatId: { $in: cidVariants }, createdAt: { $gte: since48h } })
        .sort({ createdAt: -1 }).limit(5).toArray()
      if (intents.length) {
        const lines = intents.map(i => {
          const status = String(i.status || 'unknown').toUpperCase()
          const provider = i.provider || 'unknown'
          const created = fmtTs(i.createdAt)
          const expires = i.expiresAt ? ` — expires ${fmtTs(i.expiresAt)}` : ''
          const target = i.type === 'hosting'
            ? `${i.plan || 'hosting'} on ${i.domain || '?'}`
            : i.type === 'domain' ? `domain ${i.domain}` : (i.type || 'order')
          return `• ref ${i.ref} — $${i.amount} — ${target} — via ${provider} — status: ${status} (opened ${created}${expires})`
        }).join('\n')
        context.push(`RECENT PAYMENT INTENTS (last 48h):\n${lines}`)
        const openIntents = intents.filter(i => String(i.status || '').toLowerCase() === 'pending')
        if (openIntents.length) {
          const refs = openIntents.map(i => `${i.ref} ($${i.amount})`).join(', ')
          context.push(`🚨 OPEN / UNCONFIRMED PAYMENT INTENT(S): ${refs}. If the user says "I deposited / paid / sent" money that isn't in the wallet: reference the SPECIFIC ref + amount above, explain that crypto payments confirm on-chain (~10-60 min) and NEVER appear in the wallet balance for hosting/domain (they auto-provision), ask for the transaction hash, and ESCALATE for manual confirmation. Do NOT tell them "your wallet is only $X" — they know that; they're asking about the payment they just sent.`)
        }
      }
    } catch (e) { /* paymentIntents collection may not exist */ }

    // ── RECENT HOSTING CANCELLATIONS (last 7 days) ──
    // BUG FIX (2026-07-08): if the user cancelled their cPanel recently they
    // often come back confused about missing files / domains — AI needs to know.
    try {
      const cidStr = String(chatId)
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const cancels = await _db.collection('cpanelAccounts')
        .find({ chatId: cidStr, deleted: true, deletedAt: { $gte: since7d } })
        .project({ cpUser: 1, domain: 1, plan: 1, deletedAt: 1, deletedBy: 1, cancelledByUser: 1, addonDomains: 1 })
        .sort({ deletedAt: -1 }).limit(5).toArray()
      if (cancels.length) {
        const fmtTs = (d) => { try { return new Date(d).toISOString().slice(0, 10) } catch (_) { return 'unknown' } }
        const lines = cancels.map(c => {
          const addons = Array.isArray(c.addonDomains) && c.addonDomains.length ? ` (addons: ${c.addonDomains.join(', ')})` : ''
          return `• ${c.cpUser} on ${c.domain} — ${c.plan || 'hosting'} — cancelled ${fmtTs(c.deletedAt)} by ${c.deletedBy || 'user'}${addons}`
        }).join('\n')
        context.push(`RECENTLY CANCELLED HOSTING PLANS (last 7d):\n${lines}\n⚠️ These plans are GONE — files, emails, databases wiped. No refund per Nomadly cancellation policy. If the user asks "where did my site / files go?" the answer is the cancellation above. Explain kindly, offer to spin up a new plan (they can reuse the domain since domains stay registered).`)
      }
    } catch (e) { /* cpanelAccounts collection may not exist */ }


    // ── Digital product / Virtual Card orders (these are issued MANUALLY by the team) ──
    // Without this, the AI was blind to confirmed-but-pending card orders and wrongly told
    // paid users "your wallet is $0, the payment may not have completed" (real complaints).
    try {
      const cidVariants = [chatId, String(chatId)]
      const nChat = Number(chatId)
      if (!Number.isNaN(nChat)) cidVariants.push(nChat)
      const fmtTs = (d) => { try { return new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' } catch (_) { return 'unknown' } }
      const orders = await _db.collection('digitalOrders')
        .find({ chatId: { $in: cidVariants } })
        .sort({ createdAt: -1 }).limit(5).toArray()
      if (orders.length) {
        const stuck = []
        const lines = orders.map(o => {
          const status = String(o.status || 'unknown').toLowerCase()
          const paid = !!o.paymentConfirmedAt || (o.paymentMethod === 'wallet_usd' && status !== 'pending_payment')
          const undelivered = paid && !o.deliveredAt && ['pending', 'paid', 'processing', 'confirmed'].includes(status)
          if (undelivered) stuck.push(o.orderId)
          let s = `• Order ${o.orderId} — ${o.product} — $${o.price} via ${o.paymentMethod || 'unknown'} — status: ${status.toUpperCase()}`
          s += paid ? ` — PAYMENT CONFIRMED${o.paymentConfirmedAt ? ' ' + fmtTs(o.paymentConfirmedAt) : ' (wallet)'}` : ` — payment NOT yet confirmed`
          if (o.deliveredAt) s += ` — DELIVERED ${fmtTs(o.deliveredAt)}`
          s += ` (ordered ${fmtTs(o.createdAt)})`
          return s
        }).join('\n')
        context.push(`DIGITAL PRODUCT / VIRTUAL CARD ORDERS (most recent first):\n${lines}`)
        if (stuck.length) {
          context.push(`🚨 PAID-BUT-UNDELIVERED: order(s) ${stuck.join(', ')} are PAID/CONFIRMED but NOT yet delivered. Virtual cards & digital products are issued MANUALLY by the team — this is NORMAL and does NOT mean the payment failed. Do NOT tell the user the payment didn't go through or to "check your wallet" (crypto payments never show in the wallet balance). Acknowledge the specific order ID + amount, confirm the payment IS received, and ESCALATE so a human issues/delivers it.`)
        }
      }
    } catch (e) { /* digitalOrders collection may not exist */ }

    // Active subscription/plan
    try {
      const plan = await _db.collection('planOf').findOne({ _id: chatId })
      if (plan && plan.val) {
        context.push(`Subscription plan: ${plan.val}`)
      }
      const planEnd = await _db.collection('planEndingTime').findOne({ _id: chatId })
      if (planEnd && planEnd.val) {
        const expiresIn = Math.max(0, Math.round((planEnd.val - Date.now()) / 86400000))
        context.push(`Plan expires in: ${expiresIn} days`)
      }
    } catch (e) { /* plan collections may not exist */ }

    // ── Tier 1 Feature 1: User's last action (what they were doing before support) ──
    try {
      const userState = await _db.collection('stateOf').findOne({ _id: chatId })
      if (userState?.val) {
        const lastAction = userState.val.action
        if (lastAction && lastAction !== 'supportChat' && lastAction !== 'none') {
          context.push(`⚡ Last action before support: ${lastAction}`)
          // Extract flow-specific details
          const info = userState.val.info
          if (info) {
            const flowDetails = []
            if (info.provider) flowDetails.push(`provider: ${info.provider}`)
            if (info.url) flowDetails.push(`URL: ${info.url}`)
            if (info.vpsDetails) {
              const vps = info.vpsDetails
              flowDetails.push(`VPS: ${[vps.os, vps.zone, vps.diskType].filter(Boolean).join(', ')}`)
            }
            if (info.domain) flowDetails.push(`domain: ${info.domain}`)
            if (info.phone) flowDetails.push(`phone: ${info.phone}`)
            if (info.campaignName) flowDetails.push(`campaign: ${info.campaignName}`)
            if (flowDetails.length) context.push(`Flow details: ${flowDetails.join(', ')}`)
          }
        }
      }
    } catch (e) { /* state collection may not exist */ }

    // ── Tier 1 Feature 2: Recent user-facing errors (last 30 minutes) ──
    try {
      const recentErrors = await _db.collection('userErrors')
        .find({ chatId, timestamp: { $gt: new Date(Date.now() - 30 * 60 * 1000) } })
        .sort({ timestamp: -1 }).limit(3).toArray()
      if (recentErrors.length > 0) {
        const errStr = recentErrors.map(e => {
          const ago = Math.round((Date.now() - new Date(e.timestamp).getTime()) / 60000)
          return `${e.feature}: "${e.error}" (${ago} min ago)`
        }).join('; ')
        context.push(`⚠️ RECENT ERRORS: ${errStr}`)
      }
    } catch (e) { /* userErrors collection may not exist yet */ }

    // SIP/Phone context — critical for call troubleshooting
    try {
      const testCred = await _db.collection('testCredentials').findOne({ chatId, expired: { $ne: true } })
      if (testCred) {
        context.push(`Test SIP: ${testCred.callsMade || 0}/${testCred.maxCalls || 2} test calls used, credential: ${testCred.expired ? 'expired' : 'active'}`)
      }
      // ── Detailed Cloud IVR plan facts ──
      // Document shape: phoneNumbersOf[chatId] = { val: { numbers: [{ phoneNumber, plan, planPrice, purchaseDate, expiresAt, status }, …] } }
      // We surface plan + price + age + remaining days for EACH active number so the AI can
      // quote exact upgrade math instead of inventing it (root-cause of the EIN_5050 bad-rated session).
      const phoneDoc = await _db.collection('phoneNumbersOf').findOne({ _id: chatId })
      const phoneNumbers = phoneDoc?.val?.numbers || []
      const PHONE_PLAN_PRICES = {
        starter: Number(process.env.PHONE_STARTER_PRICE || 50),
        pro: Number(process.env.PHONE_PRO_PRICE || 75),
        business: Number(process.env.PHONE_BUSINESS_PRICE || 120),
      }
      const fmtDate = (iso) => {
        try { return new Date(iso).toISOString().slice(0, 10) } catch (_) { return 'unknown' }
      }
      const phoneSummaries = []
      for (const num of phoneNumbers.slice(0, 5)) {
        if (!num || num.status === 'deleted' || num.status === 'expired') continue
        const planKey = (num.plan || '').toLowerCase()
        const paidPrice = Number(num.planPrice || PHONE_PLAN_PRICES[planKey] || 0)
        const purchaseISO = num.purchaseDate || num.activatedAt || null
        const expiresISO = num.expiresAt || null
        const ageDays = purchaseISO ? Math.max(0, Math.floor((Date.now() - new Date(purchaseISO).getTime()) / 86400000)) : null
        const remainingDays = expiresISO ? Math.max(0, Math.floor((new Date(expiresISO).getTime() - Date.now()) / 86400000)) : null
        // Daily value of what they paid (most plans are monthly, billed for ~30 days)
        const cycleDays = (ageDays != null && remainingDays != null) ? (ageDays + remainingDays) : 30
        const dailyValue = cycleDays > 0 ? paidPrice / cycleDays : 0
        const remainingValue = remainingDays != null ? Math.round(dailyValue * remainingDays * 100) / 100 : null
        const parts = [
          `${num.phoneNumber || num._id || 'number'}`,
          `${num.plan || 'unknown'} plan ($${paidPrice}/cycle)`,
        ]
        if (purchaseISO) parts.push(`purchased ${fmtDate(purchaseISO)}${ageDays != null ? ` (${ageDays}d ago)` : ''}`)
        if (expiresISO)  parts.push(`expires ${fmtDate(expiresISO)}${remainingDays != null ? ` (${remainingDays}d left)` : ''}`)
        if (remainingValue != null && paidPrice > 0) parts.push(`unused credit ~$${remainingValue.toFixed(2)}`)
        phoneSummaries.push(parts.join(' · '))
      }
      if (phoneSummaries.length > 0) {
        context.push(`Cloud IVR numbers:\n  • ${phoneSummaries.join('\n  • ')}`)
        // Hand the model concrete tier prices so it stops guessing.
        context.push(`Plan tier prices: Starter $${PHONE_PLAN_PRICES.starter}/mo, Pro $${PHONE_PLAN_PRICES.pro}/mo, Business $${PHONE_PLAN_PRICES.business}/mo.`)
        context.push(`UPGRADE MATH RULE: when a user asks about upgrading from one plan to another, the prorated upgrade cost = (new_plan_price − unused_credit_of_current_plan). Use the "unused credit" value listed above for each number — do NOT invent figures. If a user mentions a price the system did not compute, do NOT confirm it; restate the math from these numbers and escalate if they disagree.`)
      }
    } catch (e) { /* phone collections may not exist */ }

    // Recent lead jobs
    const recentJobs = await _db.collection('leadJobs')
      .find({ chatId })
      .sort({ createdAt: -1 })
      .limit(3)
      .project({ results: 0 })
      .toArray()
    if (recentJobs.length > 0) {
      const jobSummary = recentJobs.map(j => {
        const status = j.status || 'unknown'
        const target = j.target || 'General'
        const count = j.phonesToGenerate || '?'
        const date = j.createdAt ? new Date(j.createdAt).toISOString().split('T')[0] : '?'
        return `${target} (${count} leads, ${status}, ${date})`
      }).join('; ')
      context.push(`Recent orders: ${jobSummary}`)
    }

    // Support session history
    const session = await _db.collection('supportSessions').findOne({ _id: chatId })
    if (session && session.val > 0) {
      context.push('Support session: Active')
    }

    // Marketplace activity
    try {
      const mpProducts = await _db.collection('marketplaceProducts').find({ sellerId: chatId, status: 'active' }).project({ title: 1, price: 1 }).toArray()
      if (mpProducts.length > 0) {
        const listings = mpProducts.map(p => `${p.title} ($${p.price})`).join(', ')
        context.push(`Marketplace listings (${mpProducts.length}): ${listings}`)
      }
      const mpConvs = await _db.collection('marketplaceConversations').find({
        $or: [{ buyerId: chatId }, { sellerId: chatId }],
        status: { $in: ['active', 'escrow_started'] }
      }).project({ productTitle: 1 }).limit(5).toArray()
      if (mpConvs.length > 0) {
        context.push(`Active marketplace conversations: ${mpConvs.length} (${mpConvs.map(c => c.productTitle).join(', ')})`)
      }
    } catch (e) { /* marketplace collections may not exist yet */ }

    // ── Enhanced: Hosting & domain status ──
    try {
      const hosting = await _db.collection('hostOf').findOne({ _id: chatId })
      if (hosting?.val) {
        context.push(`Hosting: ${hosting.val.plan || 'active'}${hosting.val.domain ? `, domain: ${hosting.val.domain}` : ''}`)
      }
    } catch { /* non-critical context enrichment — skip on error */ }

    // ── DOMAIN ROSTER (always-on for chatId — kills "where is my domain?" hallucinations) ──
    // Cross-references domainsOf (user's purchased TLDs) + cpanelAccounts (hosting plans
    // + addon domains) + registeredDomains (registrar metadata). Surfaces an authoritative
    // per-domain summary so the AI quotes facts instead of inventing "maybe not registered".
    try {
      const chatIdStr = String(chatId)
      const domainsOfDoc = await _db.collection('domainsOf').findOne({ _id: chatIdStr })
      const purchasedSet = new Set()
      if (domainsOfDoc) {
        for (const k of Object.keys(domainsOfDoc)) {
          if (k === '_id') continue
          purchasedSet.add(k.replaceAll('@', '.').toLowerCase())
        }
      }

      const allHostingPlans = await _db.collection('cpanelAccounts')
        .find({ chatId: chatIdStr })
        .project({ domain: 1, plan: 1, expiryDate: 1, suspended: 1, deleted: 1, addonDomains: 1, terminatedOnWhm: 1 })
        .toArray()
      const primaryToPlan = new Map()
      const addonToPrimary = new Map()
      for (const p of allHostingPlans) {
        if (p.terminatedOnWhm) continue   // terminated plans hidden in My Hosting Plans
        if (p.domain) primaryToPlan.set(String(p.domain).toLowerCase(), p)
        if (Array.isArray(p.addonDomains)) {
          for (const a of p.addonDomains) {
            const ad = (typeof a === 'string' ? a : a?.domain || '').toLowerCase()
            if (ad) addonToPrimary.set(ad, p)
          }
        }
      }

      const allDomainNames = new Set([
        ...purchasedSet,
        ...primaryToPlan.keys(),
        ...addonToPrimary.keys(),
      ])

      // Pull registeredDomains records (schema is inconsistent across the fleet —
      // chatId can live at top-level OR val.chatId OR val.ownerChatId, sometimes
      // stored as a stringified number. So we look up BY domain name instead.)
      const registeredByDomain = new Map()
      if (allDomainNames.size) {
        const regDocs = await _db.collection('registeredDomains')
          .find({ _id: { $in: Array.from(allDomainNames) } })
          .project({ _id: 1, val: 1 })
          .toArray()
        for (const r of regDocs) registeredByDomain.set(String(r._id).toLowerCase(), r)
      }

      if (allDomainNames.size > 0) {
        const lines = []
        const fmtDate = (iso) => {
          try { return new Date(iso).toISOString().slice(0, 10) } catch (_) { return 'unknown' }
        }
        for (const d of allDomainNames) {
          const reg = registeredByDomain.get(d)
          const primaryPlan = primaryToPlan.get(d)
          const addonPlan = addonToPrimary.get(d)
          const parts = [d]

          if (purchasedSet.has(d) || reg) {
            const rawRegistrar = reg?.val?.registrar || reg?.val?.provider || (purchasedSet.has(d) ? 'Nomadly' : 'external')
            // Sanitize: never expose third-party registrar names (OpenProvider, ConnectReseller, etc.)
            // to the LLM context — it will faithfully repeat them to the user. Map all known
            // upstream registrars to the consumer-facing brand "Nomadly".
            const registrar = sanitizeAiContext(String(rawRegistrar))
            parts.push(`registered ✅ (${registrar})`)
          } else {
            parts.push(`registration source: unknown`)
          }

          if (primaryPlan) {
            const expiry = primaryPlan.expiryDate ? fmtDate(primaryPlan.expiryDate) : '—'
            const status = primaryPlan.deleted ? 'cancelled' : primaryPlan.suspended ? 'suspended' : 'active'
            parts.push(`PRIMARY hosting plan (${primaryPlan.plan || '?'}, ${status}, expires ${expiry})`)
          } else if (addonPlan) {
            const expiry = addonPlan.expiryDate ? fmtDate(addonPlan.expiryDate) : '—'
            const status = addonPlan.deleted ? 'cancelled' : addonPlan.suspended ? 'suspended' : 'active'
            parts.push(`ADDON under ${addonPlan.domain} (${addonPlan.plan || '?'}, ${status}, expires ${expiry}) — visible in 📂 My Domain Names, NOT as its own row in 📋 My Hosting Plans (addons nest under their primary)`)
          } else {
            parts.push(`no hosting plan`)
          }
          lines.push(' • ' + parts.join(' · '))
        }
        context.push(`📂 USER DOMAIN ROSTER (${allDomainNames.size} domain(s)):\n${lines.join('\n')}`)
        context.push(`DOMAIN-VISIBILITY RULE: A user's domain may be registered AND active even if it doesn't appear as its own row in 📋 My Hosting Plans — addon domains nest under their primary plan and are listed in 📂 My Domain Names. Before saying a domain "may not be registered" or "may have an issue", check the roster above. If the roster shows a domain as "registered ✅" or "ADDON", DO NOT tell the user it isn't registered. Reassure them and explain it's an addon, then point to 📂 My Domain Names for the full list.`)
      }
    } catch (e) {
      log(`[AI Support] Domain roster context error: ${e.message}`)
    }

    // ── Enhanced: Recent shortlinks ──
    try {
      const links = await _db.collection('linksOf').find({ _id: new RegExp(`^${chatId}/`) })
        .sort({ _id: -1 }).limit(3).toArray()
      if (links.length > 0) {
        context.push(`Recent short links: ${links.length} created`)
      }
    } catch { /* non-critical context enrichment — skip on error */ }

    // ── DNS context (only when user is asking about DNS) ──
    // Industry-known pitfall: users paste full FQDN as DNS hostname and end up
    // with `www.zone.zone` records. Injecting the actual records lets the AI
    // diagnose this and respond specifically instead of giving generic answers.
    try {
      const dnsRegex = /\b(dns|a\s?record|aaaa|cname|mx|txt|nameserver|subdomain|propagat|zone|cloudflare)\b/i
      if (userMessage && dnsRegex.test(userMessage)) {
        // Schema-tolerant lookup: chatId can live at top-level OR val.chatId OR
        // val.ownerChatId, and may be stored as a stringified number. Earlier
        // restrictive {chatId: String(chatId)} filter returned 0 docs for many
        // users (e.g. @Night_ismine's verify-navy.com), so the AI gave generic
        // DNS answers. Fall back to the user's domainsOf list so we still get
        // a domain set even when registeredDomains.chatId is undefined.
        const cidStr = String(chatId)
        let userDomains = await _db.collection('registeredDomains')
          .find({ $or: [
            { chatId: cidStr },
            { 'val.chatId': cidStr },
            { 'val.ownerChatId': cidStr },
          ] })
          .project({ _id: 1, val: 1 })
          .limit(5)
          .toArray()
        if (userDomains.length === 0) {
          // Fallback: derive domain names from the user's domainsOf doc and
          // hydrate from registeredDomains by _id.
          const domsDoc = await _db.collection('domainsOf').findOne({ _id: cidStr })
          if (domsDoc) {
            const names = Object.keys(domsDoc).filter(k => k !== '_id').map(k => k.replaceAll('@', '.').toLowerCase()).slice(0, 5)
            if (names.length) {
              userDomains = await _db.collection('registeredDomains')
                .find({ _id: { $in: names } })
                .project({ _id: 1, val: 1 })
                .limit(5)
                .toArray()
              // Add naked entries for any name not yet in registeredDomains
              const found = new Set(userDomains.map(d => String(d._id).toLowerCase()))
              for (const n of names) if (!found.has(n)) userDomains.push({ _id: n, val: {} })
            }
          }
        }
        if (userDomains.length) {
          context.push(`User has ${userDomains.length} registered domain(s): ${userDomains.map(d => d._id).join(', ')}`)
          // Pull live DNS records for each domain and flag duplicated-zone bugs.
          let domainService = null
          let detectDuplicatedZone = null
          try {
            domainService = require('./domain-service')
            detectDuplicatedZone = require('./dns-hostname-normalizer').detectDuplicatedZone
          } catch (_) { /* modules may not be loaded yet */ }
          if (domainService) {
            for (const d of userDomains.slice(0, 3)) {
              try {
                const res = await domainService.viewDNSRecords(d._id, _db)
                const recs = (res?.records || []).slice(0, 25)
                if (!recs.length) continue
                const broken = []
                const lines = []
                for (const r of recs) {
                  const sub = detectDuplicatedZone ? detectDuplicatedZone(r.recordName || '', d._id) : null
                  if (sub !== null) {
                    broken.push({ name: r.recordName, fix: sub === '' ? '@' : sub, type: r.recordType, value: r.recordContent })
                  }
                  lines.push(`${r.recordType} ${r.recordName || '@'} → ${r.recordContent || '—'}`)
                }
                context.push(`📋 DNS records on ${d._id}:\n${lines.join('\n')}`)
                if (broken.length) {
                  const brokenLines = broken.map(b => `${b.type} ${b.name} → should be "${b.fix}" (currently has zone duplicated)`).join('; ')
                  context.push(`⚠️ DUPLICATED-ZONE RECORDS DETECTED on ${d._id}: ${brokenLines}. Tell the user EXACTLY this: they accidentally typed the full domain as the hostname when adding the record. The bot now offers a one-tap "🛠️ Fix N broken record(s)" button on the DNS Records screen for the domain — instruct them to open 🌍 Domains → ${d._id} → DNS Records and tap that button. (Or they can delete + re-add the record using ONLY the sub-label like 'www' instead of '${d._id}'.)`)
                }
              } catch (e) {
                // viewDNSRecords can throw for OpenProvider-managed zones; skip silently
              }
            }
          }
        }
      }
    } catch (e) {
      log(`[AI Support] DNS context inject error: ${e.message}`)
    }

    return context.length > 0 ? `\n\n[USER CONTEXT]\n${context.join('\n')}` : ''
  } catch (e) {
    log(`[AI Support] Context error: ${e.message}`)
    return ''
  }
}

// ── Get conversation history ──
async function getConversationHistory(chatId, limit = 10) {
  if (!_aiChatHistory) return []
  try {
    const messages = await _aiChatHistory
      .find({ chatId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()
    return messages.reverse().map(m => ({
      role: m.role,
      content: m.content,
    }))
  } catch (e) {
    return []
  }
}

// ── Save message to history ──
// (2026-07-30 diagnostic bug: user 5828254066 had a full support session with
// AI reply but zero rows in aiSupportChats. Silent failures via `_aiChatHistory
// = null` or a swallowed insertOne left admin unable to reconstruct the
// conversation later. Now every skip/failure is logged with a stable prefix
// so operators can grep, and we surface the row count on the debug endpoint.)
let _aiChatSaveMisses = 0
let _aiChatSaveOk = 0
async function saveMessage(chatId, role, content) {
  if (!_aiChatHistory) {
    _aiChatSaveMisses++
    log(`[AI Support] saveMessage SKIPPED: _aiChatHistory not initialized (chatId=${chatId}, role=${role}, misses=${_aiChatSaveMisses})`)
    return
  }
  try {
    await _aiChatHistory.insertOne({
      chatId,
      role,
      content,
      createdAt: new Date(),
    })
    _aiChatSaveOk++
  } catch (e) {
    _aiChatSaveMisses++
    log(`[AI Support] Save message error (chatId=${chatId}, role=${role}, misses=${_aiChatSaveMisses}): ${e.message}`)
  }
}

// ── Diagnostic snapshot of chat-history save health ──
function getAiChatHistoryHealth() {
  return {
    initialized: !!_aiChatHistory,
    savesOk: _aiChatSaveOk,
    saveMisses: _aiChatSaveMisses,
  }
}

// ── Language display names for AI instruction ──
const LANG_NAMES = {
  en: 'English',
  fr: 'French (Français)',
  zh: 'Chinese (中文)',
  hi: 'Hindi (हिन्दी)',
}

// ── Main AI response function ──
// Builds the OpenAI `messages` array (system prompt + language instruction +
// user context + conversation history + the new user message). Shared by both
// getAiResponse (non-streaming) and getAiResponseStreaming so the prompt
// construction lives in exactly one place.
async function buildAiMessages(chatId, userMessage, lang = 'en') {
  const [userContext, history] = await Promise.all([
    getUserContext(chatId, userMessage),
    getConversationHistory(chatId),
  ])

  const langName = LANG_NAMES[lang] || LANG_NAMES.en
  const langInstruction = lang !== 'en'
    ? `\n\n## LANGUAGE REQUIREMENT\n**CRITICAL**: The user's preferred language is ${langName}. You MUST:\n1. Respond entirely in ${langName}. Do NOT respond in English.\n2. Use the TRANSLATED BUTTON LABELS from the "BUTTON LABELS BY LANGUAGE" table above for the "${langName}" column. For example, instead of "📋 My Plans" use the ${langName} version from the table.\n3. Use HTML tags (<b>, <i>, <code>) for formatting, not markdown.`
    : ''

  return [
    { role: 'system', content: SYSTEM_PROMPT + langInstruction + userContext },
    ...history,
    { role: 'user', content: userMessage },
  ]
}

async function getAiResponse(chatId, userMessage, lang = 'en') {
  if (!openai) {
    return { response: null, escalate: needsEscalation(userMessage, lang, null, chatId), error: 'OpenAI not initialized' }
  }

  try {
    // Build messages array (system + context + history + user message)
    const messages = await buildAiMessages(chatId, userMessage, lang)

    // Call OpenAI with retry for 429 rate-limit errors
    let completion = null
    const MAX_RETRIES = 2
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        completion = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages,
          max_tokens: 1200,
          temperature: 0.7,
        })
        break // success
      } catch (retryErr) {
        const is429 = retryErr?.status === 429 || retryErr?.error?.code === 'insufficient_quota' ||
          (retryErr.message && retryErr.message.includes('429'))
        if (is429 && attempt < MAX_RETRIES) {
          const backoff = (attempt + 1) * 3000  // 3s, 6s
          log(`[AI Support] OpenAI 429 — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
          await new Promise(r => setTimeout(r, backoff))
          continue
        }
        // Not retryable or max retries exceeded
        throw retryErr
      }
    }

    if (!completion) {
      throw new Error('OpenAI returned no completion after retries')
    }

    const rawAiResponse = completion.choices[0]?.message?.content || ''
    // Defence-in-depth: scrub any third-party provider/vendor names the LLM might
    // have produced (despite the BRAND CONFIDENTIALITY rule) before showing to the user
    // AND before persisting to chat history (so future turns don't re-leak them).
    const aiResponse = sanitizeUserText(rawAiResponse)

    // Save both messages to history
    await saveMessage(chatId, 'user', userMessage)
    await saveMessage(chatId, 'assistant', aiResponse)

    // Check if AI itself flagged escalation or if keywords match (smart escalation).
    // Pass chatId so critical-keyword pings are deduped within a session.
    const escalate = needsEscalation(userMessage, lang, aiResponse, chatId) ||
      aiResponse.toLowerCase().includes('human agent') ||
      aiResponse.toLowerCase().includes('support team') ||
      aiResponse.toLowerCase().includes('escalat') ||
      // Multi-language escalation phrases in AI response
      (lang === 'fr' && (aiResponse.toLowerCase().includes('agent humain') || aiResponse.toLowerCase().includes('équipe de support'))) ||
      (lang === 'zh' && (aiResponse.includes('人工客服') || aiResponse.includes('支持团队'))) ||
      (lang === 'hi' && (aiResponse.includes('सहायता टीम') || aiResponse.includes('मानव एजेंट')))

    return { response: aiResponse, escalate, error: null }
  } catch (e) {
    const is429 = e?.status === 429 || e?.error?.code === 'insufficient_quota' ||
      (e.message && e.message.includes('429'))
    if (is429) {
      log(`[AI Support] OpenAI quota exceeded for ${chatId} — escalating to human agent`)
    } else {
      log(`[AI Support] OpenAI error: ${e.message}`)
    }
    // Save the user message so admin can see what was asked even if AI failed
    await saveMessage(chatId, 'user', userMessage).catch(() => {})
    return { response: null, escalate: true, error: e.message }
  }
}

// ── Streaming AI response (#7) ──
// Same as getAiResponse but streams tokens. `onDelta(sanitizedPartialText)` is
// invoked progressively as the model generates, so the caller can edit the
// Telegram message in place for a "typing live" UX. Returns the same shape as
// getAiResponse once the stream completes (fully sanitized + history saved +
// escalation detected). Brand-confidentiality scrubbing is applied to BOTH the
// streamed partials and the final text so vendor names never flash on screen.
async function getAiResponseStreaming(chatId, userMessage, lang = 'en', onDelta = null) {
  if (!openai) {
    return { response: null, escalate: needsEscalation(userMessage, lang, null, chatId), error: 'OpenAI not initialized' }
  }

  try {
    const messages = await buildAiMessages(chatId, userMessage, lang)

    // Open the stream with the same 429-retry behaviour as getAiResponse
    let stream = null
    const MAX_RETRIES = 2
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        stream = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages,
          max_tokens: 1200,
          temperature: 0.7,
          stream: true,
        })
        break
      } catch (retryErr) {
        const is429 = retryErr?.status === 429 || retryErr?.error?.code === 'insufficient_quota' ||
          (retryErr.message && retryErr.message.includes('429'))
        if (is429 && attempt < MAX_RETRIES) {
          const backoff = (attempt + 1) * 3000
          log(`[AI Support] OpenAI 429 (stream) — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
          await new Promise(r => setTimeout(r, backoff))
          continue
        }
        throw retryErr
      }
    }
    if (!stream) throw new Error('OpenAI returned no stream after retries')

    let raw = ''
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content || ''
      if (!delta) continue
      raw += delta
      if (typeof onDelta === 'function') {
        // Sanitize the partial so banned vendor names never flash mid-stream.
        try { await onDelta(sanitizeUserText(raw)) } catch { /* edit throttling decides */ }
      }
    }

    const aiResponse = sanitizeUserText(raw)

    await saveMessage(chatId, 'user', userMessage)
    await saveMessage(chatId, 'assistant', aiResponse)

    const escalate = needsEscalation(userMessage, lang, aiResponse, chatId) ||
      aiResponse.toLowerCase().includes('human agent') ||
      aiResponse.toLowerCase().includes('support team') ||
      aiResponse.toLowerCase().includes('escalat') ||
      (lang === 'fr' && (aiResponse.toLowerCase().includes('agent humain') || aiResponse.toLowerCase().includes('équipe de support'))) ||
      (lang === 'zh' && (aiResponse.includes('人工客服') || aiResponse.includes('支持团队'))) ||
      (lang === 'hi' && (aiResponse.includes('सहायता टीम') || aiResponse.includes('मानव एजेंट')))

    return { response: aiResponse, escalate, error: null }
  } catch (e) {
    const is429 = e?.status === 429 || e?.error?.code === 'insufficient_quota' ||
      (e.message && e.message.includes('429'))
    if (is429) {
      log(`[AI Support] OpenAI quota exceeded (stream) for ${chatId} — escalating to human agent`)
    } else {
      log(`[AI Support] OpenAI stream error: ${e.message}`)
    }
    await saveMessage(chatId, 'user', userMessage).catch(() => {})
    return { response: null, escalate: true, error: e.message }
  }
}

// ── Clear conversation history (when support session ends) ──
async function clearHistory(chatId) {
  // Reset in-memory escalation dedup so the next session starts clean.
  _escalatedThisSession.delete(String(chatId))
  if (!_aiChatHistory) return
  try {
    await _aiChatHistory.deleteMany({ chatId })
  } catch (e) {
    log(`[AI Support] Clear history error: ${e.message}`)
  }
}

// ── Marketplace AI Chat Moderation ──
const MP_MODERATION_PROMPT = `You are a marketplace safety AI. Analyze this message from a buyer-seller chat on ${BRAND} marketplace.

RULES:
- All payments MUST go through @Lockbaybot escrow
- Any attempt to move payment off-platform is suspicious
- Watch for: fake urgency, pressure tactics, requests for personal info, phishing links, social engineering
- PayPal, CashApp, Venmo, Western Union, wire transfers, direct crypto addresses are ALL red flags
- "I'll pay you directly", "no need for escrow", "let's do it off Telegram" are scam indicators

Respond with a JSON object ONLY:
{"flagged": true/false, "reason": "brief reason if flagged", "severity": "low|medium|high"}

If the message seems like normal product discussion, negotiation, or questions, return {"flagged": false}.`

async function moderateMarketplaceChat(message) {
  if (!openai) return { flagged: false }
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-nano',
      messages: [
        { role: 'system', content: MP_MODERATION_PROMPT },
        { role: 'user', content: message },
      ],
      max_tokens: 100,
      temperature: 0.1,
    })
    const raw = completion.choices[0]?.message?.content || ''
    const match = raw.match(/\{[^}]+\}/)
    if (match) {
      const result = JSON.parse(match[0])
      return { flagged: !!result.flagged, reason: result.reason || '', severity: result.severity || 'low' }
    }
    return { flagged: false }
  } catch (e) {
    log(`[AI Moderation] Error: ${e.message}`)
    return { flagged: false }
  }
}

// ── Marketplace AI Helper (contextual Q&A for marketplace users) ──
const MP_HELPER_PROMPT = `You are the AI assistant for the ${BRAND} Marketplace — a P2P digital goods marketplace inside Telegram.

Help users with marketplace-specific questions:
- How to list/sell products (photos required, pricing $20-$5000, categories)
- How to buy (browse deals, chat with seller, start escrow)
- How escrow works (@Lockbaybot holds funds until delivery confirmed)
- Pricing tips, listing optimization, safety advice
- Chat commands: /escrow, /price XX, /done, /report

SAFETY RULES you MUST emphasize:
- ALWAYS use @Lockbaybot escrow — NEVER pay outside of escrow
- Report suspicious users with /report
- AI monitors all chats for scam patterns

LANGUAGE-AWARE BUTTON LABELS (use the user's language verbatim when telling them where to tap):
- EN: "🏪 Marketplace" → "📦 My Listings" / "🛒 Browse" / "💬 My Chats" / "📜 Listing Rules"
- FR: "🏪 Marché" → "📦 Mes annonces" / "🛒 Parcourir" / "💬 Mes Chats" / "📜 Règles d'annonce"
- ZH: "🏪 市场" → "📦 我的房源" / "🛒 浏览" / "💬 我的聊天" / "📜 房源规则"
- HI: "🏪 मार्केटप्लेस" → "📦 मेरी लिस्टिंग" / "🛒 ब्राउज़" / "💬 मेरी चैट्स" / "📜 लिस्टिंग नियम"

Be concise (under 200 words), use Telegram HTML formatting (<b>, <i>), and be friendly.
When the user's language is not English, respond in their language.`

// Build a marketplace-specific user context (parallels getUserContext but
// limited to data that matters in MP — listings, conversations, escrow, wallet
// for fee context). Keeps the call lightweight (~40-100 tokens).
async function getMarketplaceContext(chatId) {
  if (!_db) return ''
  const ctx = []
  try {
    const wallet = await _db.collection('walletOf').findOne({ _id: chatId })
    if (wallet?.val) {
      const usd = Number(wallet.val.usdIn || 0).toFixed(2)
      ctx.push(`Wallet: $${usd} USD`)
    }
    const listings = await _db.collection('marketplaceProducts')
      .find({ sellerId: chatId, status: { $in: ['active', 'pending'] } })
      .limit(5)
      .toArray()
    if (listings.length) {
      const summary = listings
        .map(l => `${l.title || l.name || l._id} ($${l.price || '?'})`)
        .slice(0, 3)
        .join(', ')
      ctx.push(`Active listings (${listings.length}): ${summary}`)
    }
    const convs = await _db.collection('marketplaceConversations')
      .find({ $or: [{ sellerId: chatId }, { buyerId: chatId }] })
      .sort({ updatedAt: -1 })
      .limit(3)
      .toArray()
    if (convs.length) {
      const states = convs.map(c => c.escrowStatus || c.status || 'open').join(', ')
      ctx.push(`Open conversations: ${convs.length} (states: ${states})`)
    }
  } catch (e) {
    log(`[MP AI] context build error: ${e.message}`)
  }
  return ctx.length ? `\n\nUser context:\n- ${ctx.join('\n- ')}` : ''
}

async function getMarketplaceAiResponse(chatId, userMessage, lang = 'en') {
  if (!openai) return { response: null, error: 'AI not available' }
  try {
    const langName = LANG_NAMES[lang] || LANG_NAMES.en
    const langInstruction = lang !== 'en'
      ? `\n\nIMPORTANT: Respond entirely in ${langName}. Use HTML tags for formatting.`
      : ''

    const history = await getConversationHistory(chatId, 5)
    const userContext = await getMarketplaceContext(chatId)

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: MP_HELPER_PROMPT + userContext + langInstruction },
        ...history.slice(-4),
        { role: 'user', content: userMessage },
      ],
      max_tokens: 800,
      temperature: 0.7,
    })

    const rawAiResponse = completion.choices[0]?.message?.content || ''
    const aiResponse = sanitizeUserText(rawAiResponse)
    await saveMessage(chatId, 'user', userMessage)
    await saveMessage(chatId, 'assistant', aiResponse)
    return { response: aiResponse, error: null }
  } catch (e) {
    log(`[Marketplace AI] Error: ${e.message}`)
    return { response: null, error: e.message }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tier 1 Feature 2: Record user-facing errors for AI context
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function recordUserError(chatId, feature, error) {
  if (!_db) return
  try {
    await _db.collection('userErrors').insertOne({
      chatId,
      feature,
      error: typeof error === 'string' ? error : (error?.message || String(error)),
      timestamp: new Date(),
    })
  } catch (e) {
    log(`[AI Support] recordUserError failed: ${e.message}`)
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tier 1 Feature 3: Extract action buttons from AI response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function extractActionButtons(aiResponse, lang = 'en') {
  if (!aiResponse) return []

  // Map of keyword patterns → button labels per language.
  // Keywords are matched against the AI response text in the user's language,
  // so each map stores keywords in that language. ZH/HI maps were missing
  // before — without them, ZH/HI users got EN button labels even when the AI
  // response was fully translated.
  const buttonMap = {
    en: {
      'url shortener': '🔗✂️ URL Shortener — Unlimited',
      'cloud ivr': '📞 Cloud IVR + SIP',
      'wallet': '👛 Wallet',
      'deposit': '👛 Wallet',
      'marketplace': '🏪 Marketplace',
      'domain': '🌐 Bulletproof Domains',
      'hosting': '🛡️🔥 Anti-Red Hosting',
      'vps': '🖥️ VPS/RDP',
      'sms lead': '📱 SMS Leads',
      'virtual card': '💳 Virtual Card',
      'email validation': '📧 Email Validation',
      'bulk sms': '📲 BulkSMS — Free',
      'digital product': '📦 Digital Products',
      '/testsip': '🧪 Free SIP Test',
    },
    fr: {
      'raccourcisseur': '🔗✂️ Raccourcisseur URL — Illimité',
      'cloud ivr': '📞 Cloud IVR + SIP',
      'portefeuille': '👛 Portefeuille',
      'dépôt': '👛 Portefeuille',
      'marketplace': '🏪 Marketplace',
      'marché': '🏪 Marché',
      'domaine': '🌐 Domaines Bulletproof',
      'hébergement': '🛡️🔥 Hébergement Anti-Red',
      'vps': '🖥️ VPS/RDP',
      'sms': '📱 Leads SMS',
      'carte virtuelle': '💳 Carte Virtuelle',
      'validation d\'e-mails': '📧 Validation d\'e-mails',
      'produit numérique': '📦 Produits numériques',
    },
    zh: {
      '缩短器': '🔗✂️ URL 缩短器 — 无限',
      '短链': '🔗✂️ URL 缩短器 — 无限',
      'cloud ivr': '📞 Cloud IVR + SIP',
      'sip': '📞 Cloud IVR + SIP',
      '钱包': '👛 我的钱包',
      '充值': '👛 我的钱包',
      '存款': '👛 我的钱包',
      '市场': '🏪 市场',
      '域名': '🌐 防弹域名',
      '托管': '🌐 离岸托管',
      '主机': '🌐 离岸托管',
      'vps': '🖥️ VPS/RDP',
      '短信线索': '📱 短信线索',
      '虚拟卡': '💳 虚拟卡',
      '邮箱验证': '📧 邮箱验证',
      '群发邮件': '📧 群发邮件',
      '数字产品': '🛒 数字产品',
    },
    hi: {
      'छोटा करें': '🔗✂️ URL छोटा करें — असीमित',
      'शॉर्टनर': '🔗✂️ URL छोटा करें — असीमित',
      'cloud ivr': '📞 Cloud IVR + SIP',
      'sip': '📞 Cloud IVR + SIP',
      'वॉलेट': '👛 मेरा वॉलेट',
      'जमा': '👛 मेरा वॉलेट',
      'डिपॉजिट': '👛 मेरा वॉलेट',
      'मार्केटप्लेस': '🏪 मार्केटप्लेस',
      'डोमेन': '🌐 बुलेटप्रूफ डोमेन',
      'होस्टिंग': '🌐 ऑफ़शोर होस्टिंग',
      'vps': '🖥️ VPS/RDP',
      'sms लीड': '📱 SMS लीड्स',
      'वर्चुअल कार्ड': '💳 वर्चुअल कार्ड',
      'ईमेल सत्यापन': '📧 ईमेल सत्यापन',
      'ईमेल ब्लास्ट': '📧 ईमेल ब्लास्ट',
      'डिजिटल उत्पाद': '🛒 डिजिटल उत्पाद',
    },
  }

  const lower = aiResponse.toLowerCase()
  const map = buttonMap[lang] || buttonMap.en
  const fallbackMap = buttonMap.en
  const suggested = []
  const seen = new Set()

  // Check language-specific map first, then fallback to English
  for (const [keyword, button] of Object.entries(map)) {
    if (lower.includes(keyword) && !seen.has(button) && suggested.length < 2) {
      suggested.push(button)
      seen.add(button)
    }
  }
  if (suggested.length < 2 && lang !== 'en') {
    for (const [keyword, button] of Object.entries(fallbackMap)) {
      if (lower.includes(keyword) && !seen.has(button) && suggested.length < 2) {
        suggested.push(button)
        seen.add(button)
      }
    }
  }

  return suggested
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tier 1 Feature 5: Rate support session (satisfaction tracking)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function rateSupportSession(chatId, rating) {
  if (!_db) return
  try {
    await _db.collection('supportRatings').insertOne({
      chatId,
      rating, // 'good' or 'bad'
      createdAt: new Date(),
    })
    log(`[AI Support] Session rated by ${chatId}: ${rating}`)
  } catch (e) {
    log(`[AI Support] Rating save error: ${e.message}`)
  }
}

module.exports = {
  initAiSupport,
  getAiResponse,
  getAiResponseStreaming,
  getUserContext,
  getMarketplaceAiResponse,
  moderateMarketplaceChat,
  clearHistory,
  needsEscalation,
  isAiEnabled: () => !!openai,
  // ── Tier 1 new exports ──
  recordUserError,
  extractActionButtons,
  rateSupportSession,
  // ── Diagnostic (2026-07-30 lost-chat-history investigation) ──
  getAiChatHistoryHealth,
  // Test-only hook: lets unit tests stub the OpenAI client without exporting
  // the real instance for general consumption.
  __setOpenAIForTest: (fake) => { openai = fake },
}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// (Duplicate rateSupportSession block removed 2026-07-30 — pre-existing
// duplicate declaration was harmless at runtime (function hoisting kept
// the second) but broke ESLint's module parser after the diagnostic
// getAiChatHistoryHealth export was added.)

