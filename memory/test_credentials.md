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
