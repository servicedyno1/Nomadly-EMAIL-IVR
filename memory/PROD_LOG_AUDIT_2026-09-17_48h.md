# Production Log Audit — Railway `Nomadly-EMAIL-IVR` — last 48h
Window: 2026-09-15T03:00Z → 2026-09-17T03:00Z (production clock).
Tooling: `ops/railway_48h_anomaly.js` (read-only Railway GraphQL, `API_KEY_RAILWAY`). Raw JSONL in `/app/investigations/anomaly48h/`.

## TL;DR
Payments, billing, Twilio subaccounts, DB and the bot itself are healthy. No new billing leak (the F2/F3/F4 fixes are visibly working — every "not billed" line is a correctly-excluded bridge/transfer leg). Three real problems stand out, two of them credential/infra rather than code.

## Findings (ranked)

### 1. Connect Reseller domain API is fully down in prod — 401 "Unauthenticated user" (P1, infra)
- `checkDomainPriceOnline error: 401 Unauthorized "Unauthenticated user"` ×85
- `[CR-Whitelist] API test failed` ×37, `[CR-Whitelist] Browser automation failed: Login failed - landed on .../login` ×9
- Root cause: the production Railway egress IP is **not whitelisted** at ConnectReseller, and the auto-whitelist browser bot can no longer log in (CR login page rejects it → creds/2FA/portal change).
- Impact: **degraded, not fatal.** `domain-service.checkDomainPrice()` runs CR + OP in parallel; OpenProvider is healthy so users still get prices/registration. But CR is effectively offline → no price competition, fewer TLD options, all registrations routed to OP.
- Fix is **not code**: whitelist the prod egress IP in the CR dashboard (or fix CR login creds). Code side we could add an admin alert when CR has been 401 for >X min so this doesn't silently rot.

### 2. cPanel self-heal loop thrashing on a SUSPENDED account `ghrx51df` (P2, CODE — fixable)
- `[Panel] Self-heal: cpPass rotation FAILED for ghrx51df — the user "ghrx51df" is currently suspended. Changing the user's password would unsuspend the account` ×19
- `[Panel] Self-heal: cpPass repair failed for ghrx51df` ×19, `list_files user-level failed … WHM fallback (user-auth-broken)` ×10
- Root cause: `_repairCpPass` (js/cpanel-routes.js:362-376) — when WHM `/passwd` fails it returns `{ok:false}` but never stamps `cpPassRotatedAt`, so the 60-min cool-down never engages → every request retries forever. For a suspended account the rotation can NEVER succeed (WHM refuses because it would unsuspend).
- Fix: detect the "suspended" reason and short-circuit as terminal (stamp a cool-down / `cpPassSuspendedAt`) so it stops thrashing. Cheap, self-testable via the injected `repairFn` in the existing test harness.

### 3. Contabo VPS auth still 100% broken + noisy self-heal (P1, infra — known)
- `[Contabo] Token fetch failed … error: 'invalid_client', 'Invalid client credentials'` ×101
- `[VPS Self-heal] Could not fetch <id>: VPS provider authentication failed` ×96
- Known issue from prior forks. Contabo OAuth client creds are invalid. VPS_DEFAULT_PROVIDER is `digitalocean`, so new VPS may route around it, but any Contabo-tagged VPS self-heal loops 96×/48h.
- Fix is **not code** (valid Contabo creds). Code side: gate the Contabo self-heal so it backs off after N failures instead of retrying every cycle.

## Benign / confirmed-healthy (no action)
- **Billing:** 161 "not billed" lines are ALL correct bridge/transfer-leg exclusions (F2/F3/F4 working). No over/under-bill patterns.
- **Payments:** DynoPay webhooks processing, idempotency dedup working, BlockBee fallback firing, Fincra reconcile scheduled. No payment failures.
- **Twilio:** PhoneMonitor 38 subaccounts, auth-failed=0 on every 30-min check.
- **Telegram:** 69 `bot was blocked by the user` are AutoPromo sends to users who blocked the bot (expected churn); `message can't be edited` ×4 handled by the fresh-send fallback.
- **Voice "expired":** ~500 `handleCallAnswered: NO SESSION … (likely outbound or expired) — skipping` = expected for outbound legs.
- **Process restarts:** `npm … SIGTERM` ×10 (mostly 09-16 afternoon) = rolling redeploys, not crashes — no stack traces before them, heap steady at ~3%.
- **CpanelMigration timeout** ×10 (`list WHM accounts: timeout 30000ms`) — a single migration job retrying; low impact.
- **Abuse note (not a bug):** several hosted anti-red domains are phishing look-alikes (rbc-verify.com, charlesschwab-secure.org, netflixsecure-dashboard.com, securitedesjardins.com…). Compliance/business call, not engineering.

## Fixes applied (2026-09-17, user-approved)
Approved: fix #2, quiet #3 & #1 loops, ignore CR/Contabo infra root causes.

### #2 cPanel self-heal loop on SUSPENDED accounts — FIXED (code)
- `js/cpanel-routes.js`: `_repairCpPass` now detects a terminal WHM `/passwd` reason via new `_isTerminalPasswdReason()` (suspended / would-unsuspend / locked / disabled). On detection it stamps `cpPassSuspendedAt` and backs off for `CPPASS_SUSPENDED_COOLDOWN_MIN` (default 360m), returning `{terminal:true}`. A recent marker short-circuits BEFORE any WHM call (`{suppressed:true}`). A successful rotation `$unset`s the marker. `_selfHealCpPass` no longer logs the generic "cpPass repair failed" for terminal/suppressed results.
- Effect: ghrx51df-style thrash (38 log lines/48h) → one concise line per 6h back-off window; no more pointless WHM `/passwd` calls.
- Tests: `js/tests/test_cpanel_suspended_selfheal_2026-09.js` (15/15). Regression `test_cpanel_selfheal_cppass.js` 24/24 green.

### #3 Contabo auth spam — QUIETED (code; infra creds still invalid_client, left to owner)
- `js/contabo-service.js`: `getAccessToken` now trips an **auth circuit breaker** (`_authFail`) on a terminal auth failure — subsequent calls fast-fail with a typed `VPS_AUTH_DOWN` error WITHOUT hitting keycloak, for `CONTABO_AUTH_COOLDOWN_MIN` (default 30m). Reason logged exactly once per window. New `isAuthHealthy()` export.
- `js/_index.js` `selfHealRenewedAfterCancelVPS`: skips the whole Contabo sweep with ONE throttled log (≤1/6h) when `isAuthHealthy()` is false, and breaks the per-instance loops on a mid-cycle `VPS_AUTH_DOWN`.
- Effect: ~200 noise lines/48h (101 token-fetch + 96 self-heal "Could not fetch") → a couple of lines.
- Tests: `js/tests/test_contabo_auth_breaker_2026-09.js` (10/10). `test_contabo_service.js` failures are pre-existing (live API rejects the invalid creds + env-driven pricing/catalog drift), unchanged by this work.

### #1 Connect Reseller — NO code change (per "ignore")
- The `cr-auto-whitelist.js` loop is already throttled per-process (escalating back-off 60s→10m→60m→6h; test-fail logs deduped to first-3-then-every-10th; browser automation once per process). The 48h volume (37 test-fail + 9 browser-fail) is **restart-amplified** (~10 process restarts), not in-process thrash. Infra root cause (prod egress IP not whitelisted at CR / CR portal login rejecting `CR_PANEL_*`) left to the owner. OpenProvider fallback keeps domain pricing working.
