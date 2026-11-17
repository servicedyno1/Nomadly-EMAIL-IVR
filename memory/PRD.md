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
