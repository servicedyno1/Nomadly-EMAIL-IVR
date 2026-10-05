# Test credentials

## Sales & Profit dashboard (/sales) — WhiteLabel & Nomadly admin
- URL (sandbox): `${REACT_APP_BACKEND_URL}/sales`
- Login: POST `/api/admin/sales/login` with `{ "password": "<SALES_DASHBOARD_PASSWORD>" }`
- Sandbox password (backend/.env, gitignored): `sandbox-sales-test`
- Production app-wl (Smadav): `SALES_DASHBOARD_PASSWORD` is set in the droplet env
  (`/opt/nomadly/app-wl/backend/.env`) — value NOT stored here; read from the box if needed.
- Production app-main (Nomadly): `SALES_DASHBOARD_PASSWORD` is NOT set, so /sales login
  returns 500 there by design (feature is WhiteLabel-facing).
- Token: JWT signed with SESSION_SECRET, 24h.

## Vault / infra
- Restore SSH keys: `VAULT_PASSWORD='Katiekendra123@' bash scripts/restore_infra_keys.sh`
- DO droplet: `ssh -i /root/.ssh/nomadly_droplet root@146.190.238.190`
- WHM box:   `ssh -i /root/.ssh/whm_box root@68.183.77.106`
- **Droplet RUNTIME env = `/opt/nomadly/shared/<app>/backend.env`** (deploy.sh symlinks it into every release).
  `/opt/nomadly/<app>/backend/.env` is now a symlink to it — edit either, then blue/green redeploy
  (`bash /opt/nomadly/deploy.sh app-main|app-wl`) so dotenv reloads.
- ConnectReseller panel (`CR_PANEL_EMAIL/CR_PANEL_PASSWORD` in env): password EXPIRED as of 2026-10-01 — CR demands
  reset + 2FA. Browser auto-whitelist is down until the user resets it.

## Reseller API (dry-run testing) — created 2026-10-03 (API-parity fixes)
- Base URL: {REACT_APP_BACKEND_URL}/api/reseller/v1  (internal: http://127.0.0.1:5000/reseller/v1)
- Auth: `Authorization: Bearer <key>`  OR  `X-API-Key: <key>`
- Owner chatId: 999000111  (wallet funded usdIn=100000 in Mongo `walletOf`)
- API KEY (rotates on every owner re-seed): rsk_live_072b98398b0395084da80bc5269a26f25af8b7a7c8f2d4fa
- Mode: dry_run (RESELLER_API_LIVE not set) — no WHM/Cloudflare/registrar calls.
- Re-seed/rotate (PRINTS the new key as TEST_RESELLER_API_KEY=…): `node /app/scripts/seed_reseller_test_owner.js`

### Lifecycle fixtures — added 2026-06 (hosting/vps/rdp state + grace + renewable + /renewals)- Seed: `node /app/scripts/seed_reseller_lifecycle_fixtures.js` (owner 999000111):
  - hosting `apigrace01` = GRACE (expired 10h, suspended, delete_at = expiry+48h), `apisusp01` = suspended past-grace,
    `apiterm01` = TERMINATED (deleted). (`apifix01` Golden / `apifix02` Premium = online, from seed_reseller_test_hosting.js)
  - vps `vps-term-1` = CANCELLED (terminated), rdp `rdp-grace-1` = RDP in grace. (`vps-test-1`/`rdp-test-1` running, from seed_reseller_test_vps_rdp.js)
- Pytest: `backend/tests/test_reseller_lifecycle.py` (21 cases, all green — re-seeds owner at import & captures the rotated key).

### URL Shortener test fixture — added 2026-06
- Seed: `node /app/scripts/seed_reseller_test_shortener.js` → gives owner 999000111 an OWNED + COMPLETED shortener domain `golink-test.com` (cname target `nomadly.up.railway.app`).
- Endpoints: `/reseller/v1/shortener/domains` (POST buy|existing|external, GET list, POST :domain/verify, DELETE :domain) and `/reseller/v1/shortener/links` (POST, GET, GET :slug?domain=, PATCH :slug, DELETE :slug?domain=).
- On sandbox (non-live) domain activation returns a `dry_run` envelope; link CRUD writes real Mongo (`fullUrlOf`/`linksOf`/`clicksOn`/`expiryOf`, key = `domain/slug` with dots→@).
- Pytest: `backend/tests/test_reseller_shortener.py` (29 cases, all green).

### Async provisioning test fixture — added 2026-06
- Seed/rotate key (PRINTS `TEST_RESELLER_API_KEY=…`): `node /app/scripts/seed_reseller_test_owner.js` (owner 999000111, wallet usdIn=100000, mode dry_run on sandbox).
- `backend/tests/test_reseller_async_provision.py` now SELF-SEEDS the owner at import (or honors a `TEST_RESELLER_API_KEY` env var) — it never fails on a rotated key. 17 cases.
- Endpoints: POST /hosting|/vps|/rdp return 202 {status:provisioning, job_id, username|id, progress, stage_label, eta_seconds, eta_at, poll_url, credentials_url}; client_ref idempotency (same job_id, idempotent:true, wallet unchanged); `GET /jobs/:job_id` (owner-scoped progress + ETA poll; 404 if not owned); validation-before-charge; duplicate-domain 409; state surfacing on reads; no-auth 401.
- Run the reseller pytest suites INDEPENDENTLY (each re-seeds owner at import → running together rotates the key mid-run and 401s the other): `test_reseller_async_provision.py`, `test_reseller_lifecycle.py`, `test_reseller_renew.py`.
- LIVE-only paths (real build failure → auto-refund + `*.provision_failed` webhook) are NOT exercisable on sandbox (dry_run). Verify on a prod/staging pod with RESELLER_API_LIVE=true and SKIP_WEBHOOK_SYNC unset.

## Reseller API (LIVE mode) — bug fix verification 2026-10-05 (cPanel credentials 501)
- Base URL: {REACT_APP_BACKEND_URL}/api/reseller/v1
- Auth: `Authorization: Bearer <key>`  OR  `X-API-Key: <key>`
- LIVE API KEY (owner chatId 5590563715, @onarrival1): rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736
- Mode: LIVE (RESELLER_API_LIVE=true; reseller API uses dedicated PROD Railway DB via RESELLER_DB_URL).
- Target accounts for the 501-no_credentials fix:
  - `name65fb`  = API-provisioned (was 501, now backfilled with creds) — EXPECT 200 on /files,/subdomains,/ssl,/stats.
  - `nbayftest` = manually-provisioned control — EXPECT 200 on the same endpoints.
- ⛔ LIVE: test ONLY read-only GET endpoints. NEVER POST /hosting or any mutating route (real charges/provisioning).
