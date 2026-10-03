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
- **Never "Save to GitHub" onto `WhiteLabel`** and never `git merge main` into it — that clobbers the Smadav branding (7129cae9). Use the **"Sync main → WhiteLabel"** GitHub Action (below).


## 2026-10-03 — One-click brand-safe "Sync main → WhiteLabel" (GitHub Action)
- Finding: GitHub `main` (5384b468) == workspace == live app-main runtime (e376022). `WhiteLabel` (16bb4dd7, live
  on app-wl) was missing main's custom-domain shortlink click-count fix (`js/shortener-analytics.js`) + 2 dev-only
  check endpoints (`/dev/shortlink-analytics-test`, `/dev/rdp-pricing-test` in `js/_index.js`). Every other
  main↔WL difference is intentional Smadav branding (`frontend/src/{App.js,App.css,index.js,index.css,branding.js,
  pages/SalesDashboard.js}`, `frontend/.env.production`, `frontend/public/smadav-*`, `js/branding.js`,
  `js/routes/sales.js`, `/admin/sales` + `/branding` mount in `_index.js` ~38047) + WL-only `js/vps-ssh-reachability.js`.
- Agent may NOT push to GitHub (platform rule) → built `.github/workflows/sync-whitelabel.yml` (workflow_dispatch;
  inputs `dry_run`, `deploy`) + `scripts/sync_whitelabel.py`: per-file 3-way merge on git objects (no checkout),
  base = `main=` in `.whitelabel-sync` on WhiteLabel (bootstrap `e92a09ed`), skips docs/brand/workflow files
  (Actions token can't modify `.github/workflows/*`), runtime conflict ⇒ exit 2 nothing pushed, broken JS/PY ⇒ exit 3,
  fast-forward push only, then `gh workflow run deploy.yml --ref main -f app=app-wl`.
- deploy.yml `paths-ignore` += `.github/**`, `.whitelabel-sync`, `scripts/sync_whitelabel.py`, `scripts/test_sync_whitelabel.sh`.
- Tests: `bash scripts/test_sync_whitelabel.sh` (throw-away bare repo in /tmp from REAL main+WL) — 16/16 pass.
- USER STEPS: just "Save to GitHub" (main) — since 2026-10-03 10:30Z the sync also runs **automatically on every push to
  main** (docs-only pushes ignored; no marker-only commits; pause with repo variable `WL_AUTO_SYNC=false`). Manual
  run/preview still available (Actions → "Sync main → WhiteLabel" → Run workflow). First save after the button was
  added did NOT sync because the workflow was manual-only (0 runs on GitHub) — fixed by the push trigger.
- Repo made PRIVATE by owner 2026-10-03 ~10:20Z. Droplet mirrors still fetch (credential.helper=store, /root/.git-credentials);
  app-main deployed c1709532 OK after the save. Secret rotation + vault re-lock still pending (owner).


## 2026-10-03 — Reseller API flipped to LIVE on production main bot (env-only change)
- Finding: `RESELLER_API_LIVE` was absent from both `/opt/nomadly/shared/{app-main,app-wl}/backend.env`, so
  `/reseller/v1/*` ran in `dry_run` on prod (gate in `js/reseller-api.js:134`:
  `RESELLER_API_LIVE==='true' && SKIP_WEBHOOK_SYNC!=='true'`).
- Change (user-approved: **main only**, blue/green): appended `RESELLER_API_LIVE=true` to
  `shared/app-main/backend.env` (backup `backend.env.bak.20261003T092653Z`), ran `/opt/nomadly/deploy.sh app-main deploy`
  → release `20261003T092654Z-e376022` on `app-main-a :5000`, nginx flipped, `app-main-b` retired, zero downtime.
- Verified: `http://127.0.0.1:5000/reseller/v1/health` and public `https://2.speechcue.com/api/reseller/v1/health`
  → `mode: live`; `app-wl` (:5001) untouched → `dry_run`. Bot `/health` healthy, no boot errors.
- NOTE: prod main is still at GitHub `e376022`; this session's local commits (shortlink analytics fix, RDP
  diag endpoints, HEAD `29ab43ff`) are NOT yet pushed — user must use "Save to Github" then redeploy.
- Also sync vault/`memory/test_credentials.md` env snapshot if the vault is regenerated (new key not in vault yet).


## 2026-10-02 — RDP order failure (@morganfreebandzz) — FIXED, tested, deployed to both bots
- **Symptom**: user ordered a Windows RDP; provisioning failed and the bot/admin message said "…your Monthly **VPS** Plan".
- **Root cause 1 (provisioning)**: `VPS_RDP_PROVIDER=azure` on app-main → Azure subscription returned 404. Switched to
  `digitalocean-rdp` (DO Ubuntu→Windows conversion service, `js/digitalocean-rdp-service.js`) in local `.env`, vault,
  and BOTH droplet envs (`/opt/nomadly/shared/app-main|app-wl/backend.env`). `VPS_DEFAULT_PROVIDER=digitalocean` on both.
- **Root cause 2 (message)**: `vp.errorPurchasingVPS` template was `plan => "...${plan} VPS Plan"`. Now
  `(plan, isRDP) => "...${plan} ${isRDP ? 'RDP' : 'VPS'} Plan"` in `js/lang/{en,fr,hi,zh}.js`; all 4 call sites in
  `js/_index.js` (`buyVPSPlanFullProcess` ×2, `upgradeVPSDetails` ×2) pass `vpsDetails.isRDP`.
- **Diagnostics**: `GET /admin/vps-flow-check?key=<SESSION_SECRET[:16]>&lang=en|fr|hi|zh` → `errorPurchasingMessage.rdpSaysRDP/vpsSaysVPS`;
  `GET /admin/vps-catalog-check?key=…` → `providers.rdp.name === 'digitalocean-rdp'`, `providers.vps.name === 'digitalocean'`.
- **Tests**: testing agent iteration_58 — 7/7 backend checks pass (4 langs, catalog routing, 403 auth guard, call-site grep).

## 2026-10-02 (follow-up) — Provisioning poll-hardening + Morgan credential re-send
- **Poll-hardening shipped & deployed** (`main` e92a09ed, `WhiteLabel` 16bb4dd7, both bots live): `buyVPSPlanFullProcess`
  now aborts immediately when `getInstance` reports `failed`/`destroyed`/`error` (the DO 403 outstanding-balance case),
  deletes the orphan `vpsPlansOf` record, marks progress failed, and sends the RDP-aware failure message — instead of
  polling 25 min then DMing credentials for a server that never existed. Setup-tracker title, wallet-refund message and
  the background IP-ready note are all RDP-aware now. Guard logic unit-tested (12/12, regex anchored). Verified present
  in both live releases, `/health` 200, pm2 online.
- **@morganfreebandzz (7706803914) delivery closed**: the original comp-vps #2 provision left NO retained log and there is
  no outbound-message collection, so the original Telegram delivery was unprovable. Re-sent creds + `.rdp` via Bot API
  (Telegram ACK message_id 3354723 + 3354724 → delivery proven). Fixed a wrong `rootPasswordSecretId` pointer so in-bot
  "Show Password" returns the applied password. Details in `memory/RDP_MORGANFREEBANDZZ_MANUAL_COMPLETION_2026-10-02.md`.

## 2026-10-02 — Full i18n: central keyboard-button localization (fr/hi/zh)
- **Dictionaries + hosting-panel locales 100% translated**: `scripts/check_untranslated.js` reports 0 English leaks across `js/lang/*.js`, `js/i18n/*.json`, and `frontend/src/locales/*.json`.
- **Central button interceptor populated** (`js/kb-i18n-buttons.js`, was empty): 40 high-traffic CUSTOMER-facing hard-coded buttons — IVR outbound-call setup, bulk-campaign scheduling, payment, feedback, URL shortener, marketplace/escrow. `js/tg-opts.js` localizes them OUTBOUND via the chatId→lang cache; `js/_index.js` `canonicalizeIncoming` (line ~7507) maps the localized press back to English BEFORE the literal `message === '...'` handlers run.
- **Safety rule (why only a subset)**: only PURE labels were centralized — hard-coded English labels that are NOT a lang-dict value, so no `message === trans()/vp.key/btn.key` matcher exists for them and canonicalize can never hijack a legitimately-translated button. Admin buttons stay English (per user). Brand tokens kept untranslated (Cloud IVR, HostPanel, Anti-Red, BulkSMS, Bit.ly, SIP, VPS/RDP, CSV/TXT, USD/NGN).
- **NOT centralized (intentional, would break handlers)**: dict/helper-backed labels matched via their translated value — `✅ Confirm` (`confirmChangeBtn`, VPS flows `message === vp.confirmChangeBtn`), `📝 Type Text (AI Voice)` (`btn.typeText`), `🎙️ Upload Audio` (`btn.uploadAudio`). These remain handled by the existing dict/helper path.
- **New guard** `tests/kb-i18n.test.js` (8 tests): full fr/hi/zh coverage, per-lang uniqueness (incl. generic Back/Cancel/Main Menu), no collision with a dict value of a DIFFERENT English canonical (caught + fixed a bulk-campaign vs SMS `⏰ Schedule for later` clash → bulk now `⏰ Programmer plus tard` etc.), every key present in `_index.js`, canonicalize round-trip.
- **Tests**: Jest i18n/keyboard suites 32/32 pass; `scripts/journey_crawler.js` FR depth-3 walked 134 screens with 0 issue markers (NO_REPLY/STRANDED/JS_ERROR none) — nav + feature buttons localized correctly. (HI/ZH crawl not re-run this session; FR exercises the same central path.)
- **Deploy**: committed + pushed to `WhiteLabel` (app-wl Smadav) and `main` (app-main Nomadly) on `servicedyno1/Nomadly-EMAIL-IVR`. The `/admin/sales` + `/branding` WL wiring (`_index.js` ~line 38018) is untouched — translation changes all sit below line ~34000, so the cross-branch propagation does not re-introduce the historical white-label clobbering.
- **Files**: `js/kb-i18n-buttons.js` (map), `js/kb-i18n.js` + `js/tg-opts.js` (interceptor, from prior session), `js/_index.js` (canonicalize wiring + codemod), `js/lang/*.js` + `frontend/src/locales/fr.json` (dictionaries), `scripts/check_untranslated.js` + `scripts/i18n_fill/` (lint/codemod tooling), `tests/kb-i18n.test.js`.


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
