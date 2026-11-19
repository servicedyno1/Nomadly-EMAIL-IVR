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

## P0 — Immediate (2026-11-16)
- [x] SIP test page login fix (all 4 brands, deployed; registration verified live) — see CHANGELOG 23:50Z
- [ ] Customer @Spirits_Of_The_Ancesters to retry /call (not user-confirmed)
- [x] Reviews moderated (admin approve), custom caller ID OFF, Bird-only calling — all 4 brands (2026-11-17)
- [x] Test page /call live E2E (2026-11-17): Free Test outbound PASS on all 4 brands (user answered); My Credentials inbound ring+answer+2-way RTP PASS on Nomadly & Voodoo (Smadav/PROSHOP have no active numbers). Inbound route was never broken. "Beep" = robot browser's fake mic.
- [x] CloudIVR web dashboard browser phone: incoming + outgoing live E2E PASS (2026-11-17, Nomadly; WL brands have no web accounts)
- [ ] Real Bird-only test calls: landing browser call, bot Quick IVR transfer + OTP (+ hold music)
- [ ] Campaign results: 34 answered-but-no_answer calls (deploy windows) — confirm, fix WL brands' ARI app split
- [ ] Backup carrier switching end-to-end (switch, alert, recovery)
- [x] WL dashboard browser phone on our SIP server + brand sync always carries SIP files (deployed f84ae145; permanent after Save to GitHub)
- [ ] Top up Multitel account, buy test US number, test full SIP routing
- [ ] Deploy inbound email code to production
- [ ] Verify Zadarma number activation

## P1 — Next
- (2026-11-18) Shipped: live SIP status badge, old SIP login sweep (Telegram/Inbox/email), live renewal calendar link (Google/Apple). See CHANGELOG. Pending user confirmation; @Chemist454 sign-in never verified (prod DB not reachable from preview).
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

## 2026-11-14 — Bird caller IDs trimmed to Infobip only
- User chose: removed all 27 non-Infobip caller IDs from Bird (20 were active customers' Telnyx numbers). Bird now: +16479457172 only.
- Code: birdAutoLinkTick links ONLY Infobip-owned numbers. Production still runs old code (re-arms Telnyx/SignalWire numbers every 3 min) until Save to GitHub → deploy; re-run cleanup after deploy if any came back.

## 2026-11-14 — SMADAV support: orteac.org "not connected" (@Feezy95, chatId 1454387983)
- Our side OK: WHM orte2583 on 68.183.77.106 (Golden Anti-Red 1-Month, $100 wallet, 12 Nov), CF zone 50f4ac… ACTIVE, apex+www CNAME → tunnel (proxied), Origin CA cert installed. Through CF edge the site answers (302 decoy redirect to Wikipedia for datacenter/curl traffic = anti-red/customer content).
- Root cause: Namecheap put the domain on **clientHold** (+addPeriod = newly registered) → .org registry NXDOMAIN; nothing resolves anywhere. Customer must clear it at Namecheap (registrant email verification or Namecheap support/abuse). No code change.

## 2026-11-14 — Caller-name (CNAM) lookups: Multitel first
- cnam-service.js order now Multitel → SignalWire (Telnyx removed). Used by bot quick-call name suggestion (_index.js ~27019), CloudIVR leads /cnam, validatePhoneBulk, phone-test-routes.
- BLOCKERS: (1) Production droplet 146.190.238.190 gets HTTP 403 firewall page from api.multitel.net (and www) → Multitel must allow that IP. (2) Preview creds (test slot, updated 04:21) → 401 from IP 35.193.209.116. SignalWire fallback still returns names (e.g. "SEATTLE WA").

## 2026-11-14 — Multitel caller-name lookup (preview verified)
- New Multitel API credentials saved (test + live). Allow-listed IPs: preview 35.193.209.116 (can change), prod 146.190.238.190 (+ IPv6 2a03:b0c0:2:f0:0:2:875:c001).
- js/cnam-service.js: Multitel → SignalWire. Multitel echoes the number when no name → now treated as "no name" so SignalWire fallback runs.
- Preview tested: GOOGLE INC (Multitel), COMMENT&MESSAGE (Multitel), fallback to SignalWire works. NOT published to production yet.
- Note: Multitel blocks IPs after repeated failed logins — never auto-retry on 401.

## 2026-11-14 — Multitel country/paperwork scan (read-only)
- Raw: memory/multitel_scan.json (150 listed countries; 90 with stock). Classified: memory/multitel_classified.json (184 country+type offers: 50 No ID, 47 details-only, 86 documents, 1 unclear ES Local). Script: memory/multitel_classify.py.
- Source: v3 getareas + get-prefix (needs_registration + restrictions text) + getregistration. Compared to memory/infobip_full_report.csv.

## 2026-11-14 — Multitel ↔ Bird link PROVEN (production)
- Bought Multitel US local +18648308599 ($0.60/mo, no ID), routed uri 18648308599@188.166.34.29:5080 (ringtype 1).
- SIP server 188.166.34.29: added /etc/asterisk/pjsip_multitel.conf (endpoint multitel, udp 5080, identify = Multitel origination IPs) + [from-multitel] dialplan (X-DID or EXTEN → DIDAPP_<digits> → Stasis pstn). Backups *.bak.<ts>. Repo copies: ops/sip-server/asterisk/pjsip_multitel.conf + extensions.conf.
- Armed via prod app-main bird-callerid-verify → Bird called, call engine answered/recorded, Whisper read 698335 → Bird VERIFIED, outbound_enabled true.
- Prod already runs Infobip-only Bird auto-link (release 20261114T134632Z) — Multitel numbers must be added to birdAutoLinkTick + telnyxDidSync(DIDAPP) when the Multitel seller is built.
- NEXT (user-approved): Multitel provider adapter + combined Infobip/Multitel catalog (least paperwork, then cheapest), all three paperwork groups incl. document upload, auto Bird link for Multitel numbers.

## 2026-11-14 — Multitel + Infobip combined selling (built in preview, NOT published)
- New: js/multitel/index.js (search getareas→getprefixes→getnumbers, buy rentnumber + modifynumber uri <digits>@SIP_SERVER_IP:5080, release, inventory, registration_status; 401/403 → 30-min self-block, never retried),
  js/multitel/countries.js (generated from memory/multitel_classified.json + Infobip EUR costs), js/number-catalog.js (best provider: least paperwork, then cheapest),
  js/cloudivr-web/number-docs.js (upload PDF/JPG/PNG ≤4×10MB to Emergent object storage, email docs + end-user details to support@multitel.net (MULTITEL_DOCS_EMAIL override) after purchase, 30-min tick: approved → notify; rejected → release + refund planPrice),
  frontend pages/buy/Paperwork.js (PaperworkNote + DocumentUpload), Numbers.js "Awaiting carrier approval" pill.
- numbers.js: countries() now = phone-config + catalog.sold(); c.offers[type] = {provider, level, businessOnly, address, request}. Search uses own provider (non-US/CA); US/CA via chain (signalwire wrapper now tries Multitel first when it wins, Multitel also as fallback). purchaseLocked: paperworkIssue() (profile, business-only, address country, docs ready). doc.provider 'multitel', registration {status:'pending'} when number needs registration.
- voice-service: Multitel numbers in DIDAPP sync + Bird auto-link (with Infobip).
- Verified: catalog (89 countries), document upload/list/validation, storage download + MultiTEL email composition, UI paperwork card (DE national).
- BLOCKED: preview egress IP changed to 34.170.12.145 (Multitel 401 — not allow-listed); production 146.190.238.190 gets Multitel Cloudflare WAF 403 ("you have been blocked") — Multitel support must unblock. Search/buy e2e not yet tested.
- Not done: Multitel inbound SMS (Multitel numbers sold as calls-only for now).

## 2026-11-14 — Compliance module (preview, NOT published)
- js/cloudivr-web/compliance.js: Stripe Identity (document + live selfie, claimable TEST sandbox keys STRIPE_* in backend/.env; webhook POST /api/stripe/webhook), company papers (object storage, admin approve/reject), legal ledger: LEGAL_DOCS {terms:'2026-11-14', aup:'2026-11'} → append-only `legalAcceptances` {chatId, doc, version, at, ip(clientIp), userAgent, method signup|prompt}; bump a version → everyone re-accepts (PolicyGate, blocking). Admin GET /admin/compliance/:chatId/acceptances.
- Gate: level-2 (documents) countries need Stripe ID verified (+ approved company papers for business). All purchases need current terms accepted (policy_needed). Sign-up requires acceptPolicy:true.
- js/sms-optout.js: STOP/START per account (`smsOptOuts`); sends blocked (403 opted_out); thread shows notice.
- js/cloudivr-web/ten-dlc.js: customer form → admin "Approve and file" → Infobip (brands → register → campaigns → register) / MultiTEL (brand_nonBlocking → campaignBuilder_insert); preview dry-run simulates filing; hourly tick polls Infobip campaign; "Mark active" also re-snapshots numbers. US local Infobip/MultiTEL numbers can't send texts until active.
- Extra SIP logins: Business plan, 5/number (val.numbers.extraSip), /sip-auth + voice-service accept only while plan=business.
- Multitel SMS: sendsms + smsuri webhook /multitel/sms-webhook/<sha key>. Infobip numbers now send texts via Infobip in sms-reply.deliver.
- Catalog offers[type].caps {voice,sms,fax,smsNeedsApproval}; /texting/ready → Texting Number page "Ready-to-text numbers" (Starter $50 = Texting price).
- Terms (frontend/src/cloudivr/pages/terms/content.js) updated 14 Nov 2026: identity & records (≥4 yrs), texting/opt-out/10DLC, carriers & partners (MultiTEL, Infobip, Bird).
- Tests: iteration_268/269/270 (all fixed). Prod needs: publish, Stripe keys on prod droplet env, Multitel IP unblock, MultiTEL provider approval (Reseller Schedule §1), Bird resale/partner agreement.

## 2026-11-14 — 5-plan ladder + texting price research
- Plans (internal key → name): starter→Basic $50/100 min · standard→Starter $75/250 min (Basic + voicemail, SIP, recording; 8 extra numbers) · pro→Pro $100/400 min · business→Business $120/600 min · Enterprise $399/mo (talk to sales, `PHONE_ENTERPRISE_PRICE`).
- Existing Pro customers keep $75 + all Pro features through `priceLock {plan:'pro',price:75}` (one-time migration `lockLegacyPrices`, marker `migrationMarks/priceLock:pro75-2026-06`). The lock is dropped on any plan change. Upgrade credit uses the locked price.
- Env: PHONE_PRO_PRICE=100, PHONE_STANDARD_PRICE=75, PHONE_STANDARD_ON, STANDARD_MINUTES=250, PHONE_ENTERPRISE_PRICE=399. PRODUCTION env must get the same keys before deploy, or else production Pro stays at $75.
- Bot: Starter button in 5 languages, the Change Plan menu now uses Basic/Starter/Pro/Business, cp_8 shows Starter and drops the "0 SMS" copy.
- Texting research: memory/TEXTING_PRICING_2026-06.md + texting_pricing_2026-06.csv (suggested prices only, not live).
- Tested: iteration_272 (backend 100%, frontend ~90%); follow-up fixes self-verified.
- Backlog: per-country text pricing once approved; buy-page PlanHelper component isn't rendered anywhere (dead code); finish the iteration-271 copy fixes; Multitel SMS end-to-end test; production rollout.

## 2026-11-14 (b) — Texting countries, lookups, add-ons (step 1 of 4 done)
- International Texting page (/app/international-texting): 11 instant no-ID countries (js/texting-countries.js), all shown as "Mobile" with SMS/Calls badges, pick a number, Basic $50/mo. Text = 3x cost (min $0.05), extra number on a plan = 3x monthly cost (min $25).
- USA Texting Number (Spenza): $50/mo, unlimited texts (MOBILE_TEXT_PRICE=0).
- Landline texting (hosted SMS) paused: HOSTED_SMS_AVAILABLE=false, and the landing card now sells the Texting Number.
- Number lookup (/app/lookup, Bird): $0.015 each (3x $0.005), refunded on failure.
- AI receptionist: every plan, $0.10/min (AI_RECEPTIONIST_RATE_PER_MIN). Outgoing AI campaigns use the new `aiCampaigns` feature (Business only).
- Extra SIP logins: Pro 2 / Business 5 free; then $5/mo each (EXTRA_SIP_PRICE) on Starter+; added to renewalPrice.
- 10DLC: refused with no US numbers; a rejection refund now logs a tendlc-refund transaction.
- MultiTEL auth breaker is now persisted for 6h in a tmp file (it had logged 27 rejected logins across restarts). Search returns 503 provider_unavailable while blocked.
- Tests: iteration_273 (backend 22/24, frontend ~90%); all its findings fixed and self-verified.
- NEXT (user-approved order): 2) Multitel⇄Infobip failover + routing + Bird→Multitel call backup + edge cases (retry on the other provider at the same price, then refund; 5-min health check that hides a down provider's stock; Telegram alerts for provider down / low balance; failed text: no charge + notice + 3 retries; failed forwarding → voicemail). 3) Bot: same plans as web (no Enterprise), only instant no-ID and address-only numbers, address asked at checkout only, no ID/business info. 4) Onboarding/dashboard redesign: show the design plan to the user first. Also collect marketing/performance data (signup source, purpose, funnel events).
- Multitel preview blocked: allow-list the preview IPs 35.193.209.116 and 34.170.12.145, then delete /tmp/multitel-auth-block.

## Status 2026-11-14
- Onboarding redesign (purpose picker, purpose Home, 4-group menu, attribution, marketing opt-in, journey events) — built, tested (iter 275), preview only.
- Multitel outbound trunk installed on live SIP; blocked by Multitel 403 (termination IP not authorised). Next: user adds 188.166.34.29 in Multitel portal → Termination IPs, retest, then set CALL_ENGINE_BACKUP_TRUNK=multitel-out.
- Backlog: admin view of signup sources/funnel; live Multitel SMS end-to-end test; bot plan-parity regression; production deploy of all preview work.
- 2026-11-14 later: flags everywhere, Signup insights, SIP calls-from, system caller rotation, Infobip DLR refunds — tested iter 276/277. Blockers on provider side: MultiTEL Messaging API approval, MultiTEL termination IP (my.multi.tel/trunks/authorized-ips), Infobip SMS channel provisioning. Open: extras don't ring on inbound; auto IMEI check needs paid TAC provider; MultiTEL fax (T.38/FaxEmail) wiring; publish to prod.

## 2026-11-14 (late) — Round: Bird-style UI, provider alerts, profile gate, bulk lookups, prod env
- Sidebar regrouped (Home/Numbers/Calling/AI/Texting/Fax & eSIM/Tools/Account) with colour chips, light sidebar; Home product grid (`pages/dashboard/ProductGrid.js`) and landing "Everything we offer" (`pages/landing/Products.js`) share `src/cloudivr/products.js`.
- Caller IDs: only Bird code-verified; review/attest paths retired; bot typed numbers refused.
- Provider health (`js/provider-health.js`): warn < $20 (Multitel/Infobip), hide their numbers < $10 while the other is healthy; Bird 402 = wallet empty; alerts Telegram + email via `js/admin-mail.js` (moxxcompany@gmail.com). Bird has no balance API.
- Profile required (428 profile_required) for all outgoing calls, Quick/Bulk IVR (send or schedule), browser phone; SIP outbound hangs up for web accounts without details.
- Lookup page: number + email (Bird `/v1/lookup/email`, batch `/v1/lookup/email/batch`), single and bulk up to 1,000 (paste/CSV, background jobs `lookupBatches`, CSV download). Bird lookup rate limit = 10 requests/min → bulk numbers ≈ 6.5 s each.
- Tests: iteration_280 / 281 (backend 100%, frontend 95%).
- PROD (droplet 146.190.238.190): app-main deployed from workspace 2a6b1e4 (scripts/deploy_workspace_to_droplet.sh now disables GitHub catch-up). Env fixed: EMERGENT_LLM_KEY, CLOUDIVR_ADMIN_EMAILS=moxxcompany@gmail.com on all apps; Infobip, Google Maps, CLOUDIVR_MAIL_SENDER on wl/voodoo/proshop; Multitel creds updated to the working account (backups *.bak-envfix-*, *.bak-multitel-*). Restart needed after Multitel IP allow-list.
- PROD blockers: Multitel API refuses the droplet IP 146.190.238.190 (403) → whitelist it in Multitel; Telnyx (account blocked, also mailer) and Twilio keys return 401.
- Telnyx→Multitel migration: prod dry run found 22 numbers (19 app-main, 3 app-voodoo, mostly toll-free); script now maps toll-free→toll-free; NOT applied (waits for Multitel IP allow-list + user OK).

## 2026-11-15 — Address reuse, split payments, copy wrapping, Multitel fax
- Saved profile address reused automatically: `profile/useSavedAddress.js` prefills ZIP / LOA fields; `spenza.js profileZip()` fills missing ZIP server-side. Profile edits apply to new orders only.
- Split payments: WalletPay (wallet first, rest by crypto/card) now on Travel eSIM, fax numbers, carrier-request orders, International Texting; any 402 error shows "Add funds" link.
- Truncated copy fixed (Home stats, sidebar, buy steps, pickers, address suggestions, lookup, email log, SIP card, landing).
- Fax: new numbers MultiTEL only (`js/multitel/fax.js`: buy + faxdetect, send_fax, fax_inbox/fax_outbox polling in fax-service maintain). Old SignalWire/Telnyx fax numbers untouched.
- Tests: iteration_282 + multitel_fax_unit_test 16/16, provider_health 19/19, bird_only 22/22.
- PROD: deployed 9bc2f5e. MultiTEL still 403 from droplet (Cloudflare WAF, Ray a5a9d4e3ce4dfea2) → MultiTEL numbers and fax numbers unavailable live until Multitel unblocks.


## Status 2026-11-15
- Done/live: swap audit (21 replaced), call permission logging, renewals + release at expiry, DE/FR city numbers, bot fixed Istanbul address, bulk lookup downloads.
- Open: Multitel fax end-to-end (NO_ROUTE_DESTINATION — support question drafted, fax still sold), Multitel SMS live test, set BOT_END_USER_NAME, 11 Bird verifications pending, deploy bot change to WhiteLabel apps if they run separate code.


## Pending (2026-11-15, user-requested, NOT started)
- P0 AI Receptionist: own full page separate from outbound AI Agent (pick number, greeting, business hours, take messages, transfer to person, book visits via Google Calendar, call summaries). Backend inbound AI exists (features.aiAgent on numbers, ai.opening 'inbound'); products.js links 'ai-agents?use=inbound' to the same page today.
- P0 UI/UX: plan-centric app (talk about "my plan" + what it includes, not just "my number"); group standalone services clearly (eSIM, Texting Number, Fax, Lookups, Travel eSIM) apart from plan features. Call design_agent first.
- P1 Infobip inbound routing for +16479457172 / all Infobip DIDs → our SIP.
- P1 After user presses Save to GitHub: verify Actions deploy app-main + Sync→WhiteLabel → app-wl/voodoo/proshop all report the new sha (deploy guard on droplet).
- Done this round: invoices/receipts (user+admin), capacity labels, Texting Numbers unlinked from caller ID, bot name/address all brands, IVR caller fix for Multitel/Infobip, live tests (Quick/Bulk IVR, forwarding: Multitel; Infobip outbound), Home recent activity removed.


## Update 2026-11-15 02:57 UTC
- Done & live (all brands): number plan details on Home rows; Travel eSIM iPhone/Android install; onarrival21 eSIM linked.
- Undone by user request (backlog Phase 3): dedicated AI receptionist page, usage (per-call/per-text) invoices, plan-centric Home redesign.
- Phase 2 backlog: plan details on My numbers + number Overview; email travel eSIM install links.
- Open: WL texting-number caller-ID guard; Save to GitHub (main + WhiteLabel); migration 20 vs 18 reconciliation; Bird verification 10/21; Multitel fax; renewal lifecycle test conflict.

## Update 2026-11-15 03:25 UTC
- Done & live: orphan-extra-line fix (scheduler follows provider swaps); MAZE + 1 other account numbers re-activated; old carrier numbers cleared from all accounts; Multitel two-way texting verified, international texting ON (Multitel countries only, all brands; WL had no gating and no Intl Texting page).
- Open: Multitel fax still fails ("Call ended before fax completion: NORMAL_UNSPECIFIED") → waiting on Multitel; +16806811015 is in fax-inbox mode (no calls). Ask Multitel to whitelist main-server IPv6 2a03:b0c0:2:f0:0:2:875:c001. Customers not notified about the released/repaired numbers.

## Update 2026-11-15 05:05 UTC
- Fixed: call forwarding refused by Bird when showing caller's unverified number → redial with own number (all brands). ~$1.80 failed-forward charges for MAZE pending refund approval.
- Fixed: bot "Cloud IVR + SIP" crash (balance-monitor regex blocked RegulatoryFlow init). Verified via prod webhook simulation.
- Fixed: WL bots' false "MultiTEL DOWN" alerts (old non-IPv4 multitel client). Real issue left: MultiTEL balance $11.43 — top up.
- Bot plan/number parity with web (except Enterprise) live on all brands.
- Still open: JujuCloud email (only ensure cloudivr.net customers don't receive JujuCloud mail), Multitel NL inbound SMS + fax (provider), 7 carrier releases (401), 20 vs 18 replacement reconciliation.

## Update 2026-11-15 13:20 UTC
- Forwarding caller-ID choice (business number default / caller's number on US forwards via MultiTEL trunk, auto-fallback). Live E2E verified on-net.
- NUMBER_PROVIDERS env (multitel | infobip | multitel,infobip); prod = multitel on all brands.
- CNAM: EZCNAM primary, MultiTEL then SignalWire fallback on errors. Live verified.
- Pro $100, brief bot copy, address-after-payment (untested end-to-end), Infobip inbound routing fix. Infobip outbound still 10309 (balance €2.79).

## Update 2026-11-15 13:30 UTC
- Low provider balance no longer hides numbers; paid orders queue (pending-orders.js), auto-complete after top-up, refund if number gone or after 48 h; admin Telegram+email; numbers held from other buyers. Spenza eSIM create path covered (buyMobile not yet).
- All plain CloudIVR transactional emails now use the shared light-card layout; voicemail email shortened.


## 2026-11-15 update
- DONE (preview): AI Receptionist own page/bot menu (hours, after-hours message/voicemail, messages inbox, emails), Bird spend-estimate + daily-limit alerts. NEXT: deploy app-main + port to WhiteLabel brands; then live receptionist call test.

## 2026-11-15 (fork) — Growth batch live on all brands
- Done: missed-call text-back (opt-in, web), growth nudges (missed calls, forward failures without backups, auto-renew off), weekly bad-support report (admin Telegram + email, prod email verified), signup source tracking, AI Receptionist + Bird spend — app-main + WL/Voodoo/ProShop (overlay).
- Forwarding no-answer: backup numbers already existed; owners now get a tip + weekly nudge to add one.
- Deferred by owner: Mollie card checkout (needs cloudivr.net approved in Mollie profile).
- Backlog: verify a real forward→backup failover call on Bird/MultiTEL legs (needs owner OK for a billable test); attribution confirmed on next real signup.
- 2026-11-15: Standalone fax numbers in 15 countries (no-ID + name/address), $50/mo, 25 free pages then $0.05/page; fax removed from Business plan; web + all bots; carrier approval with full refund on rejection. Bot fax flow is English only (backlog: translate).
- 2026-11-15: Fax batch 2 live (ID-document countries, MultiTEL customer profiles + e-signature, bot main-menu fax, 5 languages); aws3.link shortener with 3 domains; international texting (MultiTEL instant no-ID countries) on all brands; web 2026 refinement layer + simplified Dashboard; fax launch announcement sent. Next: per-screen redesign of Get-a-number, landing, number settings.

## 2026-11-15 (fork 2) — Three kinds of number (LIVE on all brands since ~18:30Z)
- Architecture: every number is one of three kinds — Calls (texting = optional add-on), Calls + texting (USA unlimited + instant texting countries), Fax only. Shared definition: `frontend/src/cloudivr/kinds.js`, bot `js/bot-number-kinds.js`.
- Web Get a number: one page, 3 steps (what it's for → pick a number → pay). `pages/BuyNumber.js` + `buy/KindPicker.js`, `buy/CallsBuy.js`, `buy/TextingBuy.js`, `buy/FaxNumberBuy.js`. `?purpose=calls|texting|fax` (old voice/sip/sms still work). `/app/texting-number` and `/app/international-texting` redirect; their pages and menu items are removed.
- My numbers: one list with Calls/Texts/Fax badges + filter (`?show=`), search across all kinds.
- Number settings: one tab bar; Answering/Texting/Recordings show a list of settings with instant switches and an inline "Saved" confirmation.
- Texting add-on: `features.sms` on a calling number, switch `texting` (PATCH /numbers/:phone/switch). New calling purchases start with texting off; Calls + texting purchases (`withTexting:true`) start on; existing numbers switched OFF on every brand (owner decision; scripts/texting_off_migration.js). Replies are blocked while off; incoming texts still arrive.
- Fixed: web checkout refused texting numbers outside USA/CA/UK on the Basic plan ("extra_number_only"); texting offers now skip the plan-country rule.
- Landing: hero with one sign-up button + price list of the three kinds; pricing tabs Calls / Calls + texting / Fax only / USA eSIM; Ecosystem and feature-pill sections removed.
- Admin: Fax sales tab (`/admin/fax-sales`) — sold per country since the launch announcement, all brands via RESELLER_DBS.
- Bots (all languages): "🛒 Get a Number" asks what the number is for; Calls → plans, Calls + texting → texting countries (Basic plan), Fax only → fax numbers. Old "Choose a Plan" buttons still work.
- Tests: iteration_290 (web + API) passed; bot simulated in English and Persian up to payment review. Preview .env has PLAN_TEXTING=true, TEXTING_PROVIDERS=multitel.
- Deployed: app-main workspace b17c384 (+uncommitted); WL/Voodoo/ProShop bot overlay r11. Production PLAN_TEXTING=false on all 4 → Calls + texting shows 'not available' and the add-on switch is hidden until the owner sets it true.
- NEXT: owner decision on PLAN_TEXTING=true; Save to GitHub (else CI rolls app-main back / WL overlay drops); bot has no 'turn texting off' button yet.
- 2026-11-15: Admin Fax sales tab has a daily summary since launch (per country + brand) and a daily admin email after 08:00 UTC (js/fax-sales.js, app-main only).
- 2026-11-15: Landing page cut down to essentials (hero, how it works, pricing, test call, FAQ, final CTA) after a 9-step UX audit; live on cloudivr.net.

- 2026-11-15: SIP credential fix LIVE on all 4 brands — Kamailio stale-nonce lockout fixed, TLS copy removed (UDP/TCP 5060 only), self-healing SIP logins (web + bot), Basic plan includes SIP, quiet backfill verified 25/25 logins. Details: CHANGELOG 2026-11-15 20:40Z.


## 2026-11-15 late — SIP 403 fix
- Brand SIP SRV records repointed from Telnyx to our SIP server (root cause of 'Authentication failed 403' / not registering). Kamailio TLS runs in foreground mode; reset passwords apply immediately. Pay-first fax/number registration UI fixes (iteration_297, all pass) deployed.
- Remaining: SIP connection status UI + 30-min offline alert; mobile polish (iteration_294); country pricing regression; eSIM/texting validation.

## 2026-11-15 late — One-tap SIP QR + mobile polish (shipped, agent-tested)
- QR setup on web SIP card + bot (Linphone auto-provision link, generic SIP URI). Mobile: bottom-sheet confirms, 44px switches, install banner clear of chat, auto-renew-off confirm.
- Remaining: SIP connection status badges + 30-min offline alert; country pricing regression; eSIM/texting validation.

## 2026-11-15 late — Call reliability + Bird caller-ID lifecycle
- Fixed: silent voice prompts on our call engine (long links), voicemail custom audio, inbound calls ringing softphones (now via our SIP server, not SignalWire). Live-tested outbound, voicemail, ring+answer, IVR, forwarding.
- Extra numbers (owner decision: keep as today): own monthly date; main lapses for no funds → main + extras suspended 7 days together, restoring main brings extras back if their month is paid; main auto-renew off → extras released with main at main's end date.
- New: numbers come off Bird caller ID 3 days after release for good (all brands).
- Backlog: owner to Save to GitHub; customer confirmation of softphone calls (cv5shdaatb, cvztncffh9, cvgy3yws3m).

## 2026-11-16 — Softphone call reliability (agent-tested, not user-confirmed)
- Live on all 4 brands: softphone ACK/BYE fix (SIP server), 10-digit / 011 / 00 dialing, call sweep for missed hang-ups, refused number ends the softphone leg, extra-line warning before turning off main-plan auto-renew, missed-call notice when the softphone is not signed in (max once per 6 h per number).
- Backlog (owner decisions): stop charging 1 min + $0.03 for outbound calls that never connect; refund suspected runaway charges (9 Nov, 3 Nov) and 9013312785's remaining $0.19; message @iamthebestbusiness that calls work and the refund is in.

## 2026-11-16 — Spam text watch
- AI + rules read outgoing (single, BulkSMS) and received texts; Telegram alert to admin; admin switch (web Overview card, bot /spamhold) chooses alert-only (default) or hold for Approve / Reject. Customer never notified. Live on 4 brands, agent-tested.

## 2026-11-16 — Spam watch extended to calls (PREVIEW ONLY, not deployed)
- Owner choices: alert-only by default; check script/audio, what is said on AI calls, who is called; held items wait until decided; customer sees nothing; ONE master switch (the existing hold switch) for texts + calls, all brands.
- New `js/call-watch.js` on top of `js/msg-watch.js` (verdict modes `call` / `talk`, `gate({pre, what, action})`, `note()` alert-only records, `setHold` also writes every RESELLER_DBS brand).
- Quick IVR (`voice-service.initiateOutboundIvrCall`, all bot + web paths, not campaign leads): script text + audio words (Whisper, cached in `callWatchAudio`) + >40 different numbers/hour (`CALL_WATCH_QUICK_PER_HOUR`). Hold on → call parked in `heldCalls`, caller gets a quiet stand-in result; Approve dials, Reject drops. One decision per account + script per day.
- Call campaigns incl. AI agent campaigns (`bulk-call-service.startCampaign`): name, audio words, menu, agent script, list size ≥5000 (`CALL_WATCH_BIG_CAMPAIGN`) or numbers in sequence. Hold on → campaign shows running with `adminHold`, dials nothing; Approve → `adminRelease`; Reject → never dials.
- AI agent / receptionist: script checked on save; live transcript checked every 60 s and at call end. Always alert-only (live calls are never cut).
- Tests: js/tests/test_call_watch.js 20/20, test_call_watch_campaign.js 7/7, test_msg_watch.js 14/14, bulk-call regression suites pass (need BULK_IVR_MAINTENANCE=false). Real classifier + real audio transcription checked in preview. Admin card copy checked by screenshot.
- NOT covered: person-to-person softphone/forwarded calls (no script to read), email blasts.
- NEXT: owner OK → deploy app-main + overlay to WL/Voodoo/ProShop; then verify a live Telegram alert + Approve/Reject on each brand, and that prod app-main has RESELLER_DBS so the switch reaches all brands.
- 2026-11-16 01:05Z LIVE on all 4 brands: the platform's auto-save pushed main da862b2 to GitHub and CI deployed it (app-main-a :5000) and synced WhiteLabel c045a03 (app-wl-b, app-voodoo-a, app-proshop-b) BEFORE the owner's OK arrived (OK given afterwards). All healthy, no new errors. Verified per brand with its own release + env: AI check on, hold OFF, a real test alert delivered to the admin Telegram (message ids 3487048 / 35047 / 28691 / 5754, test records removed), normal script not flagged. app-main has 3 RESELLER_DBS → switch from main reaches all brands (not flipped live). NOT exercised live: a real held call/campaign approved or rejected.

## 2026-11-16 — Browser phone on own SIP server (CloudIVR) LIVE, agent-tested on production
- See DEPLOYMENT_STATE "2026-11-16 08:57–09:55Z". Works: connect, outbound, inbound ring/answer, two-way audio, hangup. Not user-confirmed.
- Open: Save to GitHub; prove a Bird-trunk browser call with a non-MultiTEL line; DTMF receipt at far end not verified; other brands off; Mollie cloudivr.net profile/key; calendar + 30-day Quick IVR + quieter logs went live with these deploys (not user-confirmed).

## 2026-11-16 — Audience targeting (PREVIEW ONLY, not deployed)
- Audiences: nomads/travellers, founders, small businesses, remote teams/agencies, sales teams.
- Web: `/for/<slug>` pages (nomads, founders, small-business, teams, sales) — pages/For.js + pages/for/audiences.js (all copy lives there); landing "Who it's for" card strip (landing/WhoFor.js, #who), nav link, footer column, new hero headline "One business number, wherever you work." + audience subtitle; page titles; seo.js meta + sitemap for /for/*.
- Bot: first-session welcome (js/_index.js showFirstSessionIntent, en/fr/zh/hi) names the five audiences.
- Checked in preview (5 pages render, CTAs, redirect on unknown slug, mobile no overflow). Not run through the testing agent.
- 2026-11-16: fr/es done for the audience pages + new hero (headline pairs hand-written), and the app-wide backlog of 1,433 untranslated strings filled with scripts/civr_i18n_fill_missing.py (machine translation, not human-reviewed).
- Open: deploy; bot menus/promo texts and JujuCloud not yet audience-led.

## 2026-11-16 — Audience promos + crypto de-emphasis: LIVE on all four apps
- Bot: 14 promos lead with one of five audiences in rotation; Cloud IVR intro + plan picker hints. Web: audience pages, fr/es, landing no longer crypto-led.
- Not done: bot web promos still say "top up with crypto"; app/checkout screens unchanged; first real promo send not observed; not run through testing agent.

## 2026-11-16 — Mollie cards: still blocked at Mollie; site now flips automatically
- Live probe from prod: profile "Dynotech innovations, Lda", website jujucloud.com, verified; creditcard method present; cloudivr.net redirect still 422 (not a registered domain); jujucloud.com accepted.
- Public catalog `cardPayments` = env flag OR mollie.cardsLive(req) (cached domain probe, 30 min). Landing chips + "How do I pay?" follow it; checkout already did. Live on app-main (release 20261116T104945Z).
- User action: add cloudivr.net as a website/domain on that Mollie profile (or supply the key of the profile that has it via secrets).
- JujuCloud copy brief: /app/memory/jujucloud_copy_brief.md (also served at /jujucloud_copy_brief.md in preview).

## 2026-11-16 11:15Z — Mollie cards LIVE on cloudivr.net
- New secret MOLLIE_CLOUDIVR_API_KEY = Mollie organization access token (also added to /opt/nomadly/shared/app-main/backend.env on the droplet, backup alongside). MOLLIE_API_KEY (jujucloud profile key) untouched and still the fallback.
- mollie.js: `via(origin)` maps the site host to the verified Mollie profile with that website (CloudIVR pfl_9wEoriKUvZ → cloudivr.net; Dynotech → jujucloud.com) and sends profileId with the org token; deposits store `mollieProfile` so sync/webhook use the same account.
- CloudIVR profile methods: creditcard (all currencies), plus ideal/banktransfer/mbway in EUR. No PayPal → labels now "Card" / "Pay by card"; card is listed first and preselected in wallet + checkout.
- Verified on prod: options live, /payments create (open, unpaid), in-app session mounts Mollie components on cloudivr.net/app/wallet, landing shows card chips, webhook URL answers 200. NOT verified: a real paid card payment crediting the wallet.
- Only app-main has the key/code path enabled.

## 2026-11-16 Cardholder ID check (CloudIVR web)
- LIVE on app-main (cloudivr.net) since 2026-11-16 with owner live Stripe key. Unit 27/0 + preview Stripe test-mode E2E passed. No real customer payment observed yet.

## 2026-11-16 14:15Z — Wallet + card split, missed-call dismiss, ID→profile name: LIVE on cloudivr.net (app-main)
- Every CloudIVR checkout (all MolliePay/WalletPay users): wallet pays its part, Mollie the rest; order runs server-side once paid.
- Card part held for ID check → order saved + wallet part set aside → auto-completes on ID pass; refund returns wallet part.
- ID pass: profile name set to the ID name (audit: profileNameChanges) + "You're verified" email.
- Inbox missed calls: per-call dismiss. Own-number calls still listed (user choice).
- Verification: unit 32/0, preview dismiss UI + API ownership check; split flow not exercised with a real payment yet.
- Backlog (in order): texting on/off + 10DLC gates (WIP in workspace, not shipped) → in-app alerts for held deposits/orders → Apple Pay live re-test → Bird 20-concurrent config check.

## 2026-11-16 14:45Z — Texting on/off + 10DLC: LIVE on cloudivr.net
- Texting off → no texts in or out on any number. US local numbers start 10DLC from the Texting tab; switch unlocks once approved.
- Agent-tested (unit + preview); not user-confirmed. Next: in-app alerts for held deposits/orders, Apple Pay live re-test, Bird 20-concurrent check.

## 2026-11-16 ~16:00Z — Quick actions + toll-free texting verification LIVE on cloudivr.net
- Call / Text / Fax icons on number cards + number page; toll-free verification form + admin queue.
- Agent-tested (testing agent iteration_299 + curl); not user-confirmed. MultiTEL has no toll-free verification API → admin files manually.

## 2026-11-16 status
- DONE (live, agent-tested, not user-confirmed): CNAM caller name add-on on number lookup (single + bulk, +$0.02 per US/CA number checked, never run elsewhere) + sidebar renames.
- DONE 2026-11-16: hold music flow fixed + live (162308c0), not user-confirmed by a real call.
- NEXT: Dutch inbound SMS replies not arriving; ID verification emails/inbox notices; /notifications null .find error.

## 2026-11-16 — Custom Caller ID System (Guard + Business Plan + MultiTEL Routing)

### New Feature: Caller ID Guard (`cid-guard.js`)
- 71+ hardcoded blocked numbers (US banks, government, payment processors, credit bureaus, UK/CA banks, insurance)
- Emergency number blocking (911, 112, 999, etc.)
- Jev AI classification for unknown numbers (financial institution detection)
- Telegram admin alerts on blocked attempts
- Admin API for blocklist management
- DB-backed audit trail + caching

### New Feature: Business Plan Custom Caller ID
- Business-plan users can use ANY phone number as caller ID without Bird verification
- Guard blocklist enforced on all plans
- Auto-saved as `business_passthrough` in presets

### Updated: Custom Caller ID in All Call Paths
- SIP/browser phone: Custom caller ID via X-Civr-Show-As → MultiTEL trunk (call engine)
- Quick IVR: `showAs` → MultiTEL provider
- Bulk IVR campaigns: `showAs` → MultiTEL provider
- Landing page test call: Visitor enters their own number → guard check → MultiTEL
- Inbound forwarding: Already supported via CALLER_ID_PASSTHROUGH_TRUNK (unchanged)

### Updated: Compliance Notifications
- Added ID-check-failed email + push notification (retries remaining, failure reason, tips)
- Existing: payment-held, ID-verified/released, payment-refunded, review-needed emails already in place

### Key Files
- `/app/js/cloudivr-web/cid-guard.js` — Guard module (blocklist + AI + alerts)
- `/app/js/cloudivr-web/caller-ids.js` — Updated resolve() for Business-plan passthrough
- `/app/js/voice-service.js` — SIP outbound: MultiTEL routing for custom caller IDs
- `/app/js/cloudivr-web/outbound.js` — Quick IVR: MultiTEL provider for custom CID
- `/app/js/cloudivr-web/calls.js` — Bulk IVR: MultiTEL provider for custom CID
- `/app/js/cloudivr-web/trycall.js` — Landing page: visitor caller ID support
- `/app/js/cloudivr-web/card-check.js` — ID-check-failed notification added

### Tests
- `/app/js/tests/test_cid_guard.js`: 17/17 passed

## 2026-06 update
- SIP "not registering" root-caused (migration left active numbers with incomplete/stale logins; repair ran only lazily). Fixed with an automatic in-app SIP reconciler (`js/sip-reconciler.js`, hourly) + eager repair at purchase. Grandfather-safe: mints fresh logins only for Pro/Business, repairs (never grants) lower plans that already have a login (old $75 "standard" users kept SIP). Remediation applied to live DB (18/21 repaired, idempotent). Tests 14/14.
- Fax copy: fax is standalone — removed from all plan feature lists (web comparison, Business gate, landing snapshot).
- Payments copy: landing now shows live Mollie methods (iDEAL, cards, PayPal, Apple Pay…) via `mollie.publicMethods` on `/public/catalog`; "coming soon" shows only when cards truly aren't approved for the domain.
- PENDING: deploy to droplet (Save to GitHub) to activate the hourly reconciler + make copy changes live; confirm landing visual + live Mollie method list in prod.

## 2026-06 update (2)
- Self-serve "Test my SIP registration" on bot (🧪 button, 5 languages) and web (SIP tab card) — `js/sip-selftest.js`, verified live against the production SIP server.
- Web buy flow is plan-first; all step/onboarding copy aligned. Web campaign default concurrency 20 (Bird account cap verified 20 / 5 CPS in prod env).
- Open decisions for owner: (1) bump 2 report-only campaigns to 20? (2) bot concurrency default/button order; (3) SIP on the $75 Starter plan for NEW buyers; (4) retired-login tracking + owner DM on stale-login attempts (top cause of live SIP auth failures).

## 2026-11-16 — Zoiper "STUN server error (57)" guidance
- All 4 brands (app-main, app-wl, app-voodoo, app-proshop): bot SIP guide, SIP self-test tips and web SIP page say "STUN off, or <brand SIP domain>:3478". Deployed, not yet customer-confirmed (@johnwill202).
- Open: WL web-panel STUN row is overlay-only (next WhiteLabel CI deploy drops it); @johnwill202 retry + trace check.
- 2026-11-16: USA eSIM / Texting Number lines on web My numbers with auto-renew switch + own page /app/esim/:id (app-main). WL brands are bot-only for these.
- 2026-11-16: Linked lines bill like normal lines; wallet "check my payment" removed. Billing audit: no change in charging, revenue dip was call volume (see CHANGELOG).
- 2026-11-16: Automatic Bird ⇄ MultiTEL failover with auto switch-back and Telegram+email alerts (app-main). Renewals list includes Texting Numbers.

## Update 2026-11-16
- Wallet audit live (js/wallet-audit.js) — alerts admins on any wallet change without a billing record. First real audit run pending (30-min cycle).
- First-deposit bonus now recorded in transactions; 87 historic records backfilled.
- Pending: user verification of free-call caller IDs (landing, web trial, bot trial, SIP test page) end-to-end; Portugal test call retry; failover live switch/alerts; other brands (app-wl/voodoo/proshop) still have the unrecorded-bonus code.

## 2026-11-17 — CloudIVR setup assistant on every IVR screen (NOT yet deployed to production)
- Shared `frontend/src/cloudivr/Assist.js` + backend `js/cloudivr-web/assist.js` (`POST /api/cloudivr-web/assist/:screen`) on 9 screens:
  Quick call, New campaign (Bulk IVR), number tabs Keypad menu, Hours, Voicemail, Forwarding, Ring group, Missed-call text, Text Triggers.
- Owner choices: Chat / Manual switch per screen (remembered); assistant asks → suggests → confirms ("Fill in the form" or "yes") before
  filling the form; Undo; nothing saved until the page's own Save / Place call; "Still needed before it works" list (server GAPS checks).
- Assistant knowledge = audited product facts (plans, inbound order, key actions, OTP flow, campaigns, texting) in `KNOWLEDGE`; gets account
  context (plan, voicemail availability, the owner's Texting Numbers) and asks which Texting Number sends texts when there are several.
- New: IVR "send the caller a text" key supports 2-5 rotating versions (`smsTexts`, rotation counter in `ivrSmsRotation`).
- Audit bug fixes: IVR message key no longer hangs up after 8 s (hangs up when the message ends); OTP entry prompt no longer plays the
  owner's "after accept" sentence; custom decline sentence now also asks to re-enter the code.
- Tested: iteration_301 (all 9 screens, backend 16/16) + iteration_302 retest; last minor fixes unit-checked.

## 2026-11-17 (later) — LIVE on all 4 brands
- MultiTEL outbound works again (SRTP offer accepted); custom caller ID confirmed on handset (+1 800-514-6000).
- BIRD_ONLY=false → Bird⇄MultiTEL failover back on; custom caller ID switch ON (all 4 DBs). MultiTEL refusing a custom-CID call → retried from the user's own number via the normal route.
- Caller-ID inputs now render: test pages (Business: any number; others: own numbers + Business upgrade note), CloudIVR landing "We call your phone" (any permissible number), CloudIVR web Quick call/campaigns (Business: type any number; others: 🔒 Business upgrade). Bot "🎭 Show Any Caller ID" (already built) shows again.
- Hosting panel IP Access (block/redirect + IP Logs), bulk SMS 20,000/day + 20,000 per send, broadcast sent (1,626 delivered), review brand tag. No invented reviews published.
- ⚠️ Overlay files are workspace-only until "Save to GitHub".

## 2026-11-17 — Emily → whole-flow IVR Architect (Phase 1 LIVE-READY, agent-tested)
- User brief: a full "AI IVR Architect" spec (design/validate/test/deploy complete inbound+outbound IVRs by chatting). Agreed north-star = whole-flow architect; Phase 1 = guided build + canonical blueprint + whole-flow validation + simulated test report + visual flow builder. Chose fast-track to prod once tests pass.
- Built (all preview-testable, runs on the EXISTING keypad-menu executor with zero telephony risk):
  - `js/cloudivr-web/ivr-blueprint.js` (NEW): pure validate()/simulate()/blueprint()/readiness() mirroring js/voice-service.js call behaviour (leaf actions forward/message/sms/voicemail; sub-menu depth capped at 2; wrong/no key → "invalid option" once then goodbye).
  - `js/cloudivr-web/assist.js`: `ivr` screen now uses an ARCHITECT system prompt (self-names "Emily", drives greeting→every key→submenu→operator→fallback end to end, proposes a FULL menu, never stalls); attaches a readiness report; NEW routes POST /api/cloudivr-web/ivr/{validate,simulate,blueprint} (auth-gated, operate on posted config only).
  - `frontend/.../number/IvrFlow.js` (NEW): "Call flow" card = visual node tree (Incoming→Greeting→keys/submenus) + live Checks (errors/warnings) + "Test my menu" simulated pass/fail report. Wired into IvrTab.js right column.
- Tested: iteration_303 — frontend 100% of flows (visual tree, live checks add/clear, test report pass/fail, Emily completes a full menu, Save regression). Backend blueprint logic unit-verified + 3 endpoints curl-verified with a real session.
- NOT built yet (Phase 2 — needs live-call test on the prod SIP server before enabling, so NOT silently shipped): true call queues (position/overflow/callback), menu depth >2, webhook/API/payment/auth keypad actions, outbound campaign architect, drag-edit visual builder. Blueprint/validator deliberately flag depth>2 as an error so the architect never proposes something that won't run on a real call.
- DEPLOY: changes are app-main/WITH-WEBIVR code (cloudivr-web + frontend) — go live via "Save to GitHub" (CI builds + deploys app-main; WhiteLabel sync carries cloudivr-web files). No manual prod patch made this session (read-only SSH only).

## 2026-11-17 (b) — Phase 2 start: deeper menus + webhook keys (built, preview-tested)
- Deeper menus: the inbound keypad executor (js/voice-service.js handleDTMFReceived) now walks session.ivrPath as an ARRAY (menuNodeAt helper), so sub-menus nest up to 3 levels (was capped at 1 sub-level). Submenu-entry appends to the path at any depth; SMS/webhook "replay menu" resolves the current node by path. Back-compat: an old single-digit string path still works. Additive — existing menus unaffected.
- Webhook key: new keypad action 'webhook' — on keypress we best-effort POST {event,from,to,digit,path,at} to the owner's own https URL (fireIvrWebhook, 8s timeout, https-only), then say an optional line and hang up or replay the menu. Owner gets a Telegram "Called your webhook" notice.
- Design layer (all preview-tested): ivr-blueprint.js validate/simulate/blueprint recognise webhook + depth up to 3 (MAX_SUB_DEPTH); assist.js menu() parser + KNOWLEDGE + keyGaps updated so Emily designs webhook keys and deeper menus; frontend IvrTab.js builder rows made recursive (MenuRow, submenu allowed to depth 3) + webhook url/message fields; IvrFlow.js renders a webhook node.
- Verified in preview: 3-level menu + webhook validates/simulates/blueprints correctly (curl + unit); UI driven test — added a webhook key, URL field appeared, Call-flow node + live Checks ("add the https webhook URL") updated. Frontend compiles.
- ⚠️ The EXECUTOR changes (N-level routing + webhook firing) run on the prod SIP server and were NOT exercised on a real inbound call — needs ONE live test call before switch-on. No production change made this session.
- STILL TODO (user picked all): smart keys collect-digits + PIN verify + pay-by-phone (as a texted secure payment link, not raw card DTMF); true call queues; outbound campaign architect; editable (drag) visual builder.

## 2026-11-17 (c) — Phase 2: smart keys collect-digits + PIN (built, preview-tested)
- Engine (js/voice-service.js): after a 'collect' or 'pin' key, a multi-digit gather (terminating #) is issued; handleGatherEnded intercepts via session.collect and routes to handleCollectedDigits.
  - collect: caller types N digits → best-effort POST {collected} to owner https webhook (optional) + Telegram notice → then forward (optional) or confirm message + hangup.
  - pin: caller types a code, compared to option.pin / pins[] → match runs onOk (forward or message); wrong retries up to 3 then hangs up. Simple access code (not bank-grade), noted in UI.
- Design layer (preview-tested): ivr-blueprint.js validate/simulate/blueprint cover collect+pin (LEAF); assist.js menu() parser + options schema + KNOWLEDGE + keyGaps so Emily designs them; IvrTab.js ActionFields add collect (prompt/length/forward/webhook/message) + pin (prompt/pin/onOk-forward/failMessage); IvrFlow.js icons (Hash=collect, KeyRound=pin).
- Verified in preview: validate/simulate/blueprint via curl+unit (collect→"sends it to your system", pin→"if it matches, connects them"); UI driven test — set keys to collect+pin, fields rendered, Call-flow nodes + live Checks ("add at least one PIN code") updated. Frontend compiles, node syntax OK.
- ⚠️ collect/pin EXECUTOR runs on the prod SIP server — NOT exercised on a real inbound call; needs ONE live test call before switch-on. No production change this session.
- STILL TODO (Phase 2 remaining): pay-by-phone (texted secure payment link, not raw card DTMF); true call queues; outbound campaign architect; editable (drag) visual builder.

## 2026-11-17 (d) — CORRECTION to (b)/(c) + fixes
- Entries (b) and (c) overstated: webhook/collect/pin keys and menus deeper than 1 sub-level could NOT be saved — PUT /numbers/:phone/ivr (numbers.js validateIvr) rejected them ("unknown action" / "one level deep"). Only builder/validator/flow view had been checked, never a save.
- Fixed: validateIvr now accepts webhook, collect, pin and sub-menus to 3 levels (https-only URLs through safe-url quickCheck, forward numbers through the same dial checks, PIN >= 3 digits).
- Fixed: IVR webhook + collect webhook deliveries now go through safe-url assertSendable + sendOptions (they bypassed the private-network guard). Collect with nothing typed now says goodbye instead of confirming.
- Evidence: real save + read-back via API on the test number (then restored); rejects for private URL, http URL, 5 levels, short PIN. New js/tests/ivr_smart_keys.test.js drives the real gather handler with a stubbed carrier: 13/13 pass (3-level path, legacy string path, webhook, collect, empty collect, pin wrong/right/3-strikes).
- Still NOT done: a real inbound call on the production SIP server; UI save of the new keys through the browser (API save verified only); Emily proposing the new keys in chat (not re-tested after adding them). Nothing deployed.
- Pay-by-phone not started: needs a decision on whose payment link is texted.

## 2026-11-17 (e) — Pay-by-phone key + browser verification of all new keys
- New keypad action 'pay' ("Text a payment link"): texts the caller the OWNER'S OWN https payment page from one of their Texting Numbers (user chose this over CloudIVR handling money). Stored as {payUrl, payNote, smsFrom, smsText(composed), message, after}; the call engine runs it through the existing sms-key path (case 'pay' falls into 'sms'). Save validation: https + public address, sender required, SMS length check. Wired into ivr-blueprint, assist (parser/schema/knowledge/gaps), IvrTab (IvrSms hideText), IvrFlow.
- Emily prompt: "call/notify my system/API/server/CRM" now means the webhook action and she asks for the https address (was read as forward).
- Verified: iteration_304 (browser, 100%): webhook / collect / pin / pay / 3-level sub-menus all save and reload through the UI, bad input rejected with clear messages, Checks + Test my menu cover them, Emily builds collect + pay keys from given URLs and does not invent URLs; test number menu restored, IVR left off. js/tests/ivr_smart_keys.test.js 14/14 (real gather handler, stubbed carrier).
- NOT verified: any real inbound call on the production SIP server (audio, real DTMF, real webhook delivery, real SMS send for the pay key — the stubbed test only reaches the send call). Nothing deployed.
- Note: workspace has uncommitted changes from earlier sessions in ops/sip-server/kamailio.cfg (+69/-10, Nov 16) and new ops/sip-server/tls.cfg (Nov 15) — not touched this session; review before Save to GitHub.
- Phase 2 remaining: true call queues; outbound campaign architect; editable (drag) visual builder.

## 2026-11-17 (f) — Phase 2 finished in preview: outbound architect, editable call flow, call queues
- Outbound architect: Emily uses an end-to-end prompt on Quick call + Bulk campaign; new ivr-blueprint outbound() + POST /api/cloudivr-web/outbound/check return checks + walk-through + flow in one call; OutboundFlow card on QuickCall.js and Campaigns.js (non-AI form). Outbound menus stay at ONE sub-menu level (menu() maxSub param; only the inbound keypad menu nests to 3).
- Emily stall fixed at the root: base rule "confirm before changing the form" made her ask permission with an empty patch. Now the proposal card IS the confirmation; she proposes in the first reply when the request is complete (13/13 runs across quick/campaign/ivr), defaults minor settings silently, uses [Business name] when unknown, and keeps untouched keys unchanged when editing a menu (4/4).
- Stop-calls key: NOT a feature. No key press adds a number to the do-not-call list (only the Do not call page / AI calls do). Emily must not promise one; outbound/check ERRORS on a script that promises a stop key. Known limitation: when the owner explicitly asks for a stop key she declines truthfully but asks a follow-up instead of proposing the rest in the same reply (0/3).
- Editable call flow (IVR tab): click a key node → inline editor (same fields as the builder), "+ key" on the greeting / sub-menu nodes, digit change follows the key, remove. IvrFlow Tree renders via a plain function so typing never loses focus.
- Call queue key ('queue'): up to 5 team phones ring in turn on hold music, round after round (start phone rotates per caller and per round), position announced to callers who are not first, max wait 30–900s (default 180), last resort = closing message / voicemail / another phone. Engine: startQueue / queueDial / queueContinue hooked after failoverBridge in handleBridgeTransferHangup; queue cleared on bridge. No callback request, no estimated wait.
- Bug fixed (mine, from round c): collect + PIN forwards skipped the wallet check the forward key does. Extracted ivrForwardAllowed(); used by forward, collect, pin, queue and queue overflow.
- Evidence: js/tests/ivr_smart_keys.test.js 26/26 (real handlers, stubbed carrier; includes queue rounds, position, answer, 3 overflows, caller hangup). Browser: iteration_305 (outbound flow cards + editable flow) and iteration_306 (queue key save/reload/validation/flow edit/Emily + regression of all key types) — all passed, test number restored, IVR left off.
- NOT verified: any real call. Seven inbound call-handling changes are unproven on the production SIP server (3-level menus, webhook, collect, PIN, pay text, queue, shared wallet check). The wallet-blocked path of ivrForwardAllowed was moved verbatim but not exercised in tests (needs a wallet). Emily's outbound chats were checked via API, not clicked through in the browser. Nothing deployed.
- Open: real stop-calls key for campaigns (thread optOutKey through campaign → dialer → session → DNC); queue callback request; uncommitted ops/sip-server/kamailio.cfg + tls.cfg from earlier sessions still need review before Save to GitHub.

## 2026-11-17 (g) — stop-calls key, queue call-back offer, defence audit
- Stop-calls key (campaign + quick call, connect / record-only modes only; not with a key menu or code call): `stopKey` digit → on press the number is added to the owner's do-not-call list (ai-agent store.addDnc), caller is told, owner notified; if saving fails the caller is NOT told they were removed and the owner is alerted. Threaded: calls.js / outbound.js (reject if it clashes with an active key) → bulk-call-service (stored, kept on repeat, passed in dialTelnyx) → initiateOutboundIvrCall session → handleOutboundIvrGatherEnded. UI selects quick-call-stop-key / campaign-stop-key (offer only unused digits). Legacy Twilio/SignalWire TwiML campaign path NOT wired (current carriers use the voice-service path). Telegram-bot campaigns NOT wired.
- Checks: a script may promise a stop key only if that exact key is set (error otherwise; correct key-nearest-the-wording detection, 10/10 cases). Emily sets stopKey 9 + matching line on simple campaigns, never on single calls. Hard rule in code (assist.js + ivr-blueprint stripStopPromise, 9/9 cases): when no stop key is in effect, any stop-key promise is stripped from her script and she says so — prompting alone let it through (caught 3 of 10 live runs).
- Emily mode choice spelled out (transfer / report_only / menu) + more never-ask defaults (campaign name, backups). Measured: 14/15 first-reply proposals across 5 request shapes, every proposal passing /outbound/check; menu request 10/10 ready after the code rule. Still occasionally asks an unnecessary question (1 in 15).
- Queue call-back offer (`callback: true` on a queue key): between rounds "press 1 and we will call you back"; 1 → wait ends, owner gets the caller's number (web accounts: via notify.js redirect of bot messages); no key → music + next round. It is a request to the owner, not an automatic redial.
- Evidence: js/tests/ivr_smart_keys.test.js 36/36. Browser: iteration_307 found 2 real bugs (Emily chose menu mode with a stop promise; stop select lacked key 1) → fixed; iteration_308 retest: both fixed, checkbox quirk not reproducible, one more Emily menu-mode stop-line case → fixed by the code rule and re-measured via API (not re-clicked in the browser).
- NOT verified: any real call (see memory/LIVE_TEST_SCRIPT.md). Campaign → dialer hand-off of stopKey was verified by reading the code only (test account has no business profile, so the routes refuse before that point). Nothing deployed.
- Read-only production audit (SIP server nomadly-sip-1, 188.166.34.29): attack burst from 172.110.223.x ended ~12:00 UTC Nov 17; fail2ban `asterisk` jail has .9/.49/.110 banned and its chain sits ahead of UFW (so the UFW /24 rule shows only 3 drops); blocked sources still send packets and are dropped. Since then ~1 failed attempt per 5 min from 144.172.69.129 ("trunk_1" INVITE probes) and 45.61.144.127 — under the ban threshold (10 in 600s), not banned, all rejected. recidive jail: 0 bans.
- Config drift: live /etc/kamailio/tls.cfg == workspace ops/sip-server/tls.cfg. Live kamailio.cfg (modified Nov 16 09:51 UTC) != workspace copy (edited Nov 16 23:40 UTC) and != last commit. No CI workflow deploys ops/sip-server, so Save to GitHub will not apply it — but which version is intended is unknown.
- Earlier untested list NOT touched this round: caller-ID screens per brand, Bird⇄MultiTEL failover matrix, free test-call refunds, SMS broadcast audit (Smadav / Voodoo Land), review tagging, hosting-panel IP access.

## 2026-11-17 (h) — Emily end-to-end, first REAL calls on production, stop-line fix
- PRODUCTION STATE (read-only check 15:56Z): app-main runs release 9f3f6b0 (CI deployed 14:08Z from an auto-save). It ALREADY contains 3-level menus, webhook, collect, PIN and pay-link keys + the IVR architect/flow UI. It does NOT contain call queues, the stop-calls key, outbound flow cards, or anything from this round. WL/Voodoo/ProShop run 0416437.
- REAL CALLS on production (scripts/ivr_live_probe.js, run on the droplet; Bird trunk from +18648308599 into the owner's own +18667977419, test menu set then restored to "no menu"; audio recorded via ARI snoop + Whisper transcript + app log + webhook.site): PASS 4-level menu path 1.1.1.1, webhook key (POST received), collect 123456# (POST received with collected digits), collect nothing → goodbye, PIN wrong→right, pay-link text sent from es_186015d67c97, wrong key → "not a valid option" → goodbye. DTMF incl. # works Bird → PSTN → MultiTEL toll-free → our engine.
- BUG FOUND LIVE + fixed in workspace (voice-service handleCollectedDigits): a full-length wrong PIN ends the entry by itself and the caller's following # was counted as another wrong try → hang-up after 2 real tries. Now the trailing # (within 4 s) is not counted. Test added (ivr_smart_keys 37/37). Production still has the bug until the next deploy.
- Observation: the pay-link text triggered the spam-text watch ("phishing: unsolicited payment link") → admin alert only; every pay-key text will do this unless exempted (owner decision).
- Emily: new harness scripts/emily_e2e.js — an LLM "owner" with a fact sheet chats until she proposes; the proposal is checked by the real validators and SAVED through the real API (IVR PUT, campaign validateOnly). First run 0/18 real problems: invented phone numbers / payment URL / PIN / opening hours / address, forwarded keys to the number itself or the Texting Number, proposals with holes, campaign without stop key, announcement set as "connect". Fixes in assist.js: invented() guard (phones, URLs, PINs, numbers in spoken text must come from the owner's words or the current form → she asks "Almost there — I just need…" instead of proposing), gaps that are questions are asked instead of proposed, campaign stop key 9 + sentence added in code (unless refused), connect-without-phone → record-only, model call 25 s + one retry. ivr-blueprint: stop-promise detection/removal rewritten clause-based (stopClauses/stripStopPromise; js/tests/stop_promise.test.js 32/32; fixes iteration_308 S2 and the "stop by" false positive).
- Results: harness 18/18 single run, 51/54 on 3x run before the last two fixes (the 3 failures = fixed causes; pin-pay re-run 2/2). Browser: iteration_309 7/7 (308-S2 retest, no-invention, campaign stop key, edit keeps keys, quick call). Emily typically needs 1–3 turns; she still sometimes asks one unnecessary question on campaigns.
- Preview data: Alice now has a legal profile (copied from uxtest) so campaign save-checks run.
- SIP server audit (read-only): fail2ban asterisk jail 3 banned (172.110.223.9/.49/.110), recidive 0; burst ended 12:00Z. Remaining: slow INVITE probe from 45.61.144.127 (~1 per 7 min, under the 10-in-10-min threshold, all rejected). No password SSH. A temporary DTMF logger channel + tcpdump were used during the probe and removed. Suggested (not done): a "slow scan" jail (e.g. 5 failures in 24 h → 7-day ban); 7 backup files /root/qaprobe_ivr_backup_* on the app droplet can be deleted.
- NOT verified on a real call: call queue (rounds, answer, overflow, call-back offer, 2 callers), outbound stop key → do-not-call, wallet-blocked forward, PIN/collect that FORWARD to a phone. These need the workspace deployed first (see LIVE_TEST_SCRIPT.md; calls A–F done, E now needs a re-check after deploy).
- Open: deploy decision; kamailio.cfg workspace vs live drift unchanged.

## 2026-11-17 (i) — Live-data keys + GitHub deploy failure
- NEW (workspace only, NOT deployed): js/ivr-live-data.js + cloudivr-web/ivr-connections.js + frontend pages/number/IvrLive.js.
  - Connections per account (collection webIvrConnections, AES-256-GCM sealed with WEB_SESSION_SECRET): postgres / mongodb (read-only, public hosts only, guided table→column picker, "Try it") and payment providers stripe / paypal / square / razorpay / mollie (credentials verified on connect).
  - webhook key: check.source 'reply' (system answers JSON or "say:" / "route to:" lines) or 'db' (lookup by caller's phone). collect / pin: check.source db|reply. All three: confirm=true (default for NEW keys, user chose "always ask me") → caller on hold, Accept/Decline banner via existing OtpAlert (/incoming otp list, POST /calls/otp/:id), 45 s; confirmTimeout decline|voicemail (per key). "Show me the pop-up" preview.
  - pay key: payVia 'provider' → link for fixed amount or amount from lookup, short link /public/pay/:token, texted; waitPaid keeps caller up to 3 min and confirms; polling 20 min (webIvrPayments), owner notified when paid. Real Stripe test checkout session created OK in preview; paying it in a browser was not completed (Stripe page automation failed).
  - Tests: js/tests/ivr_live_data.test.js 41/41 (real local Postgres + Mongo, stubbed carrier/providers), ivr_smart_keys 37/37, stop_promise 32/32; browser iteration_310 8/8. PayPal/Square/Razorpay/Mollie calls are written from the playbook and NOT exercised against real accounts. No real call made for any live-data key.
  - New dependency: pg (root package.json). Local test Postgres: ivrtest/ivrpass@127.0.0.1/ivrshop (apt postgresql, start with pg_ctlcluster 15 main start).
  - Emily: knows about live data in words, keeps live settings when re-proposing a key, new webhook/collect/PIN keys default to confirm; unasked "reach a person" key without a phone is dropped instead of blocking.
- GITHUB DEPLOY FAILURE (runs 14:54Z and 16:59Z, all workflows: deploy, lint, sync): annotation "The job was not started because recent account payments have failed or your spending limit needs to be increased" — GitHub billing on account servicedyno1 (private repo). Not a code problem; no step ever ran. Production still on 9f3f6b0. Fix = user settles billing / raises Actions spending limit, then re-run; alternative = deploy from the droplet with deploy.sh (needs user go-ahead).

## 2026-11-17 (j) — More keypad keys + smarter menus (preview, agent-tested iteration_311)
- New key actions: devices (rings the number's SIP login = browser phone + apps; no answer → voicemail/menu/message), ringgroup (number's Ring group members, switch may stay off), ai (takeFromIvr hands answered call to an owner agent), fax (caller types fax number → fax-service.sendIvrDoc from an owner fax number; doc via POST /fax/ivr-doc; "Get a fax number" CTA), callback (request, or auto rings owner phone via initiateOutboundIvrCall, press 1 to connect).
- Menu: voicemail department mailbox box{name,email} (email + Inbox label), sub-menu language en/es/fr (switches TTS for rest of call), extensions (2-5 digits at main greeting, 2.5s inter-digit), afterHours menu (replaces closed routing when Hours schedule is closed).
- Emily knows all of them (assist.js fields extensions/afterHours, gap questions, keepLive keeps fileId/agentId/box).
- Unit: js/tests/ivr_more_keys.test.js. NOT yet verified on real calls (production deploy blocked by GitHub Actions billing).
- Backlog (user approved): per-client personalization ([Name], [Code], any column) for web campaigns + Quick IVR, bot Bulk IVR, bot Bulk SMS; then Full team accounts (Owner/Admin/Agent, per-teammate browser phone extension, live queue, shared inbox).
- Open minor findings: orphan IVR fax docs not cleaned; Emily "Spanish option ... voicemail" phrasing makes a plain voicemail; proposal chips show raw 'extensions'/'afterHours'; call-flow node labels low contrast in light theme.

## 2026-11-17 (k) — Accept/Decline outcomes, mobile/tablet/iPad pass, 4 fixes (iteration_312)
- Manual-check keys (confirm): onAccept / onDecline {action message|forward|menu|voicemail|end, message, forwardTo}; timeout counts as Decline unless "take a voicemail" timeout set. voice-service runOwnOutcome; banner shows the choices.
- Responsive: number settings tab list stacks until xl (1280); IVR tab single column until 2xl; extension rows, sub-menu language, greeting pills wrap; DB chips scroll on phone; Accept/Decline buttons grid + 44px on phone; flow labels light.
- Fixed: Emily "Spanish option" → language sub-menu; Emily keeps smsFrom/payUrl/payNote on re-proposed keys; chips labels; orphan IVR fax docs swept (>1 day, unreferenced) on save; banner code readable in light theme.
- Open minor: example pop-up ignores Accept/Decline choices; error text doesn't say Accept vs Decline transfer; Emily adds unasked lines in summaries; extension row wraps on wide screens.
- Next (approved): personalization ([Name]/[Code]/any column) for web campaigns + Quick IVR, bot Bulk IVR, bot Bulk SMS; then Full team accounts; real calls after GitHub billing fixed.

## 2026-06 update
- DONE (preview): OTP Replay + live wrong-code message on Accept/Decline pop-up; fax doc cleanup; Emily echo fixes; extension row layout. See CHANGELOG.
- NEXT: production deploy + controlled real test call of Replay (scripts/ivr_live_probe.js, back up/restore IVR); Emily afterHours echo + readiness texting-line fix; then personalization (web/Quick IVR, Bulk IVR, Bulk SMS) and full team accounts.

## 2026-06 — Extra numbers in bulk, new limits, SIP reset & group alerts
- Extra-number limits: Basic 5, Starter 10, Pro 25, Business 50, Enterprise unlimited (phone-config SUB_NUMBER_LIMITS + subSlotsLeft). Existing plans get them immediately.
- Web: tick several search results on /app/buy?extra=… and pay once (wallet: POST /numbers/:phone/extra {phoneNumbers}; crypto: one order with items[] → activateExtras). A number that fails is skipped, its money stays in the wallet. Testing agent iteration_315: 12/12 backend, all UI flows pass.
- Bot: sub-number search is tick-to-pick (js/sub-batch.js) + "➡️ Continue with N numbers" → walletOnly checkout step 'phone-batch-pay' (deposit/resume for shortfall), each number bought via walletOk['phone-pay']. Unit-tested only, not driven live.
- Group alerts off: notifyGroup sends only to admin chat unless TELEGRAM_GROUP_ALERTS=true.
- SIP: 🔄 Reset Password keeps the username (sip-logins.newPasswordOnly; Telnyx short logins PATCHed); if only a whole new login is possible the message warns the username changed. Manage screen refreshes the cached SIP login from the record. AI support: "error 57" = turn STUN off, never a reset. voice-service: MultiTEL/Infobip numbers and free-test logins arriving via Telnyx no longer hit "Unknown provider". Tests: js/tests/test_sip_reset_keep_user.js 8/8, test_extra_numbers_multi.js 9/9.
- Open (not fixed, from iteration_315): landing catalogSnapshot still shows old 3/8/15/30; 1-pick extra lands on number setup vs N-picks on billing; wallet multi-add slot check not locked against concurrent requests; one coupon discounts all N extras; singular headings; checkout resets when ticking.

## 2026-06 — Extra numbers: one bill, per-extra control, bulk copy
- One bill: extras renew on the main number's date. A new extra pays only the days until then (plan-lifecycle prorateRatio/proratedTo; web purchaseLocked + bot phone-pay set expiresAt = main's). Existing out-of-step extras renew once, prorated up to the main date (phone-scheduler attemptAutoRenew coterm). Extras on the main date get no separate reminders; the main reminder adds "Due on renewal: plan + N extras". Bot renew menu shows the same line.
- Web Billing → Extra numbers (pages/number/ExtraLines.js): renewal summary (total = plan + extras on the plan date; out-of-step extras listed separately), per-extra Renew toggle, Delete (DELETE /numbers/:phone/extra-line, confirm = phone, released now, no refund), Copy settings (POST /numbers/:phone/copy-settings: forwarding/ivr/voicemail from any number to chosen numbers).
- Plan-limit lock for multi-add (webNumberLocks 'extras:<chat>:<parent>') + slots re-checked per number; coupon applies to the whole order and is redeemed once (purchaseLocked skipRedeem). Landing catalogSnapshot limits 5/10/25/50.
- Fixed (iteration_316 critical): positional updates hit an old released copy of a re-bought number → setField / delete / copy now match status != released.
- Not done: live SIP test call (user skipped). Open: the single-pick extra purchase skips the plan lock; ~18 other positional updates in cloudivr-web still use 'val.numbers.phoneNumber' (same released-duplicate risk); no select-all in copy targets; scheduler co-term renewal is only unit/logic checked, not time-travelled.

## 2026-11-18 — Live-copy writes, single-buy limit, renewal calendar, SIP sign-in findings (PREVIEW, not deployed)
- Live copy: `js/live-number.js` (`updateLive`, `liveQuery`) — all 31 positional writes by phone number (bot + web + voice + scheduler) now hit the non-released entry of a re-bought number.
- Extra-number limit on single buys: `numbers.js purchase()` takes the plan lock `extras:<chatId>:<parent>` and re-checks slots (multi path passes `planLocked`); bot `phone-pay` re-checks slots + 45 s per-plan guard; `webNumberLocks` TTL 15 min.
- Copy settings: Select all / Select none + count (`ExtraLines.js`).
- Renewal calendar: `js/renewal-calendar.js` (plans + extras, Texting Numbers, eSIMs, landline texting, fax; wallet cover; 90-day window, later months are estimates). API `GET /cloudivr-web/renewals/calendar`; web page `/app/renewals` (links from Wallet → Renewals, Billing → Extra numbers, command palette); bot button "📅 Renewal Calendar" (5 languages) + `/renewals`.
- Reminders (owner choice: only when the wallet is too low): hourly `remind()` after the expiry check — 3 days and 1 day before the first charge the wallet can't cover, once per account/date/stage (`renewalShortNotices`), Telegram for bot users, Inbox for web users, email via `emails.js walletShort`. Old per-number 3-day/1-day notices now go out only for lines that END (auto-renew off).
- `plan-lifecycle.groupRenewal`: an extra on its own later date is prorated to the plan's NEXT date (`joinDate`).
- SIP "bot users can't register" — NOT DNS/domain: all 5 SIP domains resolve to 188.166.34.29, answer UDP/TCP/TLS with a valid cert, and all 32 active logins (bot + web, 4 brands) authenticate (script `js/ops/sip_login_audit_2026-11.js`, read-only). Real failures in the SIP server log = old/replaced usernames (incl. pre-migration `gencred…`), expired free-test logins, wrong passwords. Code: `sip-presence.js` remembers the owner of each signed-in login, DMs the owner when a replaced login tries again (once/6 h), records password asks (`sipAuthAsks`), and gives AI support per-number SIP facts (signed in / wrong password / no attempt reached us / old login).
- Tests: `js/tests/test_renewal_calendar_live_copy.js` 15/15; iteration_317 backend 6/6, frontend 100%. Pre-existing: 1 stale case in `test_plan_lifecycle_2026-10.js`.
- Not verified live: reminder delivery, bot calendar button on Telegram, stale-login DM, AI answers using SIP facts. Needs deploy (Save to GitHub) for all 4 brands.

## 2026-11-18 (b) — Refund RCA (businessintelusa), number supply fix, menu merge + Emily-first (PREVIEW, not deployed)
- RCA (prod logs, read-only over SSH): web account 5000000000000143 had 11 extra-number buys refunded (4×$25 Nov 17 22:38Z, 3×$18 + 4×$18 Nov 18 00:27Z/00:39Z; money back in wallet). Chain: area-code search (501/225/667) → `multitel.searchNumbers` returned [] because `AREA_REGION` only knew ~150 area codes → Infobip none → Telnyx SIP account "marked as blocked" → SignalWire had stock, but its Space is at its number limit (23 held) → buy refused → "could not be reserved" → refund. MultiTEL had stock in all three area codes.
- Fix: `signalwire/rest.js` full US/CA `AREA_CODES` table (421 codes) + `isFull/setFull` (file flag, 2 h, hides SignalWire stock after a limit refusal; cleared by a successful buy); `multitel/index.js` `areaCodeHits`/`numbersFrom` (scan the state's cities, exact area-code prefixes, city prefixes first, 6 h prefix cache); `signalwire/index.js` other-area fallback while SignalWire is full; `provider-health.numbersFull` admin alert (once/6 h); honest refund message in `numbers.js`. Test: `js/tests/test_number_supply_2026-11.js` 4/4. Live preview search 667/225/501/212 → MultiTEL numbers in the right area code. NOT verified: a real MultiTEL purchase of such a number (preview is dry-run).
- Owner actions still open: SignalWire number limit (ask support / release unused), Telnyx account blocked (also refuses mail to customers: "[Mailer] Telnyx refused").
- Menu: 27 links → 13 in 5 groups (`nav.js` NAV + HUBS); pages sharing a menu entry get tabs on top (`SectionTabs.js`, testids `hub-tabs-*`, `hub-tab-*`); all old URLs unchanged.
- Emily first: `Emily.js` (`FormFold`, `useEmilyMode`, `EmilyFace`); AI receptionist/agent pages = Emily panel on top (`BuilderChat.js`), form folded for new / open for existing, test + numbers column right; number tabs (forwarding, voicemail, hours, ring group, IVR, triggers) and Quick call fold their fields under Emily while in Chat mode. Home: tasks moved into "Do more with CloudIVR"; number page: setup banner hidden once answered.
- iteration_319: backend 100%, frontend ~92%. Open (not fixed): Quick call empty submit gives no visible error / fold stays shut; empty-name agent save opens the fold but shows no message; `app-sidebar` testid not found by tester; Campaign form and missed-call text not folded; first area-code search of a big state ~10 s (cold cache).

## 2026-11-18 — UX batch: clear errors, Emily campaign, fast number search, next step
- Missing required fields on Quick call, AI agent/receptionist and New campaign: inline + toast "Almost there — add …", form unfolds, missing inputs outlined (civr-missing) and first focused; no server call. Helper `missingFields` in `frontend/src/cloudivr/Emily.js`.
- New campaign: Emily first, form folded in `campaign-fold`, Save bar always visible (`campaign-save-bar`); AI-agent kind shows plain form.
- Number search: in-memory stale-while-revalidate cache `js/cloudivr-web/search-warm.js` (fresh 3 min, kept 20 min, popular + recent area codes re-warmed every 10 min; `NUMBER_SEARCH_WARM=false` disables). `GET /numbers/search/warm` prefetch fired by Buy page as the area code is typed. Warm searches ~0.1 s, cold ~1–3 s.
- Home: one "Do this next" card (`pages/dashboard/NextStep.js`, `pickNextStep`).
- Tested: /app/test_reports/iteration_320.json (all pass; full campaign save blocked by pre-existing BULK_IVR_MAINTENANCE default=true).
- Open: nav has 5 groups vs user's "6 clear areas" choice — confirm with user.

## 2026-11-18 — AI conversations merged into Campaigns (Emily-controlled)
- Naming: outgoing = "AI conversation" campaigns; saved agents tab "AI conversations" under the Campaigns hub; inbound = "AI receptionist" (AI conversations on incoming calls). The "AI calling agents" tab under AI was removed.
- New campaign → AI conversation: one Emily chat (`/assist/aicampaign`, js/cloudivr-web/assist.js) writes the agent and fills in who to call, caller ID, name, schedule. Form folded below (`pages/campaign/AiSetup.js`). Save creates a new agent (POST /ai-agents) or saves edits to the chosen agent (PUT), then the campaign. Receptionist agents are not offered for campaigns.
- /app/ai-agents/new redirects to /app/campaigns/new?kind=ai; existing agents still open at /app/ai-agents/:id.
- Tested: /app/test_reports/iteration_321.json (pass; campaign start blocked by the existing BULK_IVR_MAINTENANCE default).

## 2026-11-18 — Campaigns on, website wording, free Emily test call
- `BULK_IVR_MAINTENANCE` now defaults OFF (js/phone-config.js); set `BULK_IVR_MAINTENANCE=true` to pause campaigns. Takes effect in production on next publish (unless prod env sets it true).
- AI conversation campaign: "Call me now" test call (AiSetup.js TestCall) saves only the agent, then POST /ai-agents/:id/call-me. Test calls are free (`test: true` → rate 0, no wallet deduction, js/ai-agent/calls.js). 5/day.
- Public/help wording: "AI conversations" (outgoing / the AI) and "AI receptionist" (incoming). Hero.js/Platform.js/Highlights.js are not rendered (dead files).
- Tested: iteration_322 — campaigns save & start (dry-run); test call reaches the server but preview has no live AI calling line (503 "AI calling line is offline"), so the ring itself is unverified.

## 2026-11-18 — Test-call polish
- `/ai-agents/:id/call-me`: simulated in preview (WEB_CLOUDIVR_DRY_RUN=true → `simulated: true`, nothing dialled), 10-digit numbers get +1, 5/day count persisted in Mongo `aiTestCalls` (TTL 3 days), returns `left`; failures mapped to plain messages (`testCallError`).
- Frontend: test-call box auto-adds +1 (`withPlusOne`), shows preview/real note with calls left and an inline error (`aicampaign-test-call-error`); same for agent page CallMeTest.
- Deleted 15 unused landing files (Bubbles, EsimPlans, Hero, HeroCard, HeroPhone, Highlights, NumbersPreview, Platform, Products, Showcase, Trust, UseCases, V2Sections, Mockups, MockupsLive); visible landing copy now says AI conversations / AI receptionist.
- Self-tested via curl (count survives restart, limit message) and screenshot.

## 2026-11-18 — Plan ladder rework, landing AI section, calendar link fix
- Plans: Basic $50 (starter) "Get a business number" · Plus $75 (standard, renamed from Starter) "Answer like a business" · Pro $100 "Reach out" · Business $120 "Scale & control".
- Moves (js/phone-config.js planFeatureAccess): voicemail→Basic; ivr, ringGroup, aiSummary→Plus; aiCampaigns, ivrSchedule, ivrPresets, consistentVoice→Pro. New helpers planNeed/minPlanFor/PLAN_ORDER; backend plan messages use planNeed.
- Plan cards: WEB_FEATURES grouped (answer/calls/ai/account) + new items (Emily, SIP live status, renewal calendar); PlanFeatures.js PLAN_JOB + grouped "See all"; catalog snapshot regenerated; rates.aiReceptionPerMin added.
- Bot: plans/plansI18n (en/fr/zh/hi/fa), plan summaries, selectPlan, cp_8 (lang/*.js), upgrade buttons, 2-days-left credit nudge, email upsell lists, ai-support plan list/table generated from phone-config.
- Landing: new AiSection (#ai, nav "AI") — Emily chat + AI receptionist / AI conversation campaigns.
- Calendar feed link now `${CLOUDIVR_PUBLIC_URL||https://cloudivr.net}/api/cloudivr-web/public/calendar/<token>.ics`; old SELF_URL /calendar links still served.
- Testing: unit tests pass (manage screen, ai-support plan context, sip/calendar feed); testing agent run was cut off (credits) — UI checked by screenshots only.

## 2026-11-18 — Emily plan suggestion + production health check
- POST /api/cloudivr-web/public/plan-suggest (js/cloudivr-web/plan-suggest.js): cheapest fitting plan + reason + optional higher-plan "later" feature; 15/hour per IP; uses APP_OPEN_API_KEY (gpt-4.1-mini). UI `PlanSuggest.js` on landing calls tab (OnePage AllPlans, highlights card) and in-app buy plan picker (selects plan).
- NOTE: pushes to main auto-deploy to production (fda103d deployed 07:47 UTC 11-18 = plan rework + campaigns ON are LIVE). PricingFaq `Pricing` component is unused (landing uses OnePage AllPlans).
- Prod 24h report (11-18 ~07:50 UTC): all PM2 apps online, 0 crashes (≈23 blue/green deploys/24h). SIP server: kamailio/rtpengine/asterisk/coturn active; 11 devices registered in 24h (Zoiper, SIP.js, AnySIP), 0 registered at check time; 270 scanner auth attempts (1002@, 30@); old gencred* logins 404 (14). Asterisk 1,209 call legs (from-sip 376, ce-amd 430, bird 216, multitel 158), 0 active now. 137 playback failures of one customer's campaign audio (Nov 17 16h, Nov 18 00h, during campaign + deploy restarts; file fetch OK now). 97 ARI websocket drops = deploy restarts. 7 CloudIVR purchases refunded 11-17 22:38 & 11-18 00:27/00:39 (SignalWire cap; fix since deployed). Telnyx account blocked/401, Twilio account inactive 401, LINKLY key invalid, CR-Whitelist login failing (all bots). Nov 13 Asterisk fd exhaustion (ulimit 1024) — not recurring.

## 2026-11-18 — Emily scope guard, restart-safe calls, Telnyx ANI noise
- js/emily-guard.js: SCOPE rule prepended to Emily prompts (assist.js all screens, ai-draft builderChat, plan-suggest). Off-topic/misuse → one-line refusal, no patch, `offTopic:true`; logged to Mongo `emilyOffTopic` (TTL 180d) and shown in admin Overview card (EmilyMisuse.js, GET /admin/emily-misuse). plan-suggest returns 422 off_topic.
- Restart-safe campaigns (owner: deploys never wait): /health calls.total now includes CallEngine (Asterisk ARI) live legs (callengine.liveLegs). scripts/droplet_deploy.sh flips nginx immediately; old slot stops new bulk dials and is retired in the background by retire_when_idle once its live calls reach 0 (cap 30 min) — its ARI calls keep their controller. Installed deploy.sh self-updates, so this applies from the deploy AFTER the one that ships it.
- Bot startup Telnyx "ANI override" step skipped when Telnyx is down/blocked (custom caller ID runs via Bird → MultiTEL failover; prod 24h: 59 multitel-out legs all answered).

## 2026-11-18 — Telegram channel autoposter (@CloudIVRNet 2×/day + @Hostbay 1×/day)
- js/channel-ads.js: CHANNEL_ADS_TARGETS (default "@CloudIVRNet=14:00,22:00;@Hostbay=18:00", UTC). Same CloudIVR ads on both (assumed). Rotates how/feature/usecase/tip/new. Caption = punchy headline (≤7 words, also printed on visual) + 1–2 lines, from owner's OpenAI keys (APP_OPEN_API_KEY → OPEN_API_KEY), fallback text. Bot @NomadlyBot verified admin/can_post on both (@Hostbay 2,043 subs). Once-only per slot (Mongo channelAdPosts; CloudIVRNet key `<date>T<hh:mm>`, others `<chat>:<date>T<hh:mm>`). Preview = simulated but visuals are still generated. Off: CHANNEL_ADS_ON=false.
- js/channel-ads-studio.js: every post makes a NEW visual on the spot — ~45% real screens (layout desk or phone+desktop side-by-side), ~30% AI artwork (OpenAI images gpt-image-1.5 → gpt-image-1-mini, each key) with real phone screen overlaid, ~25% phone-size clip (1080×1350 MP4) recorded live via puppeteer screencast + ffmpeg. Random theme/font/tilt/glow, signature de-dupe vs last 40 posts. Browser: BROWSER_WS_ENDPOINT (Browserless, one short session per page) else local Chrome. Capture base CHANNEL_ADS_CAPTURE_URL (default CLOUDIVR_PUBLIC_URL / cloudivr.net). Logged-in app screens/clips need CHANNEL_ADS_DEMO_EMAIL/PASSWORD (set in preview to Alice; NOT set in prod → app screens come from saved real screens js/channel-ads-src/*-desktop|phone.jpg, public pages are live; app-only clips fall back to an image). Refresh saved screens: buildLibrary([ids]). Dev try: node scripts/channel_ads_try.js screen|art|clip <id>.
- Emily end-to-end demos (studio DEMOS: demo-ivr, demo-receptionist, demo-reminder, demo-plan-number, demo-ai-campaign): type a plain-words request into Emily → her setup → form filled; NEVER presses Save/Pay. Posted as phone clip (~30%, MP4 at 0.6× speed since screencast drops idle frames) or a 3-step album (~25%, sendMediaGroup, link in caption since albums can't carry buttons). Live when CHANNEL_ADS_DEMO_EMAIL/PASSWORD work, else saved recordings js/channel-ads-src/demo-*.webm/.jpg/.json (rebuild: buildDemoLibrary([ids]), local Chrome recommended). Mix: demo 30 / series 25 / screen 20 / art 15 / clip 10.
- Every caption ends with 👉 cloudivr.net (tracked link) + 💬 Support: @CloudIVRhelp (CHANNEL_ADS_SUPPORT); photo/video posts also have buttons [Try CloudIVR] [Support]; albums carry the link in the caption.
- Link previews off: channel posts are media captions (never previewed); all bot text messages default to no preview (tg-opts.js).
- Admin dashboard is never captured (go() + snapPage guard on /admin).
- Admin: /admin/channel-posts shows thumbnails, visual type, per-channel "Post to … now" (runs in background).

## 2026-11-18 — Onboarding funnel fixes (preview)
- Free test call needs no legal details (unless custom caller ID). New numbers come only from NUMBER_PROVIDERS (prod: multitel) — SignalWire/Telnyx SIP no longer sell. Home leads with the free call. Abandoned-payment + try-call reminder emails already existed (emails.js depositNudges/tryNudge).

## Pricing display rule (2026-06)
Per-minute/usage rates appear ONLY on /pricing (UsageRates). In-app and landing copy uses a "See pricing" link instead. Admin pages are exempt.

## 2026-11-18 — Landing page rebuild (2026 premium look) — shipped, agent-tested (iteration_327), not user-confirmed
- New: `landing/Hero.js` (OneHero + TrustBand), `HeroDemo.js`, `Bento.js` (#features), `UseCases.js` (audience tabs), `Plans.js`, `lx.css` (Bricolage Grotesque + Plus Jakarta Sans, glow/glass/grain; loaded from kit.js so all public pages get it).
- Main action everywhere = free test call (#try); secondary = Get your number. Header: Product, Pricing, FAQ, Sign in, Free test call.
- Order: hero → trust band → try (+HearIt) → features → AI → audiences → how → reviews (real only) → plans → FAQ → final CTA.
- Landing plans = one row of cards; tabs/eSIM/fax/texting detail on /pricing (old `#pricing-<tab>` links redirect there; PricingPage listens to `civr-pricing-tab`).
- FAQ added: countries, documents. Porting NOT added (unconfirmed offer). Cookie banner slimmer on phones.
- channel-ads-studio plan-suggest captures now use `/pricing`.
- 2026-11-18 follow-up: app shots in public/cloudivr/shots recaptured from the redesigned app via `node scripts/seed_civr_live_demo.js` → `python3 scripts/landing_shots.py` → `seed --clean` (script now tidies preview pills, test numbers/names, toasts; campaigns shot = seeded demo campaign). Mobile hero shortened (1290→1154px) and sticky bar now appears once the hero buttons scroll away. Self-checked by screenshot only.
- Open: old unused landing files (ProductHero hero, HeroTabs, WhoFor on landing, Facts/Statement/Coverage) not cleaned up.

## 2026-11-18 — eSIM buy flow, payment block, grid backgrounds — shipped, screenshot-checked only, not user-confirmed
- `/app/esim` "On your phone": buy form shows straight away (no "Get this eSIM" step); plan picker only when >1 plan. "In your browser" no longer has a Cancel that collapses the form.
- `WalletPay.js` rebuilt as one block: Total today, wallet line (covers / short + Top up), then wallet → card or bank → crypto. Removed the duplicate "Pay by card or bank" button (ShortNote + WalletPay both rendered MolliePay when wallet was short). Used on ~15 screens. Card path NOT verified in preview (Mollie is off there).
- Grid/checker backgrounds removed from landing hero and SIP pages.
- 2026-11-18: Landing 'Cards coming soon' on production — cause: bundled catalogSnapshot (taken from preview) had cardPayments=false and no paymentMethods; live prod catalog returns true. Snapshot regenerated from https://cloudivr.net (script now keeps paymentMethods); /public/catalog now waits up to 2.5s for the Mollie domain check on the first request after a restart (mollie.warm). Needs publish; not verified on production.
- 2026-11-18: SIP 408 (onarrival21) — see DEPLOYMENT_STATE.md last section; fix live on SIP server, awaiting user retry.

## 2026-11-18 — Softphone sign-in status (customers + admin) — preview, self-tested (unit test + screenshots), needs publish
- `js/sip-presence.js`: `fail()`, `overview()`, `status()` now returns `lastFailure {at, reason: password|locked|old_login, login, app, text}` (only failures newer than the last good sign-in, 24 h). `GET /sip-failed/:user` in `_index.js` (X-Sip-Key). `GET /admin/softphones` in `cloudivr-web/admin.js`.
- UI: `SipStatusBadge.js` shows last sign-in on phones too and a plain failure note; admin tab "Softphones" (`pages/admin/Softphones.js`).
- Test: `node js/tests/test_sip_signin_failures.js`.
- SIP server side (upgrade to 6.0.8, watchdog, lock replies) is already live — see DEPLOYMENT_STATE.md.
- Not done: failure note in the Telegram bot's SIP status line; alert when the nginx door or the app API is down.

## 2026-11-18 — Natural female voice for landing demo + free test calls — preview, needs publish, not user-confirmed
- Demo clip `frontend/public/civr/sample/sample-call.mp3` rebuilt by `node scripts/sample-call/make.js`: gpt-4o-mini-tts, voice `marin` (business), `cedar` (caller), `coral` (front desk), per-speaker style brief, natural speed (was 1.08x), uncompressed source, 128 kbps (was 64). 34.7 s → labels now "Hear a sample call" / "That was a CloudIVR call" (es/fr added).
- Free "call me" test calls: `trycall.js` marks the call with `callengine.naturalVoice(id)`; `/callengine/tts.mp3?...&v=n` (signed) speaks with `marin` + style brief as WAV. Other customers' calls keep their current voice (nova/onyx). Endpoint now retries with APP_OPEN_API_KEY if OPENAI_API_KEY is rejected (preview's OPENAI_API_KEY is invalid; both prod keys valid).
- Phone calls are still narrowband (8 kHz) by nature. Not verified on a real phone call.

## 2026-11-18 — Natural voice for everyone, instant test-call greeting, plan-first buying — preview, needs publish, not user-confirmed
- Call engine: every female-voiced spoken prompt now uses `marin` + style brief (`&v=n` on all female URLs; `ceTts()` in `_index.js`). Male stays `onyx`. `naturalVoice()` per-call flag removed.
- `ceTts` keeps each sentence on disk (`os.tmpdir()/callengine-tts`); 20 s after start the app prepares `trycall.SPOKEN` (greeting + 3 menu answers). Measured in preview: greeting 3.1 s → 21 ms from the app. SIP-server helper still converts once per new URL (fast).
- Saved greetings (Voice maker / audio library / bot): new voice `marin` ("Natural, lifelike female") added to `tts-service.js`, goes direct to OpenAI gpt-4o-mini-tts (no speed control), and is the default (`DEFAULT_VOICE`, VoiceMaker, AudioLibrary). Existing saved audio files are unchanged.
- Web buy (calls): plan must be chosen before the number search shows. Steps: What it's for → Choose a plan → Pick a number → Pay. No plan is pre-selected unless it came from a link (`?plan=`) or a resumed checkout. `buy-plan-chosen` / `buy-plan-change` / `buy-number-step` / `buy-pay-step` testids.
- Bot: main buy path was already plan-first; "buy another number" with no active plan used to skip the plan (silently Starter) — now goes through `cpAskPlanFirst()`. Bot path NOT exercised live.
- Texting and fax numbers have a single plan, so they have no plan step.

## 2026-11-18 — Challenge page redesign ("Quick security check") — preview, needs publish
- Replaced the old "Verifying your browser" spinner+progress-bar captcha interstitial with a clean card-based design matching the user-provided reference screenshots.
- New design: centered frosted-glass card with shield-checkmark SVG icon, "Quick security check" heading, "Please continue to complete a security check before accessing this website." body, full-width "Continue" button, "Thank you for your patience." footer.
- Adapts to both dark mode (dark charcoal background, glass card) and light mode (light gray background, white card with shadow) via `prefers-color-scheme` media query.
- All bot-detection heuristics preserved exactly (same scoring logic, same nonce/PoI verification, same timeout behavior).
- Button is immediately visible (no hidden-then-reveal); if clicked before checks complete, it shows "Checking..." and waits for readiness, then auto-submits. High-score clients wait slightly longer (4.2s vs 3s) before PoI becomes ready.
- "Access Denied" failure page also updated to match the new card design language (dark, shield-X icon).
- All user-facing references updated from "Verifying your browser" to "Quick security check" across: `js/lang/en.js`, `js/protection-enforcer.js`, `js/ai-support.js`, `js/cpanel-routes.js`, `js/_index.js`, and detection string in `anti-red-service.js`.
- Files changed: `js/anti-red-service.js` (challengePage function + Access Denied + detection string), `js/lang/en.js` (6 strings), `js/protection-enforcer.js`, `js/ai-support.js`, `js/cpanel-routes.js`, `js/_index.js`.
- Applies to all Reseller API customers and all bot hosting customers (single `challengePage()` function serves all domains).
- Visually verified via screenshot tool (dark + light modes on mobile viewport).

## 2026-11-19 — Full Signed-In UX Refresh — preview, needs publish, needs user confirmation
- Comprehensive visual style refresh across ALL signed-in CloudIVR pages via CSS theme layer.
- **theme-2026.css** (loaded last in cascade) — 350+ lines of design tokens, component overrides, and Tailwind utility color remaps:
  - New palette: dark base #0c0e12, card #13171f, blue accent #3b82f6/#2563eb (was indigo #818cf8)
  - Light theme: #f8fafc base, #ffffff cards, #2563eb accent
  - Hairline borders (8% opacity white in dark, #e2e8f0 in light), no heavy box-shadows
  - Cards: 14px radius, 1px border, hover lift animation
  - Buttons: 44px min-height, blue primary with glow shadow, ghost with accent hover
  - Pills: compact 26px min-height, semantic color variants (ok/warn/bad)
  - Inputs: 44px min-height, subtle bg, blue focus ring
  - Glass morphism: 20px blur + 160% saturation for topbar and mobile nav
  - Stats ribbon: auto-fit grid with 2px gap (was separate cards)
  - Page titles: Barlow Condensed font, clamp(1.5rem, 4vw, 2rem), tight letter-spacing
  - Tables: simpler headers, hairline rows, hover highlight
  - Scrollbar: thin 6px with themed thumb
  - Touch targets: 44px minimum on coarse pointer devices
  - Reduced motion: respects prefers-reduced-motion
  - Utility color remaps: 25+ Tailwind classes remapped from old palette to themed CSS variables (covers all pages at once without individual JS edits)
- **Shell.js** — sidebar uses CSS vars for bg/borders, topbar balance pill uses monospace, main content gets sm:px-6 breakpoint
- **MobileNav.js** — bottom nav glass effect via CSS, touch targets, themed toggle colors
- **ui.js** — PageHeader subtitle uses --c-muted, Field labels use --c-text-2, Toggle uses accent var, ErrorNote/PreviewBanner use semantic color vars
- **SectionTabs.js** — tab text uses --c-muted inactive / --c-text active
- **Dashboard.js** — Stat component value no longer has redundant "block" class (CSS handles layout)
- **Numbers.js** — QuickSwitch/FaxSwitch/IconBtn use CSS vars instead of hardcoded hex
- **LogTable.js** — icon color constants use CSS vars instead of hardcoded hex
- **confirm.js** — dialog card uses civr-card (not hardcoded #111), icon/text colors use CSS vars
- **theme.js** — Fixed CSS load order: theme-2026.css loads LAST (was 3rd of 5, overridden by theme-air.css)
- Testing: 100% frontend functional pass (all pages load, navigation works, interactions work, mobile viewport correct). CSS load order bug found and fixed.
- Files changed: theme-2026.css, theme.js, Shell.js, MobileNav.js, ui.js, SectionTabs.js, Dashboard.js, Numbers.js, LogTable.js, confirm.js
- Added `GET /wallet/usage` API in `js/cloudivr-web/wallet.js`: aggregates walletLedger (call charges, AI receptionist/campaign minutes), phoneTransactions (SMS, fax), and transactions (lookups, credits) for current billing cycle.
- Created `frontend/src/cloudivr/pages/wallet/Usage.js`: summary cards (calls, AI, campaigns, SMS, fax, lookups, total spend), per-number breakdown, destination country breakdown, detailed activity log.
- Added as "Usage" tab between Wallet and Renewal calendar in `nav.js` and routed in `Shell.js`.
- Billing period = earliest purchaseDate to latest expiresAt across active numbers.
- Country detection from destination phone prefix (+1=US/CA, +44=GB, etc.).
- No duplicate entries — each data source (walletLedger, phoneTransactions, transactions) has distinct categories.

## 2026-11-18 — Channel posting extended to all Nomadly products — pushed to GitHub, needs publish
- Extended the channel-ads system to cover ALL Nomadly bot products, not just CloudIVR.
- **@Hostbay** (3 posts/day at 10:00, 16:00, 22:00 UTC): all products — Anti-Red Hosting, Bulletproof Domains, VPS/RDP, Phone Leads, BulkSMS, CloudIVR, Digital Products, USA eSIM, URL Shortener, Wallet.
- **@CloudIVRNet** (1 post/day at 16:00 UTC): CloudIVR-only content (phone numbers, IVR, AI receptionist, campaigns, SIP).
- Channel-aware content: captions, AI prompts, branding, CTA all adapt per channel.
  - @Hostbay CTA → t.me/Nomadlybot (Telegram bot); @CloudIVRNet CTA → cloudivr.net (web).
  - Visual branding shows "Nomadly" for Hostbay, "CloudIVR" for CloudIVRNet.
- 14 new NOMADLY_SCREENS definitions for Nomadly-only products (bot-only, no web screenshots → force AI artwork layout).
- Product facts function `nomadlyFacts()` provides context for AI caption generation.
- Nomadly use-cases and what's-new lists added for varied content rotation.
- Files changed: `js/channel-ads.js`, `js/channel-ads-studio.js`.
- All syntax checks pass. Pushed to GitHub.

### 2026-11-19 — Dark mode polish + number card density
- Number cards: quick switches collapsed behind "Quick switches · X of N on" toggle (Numbers.js SwitchesToggle)
- Inbox filters: single swipeable row on phones
- Fixed select dropdown fill/caret regression (theme-2026.css background → background-color)
- Dark accent pills lighter blue for contrast; light-mode Usage green amounts darker
- Tested: iteration_329 (95% frontend pass)
- Open minor contrast items: ⌘K hint (dark), segmented count opacity, wallet subtitle #a1a1aa, fax "Receiving faxes" emerald-500 (light), logo "IVR" green (light), warn pills amber (light)
