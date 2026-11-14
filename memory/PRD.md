# PRD — Nomadly / CloudIVR / Smadav / Speechcue / Voodoo Land / ProShop

## Original Problem Statement
Multi-brand telecom platform with virtual numbers, IVR, call forwarding, voicemail, SIP extensions, AI receptionist, and customer-managed numbers. Brands: Nomadly, CloudIVR, Smadav/Speechcue, Voodoo Land, ProShop.

## Core Architecture
- **Frontend**: React (CRA + Craco) at `/app/frontend/`
- **Backend**: FastAPI (Python) at `/app/backend/` + Express/Node.js bot at `/app/js/`
- **Database**: MongoDB via `MONGO_URL`/`DB_NAME`
- **SIP Stack**: Self-hosted Kamailio SBC + Asterisk PBX + RTPengine on DigitalOcean (`nomadly-sip-1`)
- **Providers**: Bird (outbound/bulk), Telnyx (inbound DID), SignalWire (legacy), DIDWW (assessed), Zadarma (assessed), Multitel (assessed)

## What's Been Implemented

### Completed (Agent-Tested, Not User-Confirmed)
1. **Telnyx SIP inbound-only provider** — numbers, SIP trunk, Asterisk routing, 12/12 tests
2. **Customer migration from SignalWire** — 19 Nomadly + 3 Voodoo swapped
3. **AI migration to Bird/CallEngine** — outbound/inbound AI, RTP bridge, 25/25 tests
4. **Meechchop6 campaign** — caller ID migrated, Bird verified, resumed pending-only
5. **Bird AMD (answering machine detection)** — 16/16 tests, live machine detected
6. **Early campaign failure alerts** — Telegram when most of first 10 calls fail
7. **Spenza eSIM safeguard** — no auto-rebuy on provider failures, alert only (deployment unverified)
8. **Deployment verification** — deploy_verify.sh with retry and Telegram alerts

### Completed 2026-11-14
9. **Multitel DID provider assessment**
   - API credentials working (v3 REST API)
   - 99 countries, 17 no-paperwork, US 2,267 areas
   - US: $0 setup + $0.60/mo (cheaper than Telnyx)
   - Account needs ~$5 top-up to buy

10. **Inbound email pipeline (richard@cloudivr.net)**
    - MX record: cloudivr.net → receive.forge.rmta.net (Cloudflare)
    - Resend receiving enabled + verified
    - Webhook: cloudivr.net/api/cloudivr-web/email-inbound/webhook
    - Backend: `/app/js/cloudivr-web/inbound-email.js` (webhook + admin API)
    - Frontend: `/app/frontend/src/cloudivr/pages/admin/InboxAdmin.js`
    - Wired into AdminApp.js as "Inbox" tab
    - Local webhook test: ✅ stored in MongoDB
    - **Needs production deployment for live email flow**

11. **Zadarma number ordered** (+1 646 795 8069)
    - Status: "checking" (activation pending)
    - SIP forwarding configured to sip-tls.cloudivr.net:5061
    - Asterisk pjsip_zadarma.conf and dialplan created
    - Provider adapter built: `/app/js/zadarma/provider.js`

### Provider Comparison (US Local Numbers)
| Provider | Setup | Monthly | Inbound/min | Status |
|----------|-------|---------|-------------|--------|
| Telnyx | $1 | $1 | ~$0.01 | Active (current) |
| Multitel | $0 | $0.60 | $0.006 | Ready (needs top-up) |
| Zadarma | €0 | €3.20 | included | Number activating |
| DIDWW | varies | $1.20-$5 | varies | $0 balance, no setup |

## P0 — Immediate
- [ ] Top up Multitel account, buy test US number, test full SIP routing
- [ ] Deploy inbound email code to production
- [ ] Verify Zadarma number activation

## P1 — Next
- [ ] Build full Multitel provider adapter (search/buy/release/SIP)
- [ ] Wire Multitel into voice-service, Bird caller-ID, QuickIVR
- [ ] Country catalog in CloudIVR number selection (17 no-paperwork countries)
- [ ] Verify Spenza eSIM safeguard in production (deployment race)

## P2 — Backlog
- [ ] DIDWW implementation (when funded)
- [ ] VoIP.ms KYC completion
- [ ] AWS Chime SDK manual review
- [ ] Number porting from Telnyx to Multitel
- [ ] International number coverage expansion

## Key Files
- `/app/js/zadarma/provider.js` — Zadarma DID adapter
- `/app/js/zadarma/index.js` — Zadarma API client
- `/app/js/telnyx-sip.js` — Telnyx SIP adapter
- `/app/js/cloudivr-web/inbound-email.js` — Resend inbound email handler
- `/app/frontend/src/cloudivr/pages/admin/InboxAdmin.js` — Admin inbox UI
- `/app/ops/sip-server/asterisk/pjsip_zadarma.conf` — Zadarma SIP trunk config
- `/app/ops/sip-server/asterisk/extensions.conf` — Dialplan with from-zadarma context
- `/app/memory/zadarma_no_id_cities.csv` — Zadarma US/CA cities (no ID required)
- `/app/memory/zadarma_all_countries.csv` — Zadarma all-country availability

## 2026-11-14 — Prod admin login "busy or restarting" (RESOLVED in prod config)
- Root cause: Telnyx blocked both Telnyx accounts ("This user has been marked as blocked", since 2026-11-12 12:07 UTC). MAIL_PROVIDER=telnyx on all 4 brands → every app email failed (541+), incl. admin sign-in codes → /admin/login returned 502 → Cloudflare replaced it with its own page → UI showed generic "busy" text.
- Fix: droplet shared envs (app-main/wl/voodoo/proshop) → MAIL_PROVIDER=resend + RESEND_API_KEY (backups backend.env.bak-20261114T102347). All 4 redeployed via deploy.sh (call drain). Real Resend send from prod verified.
- Code (preview, needs Save to GitHub): app errors 502→503 in cloudivr-web admin-auth/ai/fax/leads/phone-auth so Cloudflare passes the real message.
- Open: Telnyx account block (inbound Telnyx numbers/SIP list failing). User chose to handle email only for now.
- 2026-11-14 follow-up: Inbox tab IS live in prod build (chunk 763, release 33f1d02). User's tab was loaded 10:08:45, before the 10:09 build swap → needs reload. inboundEmails in prod: 2 test mails, bodies backfilled from Resend (key was missing at receive time).
- 2026-11-14: Webhook now verifies Resend/Svix signature (RESEND_WEBHOOK_SECRET, 5 min tolerance, fail-closed). Test: js/tests/test_inbound_email_signature.js (7/7). Rotated: old webhook 4036de39 deleted, new 0cfb7391 created; secret written only to droplet shared/app-main/backend.env. Code goes live after Save to GitHub → then verify with a real email.
- 2026-11-14 Infobip number scan (read-only, 249 countries): balance €8.21, owns 1 CA number. In stock + no paperwork: CA, PR, US(10DLC), AR, FR, MX, PL, RO, UA, CL, LT, MY, HR, ES. Address-only (company name+address): AU, DK (no stock). Sweden company name only (no stock). Details: memory/infobip_number_requirements.csv. No purchase made.

## 2026-11-14 — Customer legal profile (individual / business) for number resale
- New: js/cloudivr-web/legal-profile.js (validate, 428 gate, Google Places (New) proxy /address/suggest + /address/place, numberResaleRecords). Key GOOGLE_MAPS_API_KEY (backend, server-side only).
- Gate on: /numbers/buy, /numbers/checkout, /numbers/:phone/extra(-checkout), /numbers/:phone/replace, /fax-numbers, /mobile-numbers.
- Every sale → numberResaleRecords {resold:true, endUser, note} + number doc resold/endUser. Infobip: resale note PUT best-effort — Infobip API does NOT keep `note` on this account (verified). infobipRequirements() ready for request-based countries (AU/DK companyName+companyAddress) — Resource Request ordering not built yet.
- UI: frontend/src/cloudivr/profile/* — sign-up dialog after onboarding (skippable, profileDue), banner for existing users, Buy page gate replaces Checkout, Settings card, admin Users drawer "Number holder details".
- Tests: iteration_265 (backend 22/22, frontend all flows); fixed after: modal stacking, replace/mobile gates, fax shared instance.
- Infobip full offer scan (2994 lookups, 249 countries): 58 countries with offers → memory/infobip_full_report.xlsx (+csv), preview link /reports/infobip-number-offers.xlsx. Resale terms are NOT in the API (portal offer cards only).

## 2026-11-14 — Spenza gets customer details (eSIM + Texting/mobile numbers)
- js/spenza.js spenzaUser(): user.name = legal holder (business name / full legal name); US addresses also send address/city/state (Spenza fields are US-format; non-US → name only). syncProfile(): PUT /api/v1.1/users/{email} when a customer with a Spenza user saves details (skipped in dry-run).
- Gate also on POST /esim; resale records provider spenza-esim / spenza-mobile with lineId; phoneNumber filled when Spenza assigns it (resaleNumber()).
- Frontend: api.js intercepts 428 profile_required → ProfileAskHost dialog (mounted in CloudIvrApp) → re-sends the same order after save (covers app + landing checkouts).
- Fixed pre-existing: Texting Number page left the pay form open after a successful order (double-pay risk) → form closes + list reloads.
- Tests: iteration_266 (summary only; backend 5/5 + 22 regression, frontend 6/6). Spenza live sync not testable in preview (dry-run).

## 2026-11-14 — Infobip as Telnyx replacement: inbound + Bird auto-verify TEST PASSED (preview)
- Test number: Infobip-owned CA +16479457172 (no purchase). Bird armed → Bird called → Infobip CALL_RECEIVED → our webhook → answered + recorded → Whisper → code 010461 submitted → Bird VERIFIED, outbound_enabled true.
- Fixes: infobip start-recording body must be { recording: { recordingType:'AUDIO' } }; CALL_PRE_ESTABLISHED no longer replays a 2nd call.initiated; Bird capture detects WAV (Infobip) vs MP3; Infobip owned numbers now included in Bird auto-link (ib.refreshOwned/ownedNumbers).
- Preview config: SELF_URL updated to current preview; Infobip webhook profile nomadly-dev-voice2 notifyUrl → current preview /api/infobip/voice-webhook (was a dead old preview URL).
- PRODUCTION: no INFOBIP_* env on droplet yet → needs API key, base URL, a prod calls configuration + subscription/profile pointing at https://<prod>/api/infobip/voice-webhook, before enabling.

## 2026-11-14 — Infobip countries + production setup
- js/infobip/countries.js: INSTANT (AR CL ES FR HR LT MX MY PL PR RO UA) + REQUEST (AT CR DO EC PE PY SE AU DK DE CY; keys companyName/companyAddress/contactPerson; DE/CY clientType LOCAL).
- numbers.js: countries() adds/marks provider 'infobip' (when INFOBIP enabled); search uses ib.searchNumbers directly, surcharge 0 (plan price only), skips Telnyx paperwork check; purchaseLocked prepaid/presetOrder + viaInfobip (no Telnyx call-control/SIP-cred calls, provider saved).
- number-requests.js: POST /numbers/request (gate, debit plan price, Infobip POST /resources/1/requests), GET /numbers/requests, tick (10 min; 1 min dry-run) polls status → claim 'activating' → find unassigned owned number in country → voice+SMS routing → numbersApi.purchase(prepaid) ; declined → refund once.
- Infobip SMS inbound: /infobip/sms-webhook/:key (HMAC of API key) → handleInboundSms; ib.routeSms on buy (deletes v1 config then POST v2 HTTP_FORWARD).
- Live call check (preview): Bird call +12074892004 → +16479457172 → Infobip → owner found → answered → IVR greeting spoken. DTMF/voicemail not exercised (test script hangs up on answer). Test number attached to preview user 5000000000000092 (liveTest).
- PRODUCTION: Infobip calls config 'nomadly' + profile/subscription 'nomadly-prod-voice' → https://2.speechcue.com/infobip/voice-webhook created; INFOBIP_API_KEY/BASE_URL added to /opt/nomadly/shared/app-main/backend.env (backup taken). NOT restarted — goes live with next deploy (Save to GitHub). Other brands not enabled.
- Tests: iteration_267 backend 11/11, frontend 90% → fixed pending list refresh, refund idempotency, atomic activation claim, gate for all request countries.

## 2026-11-14 — Infobip default + Bird lookups
- Provider chain (signalwire/index.js w.searchNumbers): Infobip FIRST for local numbers → Telnyx SIP → SignalWire → old Telnyx. Toll-free unchanged. Infobip search filters area code client-side (API ignores it) and accepts additionalSetupRequired null (US numbers lack the field).
- US/CA added to infobip INSTANT; keep toll_free type; web search for US/CA goes through chain; surcharge 0 only when the hit is from Infobip (hit.provider).
- w.assignNumberToCallControlApp returns true for Infobip-owned numbers (no Telnyx call).
- Lookups: Bird first everywhere (signalwire lookup(), validateForwardingDestination, bulk-esim lookupOne); Telnyx lookups removed. Caller NAME: Bird + Infobip don't return names (Bird docs; Infobip lookup "route not available") → CNAM = SignalWire → Multitel (Telnyx removed).
- Self-tested: US no-area → 10 Infobip; 631 → 2 Infobip; 212 → SignalWire; CA → Infobip; toll-free → SignalWire; Bird lookup US/GB ok; Multitel CNAM ok.
