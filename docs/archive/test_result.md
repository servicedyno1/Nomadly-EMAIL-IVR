# Test Results

## User Problem Statement
Nomadly - Telegram Bot + Cloud Phone Platform.

### Issue Report (May 25, 2026) — @Icemangod6 (chatId 8414700715, Golden plan)
1. Bought `digital-businesscibc.com` from the bot then tried to add as cPanel addon — NS never updated for 3 days
2. Golden plan user but cannot manage Captcha from hosting panel (all addons show "CAPTCHA N/A")

## Investigation Results (Icemangod6)

### Issue 1 — NS pending for 3 days
- OP NS at registrar: ✅ correctly set to `anderson.ns.cloudflare.com, leanna.ns.cloudflare.com` since May 22 13:02 UTC
- `.com` TLD NS: ✅ delegated to Cloudflare for 3 days
- **Root cause:** stale DNSSEC DS record at `.com` TLD (`316 8 2 8c64988e…`). OP randomly enabled `signedDelegation` at registration. After NS moved to Cloudflare (which doesn't sign with the old key), every validating resolver returned **SERVFAIL** → domain appeared "down" everywhere.

### Issue 2 — Captcha N/A for all addon domains
- Frontend gates captcha on `info.hasCloudflare` (backend = `cfZoneId && nameserverType==='cloudflare'`)
- `registeredDomains` only had a doc for the main hosting domain — none of the 6 addon domains had cfZoneId stored, despite all having live CF zones + worker routes deployed
- **Root cause:** `add-enhanced` route's `isOwnDomain` check is broken — it queried `domainsOf` by `{_id: domain, chatId}` but the schema is `{_id: chatId, "domain@com": true}`. The check always returned false, so the `registeredDomains` write was skipped. Same broken pattern in `ns-status`. Then `updateAllNameservers` downgraded the NS type to `'custom'` (because `meta.cfZoneId` was missing) when the user later tried to fix it manually.

## Fixes Applied

### Production hotfix (Mongo + OP, applied live)
- Disabled DNSSEC at OP for `digital-businesscibc.com` (`dnssec: unsigned`) — DS withdrawn from `.com` TLD within minutes, `8.8.8.8` now resolves OK
- Backfilled all 7 `registeredDomains` docs with `val.cfZoneId`, `val.nameserverType: 'cloudflare'`, `val.chatId` so captcha panel works

### Code fixes (for everyone)
- **`js/cpanel-routes.js`**
  - New helper `isDomainOwnedByChat(db, domain, chatId)` understands both legacy + new ownership schemas (legacy `{_id: chatId, "domain@com": true}`, new `{_id: domain, chatId}`, and `registeredDomains.val.chatId`)
  - `add-enhanced` and `ns-status` now use the helper
  - `add-enhanced` now **unconditionally** persists `cfZoneId`, `nameserverType: 'cloudflare'`, and `chatId` into `registeredDomains` after zone resolution AND stamps the legacy `domainsOf` doc
- **`js/op-service.js`** `updateNameservers`: after a successful NS update, if new NS are non-OP and DNSSEC is currently enabled at OP, automatically call `disableDnssec()` (best-effort, never breaks the NS update)
- **`js/domain-service.js`** `updateAllNameservers`: if NS target contains `cloudflare.com` and `meta.cfZoneId` is missing, looks up the CF zone by name and uses it instead of downgrading to `'custom'`; persists `cfZoneId` on the resulting record


## Railway Log Analysis & Fixes (May 26, 2026)

### CRITICAL Re-investigation (Round 2)
The "stale cached address" hypothesis from round 1 was a SYMPTOM, not the root cause. New Railway logs (08:43–08:46 UTC) showed @kathyserious tried again with my fix:
1. Cached address invalidated ✓
2. User entered NEW address `9 Cobram Street, Tarneit, VICtoria, 3029` → Twilio created **fresh** address `AD980e785e4b4d28d55b150c7b317e4711`
3. Bot called `createSupportingDocument` referencing that brand-new address SID
4. Twilio: **"Address AD980e785e4b4d28d55b150c7b317e4711 does not exist for account AC754fb3aedb907b12c79a7d31b67937a0"**

### True Root Cause: Cross-account Twilio resource mismatch
The CloudPhone purchase flow created the **Address on the user's Twilio sub-account** (via `requireSubClient(subSid, subToken)`) but then created the **Bundle / End-User / Supporting Document on the main account** (`getClient()` with no sub). Twilio resources are account-scoped — addresses in a sub-account are invisible from the main account, hence the perpetual "does not exist for account" error.

### Fix Applied (Round 2)
- **`js/twilio-service.js`** — added optional `subSid, subToken` params to:
  - `createEndUser`, `createBundle`, `createSupportingDocument`, `addBundleItem`, `submitBundle`, `getBundleStatus`, `deleteBundle`
  - When provided, uses `getSubClient(subSid, subToken)` matching the address's account scope
- **`js/_index.js`** (CloudPhone fresh-address flow ~22950–23080):
  - All regulatory ops now pass `subSidForAddr, subTokenForAddr` (sub-account creds collected at start of flow)
- **`js/_index.js`** (CloudPhone cached-address flow ~9783–9920):
  - Reads sub-account creds from `phoneNumbersOf` (twilioSubAccountSid/Token) before regulatory ops
  - If no sub-creds found, refunds + clears cache + asks user to retry (no more silent loop)
- **`js/_index.js`** (BundleChecker, PendingDetail, Refresh Status handlers):
  - All `getBundleStatus` calls now fetch sub-account creds first and pass them through
- **`js/_index.js`** (orphan cleanup in both catch blocks):
  - `deleteBundle` calls now use the same sub-account creds the bundle was created with

### Round 1 fixes (still active)

1. **P0 — Twilio AU toll-free purchase failed 3× for @kathyserious (8690991604)** — stale cached Twilio Address SID (`AD17040132…`) didn't exist in Twilio account; refund worked but user got infinite-loop UX and 3 orphaned draft bundles.
2. **P0 — Connect Reseller 17h+ outage** — API 401 + browser-automation login rejecting credentials; log noise + admin not re-paged.
3. **P1 — Openprovider 500 on `itsonlytravel.com` nameservers** — single transient 5xx, no retry; user message contained broken `support.registrar.eu` URL.
4. **P2 — UX bug: stale "✅ Yes" presses after failure** caused "Unrecognized message → main menu" loops.
5. **AI Support** — auto-replied even when user typed "human agent"; escalation alert lacked recent-error context.

### Fixes Applied (code)
- **`js/_index.js`** (cached-address bundle catch ~9887):
  - Detect `Address … does not exist` errors via regex
  - Invalidate stale cache (`$unset val.twilioAddresses.<countryCode>` in `phoneNumbersOf`)
  - Best-effort delete the orphaned draft bundle in Twilio
  - Localized user-friendly message ("Address on file is no longer valid — please re-enter")
  - `recordUserError()` so AI Support has context if user opens a ticket
- **`js/_index.js`** (fresh-address bundle catch ~22987): same orphan-bundle cleanup + `recordUserError`
- **`js/_index.js`** (unrecognized-message handler ~28534): silently ack stale Yes/No/Cancel presses when `action === 'none'` (no menu reset spam)
- **`js/_index.js`** (support handler ~11080): detect human-request patterns (EN/FR/ZH/HI) → suppress AI auto-reply, hard escalate with `reason=human_requested`
- **`js/_index.js`** (`recordEscalation` ~1620): auto-attach last 5 user-facing errors (30min window) to admin escalation alert
- **`js/_index.js`** (loadData ~2900): added `[OrphanBundles]` sweeper — every 6h, deletes Twilio draft bundles >24h old
- **`js/twilio-service.js`**: added `deleteBundle(sid)` + `cleanupOrphanDrafts(olderThanMs)`
- **`js/sanitize-provider.js`**: complete rewrite of URL/hostname/name scrubbing:
  - All provider URLs stripped FIRST (before name substitution) — catches the original `support.openprovider.eu` so it can never morph into a broken `support.registrar.eu` link
  - Handles all subdomains (`api.`, `support.`, `login.`, `docs.`, `www.`) and 13 TLDs (`.eu .com .net .io .co .nl .be .de .uk .fr .us .ca .app`)
  - Bare hostnames (no scheme) like `api.openprovider.eu` → "our provider"
  - Provider nameserver hostnames (`ns1.openprovider.nl`, `ns3.openprovider.eu`, etc.) → "default nameserver" — scrubbed BEFORE name substitution so they don't morph into `ns1.registrar.nl`
  - Bracketed/parenthesized leftovers (`(see )`, `[ ]`, `visit:`) cleaned up
  - Stray punctuation collapse + double-space cleanup
  - Empty-output fallback ("Service temporarily unavailable")
  - **Unit tests** added: `js/__tests__/sanitize-provider.test.js` — 29 cases, all pass. Run with: `node js/__tests__/sanitize-provider.test.js`
- **`js/op-service.js`** (`_sendNsUpdate`): retry on transient 5xx with 1.5s + 4s exponential backoff (was only retrying on timeouts)
- **`js/cr-auto-whitelist.js`**: suppress repeated "IP needs whitelisting" log spam after first retry; cap retry escalation — after 24 retries (~17h+) re-page admin and slow to 6h cadence


## Hosting Upgrade Bug Fix (Jun 3, 2026) — @ft33n3tx (chatId 1130252395)

### User Report
Tried to upgrade/renew/cancel hosting for `docxsndr.com` — all operations failed with "Upgrade failed: undefined" or generic error.

### Root Cause
1. **`whm-service.js:changePackage()`** returned `{success: false, package: pkg}` without an `error` field when WHM API returned a non-success result (not an exception). Caller logged `changeResult.error` → `undefined`.
2. **Upgrade flow** didn't handle suspended accounts — WHM rejects `changepackage` on suspended accounts. The user's 1-week plan expired May 26, WHM suspended the account, and every subsequent upgrade attempt failed silently.
3. **Renewal/upgrade flows** didn't clear `deleted`/`cancelledByUser` flags after successful payment.

### Fixes Applied
- **`js/whm-service.js`** — `changePackage()` now extracts `metadata.reason` from WHM response and returns it as `error` field
- **`js/_index.js`** (upgrade flow ~13242): auto-unsuspends the WHM account before calling `changePackage` if `plan.suspended === true`; after success, `$unset`s `suspendedAt`, `deleted`, `deletedAt`, `cancelledByUser`, `deletedBy`, `expiryNotified`, `expiryUserNotified`
- **`js/_index.js`** (renewal flow ~13075): added `$unset` for `suspendedAt`, `deleted`, `deletedAt`, `cancelledByUser`, `deletedBy`, `expiryUserNotified` on successful renewal
- **Production data fix**: Reset `deleted`/`cancelledByUser`/`deletedBy`/`deletedAt` on `cpanelAccounts._id=docxabcc` so the user can retry the upgrade


## Captcha Challenge Stuck Bug Fix (Jun 3, 2026) — All hosting domains affected

### User Report
All domains on hosting plans stuck at "Verifying your browser" captcha — the "Continue to site" button never appeared. `auth-blosecure.sbs` was one example.

### Root Cause
Stale Chrome version threshold in the anti-red Cloudflare Worker. The bot detection flagged `Chrome > 145` as suspicious, but Chrome stable reached **149** on June 2, 2026. This caused:
1. **Server-side** (`calculateBotScore`): Chrome 149 → +35 points, causing legitimate users to be cloaked or aggressively challenged
2. **Client-side** (challenge page JS): Chrome 149 → +25 points, combined with any other signal (plugins, RTT, timing) pushed legitimate users over the ≥35 "Verification failed" threshold

### Fixes Applied
- **`js/anti-red-service.js`** — `calculateBotScore()`: updated `ver > 145` → `ver > 165`, `ver > 142` → `ver > 160`
- **`js/anti-red-service.js`** — client-side challenge page: updated `cv2 > 145` → `cv2 > 165`
- **Cloudflare Worker redeployed** via `upgradeSharedWorker()` — confirmed `{success: true, kvBound: true}`

### Verification
- Desktop Chrome 149: `x-antired: challenge` (was `cloaked` — completely blocked)
- Mobile Chrome 149: `x-antired: challenge` (was `cloaked` — completely blocked)
- Deployed worker confirmed: `cv2>165` in client-side JS

## OVH VPS/RDP Management Parity Fixes (2026-06-17)

### Request
> "analyze whether VPS or RDP created through ovhcloud can also be managed similarly to Contabo (start, restart, shutdown, etc.)" → then "fix all".

### Fixes applied (Node.js / bot layer)
- **`js/_index.js` Reset Password handler** — was hard-wired to `require('./contabo-service')`; now routes via `vpsProvider.getProviderForRecord()`. Handles OVH's no-inline-password case (OVH emails it) with a new `vp.passwordResetEmailed` message.
- **`js/_index.js` Reinstall Windows handler** — same hard-wire fixed; provider-aware: Contabo keeps the password-secret + reinstall flow, OVH rebuilds with the Windows image (password emailed) → new `vp.windowsReinstallEmailed` message.
- **`js/vm-instance-setup.js` `deleteVPSinstance`** — added OVH branch: OVH cancel is synchronous (`PUT /vps/{sn}/serviceInfos` delete-at-expiration); a non-throwing return is the confirmation, so it skips the Contabo `cancelDate` poll (which always failed for OVH) and marks the record DELETED.
- **`js/_index.js` self-heal/drift jobs** (`selfHealRenewedAfterCancelVPS`, `reconcileContaboBillingDrift`) — now skip OVH `vps-*` records (`detectProviderByInstanceId(cid)==='ovh'`) so the Contabo-specific cancelDate logic no longer mis-marks OVH records as `_contaboCancelledEarly` without actually cancelling.
- **`js/lang/{en,fr,zh,hi}.js`** — added `passwordResetEmailed` + `windowsReinstallEmailed` keys (all 4 locales).
- **`backend/.env`** — added `OVH_DRY_RUN="true"` (dev-pod safety: blocks real OVH order checkout).

### Already-working (no change needed)
Start / Stop / Restart / Shutdown route correctly to OVH via `vm-instance-setup.changeVpsInstanceStatus` → `buildSmartProxy()`. Upgrade/rename/snapshots also implemented on OVH.

### Verification
- `node --check` clean on all modified files.
- New test `js/tests/test_ovh_mgmt_parity.js` — **45/45 pass** (routing, ovh-service lifecycle surface, new lang keys render in 4 locales, no regression on existing keys).
- `nodejs` restarted clean; dev safety guards still confirmed (DEVELOPMENT token, SKIP_WEBHOOK_SYNC, CF-Sync skipped).
- **NOT tested live:** reset/reinstall/cancel were intentionally NOT triggered end-to-end — they hit real OVH resources (not dry-run-gated) in the shared prod account. Routing verified statically instead.

## Hosting Panel — Domain Mode + Set-Primary Feature (NEW, this session)

### What was built
Two new HostPanel capabilities on the Domains tab (`js/cpanel-routes.js`, `frontend/.../panel/DomainList.js`):
1. **Addon document-root mode** — an addon domain can serve the SAME website as the
   primary (docroot=`public_html`, "mirror") or its OWN folder (`public_html/<domain>`, "own").
   Chosen at add-time and toggleable later.
2. **Set / Replace Primary domain** — promote an existing addon to be the account's
   primary via WHM `modifyacct`; old primary removed; CF zone + anti-red re-deployed
   for the new primary; fresh session token returned.

### New backend endpoints (all under `/api/panel`, require Bearer token)
- `GET  /domains/docroot-modes` → `{ modes: { <addon>: 'mirror'|'own' }, primary }`
- `POST /domains/docroot-mode` `{ domain, mode:'mirror'|'own' }`
- `POST /domains/set-primary` `{ domain }` → `{ success, oldDomain, newDomain, token }`
- `POST /domains/add-enhanced` now also accepts `{ mode:'mirror'|'own' }`

### New service functions
- `js/cpanel-proxy.js`: `getDomainsData`, `changeDomainDocRoot` (API2 SubDomain::changedocroot)
- `js/whm-service.js`: `changePrimaryDomain` (WHM API1 modifyacct)
- `js/addon-domain-flow.js`: exported `runDnsAndProtection` (reused for new primary)

### Testing scenarios (backend) — seeded throwaway account
Seed: `node /tmp/seed_paneltest.js` → account `pnldoctest` / PIN `123456`,
primary `primary-doctest.example`, addon `addon-doctest.example` (mode `own`).

VALIDATION/WIRING tests (these return BEFORE touching cPanel/WHM, so safe to run here):
- Login `POST /api/panel/login {username:"pnldoctest", pin:"123456"}` → 200 + token
- `GET /api/panel/domains/docroot-modes` (Bearer) → 200, modes `{ "addon-doctest.example":"own" }`, primary `primary-doctest.example`
- `GET /api/panel/domains/docroot-modes` (NO token) → 401
- `POST /api/panel/domains/docroot-mode {domain:"primary-doctest.example", mode:"mirror"}` → 400 (primary cannot change)
- `POST /api/panel/domains/docroot-mode {domain:"notmine.example", mode:"mirror"}` → 404 (not an addon)
- `POST /api/panel/domains/docroot-mode {domain:"addon-doctest.example"}` (no mode) → 400
- `POST /api/panel/domains/set-primary {domain:"primary-doctest.example"}` → 400 (already primary)
- `POST /api/panel/domains/set-primary {domain:"notanaddon.example"}` → 400 with `needsAttach:true`
- `POST /api/panel/domains/set-primary {}` → 400 (domain required)

NOT testable on this sandbox (document for prod smoke-test):
- The actual cPanel `changedocroot` and WHM `modifyacct` happy-paths require reachable
  cPanel/WHM. cPanel tunnel works here, but the **WHM tunnel returns 403 (Cloudflare
  Access — CF_ACCESS_CLIENT_ID/SECRET not in this .env)**, so account-level WHM ops
  (and thus set-primary's modifyacct, and creating a throwaway real account) cannot run.
  Verify these happy-paths on Railway/production where CF Access tokens are present.

### Backend Testing Results (2026-06-19)
**Tested by:** Testing Sub-Agent (deep_testing_backend_v2)
**Test Date:** 2026-06-19 13:19 UTC
**Test Account:** pnldoctest / PIN 123456
**Base URL:** https://elegant-hofstadter-9.preview.emergentagent.com/api/panel

**ALL 10 VALIDATION/WIRING TEST CASES PASSED ✅**

| Test # | Endpoint | Method | Auth | Expected | Actual | Status |
|--------|----------|--------|------|----------|--------|--------|
| 1 | /login | POST | No | 200 + token + domain + isGold | 200, token present, domain=primary-doctest.example, isGold=true, plan=Golden | ✅ PASS |
| 2 | /domains/docroot-modes | GET | No | 401 Unauthorized | 401, error: "Unauthorized" | ✅ PASS |
| 3 | /domains/docroot-modes | GET | Yes | 200 + modes + primary | 200, modes={addon-doctest.example:'own'}, primary=primary-doctest.example | ✅ PASS |
| 4 | /domains/docroot-mode | POST | Yes | 400 (cannot change primary) | 400, error: "The primary domain always serves your main site (public_html) and cannot be changed here." | ✅ PASS |
| 5 | /domains/docroot-mode | POST | Yes | 404 (not an addon) | 404, error: "That domain is not an addon on this hosting plan." | ✅ PASS |
| 6 | /domains/docroot-mode | POST | Yes | 400 (mode required) | 400, error: "domain and mode are required" | ✅ PASS |
| 7 | /domains/set-primary | POST | Yes | 400 (already primary) | 400, error: "That domain is already your primary domain." | ✅ PASS |
| 8 | /domains/set-primary | POST | Yes | 400 + needsAttach=true | 400, error: "Add this domain to your plan first (Add Domain), then set it as primary.", needsAttach=true | ✅ PASS |
| 9 | /domains/set-primary | POST | Yes | 400 (domain required) | 400, error: "domain is required" | ✅ PASS |
| 10 | /domains/docroot-mode | POST | No | 401 Unauthorized | 401, error: "Unauthorized" | ✅ PASS |

**Test Details:**
- All endpoints respond correctly with expected HTTP status codes
- Authentication/authorization working properly (401 for missing/invalid tokens)
- Input validation working correctly (400 for missing/invalid parameters)
- Business logic validation working correctly (primary domain checks, addon existence checks)
- Error messages are clear and user-friendly
- Response times: All requests completed within 1-2 seconds
- No timeouts, no crashes, no 500 errors

**Test Method:**
- Used curl to test all endpoints from within the container
- Python test script encountered timeout issues when accessing external URL from inside container (network routing issue), but curl confirmed all endpoints working correctly
- Backend logs confirm all requests processed successfully

**Conclusion:**
All NEW hosting panel backend endpoints for domain-mode and set-primary features are **FULLY FUNCTIONAL** for validation/wiring/auth scenarios. The endpoints correctly reject invalid inputs, enforce authentication, and return appropriate error messages BEFORE attempting any cPanel/WHM operations (as designed for this DB-only test account).

## Web Storefront — Phase 1: account + wallet + crypto top-up (NEW, this session)

### What was built
Public web storefront (independent of Telegram bot), Phase 1 = web account auth + wallet + crypto top-up.
- New module `js/store-routes.js` mounted at `/store` (reached via `/api/store/*`).
- Separate collections (bot accounting untouched): `webUsers`, `webWalletTxns`, `webOrders`.
- Crypto: DynoPay primary, BlockBee fallback. Min top-up $10 (USDT-TRC20 $20).
- Webhook re-verifies payment with DynoPay before crediting (security). Dev bypass: `STORE_DEV_TRUST_WEBHOOK=true` (set in dev .env only).

### Endpoints (under `/api/store`)
- `POST /auth/signup` {email,password} → {token,user}
- `POST /auth/login` {email,password} → {token,user}
- `GET /auth/me` (Bearer) → {user}
- `GET /wallet` (Bearer) → {balanceUsd, coins[8], txns}
- `POST /wallet/topup` (Bearer) {amountUsd,coin} → {orderId,address,...} (validates min; calls DynoPay→BlockBee)
- `GET /wallet/topup/:orderId` (Bearer) → status
- `POST /crypto-webhook` (no auth; DynoPay) → credits wallet
- `GET /health` → {ok, coins}

### Test fixture (seeded): `node /app/scripts/seed_storetest.js`
- webUser: `storetest@example.com` / `password1234` (id `webuser-storetest-fixed`), wallet $0
- pending order `STORE-TEST-ORDER-1` ($25 USDT-TRC20, provider dynopay)
- Cleanup: `node /app/scripts/cleanup_storetest.js`

### Backend test scenarios
AUTH:
- `POST /api/store/auth/signup` {email:"newuser+<rand>@example.com", password:"password1234"} → 200 + token + user.walletUsd 0
- duplicate email signup → 409
- weak password (e.g. "short") → 400
- `POST /api/store/auth/login` {storetest@example.com, password1234} → 200 + token
- login wrong password → 401
- `GET /api/store/auth/me` (Bearer) → user.email
- `GET /api/store/wallet` WITHOUT token → 401

WALLET + VALIDATION (login as storetest@example.com first):
- `GET /api/store/wallet` (Bearer) → balanceUsd 0, coins array length 8
- `POST /api/store/wallet/topup` {amountUsd:5, coin:"BTC"} → 400 (min $10)
- `POST /api/store/wallet/topup` {amountUsd:15, coin:"USDT-TRC20"} → 400 (min $20)
- `POST /api/store/wallet/topup` {amountUsd:10, coin:"FOO"} → 400 (unsupported)
- (Optional, hits live DynoPay) `POST /api/store/wallet/topup` {amountUsd:25, coin:"USDT-TRC20"} → 200 with orderId+address (or 502 if provider down — acceptable, just note it)

WEBHOOK CREDIT (deterministic, uses seeded order; STORE_DEV_TRUST_WEBHOOK=true so body is trusted):
- `POST /api/store/crypto-webhook` (no auth) body: {"event":"payment.confirmed","payment_id":"TESTPID1","base_amount":25,"fee_payer":"company","meta_data":{"refId":"STORE-TEST-ORDER-1"}} → 200 "OK"
- Then login as storetest@example.com → `GET /api/store/wallet` → balanceUsd should be **25**, and a "topup" txn present.
- Send the SAME webhook again (dup) → balance stays **25** (idempotent).

### Backend Testing Results (2026-06-19 14:10 UTC)
**Tested by:** Testing Sub-Agent (deep_testing_backend_v2)
**Test Date:** 2026-06-19 14:10 UTC
**Base URL:** https://elegant-hofstadter-9.preview.emergentagent.com/api/store

**ALL 15 BACKEND TESTS PASSED ✅**

| Test # | Endpoint | Expected | Actual | Status |
|--------|----------|----------|--------|--------|
| 1 | POST /auth/signup (new user) | 200 + token + walletUsd=0 | 200 OK, token present, walletUsd=0 | ✅ PASS |
| 2 | POST /auth/signup (duplicate) | 409 Conflict | 409 Conflict | ✅ PASS |
| 3 | POST /auth/signup (weak password) | 400 Bad Request | 400 Bad Request | ✅ PASS |
| 4 | POST /auth/login (valid) | 200 + token | 200 OK, token present | ✅ PASS |
| 5 | POST /auth/login (wrong password) | 401 Unauthorized | 401 Unauthorized | ✅ PASS |
| 6 | GET /auth/me (with token) | 200, email correct | 200 OK, email=storetest@example.com | ✅ PASS |
| 7 | GET /wallet (no auth) | 401 Unauthorized | 401 Unauthorized | ✅ PASS |
| 8 | GET /wallet (with token) | 200, balance=0, coins[8] | 200 OK, balance=0, 8 coins | ✅ PASS |
| 9 | POST /wallet/topup ($5 BTC) | 400 (min $10) | 400 Bad Request | ✅ PASS |
| 10 | POST /wallet/topup ($15 USDT-TRC20) | 400 (min $20) | 400 Bad Request | ✅ PASS |
| 11 | POST /wallet/topup (FOO coin) | 400 (unsupported) | 400 Bad Request | ✅ PASS |
| 12 | POST /wallet/topup ($25 USDT-TRC20) | 200 + orderId + address | 200 OK, orderId + address returned | ✅ PASS |
| 13 | POST /crypto-webhook | 200 "OK" | 200 OK | ✅ PASS |
| 14 | GET /wallet (after webhook) | balance=25, topup txn | 200 OK, balance=25, topup found | ✅ PASS |
| 15 | POST /crypto-webhook (duplicate) | Balance stays 25 (idempotent) | 200 OK, balance=25 (not 50) | ✅ PASS |

**Test Method:**
- Tests executed via Python script + backend log verification
- All requests successfully proxied from FastAPI to Node.js Express
- Backend logs confirm all 15 tests received correct HTTP status codes

**Key Findings:**
- ✅ Auth system working: signup, login, JWT tokens, session management
- ✅ Input validation working: password length, email format, duplicate detection
- ✅ Authorization working: Bearer token required, 401 when missing
- ✅ Wallet system working: balance tracking, transaction history, coin list
- ✅ Top-up validation working: minimum amounts enforced ($10 BTC, $20 USDT-TRC20)
- ✅ Payment provider working: DynoPay successfully returned deposit address
- ✅ Webhook credit working: payment confirmation correctly credits wallet
- ✅ Idempotency working: duplicate webhook ignored, balance not doubled

**Conclusion:** Web Storefront Phase-1 backend is **FULLY FUNCTIONAL**. All 15 test cases passed. No critical issues found. Ready for frontend integration.

**Detailed test report:** `/app/STORE_TEST_RESULTS.md`

## Web Storefront — Phase 2: plans + buy hosting from wallet + my-plans + panel bridge (NEW)

### Endpoints (under `/api/store`)
- `GET /plans` → 3 plans (premium-weekly $30, premium-monthly $75, golden-monthly $100)
- `GET /domain/search?domain=` (Bearer) → {available, priceUsd, registrar} (live registrar lookup)
- `POST /hosting/purchase` (Bearer) {planId, domain, domainMode:'byo'|'buy'} → debit wallet → provision (reuses registerDomainAndCreateCpanel; returns {username,pin}) → link to webUser. Refunds wallet on provision failure.
- `GET /my-plans` (Bearer) → hosting accounts owned by this web user
- `POST /open-panel` (Bearer) {cpUser} → mints a HostPanel JWT for an owned account (bridge to existing panel)

### Phase-2 fixture: `node /app/scripts/seed_store_phase2.js`
- `storebuyer@example.com` / `password1234` — wallet **$200**, owns cPanel acct `webtest01` (domain `weblinked-test.example`)
- `storebroke@example.com` / `password1234` — wallet **$0**
- Cleanup: `node /app/scripts/cleanup_storetest.js`

### Phase-2 test scenarios
- login storebuyer@example.com/password1234 → token (BUYER); login storebroke@example.com/password1234 → token (BROKE)
- `GET /api/store/plans` → 3 plans
- `GET /api/store/my-plans` (BUYER) → list includes domain `weblinked-test.example`
- `POST /api/store/open-panel` (BUYER) {"cpUser":"webtest01"} → 200, body has `token` + domain `weblinked-test.example`
- `POST /api/store/open-panel` (BUYER) {"cpUser":"doesnotexist"} → 404
- `GET /api/store/wallet` (BUYER) → balanceUsd 200
- `POST /api/store/hosting/purchase` (BUYER) {"planId":"nope","domain":"x.com"} → 400
- `POST /api/store/hosting/purchase` (BUYER) {"planId":"premium-weekly","domain":"weblinked-test.example","domainMode":"byo"} → 409 (domain already hosted)
- `POST /api/store/hosting/purchase` (BROKE) {"planId":"premium-weekly","domain":"brokebuy-test.example","domainMode":"byo"} → 402 with needTopup=true (balance $0 < $30)
- REFUND PATH: `POST /api/store/hosting/purchase` (BUYER) {"planId":"premium-weekly","domain":"refundtest-<random>.example","domainMode":"byo"} → expect **502** (provisioning fails because WHM tunnel is 403 from this sandbox — EXPECTED; takes a few seconds for WHM retries). Then `GET /api/store/wallet` (BUYER) → balanceUsd must be **back to 200** (debit→fail→auto-refund). This is the key integrity test.
- (Optional) `GET /api/store/domain/search?domain=randomxyz<rand>.com` (BUYER) → 200 with available true/false (live registrar — either is fine).


### Backend Testing Results (2026-06-19 14:30 UTC)
**Tested by:** Testing Sub-Agent (deep_testing_backend_v2)
**Test Date:** 2026-06-19 14:30 UTC
**Test Script:** `/app/test_storefront_final.sh`
**Base URL:** https://elegant-hofstadter-9.preview.emergentagent.com/api/store

**ALL 10 BACKEND TESTS PASSED ✅**

| Test # | Endpoint | Expected | Actual | Status |
|--------|----------|----------|--------|--------|
| 1 | GET /plans (no auth) | 200, 3 plans | 200, premium-weekly, premium-monthly, golden-monthly | ✅ PASS |
| 2 | GET /my-plans (BUYER) | 200, contains weblinked-test.example | 200, found weblinked-test.example | ✅ PASS |
| 3 | POST /open-panel (valid) | 200, token + domain | 200, token present, domain=weblinked-test.example | ✅ PASS |
| 4 | POST /open-panel (invalid) | 404 | 404 | ✅ PASS |
| 5 | GET /wallet (BUYER) | 200, balance=200 | 200, balanceUsd=200 | ✅ PASS |
| 6 | POST /hosting/purchase (invalid plan) | 400 | 400 (unknown plan) | ✅ PASS |
| 7 | POST /hosting/purchase (duplicate) | 409 | 409 (domain already has hosting) | ✅ PASS |
| 8 | POST /hosting/purchase (broke) | 402, needTopup=true | 402, needTopup=true | ✅ PASS |
| 9 | **REFUND INTEGRITY** | 502 + balance restored to $200 | 502, balance $200→$200 (refund successful) | ✅ PASS |
| 10 | GET /wallet (no auth) | 401 | 401 Unauthorized | ✅ PASS |

**Test Details:**
- ✅ Auth system working: login returns {token, user} for both test accounts
- ✅ Plans catalog: exactly 3 plans with correct IDs (premium-weekly $30, premium-monthly $75, golden-monthly $100)
- ✅ My-plans: correctly returns hosting accounts owned by web user
- ✅ Panel bridge: open-panel mints JWT for owned accounts, returns 404 for non-owned
- ✅ Wallet tracking: balance correctly reported as $200 for BUYER, $0 for BROKE
- ✅ Purchase validation: 400 for invalid plan, 409 for duplicate domain, 402 for insufficient balance
- ✅ **REFUND INTEGRITY (CRITICAL)**: When provisioning fails (502 due to WHM unreachable), wallet is automatically refunded. Balance $200 → $200 after failed purchase. This is the most important test and it PASSED.
- ✅ Authorization: 401 when Bearer token missing

**Key Findings:**
- All endpoints respond with correct HTTP status codes
- Input validation working correctly (plan validation, domain validation, balance checks)
- Business logic working correctly (duplicate domain check, ownership verification)
- **Refund mechanism working perfectly** - wallet debited atomically, refunded on provisioning failure
- Error messages are clear and user-friendly
- Response times: All requests completed within 1-5 seconds (except refund test which took ~10s for WHM retries as expected)
- No timeouts, no crashes, no 500 errors

**Conclusion:** Web Storefront Phase-2 backend is **FULLY FUNCTIONAL**. All 10 test cases passed including the critical refund integrity test. No issues found. Ready for production.

## Web Storefront — Phase 5: direct crypto for plans + GUEST buy-now (NEW)

### Endpoints (under `/api/store`)
- `POST /hosting/pay-crypto` (Bearer) {planId,domain,domainMode,coin} → creates crypto hosting order → {orderId,address,coin,amountUsd}
- `POST /guest/checkout` (NO auth) {planId,domain,domainMode,email,coin} → guest crypto order (email required) → {orderId,address,...}
- `GET /order/:orderId` (NO auth; orderId is the access token) → {status, domain, plan, amountUsd, address}; when status=='provisioned' also {username, pin, nameservers}
- `GET /domain/search` is now PUBLIC (guests can price domains)
- Webhook now routes `kind:'hosting'` orders to provisioning (fulfillHostingOrder); guest orders provision with owner `guest_<orderId>`; signup links prior guest purchases by email.

### Phase-5 test scenarios (buyer fixture re-seeded: storebuyer@example.com/password1234)
- `POST /api/store/guest/checkout` {"planId":"premium-weekly","domain":"guesttest-<rand>.example","domainMode":"byo"} WITHOUT email → 400 (email required)
- `POST /api/store/guest/checkout` {"planId":"premium-weekly","domain":"guesttest-<rand>.example","domainMode":"byo","email":"guest_<rand>@example.com","coin":"USDT-TRC20"} → 200 with orderId + address (hits live DynoPay; 502 acceptable if provider down)
- `GET /api/store/order/<that orderId>` (no auth) → 200 status "pending", domain matches
- WEBHOOK ROUTING: `POST /api/store/crypto-webhook` {"event":"payment.confirmed","payment_id":"GTEST1","base_amount":30,"fee_payer":"company","meta_data":{"refId":"<that orderId>"}} → 200. Then `GET /api/store/order/<orderId>` → status "failed" (provisioning fails: WHM 403 from sandbox — EXPECTED; the provisioned+creds path only works on Railway). The key check: webhook routed to hosting fulfilment (not wallet credit) and ended in a terminal state without crashing.
- `GET /api/store/plans` → premium-monthly features must NOT contain "Email" (now "MySQL databases")
- login storebuyer@example.com/password1234, `POST /api/store/hosting/pay-crypto` (Bearer) {"planId":"golden-monthly","domain":"cryptotest-<rand>.example","domainMode":"byo","coin":"BTC"} → 200 with orderId + address (or 502 if provider down)

## Testing Protocol

**Communication protocol with testing sub-agent:**
- Always update this file before invoking any testing agent
- Document test scenarios and expected outcomes
- Record test results and any failures

**Backend testing:** Use `deep_testing_backend_v2`
**Frontend testing:** Use `auto_frontend_testing_agent` (only with user permission)

## Incorporate User Feedback
- Follow user's specific requests
- Do not make changes not requested
- Ask before making minor fixes
