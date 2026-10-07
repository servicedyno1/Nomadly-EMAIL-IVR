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
