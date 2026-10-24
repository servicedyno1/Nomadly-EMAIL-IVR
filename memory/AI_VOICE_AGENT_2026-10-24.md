# CloudIVR AI Voice Agent + Telnyx line-limit redial — 2026-10-24 (preview only, TESTED iteration_121)

Respond to the owner in English. NOT pushed, NOT deployed.

## Owner choices (ask_human 2026-10-24) — do NOT re-ask
- Line limit: **wait and redial until a line frees up** (no retry cap, never failed for being busy).
- Billing: **$0.20 per started minute** (61 s = $0.40). Pro plan and higher only.
- Wallet runs out mid-call: **agent says goodbye and hangs up**.
- Setup: voice + personality/script, FAQs, transfer to a human, summary + transcript, do-not-call list.
- OpenAI key: **owner's key already in the vault** (`APP_OPEN_API_KEY`; verified with `gpt-realtime-mini`).

## Architecture
- `js/ai-agent/` — `bridge.js` (Telnyx media protocol μ-law ⇄ OpenAI Realtime GA `session.type=realtime`, `audio/pcmu`,
  semantic_vad, barge-in via `clear` + `conversation.item.truncate`, tools end_call/transfer_call/record_outcome/opt_out/take_message,
  AI disclosure opening, voicemail on AMD machine, marks for greeting/end), `calls.js` (inbound `tryInbound`, campaign `dialLead`,
  webhooks, wallet watch across all live AI calls of the account, finish → summary + aiCalls record + billing), `store.js`
  (aiAgents / aiCalls / aiDoNotCall), `hours.js` (8am–9pm lead-local, NANP area codes + country codes), `index.js` (WS upgrade on
  the Node HTTP server; paths `/ai-agent/stream/<token>` and `/cloudivr-web/ai-agents/test/<token>`, optional `/api` prefix).
- `backend/server.py` — `@app.websocket("/api/{path}")` proxies only those two paths to ws://127.0.0.1:5000 (preview ingress).
  **Prod droplet**: nginx proxies straight to Express — the server block must pass `Upgrade`/`Connection` headers for WebSockets.
- `voice-service.js` — AI-owned calls short-circuit `handleVoiceWebhook`; inbound AI answer right after the suspended-number
  check (plan minutes untouched); passes `sipHangupCause` to bulk `onCallComplete`; Telnyx dial errors carry `lineLimit`.
- `telnyx-service.js` — `createOutboundCall` errors return `code`/`status`; `isLineLimitError` (90041/90042/90043/90103/429/text).
- `bulk-call-service.js` — `requeueForLines` (lead → pending, `lineRetries++`, `waitingForLine`, backoff 5s→60s via
  `retryLater`); dial-time limit = unlimited retries; unanswered SIP 403 on hangup = requeue (safety valve 30 — a 403 can also be
  a real carrier block). AI campaigns (`mode:'ai'`, `agentId`, `agentName`): DNC → `skipped`, outside hours → stays pending +
  `waitingForHours` (recheck 10 min), wallet check incl. live AI calls, `billAiLead` (aiBilling from calls.js), stats
  interested/callback/optedOut/skipped. `fireNextBatch` exported.
- Web API (`js/cloudivr-web/ai.js`): `/ai-agents` CRUD, `/ai-agents/:id/test`, `/ai-calls`, `/ai-calls/:id`, `/ai-dnc`,
  `PUT /numbers/:phone/ai-agent`. `POST /campaigns {mode:'ai', agentId,…}` (calls.js `createAiCampaign`). Plan flag `aiAgent`
  (pro/business) in phone-config + `access.aiAgent` + webFeatures.
- Frontend: `pages/AiAgents.js` (list, tabs agents/calls/dnc, edit page), `pages/ai/{AgentForm,TestTalk,talk,AiCalls,DncList,
  AiCampaignFields}.js`, number tab `number/AiAgentTab.js`, campaign kind switch + AI stats/lead results in Campaigns/CampaignDetail.
  Browser test talk = real OpenAI (free for the user, 3 min/talk, 15 min/day). FR/ES strings added via the i18n scripts.

## Tests
- `P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 node js/tests/test_bulk_line_limit_ai_2026-10.js` → 27/27
  (start a sandbox mongod on 27999 first). Regression `test_bulk_telnyx_2026-10.js` 48/48.
- `node scripts/ai_agent_ws_test.js <wss url from POST /ai-agents/:id/test> scripts/fixtures/q.ulaw 25` → real transcript.
- testing_agent iteration_121: backend 22/22, frontend 100%.

## Not done / next
- Real Telnyx phone call with the AI agent not placed (preview is dry-run). First live test: owner's test number.
- Prod nginx WebSocket headers; optional env `AI_AGENT_MODEL` (default gpt-realtime-mini), `AI_AGENT_RATE_PER_MIN` (0.20).
