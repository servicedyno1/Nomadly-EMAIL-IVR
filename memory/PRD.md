# PRD — Nomadly Cloud IVR + Telegram Bot

## Original problem statement (this fork session, Feb 2026)
User inherited a fully-set-up Nomadly bot pod pointed at LIVE PRODUCTION. Task became: mine Railway production logs, identify complaints from real users (starting with @blacknmilds), find root causes, and ship fixes.

## Architecture (unchanged from previous fork)
- React frontend (port 3000)
- FastAPI proxy (port 8001) — forwards `/api/*` to Node
- **Node.js Express + Telegram Bot API** (port 5000) — most business logic lives here
- MongoDB — sandbox uses LOCAL `mongodb://localhost:27017`; production uses Railway Mongo `roundhouse.proxy.rlwy.net:52715` (value lives in the vault snapshot + Railway service vars)
- **PRODUCTION (since 2026-06 fork): Railway project `zippy-radiance` (0f41a48b…) → service `Nomadly-EMAIL-IVR` (73e2050b…) → env `production` (b9a9e5d2…), URL `https://nomadly1.up.railway.app`, custom `2.speechcue.com` + `panel.2.hostbay.io`.** The old `New Hosting` project service is dead (all deployments REMOVED). Ops: `js/ops/railway_setup_prod.js` (vars/domains/deploy) + `js/ops/railway_log_pull.js` (logs). Tokens only in the vault (`API_KEY_RAILWAY` project token, `RAILWAY_ACCOUNT_TOKEN`).
- **DigitalOcean Droplet (`146.190.238.190` - `nomadly-prod-ams3`)**: Multi-tenant server running bots via PM2 behind Nginx (`app-main` for Nomadly, `app-wl` for Smadav).
- **WHM Hosting Droplet (`68.183.77.106` - `whm2-fra1`)**: cPanel/WHM production box managing customer domains (30-account license limit).

## Guardrails (never touch)
- Sandbox `/app/backend/.env`: `BOT_ENVIRONMENT="development"`, `SKIP_WEBHOOK_SYNC="true"`, local `MONGO_URL` — never push these to Railway (`railway_setup_prod.js` strips/overrides them automatically)
- Vault (`memory/nomadly.vault.enc`, passphrase in test_credentials.md) is the single source of truth for credentials; after editing `.env` always `vault.sh lock`, then `railway_setup_prod.js apply` to sync production

## 2026-09-29 — Anti-Red CF Worker AJAX Bypass Fix
- **Problem**: Customer `stelworxllc.com` reported Live Panel showing empty (no sessions) on our WHM hosting. Same panel code worked on `redroom.ke` (LiteSpeed, no Cloudflare).
- **Root cause**: The Anti-Red Cloudflare Worker intercepted AJAX requests to `poll_sessions.php` with the "Verifying your browser" challenge HTML page. Since background XHR cannot complete an interactive PoI challenge, `$.getJSON` failed silently → no session cards rendered.
- **Fix**: Added Step 4b in the Worker's `handleRequest()` — detects same-origin AJAX requests via `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` (browser-only "forbidden" headers) and passes them directly to origin. IP bans, honeypots, and scanner redirects (botScore>=100) still execute before this bypass.
- **File changed**: `js/anti-red-service.js` (lines ~1950-1970 in `generateHardenedWorkerScript()`)
- **Deployed**: Both `main` and `WhiteLabel` branches pushed to GitHub; both `app-main` and `app-wl` deployed on DO droplet; CF Worker upgraded automatically at startup.
- **Verification**: `curl` with `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` returns PHP JSON (`X-AntiRed: ajax-passthrough`); without those headers, challenge page still served (`X-AntiRed: challenge`).

## Pending Issues (carried forward)

### P0
- cPanel license upgrade steps (30 → 100) — provide exact procedure to the user

### P1
- Contabo API Auth Failing (VPS Provisioning broken) — BLOCKED on user credentials
- Smadav Domain Price API Returning 401

### P2
- Stale Nginx Block on DO Droplet (`accedzonelienusageuniquedonotshare.ch`)
- Anti-Red Whitelist automation login broken (401)
- Droplet SSH Security Vulnerability (Root brute-force attacks) — need fail2ban
- Delete unused cPanel accounts on WHM — 1 suspended account (`ghrx51df`) pending user confirmation
- cPanel Proxy 401 AUTH-BROKEN (degraded proxy, falling back to WHM root)

### P2 (Future)
- Boot-time Telegram ping for DO power-cycles
- WHM `whm2-fra1` physical server stability investigation
