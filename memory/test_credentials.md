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
- Dev Telegram bot is `@Nomadlytestbot` (`TELEGRAM_BOT_TOKEN_DEV`). Because `SKIP_WEBHOOK_SYNC=true`, the bot does NOT
  auto-repoint its webhook — on a fresh pod call Telegram `setWebhook` for the DEV token only, with
  `<REACT_APP_BACKEND_URL>/api/telegram/webhook`. NEVER touch `TELEGRAM_BOT_TOKEN_PROD` (@NomadlyBot → 2.speechcue.com).

## Environment notes
- `BOT_ENVIRONMENT=development`, `SKIP_WEBHOOK_SYNC=true` (dev sandbox — does NOT touch production Telegram/Telnyx/Twilio).

## Namecheap API (hosta.sh — vanity NS pilot)
- `NAMECHEAP_USERNAME=richbayo`, `NAMECHEAP_API_KEY` in backend/.env (vault). Whitelisted ClientIp: 136.108.30.124 (OLD pod).
- ⚠️ 2026-10-11 re-setup: current pod egress IP is `35.196.223.235` — must be whitelisted in Namecheap API + ConnectReseller
  (bot logged `[CR-Whitelist] IP 35.196.223.235 needs whitelisting`). Dev bot webhook now → `https://safebrowse-guard-1.preview.emergentagent.com/api/telegram/webhook`.
- Pilot admin endpoints: `GET /api/admin/ns-pilot/status?key=<SESSION_SECRET first 16 chars>` (also start|tick|revert|switch|stop).
- Cron endpoint: `POST /api/cron/ns-pilot-tick` with `Authorization: Bearer $WEBHOOK_CRON_SECRET`.

## HostPanel test account (Phase 4 Apps tab, local sandbox DB)
- `{REACT_APP_BACKEND_URL}/panel` → username `wpapps01`, PIN `246810` (weekly plan, fake account not on WHM, installs are dry-run).
- Re-seed: `node scripts/seed_panel_apps_test.js` (ready app "Demo Site" admin `admin_demo` / `Demo-Admin-Pass-2026!` + failed app /shop).
- Reseller API on this pod points at the LIVE prod reseller DB — test it only via `js/tests/*_2026-10.js` harnesses.
