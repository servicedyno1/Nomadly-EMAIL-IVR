# NEXT TASKS for the next agent — CloudIVR web (written 2026-10-24)

Respond to the owner in **English**. Preview only: `WEB_CLOUDIVR_DRY_RUN=true` means number purchases, phone calls and campaign
dialing are SIMULATED. The browser AI test talk is REAL (owner's OpenAI key `APP_OPEN_API_KEY`). Nothing is pushed or deployed.
Context: `memory/AI_VOICE_AGENT_2026-10-24.md` (AI agent architecture) · `memory/CLOUDIVR_FEATURES_PROGRESS_2026-10-24.md` · `memory/PRD.md`.
Logins: `memory/test_credentials.md` (Alice = Business number + agent "Ava"; Bob = Starter number, use him for plan-gate checks).
Rule: after editing anything in `js/`, run `sudo supervisorctl restart nodejs` (Node has no hot reload).
Before starting, use ask_human to confirm the plan and the choices listed under each task (do NOT re-ask anything already decided in memory).

---

## Task 1 — Pending checks (verify; fix only what is broken)  · P1 · small

### 1a. Coupon countdown banner (Dashboard)
- UI: `frontend/src/cloudivr/pages/dashboard/Banners.js` (lines ~12-35). testids `dashboard-coupon-banner`, `dashboard-coupon-code`,
  `dashboard-coupon-countdown`, `dashboard-coupon-use`.
- API: `GET /api/cloudivr-web/coupons/today` (`js/cloudivr-web/extras.js` ~line 170). Returns `{coupon:null}` when there is no daily
  coupon, so the banner is correctly hidden then.
- Verify: the banner shows when a coupon exists; the countdown ticks every second down to 23:59:59 UTC; it hides once the coupon is
  used or expired; "Use it" opens `/app/buy?coupon=CODE` and the code is applied at checkout; it works in FR/ES; no overflow at 390px.
- If there is no coupon today on the preview DB, seed one through the daily coupon system (check `dailyCouponSystem.getTodayCoupons`
  in `js/_index.js`) — do it in the LOCAL preview DB only.

### 1b. Welcome card → Telegram channel
- UI: same `Banners.js` (~lines 38-55). It shows only for accounts in their **first 30 days**, and only when `catalog.channelLink` is
  set. testid `dashboard-channel-join`. The sidebar link `sidebar-channel-link` lives in `Shell.js`.
- Config: `CLOUDIVR_CHANNEL_LINK=https://t.me/CloudIVRNET` is in the preview `backend/.env`; it reaches the UI through
  `GET /public/catalog` → `channelLink`.
- Verify: register a brand-new account → the card shows → the link opens `https://t.me/CloudIVRNET` in a new tab → closing it keeps it
  hidden after a reload. Alice/Bob are older than 30 days, so they should NOT see the card (only the sidebar link).
- Check `CLOUDIVR_CHANNEL_LINK` is also in the vault / production env. If it is missing there, tell the owner (don't guess the value).

### 1c. Central SIP list (`/cloudivr/app/sip`)
- UI: `frontend/src/cloudivr/pages/Sip.js` (loads `GET /numbers`). Per-number SIP tab: `pages/number/SipTab.js`.
- Verify: every number with SIP (Pro+) is listed with its username, domain and a reveal/reset password action; Starter numbers show the
  upgrade note instead of credentials; an account with several numbers lists all of them; Bob never sees Alice's credentials; copy
  buttons work; works in FR/ES and at 390px.

Test with the testing agent (frontend). Note what you find in `memory/PRD.md`.

---

## Task 2 — AI agent books appointments in Google Calendar  · P1 · medium/large

Goal: during a call (inbound or campaign), the agent checks free times and books an appointment straight into the business owner's
Google Calendar, then confirms the date and time to the caller.

### Ask the owner first (ask_human)
- Who connects a calendar: **each customer connects their own Google Calendar** (recommended) vs one shared calendar.
- Appointment length (e.g. 30 min default, set per agent) and the bookable hours (reuse the number's Hours tab or set them per agent).
- Should the caller also get an SMS confirmation from the CloudIVR number? (SMS costs apply.)
- A Google OAuth app is needed: `GOOGLE_OAUTH_CLIENT_ID` / secret are NOT set yet (Google sign-in is hidden for that reason).
  Collect them with `secrets_request` — never in chat. Google Calendar access also needs Google's app verification for public use.

### Must do
- Call `integration_expert` with `INTEGRATION: Google Calendar` before writing any code, and follow its playbook exactly.
- OAuth connect/disconnect per web account: store refresh tokens encrypted (a new collection, e.g. `aiCalendarLinks`), never send
  them to the browser.
- Agent setting: "Book appointments" toggle + pick a calendar + appointment length (`js/ai-agent/store.js` `cleanAgent` / `FIELDS`,
  `pages/ai/AgentForm.js`).
- Realtime tools in `js/ai-agent/bridge.js` `tools()` + `runTools()`:
  - `check_availability({date})` → free slots (Google freeBusy).
  - `book_appointment({start, name, phone, note})` → creates the event.
  These are async: answer the function call (`function_call_output`) when the Google API returns, then send `response.create`. Keep a
  short filler line ("One moment while I check…") so the caller doesn't hear silence. Add the booking rules to `instructions()`.
- Use the caller's time zone (from the number/area code: `js/ai-agent/hours.js` `zonesOf`) and repeat the time back to confirm.
- Save the booking on the aiCalls record (`booking: {start, eventId, link}`) and show it in Call history (`pages/ai/AiCalls.js`) and
  in the owner's inbox notice (`calls.js finish`).
- New outcome `booked` (`store.js OUTCOMES`; stats in `bulk-call-service.js recalcStats`; labels + FR/ES strings).
- Test: unit-test the tool handlers with a stubbed Google client (style of `js/tests/test_bulk_line_limit_ai_2026-10.js`), plus one
  real browser test talk that books into a test calendar. Then run the testing agent.

---

## Task 3 — Playable recordings of AI agent calls  · P1 · medium

Goal: every AI call (inbound, campaign, browser test) gets an MP3 recording, with a player next to the transcript in Call history.

### Ask the owner first (ask_human)
- Record every AI call by default, or only when the owner turns it on per agent (recommended: a per-agent switch, default on). Some
  places require telling callers they are being recorded. Should the agent's opening line add "this call may be recorded"?
- How long to keep recordings (e.g. 90 days) and whether recording is free or costs extra.

### Suggested build (no new provider needed)
- The bridge already sees both directions: caller audio (`onMedia`, μ-law 8 kHz) and agent audio (`response.output_audio.delta`).
  Collect both into a timeline in `js/ai-agent/bridge.js` (the caller track continuously, agent chunks at their play position, and
  cut agent audio at the truncate point on barge-in). On `stop()` mix them to one 8 kHz track.
- Encode to MP3 with ffmpeg (already installed: `-f mulaw -ar 8000 -ac 1 -i pipe: -b:a 32k out.mp3`) and store it with
  `audioLibraryService.saveBuffer(buf, chatId, 'ai-call.mp3', 'audio/mpeg')` — the same storage voicemails use
  (see `js/cloudivr-web/voicemail-delivery.js`). Never store audio as base64 in Mongo.
- Save `recordingUrl` on the aiCalls record (`calls.js finish` and `onTest`). Play it with `playUrl()` from `frontend/src/cloudivr/api.js`
  in `pages/ai/AiCalls.js` (an `<audio controls>` above the transcript, testid `ai-call-recording-player`). Add it to the inbox
  notice too.
- Alternative: Telnyx `record_start` on the AI call leg → `call.recording.saved` (see `voice-service.js handleRecordingSaved` ~line
  4198). It only works on real phone calls, not browser tests, so the bridge approach above is preferred.
- Owner isolation: only the account's own recordings (route `GET /ai-calls/:id` already checks `chatId`).
- Test: a unit test that feeds two μ-law streams into the mixer and checks the MP3 length; one real browser test talk
  (`scripts/ai_agent_ws_test.js`) that checks the saved recording plays; then run the testing agent.

---

## Still open from the AI agent work (not part of these 3 tasks)
- No real Telnyx AI phone call has been made yet. The first live test should use the owner's test number +13025141000.
- Production droplet nginx must pass the WebSocket `Upgrade` / `Connection` headers before the AI agent can take real calls there.
