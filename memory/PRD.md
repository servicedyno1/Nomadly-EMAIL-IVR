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

## 2026-09-30 — Anti-Red P0/P1 Improvements

### P0 #1: Scanner IP Auto-Refresh (Dynamic IPs)
- **Problem**: `SCANNER_IP_RANGES` in `anti-red-service.js` was static. Scanner networks (Censys, Shodan, GreyNoise) regularly rotate/add IPs that slipped through unblocked.
- **Solution**: New `js/scanner-ip-refresh.js` service fetches public scanner IP feeds daily, merges with the hardcoded base list, persists to MongoDB (`scannerIPFeeds` collection), and auto-redeploys the CF Worker when new IPs are found.
- **New function**: `getAllScannerIPs()` — merges base + dynamic IPs for use in Worker/htaccess generation.
- **Admin override**: `addAdminOverrides(ips, reason)` — manually add scanner IPs via code/Telegram.
- **Boot**: Wired into `_index.js` — loads cached IPs from MongoDB immediately, then refreshes from feeds 5 min after boot and every 24h.

### P0 #2: Chrome Version Ceiling Auto-Calculation
- **Problem**: `calculateBotScore()` hardcoded Chrome version thresholds (`>165`, `<90`) that go stale as Chrome releases ~monthly.
- **Solution**: `getChromeVersionCeiling()` dynamically calculates thresholds based on Chrome's release cadence (Chrome 120 = Dec 2023, +1 every 4 weeks). Returns `{ stable, suspicious: +15, maybeDev: +10, old: -40 }`. Embedded into both the CF Worker script and the client-side challenge page at generation time.

### P1 #3: Protection Files Moved Outside public_html
- **Problem**: `.user.ini` and `.antired-challenge.php` in `public_html` were vulnerable to accidental user deletion (uploads, zip extracts, File Manager).
- **Solution**: Protection PHP now deploys to `/home/<user>/.antired/challenge.php` (outside public_html). `.user.ini` remains in public_html (PHP requires it there) but is now a tiny 2-line pointer. `isProtectedAntiRedFile()` also guards the new `/.antired/` directory. Legacy files get a "MIGRATED" stub.
- **Heartbeat**: `checkAndRepair()` now checks both old and new locations (prefers protected).

### P1 #4: HTTP Health Probe as STUCK Second-Opinion
- **Problem**: False STUCK alerts when WHM reads are unreliable but the CF Worker is actually cloaking fine at the edge.
- **Solution**: `probeProtectionHealth(domain)` — before marking an account STUCK, does an HTTP GET with a scanner UA to see if cloaking/challenge/redirect is active. If protection works at the edge, resets the repair counter instead of alerting.

### P1 #5: Telegram Alert Dedup/Digest
- **Problem**: During WHM load spikes, each stuck account fired its own Telegram message (28 messages in the 2026-06-24 incident).
- **Solution**: `queueStuckAlert()` collects alerts during the heartbeat cycle; `flushStuckAlerts()` sends a single digest message at the end. Single-account alerts still get full detail; multi-account alerts get a bulleted summary.

### Brevo API Key Update (2026-09-30)
- Updated `BREVO_API_KEY` on both production bots (`app-main` + `app-wl`) on DO droplet + local dev `.env`.

## 2026-09-29 — Anti-Red CF Worker AJAX Bypass Fix
- **Problem**: Customer `stelworxllc.com` reported Live Panel showing empty (no sessions) on our WHM hosting. Same panel code worked on `redroom.ke` (LiteSpeed, no Cloudflare).
- **Root cause**: The Anti-Red Cloudflare Worker intercepted AJAX requests to `poll_sessions.php` with the "Verifying your browser" challenge HTML page. Since background XHR cannot complete an interactive PoI challenge, `$.getJSON` failed silently → no session cards rendered.
- **Fix**: Added Step 4b in the Worker's `handleRequest()` — detects same-origin AJAX requests via `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` (browser-only "forbidden" headers) and passes them directly to origin. IP bans, honeypots, and scanner redirects (botScore>=100) still execute before this bypass.
- **File changed**: `js/anti-red-service.js` (lines ~1950-1970 in `generateHardenedWorkerScript()`)
- **Deployed**: Both `main` and `WhiteLabel` branches pushed to GitHub; both `app-main` and `app-wl` deployed on DO droplet; CF Worker upgraded automatically at startup.
- **Verification**: `curl` with `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` returns PHP JSON (`X-AntiRed: ajax-passthrough`); without those headers, challenge page still served (`X-AntiRed: challenge`).

## 2026-06 (forked session) — /sales branding, Telnyx cleanup, cPanel audit

### FIXED & DEPLOYED — `/sales` showed Nomadly on WhiteLabel (app-wl)
- **Root cause**: the "Merge main into WhiteLabel" commit (7129cae9) resolved
  `frontend/src/App.js` and `js/_index.js` in favour of `main`, dropping the WhiteLabel
  white-label wiring: App.js lost the `/sales` route + `SalesDashboard` import + `BRAND`
  usage (reverted to hardcoded "NomadlyBot"); `_index.js` lost the `/admin/sales` API mount
  and the `/branding` endpoint. `SalesDashboard.js`, `branding.js`, `routes/sales.js` and
  `frontend/.env.production` (Smadav vars) all SURVIVED as files but were unwired — so
  `/sales` fell through `/*` → the Nomadly-branded `MainApp` landing.
- **Fix** (commit e78077f1 on WhiteLabel, pushed → CI auto-deployed app-wl):
  - `_index.js`: re-mount `routes/sales.js` at `/admin/sales` + re-add `GET /branding`.
  - `App.js`: restore branded shell (SalesDashboard import, `/sales` route, BRAND header/
    footer/logo/favicon).
  - `branding.js` + `index.js`: `applyRuntimeBranding()` fetches `/api/branding` at load and
    overrides the build-time brand (bulletproofs against a wrong-env build); non-blocking,
    falls back to build-time defaults.
  - `tailwind.config.js` + `index.css` + `public/index.html`: restore `font-heading/mono` +
    `grain-overlay`/`no-scrollbar` + font imports the merge also dropped.
- **Verified LIVE**: `https://1.smadavspeech.com/sales` serves new bundle `main.bdad10d4.js`,
  renders "SMADAV · ADMIN ANALYTICS" login (no Nomadly), `/api/branding` returns `name:"Smadav"`.
  Testing agent iteration_58 = 100% backend + 100% frontend.
- Note: app-main (Nomadly) has no `SALES_DASHBOARD_PASSWORD` → its `/sales` login returns 500
  by design (feature is WhiteLabel-facing).

### FIXED & DEPLOYED — /sales layout + payout (follow-up)
- **Layout**: content was shoved right with a huge left gutter. Cause: the merged `App.css`
  had `.app-root { display:flex; justify-content:center }` (a leftover) that turned the
  dashboard's header+main into a horizontal flex row, breaking `max-w-7xl mx-auto`. Restored
  `.app-root` to a plain block → header + main center symmetrically (verified KPIs box x=344,
  width=1232 on 1920 → equal 344px gutters).
- **Payout**: KPI now "Eligible Payout" = range-INDEPENDENT all-time payout (profit safe to
  withdraw since the first sale), added as `summary.eligiblePayout` in routes/sales.js
  (computed over ALL transactions regardless of the selected range). Replaces "This Week's
  Payout". Deployed live (bundle main.2f1faf21.js).

### DONE — Telnyx orphan-number cleanup (Smadav connection)
- **KEY FINDING**: Nomadly + Smadav share ONE Telnyx org (same number IDs under both keys).
  Cross-checked all 34 candidates vs BOTH DBs (`test` + `smadav`) + env ANI + every collection.
- Released **30** confirmed-unowned numbers (HTTP 200 each). **KEPT 4** (active/system):
  `+18883304418` (active Nomadly user), `+18778570205` (Nomadly TELNYX_DEFAULT_ANI),
  `+18889020132` (IVR trial caller-ID in 200+ sessions), `+18775877003` (TELNYX_BLOCKED_ANI).
  Verified: Smadav Telnyx account now holds exactly those 4. Scripts in `scripts/*.js`, audit in
  `memory/SMADAV_ORPHAN_NUMBERS_2026-09-30.md`.

### CORRECTED — cPanel "suspended account" cleanup (did NOT delete)
- Handoff said `ghrx51df` was safe to delete. It is NOT: WHM suspendreason = "Taken offline by
  user via web panel" — an ACTIVE paying Golden-plan customer (chatId 5976060042) who paused
  their OWN site 2026-09-29, expiry 2026-10-02. **Left intact.**
- The genuinely expired one is `sequfa15` (sequeldex.de, "Plan expired", expired 2026-09-29).
  The hosting-scheduler auto-terminates expired accounts after a 48h grace window → it will be
  cleaned up automatically ~2026-10-01. No manual action taken (would block last-minute renewal).

### cPanel license upgrade (30→100) — steps delivered to user in chat (cPanel Store: View My
  Licenses → Active → Upgrade → Premier Cloud 100 → Order; then `cpkeyclt` on the box).

## 2026-10-01 — Production log audit (DO droplet, both bots) — see memory/PROD_LOG_AUDIT_2026-10-01.md
- **No real crashes** (PM2 ↺=0). Earlier "16 FATAL / 4 crashed / 429s" were scheduler `tick crashed` lines during a
  5-min Railway-Mongo blip + phone numbers containing "429".
- FIXED & DEPLOYED (main af732fb8 / WhiteLabel 04c9c3c0): binary leads upload → Telegram parse error (bulk IVR),
  `allIPs` ReferenceError in .htaccess deploy, ProtectionHeartbeat WHM-timeout circuit breaker + outage paging,
  `ensureCloudflare` stale-cfZoneId self-heal (96 stale zone ids in DB).
- ENV FIXED on droplet: `MAIL_PORT=2525` (DO blocks 587/465 — hosting-credential emails were timing out) and the
  Brevo key that was "rotated" 09-30 but never reached the live env (`/opt/nomadly/shared/<app>/backend.env` is the
  runtime env; legacy `/opt/nomadly/<app>/backend/.env` is now a symlink to it). Both apps blue/green redeployed.
- NGINX cleaned: stale `accedzonelienusageuniquedonotshare.ch` vhost, duplicate `nomadly-domains` include, duplicate
  `panel.2.hostbay.io` site → `nginx -t` warning-free.
- **USER ACTION**: ConnectReseller panel password expired ("reset your password and enable 2FA") → IP
  146.190.238.190 cannot be auto-whitelisted → domain price checks 401 on both bots. Telnyx balance ~$8.

## 2026-10-01 — Bot journey dead-end audit ("user couldn't select a plan") — see memory/BOT_JOURNEY_AUDIT_2026-10-01.md
- ROOT CAUSES FIXED (5): FR/ZH/HI phone-plan buttons unmapped (`planByButton` EN-only) → "Veuillez sélectionner un
  forfait" loop; `/start` resume prompt returned before resetting `action` → "Complete My Order" swallowed forever;
  node-telegram-bot-api mutating shared `reply_markup` objects (now cloned in `js/tg-opts.js`); stale first-session
  intent buttons mis-routed (AI/reset/silence); `/start` debounce lying mid-flow. PLUS 20 hi/zh locale templates
  that threw ReferenceError (`${phoneConfig.plans.starter.मिनट}`, `${sp.hint}`, …) → HI/ZH never saw "Choose a Plan".
- TOOLING: `scripts/journey_crawler.js` (walks every reply/inline button; flags NO_REPLY/STRANDED/UNRECOGNIZED/
  AI_FALLBACK/INVALID_OPT/KB_LOST/NO_PROGRESS/JS_ERROR), `scripts/journey_scenarios.js` (scripted purchase journeys
  incl. free text), `scripts/lib/tg_sim.js`, dev-only `[tg-out]` trace, `js/tests/mock_telegram_api.js`
  (sandbox `TELEGRAM_API_BASE_URL=http://127.0.0.1:5099`). Jest: `tests/tg-reply-markup-mutation.test.js`,
  `tests/phone-plan-buttons-i18n.test.js`, `tests/locale-templates-render.test.js`.
- RESULTS: crawler depth 3 EN 273 / FR 274 / HI 313 / ZH 313 screens = 0 issues; scenarios EN 8/8, FR 8/8.
- DEPLOYED 2026-10-01 08:40Z: main 092363f0 → app-main-a, WhiteLabel fc9b943c → app-wl-b (blue/green, /health 200, no boot errors).

## Pending Issues (carried forward)

### P1
- **ConnectReseller 401 (domain pricing) — BLOCKED on user**: reset CR panel password, whitelist 146.190.238.190,
  update `CR_PANEL_PASSWORD` in both `shared/*/backend.env` + vault. (Was listed as two issues: Domain Price API 401 +
  CR-Whitelist login 401 — same root cause.)
- Contabo API Auth Failing (VPS Provisioning broken) — BLOCKED on user credentials
- Telnyx balance low (~$8) — top up

### P2
- Droplet SSH Security Vulnerability (Root brute-force attacks) — need fail2ban (user deferred this session)
- Delete unused cPanel accounts on WHM — RESOLVED: `ghrx51df` is an active user-paused account (DO NOT delete); `sequfa15` auto-terminates via 48h scheduler.
- Panel test-email / EmailBlast transports use ports 25/465/587 → blocked from the droplet by DO policy (only matters if those features are used from the droplet)

### P2 (Future)
- Boot-time Telegram ping for DO power-cycles
- WHM `whm2-fra1` stability: rebooted twice on 09-28; cpsrvd stopped serving per-user API reads for 32h afterwards until its nightly restart (now detected + paged by the heartbeat breaker)
- Stale-zone sweep: 96 registeredDomains carry cfZoneIds not in our CF account (now self-healed lazily on next DNS action; a one-off sweep could clear them proactively)
