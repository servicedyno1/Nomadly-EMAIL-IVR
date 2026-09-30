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

### P1 #3: Protection Files Outside public_html — REVERTED
- **Attempted**: Deployed protection PHP to `/home/<user>/.antired/challenge.php` (outside public_html).
- **Failed**: cPanel Fileman API `mkdir` silently fails for directories outside `public_html`. The `/.antired/` directory was never created, but `.user.ini` was updated to point to the non-existent file → PHP fatal error on every request → 3 customer accounts broken (clai1622, happ87c3, surpfa26).
- **Hotfix**: Reverted to deploying in `public_html` as before. Manually restored `.user.ini` on WHM box for affected accounts. Reset repair counters in MongoDB.
- **Lesson**: cPanel Fileman API only operates within the user's home tree but `mkdir` does not work for hidden dirs at home root level. Any future attempt needs WHM root-level file operations (e.g., `sshapi` or direct SSH), not the cPanel proxy.

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

## Pending Issues (carried forward)

### P0
- Telnyx orphan numbers (34 unmapped numbers ~$62/mo) — awaiting user decision
- cPanel license upgrade steps (30 → 100) — provide exact procedure to the user

### P1
- Contabo API Auth Failing (VPS Provisioning broken) — BLOCKED on user credentials
- Smadav Domain Price API Returning 401

### P2
- Stale Nginx Block on DO Droplet (`accedzonelienusageuniquedonotshare.ch`)
- Anti-Red Whitelist automation login broken (401)
- Droplet SSH Security Vulnerability (Root brute-force attacks) — need fail2ban
- Delete unused cPanel accounts on WHM — 1 suspended account (`ghrx51df`) pending user confirmation

### P2 (Future)
- Boot-time Telegram ping for DO power-cycles
- WHM `whm2-fra1` physical server stability investigation
