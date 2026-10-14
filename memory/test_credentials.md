# Test / Setup Credentials

## Secrets Vault (Nomadly)
- The full `/app/backend/.env` credential set is stored encrypted at `/app/memory/nomadly.vault.enc`.
- **Vault passphrase:** `Katiekendra123@`
- Restore on a fresh pod:
  ```bash
  VAULT_PASSWORD='Katiekendra123@' bash /app/scripts/vault.sh unlock
  bash /app/scripts/setup-nodejs.sh
  ```
- `frontend/.env` is gitignored — create it with the current pod's `REACT_APP_BACKEND_URL` if missing.
- Fresh-pod gotchas (2026-10-13): if `/app` is empty except `.git`, extract code with `git archive HEAD | tar -x -C /app`.
  Run root `yarn install --ignore-engines` and `frontend/ yarn install` SEQUENTIALLY (parallel runs corrupt the shared
  yarn cache → `Cannot find module 'es-abstract/...'`; fix = `yarn cache clean` + delete node_modules + reinstall).
  Also `pip install -r backend/requirements.txt` and `apt-get install ffmpeg` (.emergent/system_deps.txt).
  Local Mongo starts empty → run `node scripts/seed_panel_apps_test.js` for the panel test account.
- Dev Telegram bot is `@Nomadlytestbot` (`TELEGRAM_BOT_TOKEN_DEV`). Because `SKIP_WEBHOOK_SYNC=true`, the bot does NOT
  auto-repoint its webhook — on a fresh pod call Telegram `setWebhook` for the DEV token only, with
  `<REACT_APP_BACKEND_URL>/api/telegram/webhook`. NEVER touch `TELEGRAM_BOT_TOKEN_PROD` (@NomadlyBot → 2.speechcue.com).

## Environment notes
- `BOT_ENVIRONMENT=development`, `SKIP_WEBHOOK_SYNC=true` (dev sandbox — does NOT touch production Telegram/Telnyx/Twilio).

## Namecheap API (hosta.sh — vanity NS pilot)
- `NAMECHEAP_USERNAME=richbayo`, `NAMECHEAP_API_KEY` in backend/.env (vault). Whitelisted ClientIp: 136.108.30.124 (OLD pod).
- ⚠️ 2026-10-14 re-setup: pod `https://706a7931-6cf1-4768-9fed-d66f48a83cd0.preview.emergentagent.com`, egress IP
  `136.70.105.25` — ConnectReseller startup check says it NEEDS whitelisting (Namecheap too). Dev bot webhook →
  `<pod>/api/telegram/webhook`. Pod has Node 20 → frontend needs `yarn install --ignore-engines` (webpack-dev-server 6
  wants Node ≥22.15). Delete the generated untracked `yarn.lock` files after install (avoid a needless prod deploy).
  Prod droplet SSH key restore: `VAULT_PASSWORD=... bash scripts/restore_infra_keys.sh`.
- ⚠️ 2026-10-13 re-setup: current pod egress IP is `34.170.12.145` — ConnectReseller startup check PASSED (already
  whitelisted); Namecheap API whitelist must include it for the hosta.sh pilot
  (previous pods: `35.196.223.235`, `136.108.30.124`). Dev bot webhook now → `https://nomadly-deploy.preview.emergentagent.com/api/telegram/webhook`.
- Pilot admin endpoints: `GET /api/admin/ns-pilot/status?key=<SESSION_SECRET first 16 chars>` (also start|tick|revert|switch|stop).
- Cron endpoint: `POST /api/cron/ns-pilot-tick` with `Authorization: Bearer $WEBHOOK_CRON_SECRET`.

## HostPanel test account (Phase 4 Apps tab, local sandbox DB)
- `{REACT_APP_BACKEND_URL}/panel` → username `wpapps01`, PIN `246810` (weekly plan, fake account not on WHM, installs are dry-run).
- Re-seed: `node scripts/seed_panel_apps_test.js` (ready app "Demo Site" admin `admin_demo` / `Demo-Admin-Pass-2026!` + failed app /shop).
- Reseller API on this pod points at the LIVE prod reseller DB — test it only via `js/tests/*_2026-10.js` harnesses.

## Voodoo Land (app-voodoo, production droplet) — 2026-10-14
- Bot @Voodoo_landbot, panel https://panel.voodoohost.xyz, call page https://voodooivr.xyz/call. No test user accounts created.
- All secrets (bot token, Mongo URL, Dynopay key, SESSION_SECRET, SALES_DASHBOARD_PASSWORD) live ONLY in
  /opt/nomadly/shared/app-voodoo/backend.env on the droplet — never copied into the repo. Setup: memory/VOODOO_LAND_SETUP_2026-10-14.md
- Voodoo Sales & Profit dashboard: https://voodooivr.xyz/sales (API /api/admin/sales/*). Password = owner-chosen value in
  SALES_DASHBOARD_PASSWORD of /opt/nomadly/shared/app-voodoo/backend.env (set 2026-10-14; not written here — this file is in git).
