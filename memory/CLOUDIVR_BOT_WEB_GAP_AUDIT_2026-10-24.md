# CloudIVR — Telegram bot vs web app: feature gap audit (2026-10-24)

Read-only audit (no code changed). Sources: `js/phone-config.js` (btn, plans, planFeatureAccess),
`js/_index.js` (cp*/ivrOb*/bulk*/cpIvr* handlers, buildManageMenu ~L30219), `js/ivr-outbound.js`,
`js/ivr-templates.js`, `js/bulk-call-service.js`, `js/voice-service.js` vs `js/cloudivr-web/*` + `frontend/src/cloudivr/*`.

## Already at parity (web has it)
Forwarding (always/busy/no-answer + hold music) · voicemail (custom audio greeting, email, ring time) · SMS inbox + email/webhook ·
SIP credentials (+ reset) · call recording · inbound IVR builder (forward/message/voicemail/sub-menu, 1 level) + 30-day key analytics ·
call & SMS logs · renew / upgrade / auto-renew / delete · area-code search · audio library (upload + TTS voices/speeds) ·
Quick IVR (library audio → transfer on key) · Bulk campaigns (paste/CSV leads, report-only/transfer, keys, concurrency, voicemail drop,
schedule, pause/resume/cancel, per-lead table) · ID verification · wallet + crypto. Bot alerts reach the web Inbox via notify.js shim.

## Missing on web (bot has it)
| # | Area | Bot feature | Engine ready? | Notes |
|---|---|---|---|---|
| 1 | Quick IVR | **OTP collection mode** (4/5/6/8 digits, 3 tries; Business: custom confirm/reject msgs) | YES (`initiateOutboundIvrCall` ivrMode/otp*) | web only does transfer |
| 2 | Quick IVR + Bulk | **Route each key (multi-key menu)**: per key forward / message / sub-menu; Bulk "use a saved menu" | YES (`menu` param in voice + `createCampaign`) | web = one transfer number |
| 3 | Quick IVR + Bulk | **Script templates** (Payment/Security/Delivery/Custom, placeholders + smart placeholders), type a script → TTS (voice + speed) → audio preview → call preview | YES (`ivr-outbound.js`, `tts-service.js`) | web needs audio pre-made in library |
| 4 | Quick IVR | **Presets** (save/load/delete call setup) · **Recent numbers** · **Resume last draft** | data in bot state (`ivrPresets`) | Business "Presets & Recent Calls" |
| 5 | Quick IVR | **Redial button** after a call (Business) | YES | inline button lost in web inbox |
| 6 | Quick IVR | **Schedule a call** (5–120 min, Business) | YES (`scheduledCalls` + cron in _index.js) | |
| 7 | Quick IVR | **Several numbers at once** (comma list) | partial (bot loops) | |
| 8 | Quick IVR | **Outbound menu stats** (key presses, 30 days) | YES (`getOutboundMenuAnalytics`) | |
| 9 | Quick IVR | 1 free trial Quick IVR call | YES | web has landing free test call instead |
| 10 | Bulk | **Detailed CSV report** at the end | YES (`generateReportFile`) | web Inbox gets caption only, no file |
| 11 | Inbound IVR | **Start from template / Save as template** (⭐ My saved templates) | YES (`ivr-templates.js`) | |
| 12 | Inbound IVR / VM | Pick AI voice + speed for typed greetings & key messages, preview; voicemail greeting templates | YES | web: Telnyx default voice, or make audio in library first |
| 13 | Number | **"What callers get now" summary** + "(skipped)" badges + forwarding-conflict resolver | YES (`getCallRouteSummary`) | web users can enable IVR while Forward=Always and not know IVR is skipped |
| 14 | Number | **Test my number** (we call it) · **Test outbound SIP** (90 s window) | YES (`placeTestMyNumberCall`, `test-outbound-sip.js`) | |
| 15 | Number | **Extra numbers on a plan** (sub-numbers: 3/15/30, from $25) | YES | deliberately left off web plan copy earlier |
| 16 | Number | Fax settings (fax to inbox on/off) | YES | fax-capable numbers only |
| 17 | Billing | **Downgrade plan** (no refund, features auto-off) | YES | web = upgrade only |
| 18 | Billing | **Coupon codes** at checkout · NGN bank transfer | YES | web = wallet + crypto |
| 19 | Account | Languages FR / 中文 / हिन्दी | bot only | web = English |
| 20 | Account | AI support assistant in chat | bot only | web links to Telegram support |
| 21 | Business | "Consistent TTS voice" (remember voice/speed) | YES | listed in Business plan copy |

## Web-only (bot lacks): on/off hours, call notes, Call me first, private mode, voicemail languages + transcripts (shared engine),
browser phone (WebRTC), crypto checkout orders, email notifications, Google sign-in.

## Suggested order (owner to choose)
P1 (engine ready, high value): 1 OTP · 2 per-key menu · 3 templates + type-a-script · 10 CSV report · 13 routing summary · 11 IVR templates.
P2: 4 presets/recent · 5 redial · 6 schedule · 8 menu stats · 14 tests · 17 downgrade · 18 coupons.
P3: 15 extra numbers · 12 voice pickers · 16 fax · 19 languages · 20 AI support · 7 multi-target.
