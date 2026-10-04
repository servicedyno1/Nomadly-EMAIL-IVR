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

### Lifecycle fixtures — added 2026-06 (hosting/vps/rdp state + grace + renewable + /renewals)
- Seed: `node /app/scripts/seed_reseller_lifecycle_fixtures.js` (owner 999000111):
  - hosting `apigrace01` = GRACE (expired 10h, suspended, delete_at = expiry+48h), `apisusp01` = suspended past-grace,
    `apiterm01` = TERMINATED (deleted). (`apifix01` Golden / `apifix02` Premium = online, from seed_reseller_test_hosting.js)
  - vps `vps-term-1` = CANCELLED (terminated), rdp `rdp-grace-1` = RDP in grace. (`vps-test-1`/`rdp-test-1` running, from seed_reseller_test_vps_rdp.js)
- Pytest: `backend/tests/test_reseller_lifecycle.py` (21 cases, all green — re-seeds owner at import & captures the rotated key).

### URL Shortener test fixture — added 2026-06
- Seed: `node /app/scripts/seed_reseller_test_shortener.js` → gives owner 999000111 an OWNED + COMPLETED shortener domain `golink-test.com` (cname target `nomadly.up.railway.app`).
- Endpoints: `/reseller/v1/shortener/domains` (POST buy|existing|external, GET list, POST :domain/verify, DELETE :domain) and `/reseller/v1/shortener/links` (POST, GET, GET :slug?domain=, PATCH :slug, DELETE :slug?domain=).
- On sandbox (non-live) domain activation returns a `dry_run` envelope; link CRUD writes real Mongo (`fullUrlOf`/`linksOf`/`clicksOn`/`expiryOf`, key = `domain/slug` with dots→@).
- Pytest: `backend/tests/test_reseller_shortener.py` (29 cases, all green).
