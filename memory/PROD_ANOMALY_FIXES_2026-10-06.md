# Production log-anomaly follow-up — 2026-10-06

Follow-up to the prod log sweep (Nomadly + Smadav on the DO droplet). User asked to
"fix 3,4,5,6,7 where and if needed" with best judgment. Classified each anomaly as
code-fix (done here), already-fixed-in-repo (needs redeploy), or prod-only ops.

## ✅ FIXED (code, verified in pod)

### Crypto IPN / global handler: HTTP 500 on malformed JSON → now 400
- **Root cause**: global Express error handler in `js/_index.js` (end of file) always
  returned `500` for *every* error — including body-parser `SyntaxError` on malformed
  JSON (which carries `status: 400`, `type: 'entity.parse.failed'`). Vulnerability
  scanners POST junk payloads at webhook/IPN endpoints → `express.json()` throws a
  400-status SyntaxError → old handler ignored `err.status` → false-alarm 500.
- **Fix**: handler now detects body-parse errors + respects `err.status`/`err.statusCode`
  in the 4xx range, returning the correct 4xx (400 "Invalid request body" for parse
  failures) and logging them as "Client error" instead of "Unhandled route error".
  Genuine server errors still return 500. `app === earlyApp` (line 38052) so the
  handler is reachable from the early-registered json parser.
- **Verified (curl against localhost:5000)**:
  - malformed JSON → `400 {"error":"Invalid request body"}` (was 500)
  - xml/scanner junk → 400
  - malformed JSON to non-existent route → 400
  - valid JSON to non-existent route → 404 (normal routing intact)

## ✅ ALREADY FIXED IN REPO (needs redeploy only — no pod change)

### BifurcationHealCron "Cannot find module '/app/scripts/heal_bifurcated_domains'"
- Current code already uses a **portable relative require**:
  `require('../scripts/heal_bifurcated_domains')` in both `js/bifurcation-heal-cron.js`
  and the `/admin/bifurcation-heal/run` route in `js/_index.js`. Both modules load
  cleanly in-pod and the cron schedules fine (`[BifurcationHealCron] Scheduled — daily
  at 03:30 UTC`). The prod error is from an OLDER release with a hardcoded `/app/...`
  path (or a release bundle missing the `scripts/` dir). **Resolution = redeploy
  current code**; the `scripts/` folder must be included in the release bundle.

## ⚠️ PROD-ONLY — credential rotation (code reads env correctly; nothing to change in repo)

### Contabo VPS auth (invalid_client / circuit open)
- `js/contabo-service.js` (L18-21) reads `CONTABO_CLIENT_ID`, `CONTABO_CLIENT_SECRET`,
  `CONTABO_API_USER`, `CONTABO_API_PASSWORD` from env — correct. 401 = expired/wrong
  prod creds. Circuit breaker backs off `CONTABO_AUTH_COOLDOWN_MIN` (default 30 min)
  after repeated failures and auto-resets once creds are valid.
  **Action for user**: rotate those 4 vars in prod deployment.

### checkDomainPriceOnline 401
- `js/cr-domain-price-get.js` (L4) uses `API_KEY_CONNECT_RESELLER` against
  ConnectReseller's `checkDomainPrice` (NOT OpenProvider). 401 = expired/invalid key.
  PRD also tracks this as the CR panel password + IP-whitelist root cause
  (`CR_PANEL_PASSWORD`, whitelist 146.190.238.190).
  **Action for user**: rotate CR creds / `API_KEY_CONNECT_RESELLER` in prod + confirm
  the prod egress IP is whitelisted in the CR panel.
  (NB: in this dev pod the call *times out* rather than 401 — pod egress IP differs.)

## ⚠️ PROD-ONLY — not auto-applied (needs prod SSH / live DB / real-money action)

### SSH hardening on the DO droplet
- Needs on-server changes: install `fail2ban`, `PermitRootLogin no` in `sshd_config`,
  bind app listeners to `127.0.0.1`. This is prod infra over SSH — NOT a repo change.
  Not applied autonomously (deferred, consistent with PRD P2).

### RDP droplet `rdp-e92d1b57` (604137195) `expires_at: null` (~$28/mo)
- Reconcile/destroy would mutate the LIVE reseller DB + destroy real billed infra.
  Not auto-executed; awaiting explicit user go-ahead.
