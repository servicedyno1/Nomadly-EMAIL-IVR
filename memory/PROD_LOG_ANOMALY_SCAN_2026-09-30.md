# Production Log Anomaly Scan + Fixes — 2026-09-30

Droplet `146.190.238.190`. Active PM2: `app-main-a` (Nomadly), `app-wl-b` (Smadav), `app-hb`.

## ✅ FIXED THIS SESSION

### #3 — Per-user cPanel 401/403 AUTH-BROKEN (both bots)  [FIXED, verified]
- ROOT CAUSE: WHM Tweak Setting `skiphttpauth=1` in `/var/cpanel/cpanel.config` had
  **disabled HTTP Basic Authentication** server-wide. The per-user cPanel proxy authenticates
  every `/execute/` UAPI call with HTTP Basic Auth (user:cpPass) over the CF tunnel
  `cpanel-api.hostbay.io` → cpsrvd :2083. cpsrvd logged `DEFERRED LOGIN ... HTTP Basic
  authentication is disabled on this server` and returned the cPanel login page (HTTP 401).
  The self-heal cpPass rotation was a red herring — the password was always correct.
- FIX (WHM box, no code/deploy): `whmapi1 set_tweaksetting key=skiphttpauth value=0`.
- VERIFIED: acce35c9 → HTTP 200 json status:1 (3 files); scotd5d6 → HTTP 200 (12 files).
  0 new AUTH-BROKEN errors after the change.
- WATCH: a cPanel update could flip `skiphttpauth` back to 1. If 401s return, re-check this setting.

### #4 — ProtectionHeartbeat `whm_read_unreliable:9` (Smadav)  [FIXED, verified]
- ROOT CAUSE: `protection-heartbeat.js` `whmApi` hardcoded `https://<WHM_HOST>:2087/json-api`
  (direct origin). The DO firewall blocks direct origin access to :2087, so every
  `get_file_content` hung the full 30s timeout → empty body → all 9 accounts marked
  `whm_read_unreliable` and skipped every cycle (protection never verified; cycle took 2232s).
  (Direct :2087 = timeout; tunnel `whm-api.hostbay.io` = 0.2s.)
- FIX (code, deployed both branches): route through `WHM_API_URL` (tunnel) when set, mirroring
  whm-service.js. Commits: main `5b1893f9`, WhiteLabel `c018b9bb`.
- VERIFIED: heartbeat now `Done in 5.2s — total:9 ok:9 repaired:0 skipped:0 errors:0`.

### #6 — Mongo "collection is object" at Smadav boot  [FIXED, deployed]
- ROOT CAUSE: `nameOf/planOf/chatIdOf/payments/clicksOf/clicksOn` were bound AFTER awaited
  index-creation calls in `_index.js`, but `db` became truthy earlier. Early Telegram webhooks
  during the boot await-window passed the `if (!db)` gate and hit the still-`{}` placeholders
  → "collection is object (not a valid MongoDB collection)" on the username sync.
- FIX (code, deployed both): bind those 6 collections synchronously right after
  `db = client.db(DB_NAME)`, before any await. Commits: main `fd1d6bf4`, WhiteLabel `aebeb829`.
- VERIFIED: both bots boot clean ("DB Connected lala"), 0 restarts, no new errors.

## ⏸️ PENDING USER DECISION

### #7 — Orphaned voice number(s) (Smadav)  [investigated; NOT actioned]
- `+18052615004` rejects inbound robocalls with no owner. Investigation found the Smadav
  `phoneNumbersOf` collection is EMPTY (0 docs) while the Smadav Telnyx account holds
  **34 active paid numbers** (6 local, 28 toll-free, ~$62/mo + inbound minutes). None owned in
  either the smadav or nomadly DB. See SMADAV_ORPHAN_NUMBERS_2026-09-30.md for the full list.
- Could be abandoned rentals OR active outbound caller-IDs — do NOT release without user
  confirmation (releasing is irreversible). Awaiting user decision on which (if any) to release.

## Out of scope this session (still open)
- P0 cPanel license upgrade steps (30→100) — still pending user request.
- #1 Contabo `invalid_client` (needs creds), #2 domain-price 401, #5 CR-Whitelist 401,
  stale nginx block, fail2ban, cPanel license-limit createacct failures.
