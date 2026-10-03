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
- API KEY: rsk_live_6fc131dd06c97b3dd6fe3a4cbbd69d0c6eac28871fbf0f7c
- Mode: dry_run (RESELLER_API_LIVE not set) — no WHM/Cloudflare/registrar calls.
- Re-seed/rotate: `node /app/scripts/seed_reseller_test_owner.js`
