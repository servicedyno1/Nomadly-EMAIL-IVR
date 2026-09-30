# Production Log Anomaly Scan — 2026-09-30 (05:45Z)

Droplet `146.190.238.190` (nomadly-prod-ams3). Active PM2: `app-main-a` (Nomadly),
`app-wl-b` (Smadav/WhiteLabel), `app-hb` (redirect/heartbeat bot).
Logs scanned: `/root/.pm2/logs/{app-main-a,app-wl-b,app-hb}-{out,error}.log`.

## P1 — Broken / active

### 1. Contabo auth circuit OPEN — `invalid_client` (Nomadly)
- Hourly: `[Contabo] 🔌 Auth circuit OPEN — token fetch failed { error:'invalid_client', error_description:'Invalid client or Invalid client credentials' } — suppressing 30m`
- Knock-on hourly: `[VPS Self-heal] Contabo auth down mid-cycle — aborting remaining checks`
- Latest 2026-09-30T05:30Z. VPS provisioning + self-heal are DOWN. Needs valid `CONTABO_CLIENT_ID/SECRET/API_USER/API_PASSWORD`.

### 2. `checkDomainPriceOnline` → HTTP 401 "Unauthenticated user" (Nomadly)
- `checkDomainPriceOnline error: Request failed with status code 401 {"responseText":"Unauthenticated user"}`
- Seen 2026-09-29T18:08 & 19:55 in app-main-a-error.log. Domain price preview API creds/whitelist broken.
- NOTE: handoff attributed this to Smadav, but it fires in the **Nomadly** log.

### 3. Per-user cPanel token 401/403 AUTH-BROKEN (both bots)
- Nomadly (users `acce35c9`, `scotd5d6`): 86× upload_files "HTTP 200 with login-page HTML", 81× list_files 401, 33× list_domains 401, 26× API2 fileop 403, 25× upload 401, 19× mkdir 403, 13× SSL installed_hosts 401. Falls back to WHM session. Latest 2026-09-29T22:45.
- Smadav (user `stel4c10` = stelworxllc.com): 33× list_files 401, upload 401, fileop 403. Latest 2026-09-29T20:31.
- Root cause: per-user cPanel API tokens invalid → every file-manager op degrades to WHM fallback.

## P2 — Degraded / needs attention

### 4. ProtectionHeartbeat — WHM reads unreliable (Smadav)
- Every cycle (~37min): `Done in 2232.3s — total:9 ok:0 repaired:0 skipped:9 (whm_read_unreliable:9) errors:0`
- ALL 9 domains skipped ⇒ anti-red protection is NOT being verified/repaired on any domain. Latest 2026-09-30T05:37. Tied to WHM box instability.

### 5. CR-Whitelist (anti-red whitelist automation) login 401 (Smadav)
- `[CR-Whitelist] API test failed (attempt #3): Request failed with status code 401`
- `[CR-Whitelist] Browser automation failed: Login failed - landed on /login?returnUrl=/admin/dashboard`
- Now on Retry #19, hourly. Outbound IP 146.190.238.190. `CR_PANEL_EMAIL/PASSWORD` failing. Latest 2026-09-30T04:54.

### 6. Mongo "collection is object" at Smadav boot
- 2026-09-28T22:53: `Error get: <chatId> — collection is object (not a valid MongoDB collection)` and
  `Error set: <chatId> -> "<username>" in undefined: Invalid collection object provided` (MANOPAGANI, claradvid21, onarrival1).
- username↔chatId cache map failed to persist — invalid/undefined collection handle at startup (init race). One-off at boot.

### 7. Voice — ORPHANED NUMBER (Smadav)
- `+18052615004` has no owner ⇒ inbound calls from +18055838840 rejected (6×). Latest 2026-09-29T23:43. Needs number cleanup/reassignment.

### 8. Telnyx balance low warning (Smadav)
- `[BalanceMonitor] Telnyx: $8.44 USD [warning]` (4×). Top-up before it blocks voice/SMS.

## P3 — Noise / benign
- AutoPromo broadcast skips users who blocked the bot: `ETELEGRAM: 403 Forbidden: bot was blocked by the user` (Nomadly 12×, Smadav 10×). Expected behaviour.
- app-hb FastAPI warning: `Duplicate Operation ID catch_all_api__path__post` (cosmetic). Redirect bot otherwise healthy (webhook set, sendMessage 200 OK).

## Healthy
- All 3 PM2 processes `online`, 0 restarts. Host cpu 1.3%, ram 23.7%. Telegram webhook 200 OK.
