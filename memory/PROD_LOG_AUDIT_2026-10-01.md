# Production log audit — DO droplet (app-main = Nomadly, app-wl = Smadav) — 2026-10-01

Window: 2026-09-28 21:30 → 2026-10-01 05:30 UTC. PM2 logs on `nomadly-prod-ams3`.
Headline: **0 real process crashes** (PM2 ↺ = 0 on every slot). The "16 FATAL / 4 crashed" counts from the
previous session were `[NS Auto-Retry]/[DnsHealer] tick crashed:` lines during a 5-minute Railway-Mongo
outage, not bot crashes. The "429" count was phone numbers containing "429" — zero real rate-limits.

## Fixed in this session (code → both branches, deployed; env → droplet)
| # | Finding | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | Bulk IVR "Select IVR Audio" never rendered for @jameswalker3646 (5999851454) — 11 silent failures | User uploaded a binary file as leads; `axios responseType:'text'` turned it into garbage "leads" whose names had `<` → Telegram `can't parse entities` → reply dropped | `parseLeadsFile()` rejects binary content (`looksBinary`), strips non-printables from names; handler rejects non-text documents up front (`cp_134b` in 4 langs) and HTML-escapes the preview |
| 2 | `[AntiRed] .htaccess deploy error …: allIPs is not defined` | `allIPs` scoped inside `generateHtaccessRules()` but used in the deploy log line → ReferenceError AFTER the write, so every deploy reported failure | re-fetch `getAllScannerIPs()` in `deployHtaccess` |
| 3 | ProtectionHeartbeat `Done in 4216s … whm_read_unreliable:17` every hour for 32h (both bots), no alert | WHM cpsrvd stopped answering per-user Fileman reads after the whm2 reboot (09-28 21:58) until its nightly restart (09-30 05:57). Each getFile hit the 30s timeout × 8 → 248s/account | Circuit breaker: abort cycle after 3 consecutive timed-out accounts; page admin once after 3 unusable cycles + once on recovery (`trackWhmOutage`) |
| 4 | `❌ DNS error for accesslog45security.com: Authentication error` (840923854 shortener activation) | `registeredDomains.val.cfZoneId` pointed at a zone no longer in our CF account; `ensureCloudflare()` trusted it blindly. **96/297** domains carry stale zone ids | `cfService.zoneExistsInAccount()`; `ensureCloudflare` relinks to a same-name zone or clears + recreates. Unknown/transient → still trusted (no destructive action) |
| 5 | `[Email] Error sending hosting credentials: Connection timeout` (Smadav 09-29 ×2) | **DigitalOcean blocks outbound 587/465**; only Brevo :2525 is open. Live env still had `MAIL_PORT=587` | `MAIL_PORT=2525` in `shared/<app>/backend.env` (both). `transporter.verify()` on 2525 → OK |
| 6 | Brevo key rotated 09-30 "on both bots" — but live key returned **401 "API Key is not enabled"** | Previous session edited `/opt/nomadly/<app>/backend/.env` (a dead legacy copy). Runtime env is `/opt/nomadly/shared/<app>/backend.env` (deploy.sh symlinks it into every release) | Synced new key into shared envs; replaced legacy files with symlinks → shared so this cannot drift again; blue/green redeployed both apps |
| 7 | Nginx: stale `accedzonelienusageuniquedonotshare.ch.conf` + `conflicting server name` warnings | Domain is hosting (CF tunnel → WHM), shortener vhost unused; `nomadly-domains/*.conf` was included twice (nginx.conf + conf.d); duplicate `panel.2.hostbay.io` site file | Removed all three (backups in `/root/nginx-backup-20261001/`), `nginx -t` clean, reloaded |

## Needs USER action (cannot be fixed in code)
- **ConnectReseller — domain price checks return 401 on BOTH bots** (`checkDomainPriceOnline … Unauthenticated user`,
  ~8 user searches failed in 2 days). Droplet IP `146.190.238.190` is not whitelisted. The auto-whitelist browser
  login fails with CR's own banner: *"Authentication failed! Invalid credentials or expired password. Please reset your
  password and enable 2FA."* → `CR_PANEL_PASSWORD` has expired at ConnectReseller.
  To fix: reset the CR panel password → Tools → Profile → API → add `146.190.238.190` → update `CR_PANEL_PASSWORD`
  in `/opt/nomadly/shared/app-main/backend.env` + `app-wl/backend.env` (+ vault). If 2FA becomes mandatory the
  browser automation will need a TOTP secret.
- **Telnyx balance $8.26–8.79** — BalanceMonitor warning ×14. Top up.
- Contabo `invalid_client` hourly (known/skipped).

## Report-only (no action)
- Railway Mongo proxy blip 2026-09-30 07:35–07:40 UTC hit both bots at once (`connection <monitor> … closed`,
  379 heartbeats); auto-recovered. Also reconnects 06:30 / 06:58 / 07:02 the same morning.
- WHM box `whm2-fra1` rebooted twice on 09-28 (16:23, 21:58). cPanel auto-upgraded 11.138.0.10 → .11 on 09-29 15:52.
- cPanel-proxy 401s (user-level auth broken) are self-healed by cpPass rotation + WHM fallback; the only
  persistent one is `ghrx51df` (user-paused account — rotation correctly SKIPPED).
- Scanner probes `GET /..%c0%af.env` → `URIError` logged as "Unhandled route error" but answered; harmless.
- `[Panel] test-email` and `EmailBlast` transports dial WHM/VPS on 25/465/587 — those are also blocked from the
  droplet (DO policy). Not touched; flag if those features are needed from the droplet.
- `csf_allow` / `add_host_access` WHM API calls log "Unknown app" on the WHM box ×29/day (CSF not installed) — noise.

## Tests added
- `js/tests/test_protection_heartbeat_breaker.js` (breaker, single page, recovery) — PASS
- `js/tests/test_ensure_cloudflare_stale_zone.js` (trust/unknown/relink/recreate) — PASS
- `js/tests/test_protection_heartbeat_fix.js` (regression) — PASS
