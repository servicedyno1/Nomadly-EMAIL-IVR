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

## Environment notes
- `BOT_ENVIRONMENT=development`, `SKIP_WEBHOOK_SYNC=true` (dev sandbox — does NOT touch production Telegram/Telnyx/Twilio).
