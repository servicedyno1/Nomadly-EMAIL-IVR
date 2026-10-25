# CloudIVR — 3CX-gap features (2026-06 session) — BUILT, PARTLY TESTED

Owner request: "apply the 4 features (vs 3CX)" + "Text Triggers" + shorter SIP logins. Owner answers (ask_human):
- Text-to-Call message = **call the texter and read a message the owner types**.
- AI summaries price = **$0.10 per minute** (per started minute of audio, min 1 min) from the wallet.
- Ring group "nobody answers" = **all three options, chosen per group**: voicemail / forward to one backup number / "sorry, try later" message + hang up.
- Webhook feed events = **all 5**: call started, call ended (with duration), voicemail left, text received, AI summary ready.
- Text Triggers naming: feature = **Text Triggers**; actions = **Auto Callback**, **Text-to-Call message**, **AI agent calls them back**;
  Auto Callback order = **owner's saved number first, then the texter**; rules = **only on keyword**, **only during business hours**,
  **once per sender per hour**.
- Shorter SIP logins (10-char `cv…` username / 12-char password) — DONE in the previous session (js/tests/test_sip_short_logins_2026-06.js).

## Status
| Feature | Backend | Frontend | Tested |
|---|---|---|---|
| Text Triggers | ✅ | ✅ (number tab "Text Triggers") | curl ✅ + sandbox unit ✅; UI NOT tested by testing agent |
| AI summaries + mood ($0.10/min) | ✅ | ✅ (Logs tab bar + per-row Summarize) | curl ✅ (real OpenAI call, auto sweep + manual, wallet debit) ; UI NOT tested |
| Ring groups | ✅ (voice-service) | ✅ (number tab "Ring group") | sandbox unit ✅ (stubbed Telnyx); NO real call yet; UI NOT tested |
| Webhook / Zapier call-event feed | ✅ | ✅ (Settings → Call events card) | curl ✅ (httpbin 200) + sandbox HMAC ✅; UI NOT tested |
| Installable app (PWA) | n/a | ✅ manifest + SW + Settings "Install the app" card | NOT tested (check Chrome DevTools → Application → Manifest) |
| FR/ES translations | — | ✅ `node scripts/civr_i18n_extract.js` + `python3 scripts/civr_i18n_fill_missing.py` (2147 keys each) | — |

Only one smoke screenshot was taken (Text Triggers tab renders correctly on desktop). The owner paused before the testing agent ran.

## Session 2 (fork) progress — testing STILL PENDING (owner paused again)
Owner choices for the testing phase (ask_human): **simulated calls & texts only** (no real Telnyx calls/texts/charges),
**report problems first and fix only after owner approval** (testing agent must NOT change code), **setup already fine** (no vault re-run).
Done in this session (no code changed):
- Verified services up (`/api/health` 200), dev flags present (`WEB_CLOUDIVR_DRY_RUN=true`, `CLOUDIVR_WEB_ON=true`, `TWILIO_ENABLED=false`).
- Verified logins: Alice + Bob OK. Alice numbers: Pro `+13465372632` (ringGroup/textTriggers/aiSummary all OFF),
  Business `+18582696527` (all three ON). Bob Starter `+13362969163` (all OFF → must show Locked cards).
- Inserted a fresh, NOT-yet-summarised voicemail for the manual **Summarize** button test: phoneLogs `_id 6ade25fd0c7ff2605b844faf`,
  `seed:'ai-summary-2026-06-qa'`, from `+14155550188` (Bright Plumbing quote), timestamp 3 h ago (outside the 2 h auto-sweep window,
  so the sweep will not grab it). Summarize makes a real OpenAI call (cheap) + debits Alice's test wallet.
- UI routes (preview domain): `/cloudivr/app/numbers/%2B18582696527?tab=triggers|ringgroup|logs`, Settings `/cloudivr/app/settings`.
  Tab buttons `number-tab-<id>`; key testids: `triggers-*`, `ring-group-*`, `ai-summary-bar` / `ai-summary-auto-toggle` / `ai-summary-locked`,
  `settings-webhooks-card` / `webhooks-*`, `settings-install-card` / `install-*`.
Next step unchanged: run `testing_agent` (both, report-only) with the brief below, show the owner the problem list, fix after approval.

## NEXT AGENT — do this first
1. Run `testing_agent` (frontend + backend) with Alice (`civr.alice@example.com` / `AliceTest#2026`, Business `+18582696527`,
   Pro `+13465372632`) and Bob (Starter — every new tab must show the Locked upgrade card). Cover:
   - Number → **Text Triggers** tab: add each action, keyword toggle + keywords, business-hours toggle hint, once-per-hour,
     reorder ↑↓, delete, master toggle, Save (validation errors: callback without "Your phone", message without text,
     AI without agent, keywordOnly without keywords, >5 rules), **Try a text** result pills, **Recent runs** list.
     On the Pro number the AI action shows "on the Business plan". Starter → Locked.
   - Number → **Ring group** tab: ≥2 phones required when on, max 5, add/remove, ring time, the 3 fallbacks (voicemail disabled
     without voicemail plan), toast lists skipped features (forwarding / keypad menu / browser ring); Overview "What callers get now"
     says "Every call rings N phones at once".
   - Number → **Logs** tab: AI summaries bar toggle (PATCH /ai-summary), per-row **Summarize · $x** on voicemail / recorded-call rows,
     summary card (sentiment pill, mood, action items), privacy mode hides summary, search finds summary text.
     Seeded rows: phoneLogs `seed:'ai-summary-2026-06'` on +18582696527 (both already summarised during curl tests — insert a new
     voicemail row with a transcript to test the button; the auto sweep only picks rows newer than the toggle's `enabledAt`).
   - **Settings**: "Call events (webhooks & Zapier)" card (URL https-only + private hosts refused, 5 event pills, secret show/copy/
     rotate with confirm, Send a test event, Recent deliveries) and "Install the app" card (Android button / iOS steps / hint).
   - FR + ES rendering of all new screens; 390px mobile layout (no horizontal overflow).
2. Fix whatever it reports; re-run `node js/tests/test_ring_group_triggers_2026-06.js` (sandbox mongod on :27999) + the bulk/SIP suites.
3. Clean up test state on Alice: Text Triggers are ON (3 rules, myPhone +14155550111), ring group ON on +18582696527
   (members +14155550101/+14155550102, fallback forward +14155550103), AI summaries ON, webhook → https://httpbin.org/post.
   Switch them off or leave for the tester, but say so in the summary.
4. Before going live (needs real Telnyx, owner's test number +13025141000): one real Auto Callback, one Text-to-Call message,
   one AI call back from a real inbound SMS; one real ring-group call (2 real phones, first-answer wins, fallback); a real
   recorded call summarised (Telnyx recording URLs expire ~10 min — the sweep runs every 30 s).

## Implementation map
### Backend (Node, js/)
- `cloudivr-web/text-triggers.js` — validate/match/evaluate/execute + routes:
  `GET/PUT /api/cloudivr-web/numbers/:phone/text-triggers`, `POST …/text-triggers/test` (simulate, never dials).
  Stored on the number: `features.textTriggers = { enabled, myPhone, rules:[{ id, enabled, action:'callback'|'message'|'ai',
  keywordOnly, keywords[], businessHoursOnly, oncePerHour, message, agentId }] }` (max 5; first matching rule runs).
  Saving `myPhone` also updates `webPrefs.callbackPhone` (shared with "Call me first").
  Runs log: collection `textTriggerRuns` (TTL 90 d) `{ chatId, phoneNumber, ruleId, action, from, body, status:
  started|preview|skipped|failed, detail, rate, test, dryRun, at }`; inbox notice via notify.push.
  Actions: callback → `voiceService.initiateOutboundIvrCall({ targetNumber: myPhone, ivrNumber: texter, greetingText: reads the
  text + "Press 1 to call them back", ivrMode:'transfer' })`; message → `initiateOutboundIvrCall({ targetNumber: texter,
  greetingText: rule.message, messageOnly: true })`; ai → `ai-agent.dialLead({ id:null, chatId, agentId, callerId },
  { number, reason })` (DNC + 8am–9pm callableNow + wallet checks). Wallet must cover max($1, rate). WEB_CLOUDIVR_DRY_RUN → status preview.
  Hook: `sms-service.js handleInboundSms` (after the phoneLogs insert) → `onInboundText()` + `events.emit('sms.received')`.
  Web accounts + Telnyx numbers only; plan gate `textTriggers` (Pro+), AI action needs `aiAgent` (Business).
- `cloudivr-web/ring-group.js` — `PUT /numbers/:phone/ring-group`; `features.ringGroup = { enabled, members[2..5], ringTimeout
  10–60, fallback:'voicemail'|'forward'|'message', fallbackTo, message }`. Plan gate `ringGroup` (Pro+).
- `voice-service.js`:
  - `ringGroupOn(num)`, `startRingGroup()` (ringback on caller, `createOutboundCall(ourNumber, member)` for every member in parallel,
    legs tracked in `activeBridgeTransfers` with `type:'ring_group'`, group state in `ringGroups[inboundCcid]`, ring timer),
    `ringGroupFallback()` (voicemail greeting / `playHoldMusicAndTransfer(fallbackTo)` / speak message + hang up).
  - `handleCallInitiated`: ring group counts as forward-always (no SIP/browser pre-ring); emits `call.started`.
  - `handleCallAnswered`: ring group is priority 0 (after off-hours, before forward-always / IVR); wallet ≥ forwarding rate.
  - `handleBridgeTransferAnswered`: first answer wins, other legs flagged `cancelled` + hung up, late answers hung up.
  - `handleBridgeTransferHangup`: unbridged ring legs never run the normal failover; last leg down → fallback.
  - `handleCallHangup`: ring group still ringing → `missed`; emits `call.ended` {duration, outcome, answeredBy}.
  - `initiateOutboundIvrCall` + `handleOutboundIvrAnswered`: new `messageOnly` param (speak once, hang up, no gather).
- `ai-agent/calls.js` — one-off outbound AI calls (no campaignId) now bill + notify like inbound (campaign leads unchanged);
  `lead.reason` → `ctx.reason` → `bridge.js` instructions "# Why you are calling"; emits `call.ended` for AI calls.
- `cloudivr-web/ai-summary.js` — `PATCH /numbers/:phone/ai-summary {enabled}` (stores `enabledAt`), `POST /numbers/:phone/logs/:id/summarize`.
  Sweep every 30 s: numbers with `features.aiSummary.enabled`, phoneLogs type voicemail|call_recording without aiSummary, newer
  than max(now-2h, enabledAt). Claim row → debit wallet (atomic) → transcript (voicemail) or download + whisper (recordings) →
  OpenAI chat JSON {summary, sentiment positive|neutral|negative, mood, actionItems[≤3]} (owner key `APP_OPEN_API_KEY`, model
  `AI_AGENT_SUMMARY_MODEL||gpt-4.1-mini`) → refund on failure/empty. Rate env `AI_SUMMARY_RATE_PER_MIN` (default 0.10).
  Saved on the log as `aiSummary`; wallet history type `ai_summary`; emits `ai_summary.ready`. Plan gate `aiSummary` (Pro+).
- `cloudivr-web/events.js` — account webhook in `webPrefs.webhook = { enabled, url, events[], secret, updatedAt }`;
  `GET/PUT /webhooks`, `POST /webhooks/secret`, `POST /webhooks/test`; deliveries in `webhookDeliveries` (TTL 14 d).
  `emit(chatId, type, data)` / `emitForNumber(phone, …)` — fire-and-forget, 6 s timeout, no redirects, https + public hosts only,
  header `X-CloudIVR-Signature` = hex HMAC-SHA256(secret, raw body), `X-CloudIVR-Event`. Body `{ id, type, created, test, data }`.
  Emit points: voice-service (call.started / call.ended), ai-agent finish (call.ended), voicemail-delivery.js (voicemail.left),
  sms-service (sms.received), ai-summary (ai_summary.ready).
- `phone-config.js` planFeatureAccess: new keys `ringGroup`, `textTriggers`, `aiSummary` (Starter false, Pro/Business true).
- `cloudivr-web/numbers.js`: FEATURE_KEYS + WEB_FEATURES (plan cards), catalog `rates.aiSummaryPerMin`, publicNumber
  `features.ringGroup/textTriggers/aiSummary`, publicLog `aiSummary` + `canSummarize`, routeSummary `ring_group`.
- `cloudivr-web/index.js` registers the 4 new route modules.

### Frontend (frontend/src/cloudivr)
- `pages/number/TextTriggersTab.js` + `TriggerParts.js` (RuleCard, TryText, RunsList), `pages/number/RingGroupTab.js`,
  `AiSummary.js` (AiSummaryCell in LogTable Details), `pages/number/LogsTab.js` (AiSummaryBar), `pages/NumberDetail.js`
  (tabs `ringgroup`, `triggers`), `pages/number/RouteSummary.js` (ring_group headline), `pages/settings/Webhooks.js`,
  `pages/settings/InstallApp.js`, `pages/Settings.js`, `pages/help/topics.js` (5 new articles + tab topics).
- PWA: `public/civr/manifest.webmanifest` (own domain, start_url /app) + `manifest-prefixed.webmanifest` (/cloudivr/app),
  icons `public/civr/brand/icon-512.png` + `icon-maskable-512.png`, `public/civr/offline.html`, `public/civr-ring-sw.js`
  (now also an offline fallback for CloudIVR navigations only), `pwa.js` (beforeinstallprompt capture, registerPwa, usePwa),
  `Brand.js` adds the manifest link + apple meta tags, `CloudIvrApp.js` calls registerPwa().

### Tests
- `js/tests/test_ring_group_triggers_2026-06.js` — 16/16 (ring group first-answer/late-answer/no-answer message/voicemail,
  missed log, messageOnly call, signed call.started/call.ended feed, trigger keyword/hours/plan rules).
- Regression run green: test_bulk_cancel_hangup_2026-10 (10/10), test_bulk_line_limit_ai_2026-10 (28/28),
  test_bulk_controls_edge_2026-10 (32/32), test_sip_short_logins_2026-06 (14/14).

## Known gaps / decisions to confirm with the owner
- Twilio inbound SMS path (`_index.js /twilio/sms-webhook`) does not run Text Triggers (web numbers are Telnyx; Twilio is off).
- Ring group members are phone numbers only (no "also ring my softphone/browser" member yet).
- Call recordings for web accounts are still Telnyx URLs (expire) — a manual Summarize on an old recording refunds with
  "could not be downloaded". Consider re-hosting recordings like voicemails.
- Webhook feed has no automatic retries (one attempt; failures visible in Recent deliveries).
- Telegram-bot users get none of these (web only by design).

## Future backlog — remaining 3CX parity (prioritised)
- P1 **Call queues** (hold music, position announcements, agents log in/out, ring strategies: all / round-robin / longest idle).
- P1 **Team accounts / extensions** (invite users, per-user extensions + softphone logins, roles, shared inbox) — prerequisite for queues.
- P1 **Live call dashboard / wallboard** (calls in progress, waiting, answered/missed today) + basic call reports (CSV, per number/agent).
- P1 Webhook retries with backoff + a native **Zapier app / CRM connectors** (HubSpot, Pipedrive, Salesforce click-to-call & contact pop).
- P2 **Call transfer & conference** in the browser phone (blind/attended transfer, 3-way calls), call park / pickup.
- P2 **WhatsApp Business** channel in the inbox (Telnyx/Meta), plus **outbound SMS** from the web inbox (2-way texting).
- P2 **Call whisper / barge / listen-in** for supervisors (queues), call tagging + dispositions.
- P2 **Mobile push notifications** for the installed PWA (incoming call, voicemail, Text Trigger ran).
- P2 **Speech analytics** on top of AI summaries (keyword spotting, trends per number), multilingual summary language choice.
- P3 Holiday calendars on Hours, music-on-hold upload, DID routing by caller ID / VIP lists, number porting in.
