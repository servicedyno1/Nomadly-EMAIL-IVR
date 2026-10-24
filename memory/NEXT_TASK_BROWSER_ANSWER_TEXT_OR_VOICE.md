# NEXT TASK — Answer incoming calls in the browser: choose Voice or Text (2026-10-24)

Status (2026-10-24 session 2): **BACKEND + FRONTEND BUILT, NOT TESTED.** Backend simulate→text→hangup flow curl-verified; frontend
compiles. Next agent: (1) restart `nodejs` if routes 404 (Node does NOT hot-reload), (2) one smoke screenshot (login civr.alice →
Numbers → number → "Browser ring" tab → toggle on → Save → "Ring me now" → banner → Answer as text → Text calls page live),
(3) testing agent for ALL 3 features together (crypto extra numbers, bot backup numbers, browser answering) at 1920x800 + 390x844,
(4) i18n: `node scripts/civr_i18n_extract.js && python3 scripts/civr_i18n_translate.py`, (5) node unit tests from §6, (6) docs.
Files built: see PRD.md "2026-10-24 (session 2)". Owner extra decision: browser phone auto-connects for numbers with browser ring on.
Preview is DRY-RUN (numbers are not live → real inbound calls cannot happen in preview; build a simulator, see §6).

## 1. Owner request (verbatim)
"analyze how user can also answer incoming call on the browser and select to use text call or voice"

## 2. Owner decisions (ask_human, 2026-10-24) — do NOT re-ask
| Question | Answer |
|---|---|
| Which numbers ring in the browser? | **Only numbers where the owner switches it on** (new per-number toggle "Ring me in the browser"; others keep today's routing) |
| How is answering-as-text charged? | **Same as outgoing text calls**: call rate + $0.03/min (TEXT_RELAY_RATE_PER_MIN), per started minute, from the wallet. Use `voiceService.getIvrCallRate(callerNumber) + RELAY_RATE()` (US/CA $0.18, intl $0.53). Do NOT also count plan minutes / bill via voice-service for that call. |
| Default when it rings? | **Both picked**: "Ask each time: Voice or Text" AND "Remember my choice per number" → per-number setting `answerMode: 'ask' | 'voice' | 'text'` (default 'ask') + a "Remember for this number" checkbox in the ringing banner that saves the choice. When remembered = text → the app auto-answers as text when it rings (still show banner briefly with "Answering as text…" + Cancel/Switch); remembered = voice → banner pre-highlights Voice (voice needs a click because browsers block audio/mic without a gesture — if auto, still require one tap). |
| How a ringing call gets attention | **Big flashing banner on every page**, **phone/desktop notification when the tab is in the background** (Notification API, ask permission once), **flashing tab title**. Vibration was NOT selected (do not vibrate for ringing). |
| Nobody answers in the browser | **Keep the number's current fallback** (forwarding no_answer/busy → voicemail → missed, exactly as today). |

## 3. How it works today (code facts)
- Inbound PSTN: `js/voice-service.js` `handleCallInitiated()` (~line 2289). Order: owner lookup → suspended check → AI agent (`tryInbound`) → minute-limit/overage check → creates `activeCalls[ccid]` session (+ `_limitTimer` 60 s interval that bills plan minutes/overage) → **SIP DEVICE RING** (~line 2478): only if `num.sipUsername && !hasIvr && !hasForwardAlways && !offHours` → dials `sip:<user>@sip.telnyx.com` via `_telnyxApi.createOutboundCall(from, sipUri)`, stores `activeBridgeTransfers[ringCcid] = { type:'sip_ring', originalCallControlId, unanswered:true, phase:'ringing', vmConfig, fwdConfig, chatId, num }`, `sessionRef.phase='ringing_sip'`, `sessionRef.sipRingCallControlId`, ring timeout `fwdConfig.ringTimeout || 25` s → hangs up ring leg.
- When the ring leg ends unanswered → `handleBridgeTransferHangup()` (~line 1843, branch ~1909) answers the original leg and runs fallback (forward no_answer/busy → voicemail → missed). When the ring leg is answered → bridged (~line 1790).
- Caller hanging up during SIP ring → cleanup ~line 4315 (`session.sipRingCallControlId`).
- Browser phone: `frontend/src/cloudivr/Softphone.js` (`useRtc` with `@telnyx/webrtc` `TelnyxRTC({login,password})` from `GET /numbers/:phone/sip`; `telnyx.notification` callUpdate → `call.inbound`, Answer button `call.ref.answer()`). It only rings if the user opened the panel and clicked **Connect**; the panel is hidden (opacity-0) when closed → no visible ring alert. Not live in preview (`c.live` false).
- Text calls engine (built 2026-10-24): `js/relay-call/index.js` (+ `preview.js` dry-run simulator), routes `js/cloudivr-web/relay.js`, UI `frontend/src/cloudivr/pages/TextCall.js` + `pages/textcall/{Setup,Live,Transcript,Composer,History}.js`. Webhooks are routed to it in `handleVoiceWebhook` (~line 2050) via `relayCall.owns(ccid, payload)` (in-memory `byCcid` or `client_state === base64('text_relay')`). Sessions: heartbeat `beatAt`, `revive()` from Mongo after restart, 60 s `sweep()`, `settle()` bills once (ledger `callRef: relay:<id>`). Collection `relayCalls` (TTL 90 days).

## 4. Target design
### 4.1 Per-number settings (web, Pro+ = `textRelay` feature for text; voice answer needs `sipCredentials`)
`num.features.browserRing = { enabled: bool, answerMode: 'ask'|'voice'|'text', lang: 'en'|'es'|'fr', voice: 'female'|'male', announce: bool }`
- API: `PATCH /numbers/:phone/browser-ring` in `js/cloudivr-web/numbers.js` (use existing `withNumber`, `gate`, `setField` helpers like the forwarding route ~line 385). Gate on plan `textRelay` (Pro+). Expose in `publicNumber`.
- UI: a card in the number's settings tabs (`frontend/src/cloudivr/pages/number/SettingsTabs*` — find where Forwarding/Voicemail tabs live) "Ring me in the browser" toggle + "When it rings: Ask each time / Always voice / Always text" + text-call language/voice/announce defaults.

### 4.2 Server: hold the call ringing while the browser decides
In `handleCallInitiated`, BEFORE the SIP ring block, add a browser-ring stage when `num.features.browserRing?.enabled && canAccessFeature(num.plan,'textRelay') && !hasIvr && !hasForwardAlways && !offHours && browserIsOnline(chatId)`:
- `browserIsOnline(chatId)`: the web app polled `GET /incoming` within the last ~20 s (keep `Map chatId → lastSeen` in a new module, e.g. `js/relay-call/incoming.js`). If no tab is open → skip the stage (today's routing, unchanged).
- Do NOT answer (caller hears ringback). Record a ringing entry: `ringing.set(ccid, { chatId, phone: to, from, startedAt, timeoutAt, sipRingCcid })`. If the number ALSO has SIP (`hasSip`), still run the existing SIP ring (so "Answer with voice" in the connected browser phone / Zoiper works) — the browser banner is just an extra alert. If it has no SIP, set our own ring timeout (`fwdConfig.ringTimeout || 25` s) that runs the SAME fallback as the SIP-no-answer branch (refactor that branch ~1909-1957 into a reusable `sipNoAnswerFallback(originalCcid, {vmConfig,fwdConfig,num,chatId,fromNumber}, hangupCause)` and call it from both places).
- Remove the ringing entry on: caller hangup (call.hangup for the original ccid — hook near the ~4315 cleanup), answered by SIP/browser voice (bridged), timeout fallback, or taken as text.

### 4.3 Answer as text (handover voice-service → relay engine)
New export in voice-service: `takeInboundForText(chatId, phone)` → atomically finds the ringing inbound session (activeCalls with `to===phone`, chatId match, phase 'ringing_sip' or new 'ringing_browser'), then:
- marks it taken, `clearInterval(session._limitTimer)` (text calls bill via relay, not plan minutes — owner decision), deletes `activeCalls[ccid]`;
- if a SIP ring leg exists: `delete activeBridgeTransfers[ringCcid]` FIRST (so its hangup does not trigger fallback) then `hangupCall(ringCcid)`; clear our browser-ring timeout;
- returns `{ ccid, from, to }` or null (already answered/ended → 409 "This call was already answered or ended.").
New relay engine function `answerInbound({ chatId, ccid, from, to, lang, voice, announce, callRate })`:
- wallet check (≥ one minute of `rate`), else 402 and leave the call ringing;
- creates the session like `start()` but `direction: 'inbound'`, `to` = caller number shown as "other", `callerId` = the CloudIVR number; `byCcid.set(ccid, id)`;
- `POST /calls/{ccid}/actions/answer` with `client_state: CLIENT_STATE` (so later webhooks route to relay) → on `call.answered` the existing `answered(s)` runs (intro speak, `transcription_start` with `transcription_tracks:'inbound'` = the caller's voice on an inbound leg, Google interim → Telnyx fallback). Since we answer ourselves, you may call `answered(s)` right after the answer command returns if `call.answered` is not delivered for already-tracked ccids — verify which happens.
- Intro wording for inbound: "Hello, you've reached <name or number>. This call is answered by text: the person is deaf or hard of hearing and types…" (add `introIn` per language in `LANGS`).
- Billing/outcome/history exactly as outgoing (`settle`), plus `direction:'inbound'` stored; History shows an "Incoming" badge; `view()` must expose `direction`.

### 4.4 Answer with voice
- If the browser phone is connected (`Softphone` status ready) and the SIP ring leg reaches it → banner "Answer with voice" calls the TelnyxRTC `call.ref.answer()`. Move `useRtc` state up (context provider in `Shell.js`) so the banner can see/answer the WebRTC call while the panel is closed; optional "Keep the browser phone online" (auto-connect on app load for numbers with browserRing + SIP).
- If the browser phone is NOT connected: the button connects the browser phone and answers when the INVITE arrives (call is still ringing via SIP ring leg), or shows "Connect the browser phone to answer with voice" — requires SIP credentials (Pro+). Numbers without SIP logins: show only "Answer as text" + a hint to create SIP logins for voice.
- Decline button: `POST /incoming/:id/decline` → immediately run the fallback (voicemail/forward/missed).

### 4.5 Web API (new `js/cloudivr-web/incoming.js`, register in `js/cloudivr-web/index.js` after relay)
- `GET /incoming` (poll every 2 s from Shell while logged in; marks browser online) → `{ calls: [{ id (ringing token, not the ccid), phone, from, startedAt, timeoutAt, answerMode, canVoice, canText, textRate }] }`.
- `POST /incoming/:id/text` `{ lang, voice, announce, remember }` → `{ call }` (relay view) — 409 if taken, 402 if wallet low; `remember` saves `answerMode:'text'`.
- `POST /incoming/:id/voice` `{ remember }` → only saves `answerMode:'voice'` (actual answer is in WebRTC) / returns SIP status.
- `POST /incoming/:id/decline`.
- Dry-run only: `POST /incoming/simulate` `{ phone, from }` → creates a pretend ringing call (no Telnyx), answering as text starts a preview relay session (reuse `preview.js`: pretend caller speaks first, e.g. "Hi, is this the support line?"), timeout runs a pretend fallback.

### 4.6 Frontend
- `IncomingProvider` in `Shell.js`: polls `GET /incoming`; renders `IncomingBanner` (fixed top, full width, high-contrast, `civr-relay-flash`-style pulsing ring, big caller number, number it came to, countdown to fallback, buttons **Answer as text** / **Answer with voice** / **Decline**, checkbox **Remember for this number**). data-testids: `incoming-banner`, `incoming-text-button`, `incoming-voice-button`, `incoming-decline-button`, `incoming-remember-checkbox`, `incoming-countdown`.
- Tab title flashing while ringing (`document.title` alternate "📞 Incoming call…"/original every 1 s; restore after). Desktop/phone notification via `Notification` when `document.hidden` (request permission from the number setting card or the first time the toggle is switched on; clicking the notification focuses the tab). No vibration (owner did not select it).
- Answer as text → navigate to `/cloudivr/app/text-call` and open `LiveCall` with the returned id (TextCall page already resumes `info.live`).
- `answerMode:'text'` remembered → auto-answer as text when the banner appears (show "Answering as text…" with a 3 s Cancel).
- i18n: re-run `node scripts/civr_i18n_extract.js && python3 scripts/civr_i18n_translate.py`; caller-number / transcript content must have `data-no-translate`.

## 5. Edge cases to handle
- Two tabs/devices: first `POST /incoming/:id/text` wins (atomic take) → others' banners disappear on next poll.
- Caller hangs up while ringing → entry removed, banner disappears, notify "missed" as today.
- Wallet can't cover one minute → text button disabled with message (call keeps ringing; fallback still runs on timeout).
- Numbers with IVR / forward-always / off-hours → no browser ring (same rule as SIP ring) — say so in the setting card.
- Node restart while ringing → ringing map lost: the call keeps ringing until Telnyx timeout; on restart sweep nothing to do (no relay doc yet). Acceptable; document.
- Blue/green deploy: webhooks may hit the other slot — text sessions already revive from Mongo.
- Plan minutes: text-answered inbound calls are NOT counted against plan minutes (owner chose "same as outgoing text calls" pricing).

## 6. Testing plan
1. Node engine test (extend `js/tests/relay_call_engine.test.js` or new `js/tests/relay_inbound.test.js`, axios stubbed): `answerInbound` sends `/calls/{ccid}/actions/answer` with relay client_state, intro (inbound wording), transcription_start inbound; hangup bills `ceil(min) × (getIvrCallRate(from)+0.03)` once; 402 when wallet low.
2. voice-service unit test of `takeInboundForText`: removes `activeBridgeTransfers` ring entry before hangup (no fallback triggered), clears `_limitTimer`, second take → null.
3. Backend pytest (dry-run): PATCH browser-ring (Starter → 403), GET /incoming shape, POST /incoming/simulate → text answer → relay live → say → hangup → history `direction:'inbound'`; decline → gone; double take → 409.
4. Testing agent UI (1920x800 + 390x844): setting card, banner on every page, countdown, title flash, remember checkbox, auto-answer as text when remembered, Answer as text → live text call screen, Decline, banner disappears when the simulated caller hangs up/timeout.
5. Before going live (P0): one real inbound call on a live Pro number (text answer + voice answer via browser phone + fallback when ignored).

## 7. Files to touch
- `js/voice-service.js` (browser-ring stage in `handleCallInitiated`, reusable no-answer fallback, `takeInboundForText`, caller-hangup cleanup, export)
- `js/relay-call/index.js` (`answerInbound`, `introIn`, `direction`), `js/relay-call/preview.js` (pretend caller for inbound), new `js/relay-call/incoming.js` (ringing map + online map)
- `js/cloudivr-web/numbers.js` (browser-ring setting + publicNumber), new `js/cloudivr-web/incoming.js`, `js/cloudivr-web/index.js`
- `frontend/src/cloudivr/Shell.js` (IncomingProvider + banner, lift `useRtc` from `Softphone.js` into a context), new `frontend/src/cloudivr/Incoming.js`, number settings tab card, `pages/textcall/History.js` (Incoming badge)
- memory: PRD.md / CHANGELOG.md / ROADMAP.md after testing
