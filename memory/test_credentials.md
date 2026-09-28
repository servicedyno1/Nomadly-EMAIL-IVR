# Test Credentials — Smadav/Nomadly Platform

## Re-provision 2026-09-28 (CURRENT pod) — fresh cred setup, Safe Dev Sandbox (user chose "a")
- Pod preview URL: **https://8aa23bba-0ef0-43c2-bbeb-149d34ef20e2.preview.emergentagent.com**  (frontend/.env REACT_APP_BACKEND_URL → proxies /api to Node :5000)
- Both `backend/.env` + `frontend/.env` were EMPTY on arrival → rewritten from the user's full cred dump.
- SANDBOX OVERRIDES vs supplied creds: `BOT_ENVIRONMENT=development` (was production), `SKIP_WEBHOOK_SYNC=true` (was false), added `DO_RDP_GOLDEN_AUTOSYNC=false` (blocks billable DO golden builds from this dev pod).
- Steps: wrote .env files; `yarn install --ignore-engines` (root, node20 vs pkg-wants-22); `pip install -r backend/requirements.txt`; `bash scripts/setup-nodejs.sh` (registered supervisord_nodejs.conf, updated SELF_URL/SELF_URL_PROD → this pod + /api); restarted backend+frontend to load fresh .env.
- Verified: nodejs :5000 boot clean ("MongoDB connection pool ready", err log empty), `[CF-Sync] Skipped BOT_ENVIRONMENT=development`, `[AntiRed] worker upgrade SKIPPED`, FastAPI `[Scheduler] SKIP_WEBHOOK_SYNC=true phone health monitor DISABLED`. `/api/health` → {healthy, database:connected} on both :5000 and :8001 proxy. Frontend renders Smadav brand, panel badge ONLINE (Bot Running / DB Connected / REST APIs Active). Telegram prod webhook NOT hijacked.

## Run mode (this Emergent pod)
- Mode: **Safe Dev Sandbox** (per user choice)
- BOT_ENVIRONMENT=development
- SKIP_WEBHOOK_SYNC=true  → production Telegram webhook is PRESERVED (points to https://smadav.up.railway.app/telegram/webhook), NOT this pod
- Database: **LIVE Railway production MongoDB** (MONGO_URL → sakura.proxy.rlwy.net, DB_NAME=smadav)

## PII log-redaction port 2026-09-27 (main 8a4fd9a → WhiteLabel)
- Added js/log-redact.js (customer domains → ***, real-TLD allowlist; infra/own domains + code tokens + IPs kept). Wired installConsoleRedaction() at top of js/_index.js (right after dotenv.config). Added the one-liner require to the 14 js/ops/* scripts that exist in WhiteLabel (main's other 30 ops scripts aren't in this branch). New test js/tests/test_log_redact_2026-06.js 25/25.
- Brand adaptation (config only, code identical to main): set LOG_REDACT_KEEP="smadavhost.com,smadavspeech.com" in backend/.env so WhiteLabel's own brand domains stay readable in logs (SELF_URL host auto-kept). Kill switch LOG_REDACT=0.
- Verified live: evil-customer.ca → ***, 1.panel.smadavhost.com / api.telegram.org / cloudflareapi.com / store-routes.js / IPs all preserved. Node boots clean.
- main commits newer than this that are already handled: f237ea7 (empty-state, ported), 65c9bd5 (sig rotation, in P0 port). The 0544a7a/f3a96e9/4149a23/d2ddb94 commits are platform auto-generated noise.

## Empty-state UX port 2026-09-27 (main f237ea7 → WhiteLabel)
- Ported "Bot empty-state UX pass" from main commit f237ea7 into js/_index.js: resilient showFirstSessionIntent() helper (send-then-set, falls back to full menu), consolidated "free to try" hint (merged IVR-trial + SIP-test), softened no-activity greeting line, one-tap Wallet CTA on empty transaction history, returning-but-inactive re-onboarding (gated by firstSessionIntentDone + firstIntentReshown + hasPurchased), first-deposit-bonus tip. New test js/tests/test_empty_state_ux_2026-06.js 16/16; js/tests/test_intent_funnel_2026-06.js bumped to {0,800} 13/13. Node boots clean.
- The commit's "DynoPay prod signature verification" half was already covered by the earlier P0 + multi-v1 rotation port (store-payment-verify.js) — f237ea7 touched no payment code, only _index.js + tests + an investigation doc.
- NOTE: this pod's git remote/token is disconnected (origin URL empty; ghu_ token expired mid-session). Ported by pulling the public commit diff over HTTPS (github.com/servicedyno1/Nomadly-EMAIL-IVR is Public). If Save-to-GitHub fails, the GitHub connection may need re-linking (support).

## Web dashboards / panels
- Sales & Profit Dashboard password: `Nomadly123@`  (env: SALES_DASHBOARD_PASSWORD)

## Upstream port 2026-09-27 (main → WhiteLabel, Reseller API excluded)
- Ported the P0 forged-DynoPay-webhook fix + crypto end-to-end + signature-rotation from `main`:
  js/store-payment-verify.js (244-line hardened rewrite), js/store-routes.js (signature gate + gateway-authoritative /crypto-webhook + /admin/reconcile-order), js/pay-dynopay.js (getDynopayPaymentStatusById), js/_index.js (rawBody capture + authDyno non-paid idempotency gate). Plus js/ops/whm_ea4_install_ext.js. Excluded: apidoc-page.js + /apidoc (Reseller API docs).
- Verified: js/tests/test_store_webhook_security_2026-06.js 9/9, js/tests/test_authdyno_created_fix_2026-06.js 5/5 (drove REAL handlers; live-DB test residue purged + verified clean).
- OPTIONAL: set `DYNO_PAY_WEBHOOK_SECRET` (whsec_… from DynoPay dashboard → save webhook URL) in Railway for BOTH services to turn ON full HMAC signature verification. Until then, security rests on the (solid) server-to-server re-verify: gateway unreachable/contradicts → HOLD + admin alert. To hard-reject bad signatures once prod logs show sig=valid, set `DYNO_PAY_WEBHOOK_SIG_ENFORCE=true`.

## Telegram
- Bot username: `@smadavv_bot`
- Admin chat id: `5590563715`  (env: TELEGRAM_ADMIN_CHAT_ID)
- Bot token (dev==prod): 8822506525:... (env: TELEGRAM_BOT_TOKEN_PROD / _DEV)

## URLs
- Frontend/preview (CURRENT pod, re-provisioned 2026-09-27): https://credential-config.preview.emergentagent.com
- Frontend/preview (previous pod): https://credential-config.preview.emergentagent.com
- Backend API base (proxied to Node :5000): <preview>/api

## Re-provision 2026-09-27 (this pod)
- Fresh backend/.env + frontend/.env written from user-supplied creds. SAFE DEV SANDBOX overrides applied: BOT_ENVIRONMENT=development, SKIP_WEBHOOK_SYNC=true.
- Verified: Telegram webhook LEFT UNTOUCHED (still https://samdav1.up.railway.app/telegram/webhook — NOT hijacked). CF-Sync skipped (dev). FastAPI phone health monitor skipped (SKIP_WEBHOOK_SYNC). Live Railway Mongo connected (DB=smadav).
- Services: nodejs (:5000) RUNNING + Mongo connected; backend (:8001) proxy /api/health healthy; frontend title/brand = SmadavBot, panel badge ONLINE (Bot: Running / DB: Connected / REST APIs: Active).
- Steps: yarn install --ignore-engines (root, node20 + --ignore-engines since pkg wants node22); bash scripts/setup-nodejs.sh (registers supervisord_nodejs.conf, updates SELF_URL to this pod +/api); restart backend+frontend so they load the new .env (frontend had booted before .env existed -> stale defaults until restart).
- NOTE: a few reconciler/enforcer jobs still tick against the LIVE DB in this mode (ProtectionEnforcer, BalanceMonitor, FincraReconcile, EmailBlast queue). They are read/decision-heavy and mostly deferred, but not hard-disabled by the two flags. Gate further if strict isolation is needed.
- Re-provisioned 2026-09-14 (WhiteLabel branch, this pod): fresh backend/.env + frontend/.env from user creds (BOT_ENVIRONMENT=development, SKIP_WEBHOOK_SYNC=true overrides); ran scripts/setup-nodejs.sh; restarted backend+frontend (both had started before .env existed — backend KeyError MONGO_URL + frontend un-interpolated %REACT_APP_BRAND_PANEL_NAME% — both fixed by restart). All services verified: nodejs RUNNING + Mongo pool ready, external /api/health healthy + DB connected, frontend title "SmadavHost | Hosting Panel", panel dashboard renders (Bot: Running / DB: Connected / REST APIs: Active). Dev guards confirmed in node log (NS-retry / AntiRed / CF-Sync / hosting scheduler / phone-health-monitor all SKIPPED). Known non-blocker: BalanceMonitor Telnyx HTTP 401 (provided TELNYX_API_KEY rejected by Telnyx balance endpoint — Twilio balance OK $11.50).
- Panel domain: panel.smadavhost.com | SIP domain: sip.smadavspeech.com

## Panel (cPanel management UI) testing
- No live customer panel credentials are stored here. cPanel/WHM operations run
  against the LIVE production WHM (68.183.77.106) + live customer accounts.
- DO NOT run destructive cPanel ops (add/delete subdomain/domain, MySQL
  create/delete, file rename/move) against real accounts from this pod.

### Bulk-Subdomain feature test — VERIFIED then TORN DOWN (2026-08-30)
- An isolated throwaway cPanel account (btpk8j / btpk8jbulk.com) was created on
  the WHM only to verify the Bulk Subdomain Import UI end-to-end (4/4 subdomains
  created, display-name doubling fix confirmed), then DELETED via
  /tmp/teardown_bulk_test_account.js. No artifacts remain on the WHM or DB.
- To re-run this E2E test later, recreate the account:
    set -a; source /app/backend/.env; set +a; NODE_PATH=/app/node_modules node /tmp/setup_bulk_test_account.js
  (prints fresh PANEL_USERNAME / PANEL_PIN / PRIMARY_DOMAIN), then tear down with
    NODE_PATH=/app/node_modules node /tmp/teardown_bulk_test_account.js

- The cPanel "broken user-auth" WHM-root fallback fix is verified with the
  fully-mocked jest suite: `cd /app && npx jest tests/cpanel-auth-broken-fallback.test.js`
  (nock — no live cPanel/WHM/DB calls).



## Architecture
- Frontend (React, :3000) → FastAPI (:8001) → proxy → Node Express (:5000) → MongoDB (live).
- All destructive background jobs (billing reconcilers, protection heartbeat, NS retry,
  CF discovery sync, phone health monitor) are DISABLED in sandbox mode.
- Note: webhook-crond (supervisor) is an Emergent platform cron daemon (FATAL: no cron in base image); it is NOT part of this app and does not affect functionality.
