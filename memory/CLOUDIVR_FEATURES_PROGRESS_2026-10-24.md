# CloudIVR web — 6 Onoff-style features · PROGRESS / HANDOFF (2026-10-24)

Status: BACKEND DONE (unit tests 31/31) · FRONTEND UI NOT BUILT · NOT pushed, NOT deployed.
Respond to the owner in English. Preview only — `WEB_CLOUDIVR_DRY_RUN=true` (calls/purchases MOCKED).

## Owner's choices (ask_human, 2026-10-24) — do NOT re-ask
- Plan page: default **Pro**, "Recommended" badge, accurate ✓/✗ list  → DONE.
- Features: On/off hours · Call notes · Call me first · Voicemail transcription · Voicemail greeting language · Private mode.
- **Call me first** = a **switch on the browser-phone dialer, per call** (not a global setting).
- **Private mode** = one tap to hide, **tap the same button again** to show (no PIN).
- **Transcription key** = owner's **own OpenAI key** (`APP_OPEN_API_KEY`, already present in backend/.env from the vault).
  If it is missing/invalid → ask via `secrets_request` (never in chat). Code already degrades to `transcriptStatus: 'unavailable'`.

## Done (uncommitted working tree at handoff; platform auto-commits)
| File | What |
|---|---|
| `frontend/src/cloudivr/PlanFeatures.js` (new) | shared plan ✓/✗ list + `planFor(plans, gate)` |
| `frontend/src/cloudivr/pages/BuyNumber.js`, `landing/PricingFaq.js`, `number/BillingTab.js` | Pro default + Recommended, uses `webFeatures` |
| `frontend/src/cloudivr/ui.js` (`Locked need=`), `NumberDetail.js`, `Softphone.js`, `SettingsTabs.js` | upgrade wording/links only |
| `js/number-hours.js` (new) | `defaultHours`, `validateHours`, `isOpen` (tz-aware, overnight ranges) |
| `js/voicemail-greeting.js` (new) | EN/FR/PT/AR standard greeting + closed messages, `spokenNumber`, `publicLangs` |
| `js/voicemail-transcribe.js` (new) | OpenAI `whisper-1` via `openai` v6 (root node_modules), key `APP_OPEN_API_KEY` |
| `js/cloudivr-web/voicemail-delivery.js` (new) | copy MP3 to audio storage, transcribe, phoneLogs row, inbox (bot.sendAudio shim), email w/ MP3 attachment |
| `js/cloudivr-web/notes.js` (new, mounted in index.js) | call notes CRUD + `attachNotes` onto log rows |
| `js/cloudivr-web/numbers.js` | catalog `webFeatures`/`recommended`/`recommendedPlan`/`voicemailLanguages`; voicemail `language` + `transcribe`; hours GET/PUT; logs carry `transcript`, `transcriptStatus`, `note` |
| `js/cloudivr-web/calls.js` | `GET/POST /calls/callback` (Call me first) |
| `js/cloudivr-web/auth.js` | `sendMail(to, subject, html, attachments)` |
| `js/voice-service.js` | `playVoicemailGreeting` (language aware), `routeOffHours`, `session.offHours` skips SIP ring, `off_hours` phase hangs up on speak end, web voicemail → `_webVoicemail()` |
| `js/tests/test_cloudivr_hours_vm_notes_2026-10.js` (new) | 31/31 pass: `node js/tests/test_cloudivr_hours_vm_notes_2026-10.js` |

## API contract for the UI (all under `/api/cloudivr-web`, cookie session)
- `GET /numbers/:phone` → `number.features.hours` = `{enabled, timezone, days:{sun..sat:{on,start,end}}, offAction:'voicemail'|'message', offMessage}`;
  `number.features.voicemail` = `{enabled, greetingType, customGreetingUrl, forwardToEmail, ringTimeout, language:'en'|'fr'|'pt'|'ar', transcribe}`.
- `GET|PUT /numbers/:phone/hours` → `{hours, openNow}`. 400 `invalid_hours` w/ message. Every plan. `offAction:'voicemail'` silently becomes `'message'` without the voicemail plan feature.
- `PATCH /numbers/:phone/voicemail` body adds `language`, `transcribe` (bool). Languages list: `catalog.voicemailLanguages` = `[{code,label,sample}]` (`useShell().catalog`).
- `GET /numbers/:phone/notes`, `POST /numbers/:phone/notes {text, peer?, direction?, logId?, callAt?}` (409 if logId already has a note), `PATCH /notes/:id {text}`, `DELETE /notes/:id`. Max 2000 chars.
  Notes saved from the softphone have no logId → matched to log row by peer digits ±15 min.
- `GET /numbers/:phone/logs?kind=` rows now include `transcript`, `transcriptStatus` ('done'|'empty'|'off'|'failed'|'unavailable'|'too_large'), `note {id,text,...}`.
- `GET /calls/callback` → `{myPhone}` (last used mobile). `POST /calls/callback {callerId, myPhone, to}` → dry-run `202 {dryRun, rate, message}`, live `201 {started, callId, rate}`.
  Gate: `ivrOutbound` (Pro+). Errors: `invalid_my_phone`, `invalid_number`, `blocked_destination`, `same_number`, `insufficient_balance` (402), `call_failed` (424).

## TODO — frontend (P0), keep components small, every control needs data-testid
1. **Hours tab** — new `pages/number/HoursTab.js`, add `['hours','Hours',null,HoursTab]` to `TABS` in `NumberDetail.js`. Toggle enabled, time-zone select
   (default `Intl.DateTimeFormat().resolvedOptions().timeZone`), 7 day rows (on toggle + start/end `<input type=time>`), offAction select (voicemail option disabled w/o `num.access.voicemail`),
   optional closed message textarea, "Open now / Closed now" pill from `openNow`, Save → `PUT hours` (use `useSave(num,'hours',reload)` with method 'PUT').
2. **Voicemail tab** (`SettingsTabs.js VoicemailTab`) — add greeting language select (from `catalog.voicemailLanguages`, show `sample` text under it; only matters for Standard greeting)
   + "Transcribe voicemails" toggle; include `language`, `transcribe` in the save body.
3. **Transcripts** — `LogTable.js` show `l.transcript` (quoted text) / status hint under the audio; Inbox already shows the caption text (transcript is in it).
4. **Call notes** — Softphone: textarea visible during/after a call ("Notes for this call"), Save → `POST /numbers/:sel/notes {text, peer: dest or caller, direction}`;
   LogsTab/LogTable: show `l.note.text` + "Add note"/"Edit" per row (`POST` with `logId` / `PATCH /notes/:id`).
5. **Call me first** — Softphone: switch "Call me first (ring my mobile)" + "My mobile" input (prefill from `GET /calls/callback`); when ON the Call button
   POSTs `/calls/callback {callerId: sel, myPhone, to: dest}` instead of WebRTC (works without SIP register; show dry-run message via toast).
   Only for numbers with `access.ivrOutbound`. NOTE: softphone number list currently filters `access.sipCredentials` — call-me-first needs `ivrOutbound`; adjust list.
6. **Private mode** — one-tap button in TopBar (EyeOff/Eye icon, `data-testid="topbar-private-mode-button"`); state in ShellCtx persisted in `localStorage` (`civr.private`);
   when ON mask phone numbers, contacts (from/to in logs), SMS/inbox text and softphone destination (e.g. `+1 ••• ••• 0100`, "Message hidden"). Tap again to show. Small banner "Private mode on".
   Suggested helper `mask(phone)` + `<Private>` wrapper in ui.js; apply in Numbers, NumberDetail header, Dashboard widgets, LogTable, Inbox, Softphone.
7. Plan copy already lists hours/notes/voicemail languages/call me first (`WEB_FEATURES` in numbers.js) — private mode is not listed yet (add `['private','Private mode',null]` if wanted).

## TODO — backend / verification (P1)
- Validate `APP_OPEN_API_KEY` works for `whisper-1` (tiny real request or check logs); if 401 → `secrets_request`.
- `supervisorctl restart nodejs` after editing `js/` (hot reload does NOT cover the Node service).
- Then testing_agent (frontend + backend): hours save/validation, voicemail language/transcribe save, notes CRUD + owner isolation (bob can't touch alice's notes),
  call-me-first dry-run + errors, private mode masks/unmasks + survives reload, plan page still defaults to Pro. Creds: memory/test_credentials.md (alice/bob).

## ⚠️ Push / deploy warning
- The owner asked to push to **main** with a GitHub token pasted in chat → NOT done (agents use "Save to GitHub" only; token must be revoked).
- `main` is what the live server builds from (CI deploys app-main, then WhiteLabel sync redeploys wl/voodoo/proshop). This change set edits
  `js/voice-service.js` (the LIVE call engine for every brand) and the UI is half-built → only push/deploy after the frontend is finished and tested.
