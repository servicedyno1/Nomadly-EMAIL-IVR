# Test / Setup Credentials

## Vault (secrets restore)
- Vault file: `memory/nomadly.vault.enc`
- Unlock: `VAULT_PASSWORD='Katiekendra123@' bash scripts/vault.sh unlock`
- Vault password: `Katiekendra123@`
- Unlocking restores `/app/backend/.env` (all app/API credentials) (never creates a root `/app/.env`).

## Environment mode (this preview pod)
- Configured as DEVELOPMENT sandbox: `BOT_ENVIRONMENT=development`, `SKIP_WEBHOOK_SYNC=true`
- Uses `TELEGRAM_BOT_TOKEN_DEV` (never the production bot on a preview pod)
- `SELF_URL` / `SELF_URL_DEV` point to the current pod `/api`; `SELF_URL_PROD` kept as the Railway URL reference.

## DATABASE ISOLATION (IMPORTANT — 2026 setup)
- This pod's `MONGO_URL` is intentionally repointed to the LOCAL MongoDB: `mongodb://localhost:27017`.
  Reason: the vault's real `MONGO_URL` points at LIVE PRODUCTION (`roundhouse.proxy.rlwy.net:52715`).
  Booting the Node bot against prod immediately resumed a real bulk-call campaign and placed live
  Twilio calls, plus ran prod maintenance jobs (phone/hosting schedulers, DNS healer, protection
  enforcer, balance monitor, email-blast queue). Isolating to local Mongo makes the sandbox safe:
  empty DB ⇒ no campaigns to resume, no numbers/domains/users to act on ⇒ zero prod side-effects.
- The original production `MONGO_URL` is preserved as a comment (`ORIGINAL_PROD_MONGO_URL=`) in
  `/app/backend/.env` and remains inside the encrypted vault.
- To go back to LIVE PRODUCTION data (only if you truly intend to, and Railway prod is stopped):
  restore the prod `MONGO_URL` line and restart `backend` + `nodejs`. Before doing so, gate every
  outbound/mutating startup job behind `SKIP_WEBHOOK_SYNC=true`, otherwise real calls/emails/renewals
  will fire again.

## Railway PRODUCTION (2026-06 fork — bot re-homed to a new project)
- Project **zippy-radiance** `0f41a48b-d2f6-4be5-acbd-524c6df6d2c6` · service **Nomadly-EMAIL-IVR** `73e2050b-586d-41d4-a1b5-6b0914e7a0f9` · env **production** `b9a9e5d2-0f71-42c4-925b-ac843adcb656`
- Public URL: `https://nomadly1.up.railway.app` (SELF_URL / SELF_URL_PROD). Custom: `2.speechcue.com`, `panel.2.hostbay.io`
- Tokens live ONLY in the vault (`backend/.env` after unlock): `API_KEY_RAILWAY` = project token (runtime + ops), `RAILWAY_ACCOUNT_TOKEN` = account token (ops only, never pushed), `API_KEY_RAILWAY_NEW_HOSTING` = legacy "New Hosting" project token (read-only history), `RAILWAY_PROD_*` = the IDs above.
- Ops tool: `VAULT_PASSWORD=… node js/ops/railway_setup_prod.js inspect|plan|apply|verify|deploy|domains|status`
- Legacy prod config snapshot (236 vars, dead "New Hosting" service): `memory/railway_newhosting_prod_vars.enc` (same vault passphrase).

## Frontend env (recreated during setup)
- `/app/frontend/.env` present with:
  `REACT_APP_BACKEND_URL=https://passphrases-3.preview.emergentagent.com` (current pod; earlier forks had a different preview host — always trust the live value in frontend/.env, not older docs)

## Admin panel
- Frontend admin dashboard is open (no login) at the pod root URL.

## Reseller API (sandbox, local Mongo `test`)
- Key label `golden e2e sandbox key` (`resellerApiKeys._id = e2e-golden-key`)
- `X-API-Key: nmdly_e2e_51573577f5db956c5c0cb039` (or `Authorization: Bearer ...`)
- Base: `${REACT_APP_BACKEND_URL}/api/reseller/v1` — e.g. `GET /rdp/plans`, `POST /rdp`
- Re-seed on a fresh pod: `node scripts/seed_rdp_reseller_e2e.js` (idempotent — upserts the key + owner
  wallet $1000 AND the `e2e-rdp-1` RDP record below). The older `seed_e2e_sandbox.js` seeds only the key+wallet.
- Sandbox owned RDP record for the key owner: `vpsPlansOf._id = "e2e-rdp-1"` (provider `digitalocean-rdp`,
  instanceId `rdp-11111111-2222-3333-4444-555555555555`, os_id `ws2022`). Used to exercise the new
  `POST /rdp/:id/password-reset`, `POST /rdp/:id/reinstall`, and `agent_online` on `GET /rdp/:id`
  in dry-run mode (SKIP_WEBHOOK_SYNC=true ⇒ isLive()=false ⇒ every mutating call returns mode:"dry_run").

## RDP golden-image admin endpoints (sandbox)
- `GET/POST ${REACT_APP_BACKEND_URL}/api/admin/rdp-golden/{status|build|sync|transfer|cancel}?key=<first 16 chars of SESSION_SECRET in backend/.env>` (URL-encode the key)
- CLI wrappers: `node js/ops/rdp_golden_build.js status|watch|build|transfer|cancel`, E2E: `node js/ops/rdp_golden_e2e.js --os ws2019|ws2022|ws2025 --region US` (creates + destroys one real droplet)

## Telegram bot simulation harness (sandbox only, added 2026-09-23)
- `backend/.env` has `TELEGRAM_API_BASE_URL=http://127.0.0.1:5099` → the bot talks to the local mock Bot API
  `js/tests/mock_telegram_api.js` instead of Telegram (nothing reaches real users). Start it if not running:
  `nohup node js/tests/mock_telegram_api.js > /tmp/mock_tg.log 2>&1 &`  (health: `GET http://127.0.0.1:5099/_health`)
- Drive the bot: `POST http://localhost:5000/telegram/webhook` with a Telegram update JSON
  (`{"update_id":1,"message":{"message_id":1,"date":<unix>,"chat":{"id":777000123,"type":"private","first_name":"Sim"},"from":{"id":777000123,"is_bot":false,"first_name":"Sim","username":"sim_user"},"text":"<button label or text>"}}`).
- Read replies: `GET http://127.0.0.1:5099/_calls?chat_id=777000123&since=<epoch_ms>&method=sendMessage` → `[{ts,method,chat_id,text,buttons[],reply_markup}]`.
  `DELETE /_calls` clears the log. Reply-keyboard buttons are "tapped" by sending their exact label as the message text.
- Sim user chat_id `777000123`: onboarded (English), wallet `walletOf._id="777000123"` seeded usdIn=500.
- Vault `.env` restores `VPS_RDP_PROVIDER="azure"`; production uses `digitalocean-rdp` (2026-09-23). Set `digitalocean-rdp` locally only if you need the bot's DO-RDP order flow.
- 2026-09-24 pod: fresh setup done via vault unlock + `scripts/setup-nodejs.sh`; frontend/.env recreated with the current pod URL. `TELEGRAM_API_BASE_URL` mock harness is NOT set in the vault .env (add it manually before driving the bot in a sim).

## Reseller API — GAP-FIX test key (2026-09-25, sandbox, local Mongo `test`)
- `X-API-Key: nmdly_test_reseller_gapfix` (owner `gapfix-owner`)
- Stood up by `node js/ops/reseller_test_server.js` (standalone reseller router on :5000, external
  providers stubbed, isLive()=false). Seeds domainsOf/registeredDomains/cpanelAccounts for the owner.
- Base: `${REACT_APP_BACKEND_URL}/api/reseller/v1`. Used to verify the 7 gap fixes + change-primary.

## SMADAV / SAMDAV white-label (2026-09-25) — same Railway account, DIFFERENT branch + service
- White-label of Nomadly. Railway project **zippy-radiance** `0f41a48b-…` (same as Nomadly) · service **SAMDAV** `6d40a2dd-dfdf-4d05-9c68-4962a065885c` · env **production** `b9a9e5d2-…`.
- Deploys from GitHub branch **`WhiteLabel`** (NOT `main`; Nomadly = `main`). Same repo `servicedyno1/Nomadly-EMAIL-IVR`. Platform auto-commits land on `main`, so ops scripts here do NOT rebuild SAMDAV.
- Public URL `samdav1.up.railway.app`. Custom domains (attached this session): `1.smadavspeech.com` (call page) + `1.panel.smadavhost.com` (host panel).
- Cloudflare zones (same CF account, `expressdrop247@gmail.com`): `smadavspeech.com` `4e3fa86fdd52ea305d3ae2e57a9705aa`, `smadavhost.com` `b3667eb4a8adce1f33b86d7f9d614431`.
- SIP (branded Telnyx domain `sip.smadavspeech.com`): needs A `192.76.120.10` + SRV `_sip._tcp/_udp`(5060) `_sips._tcp`(5061) → `sip.telnyx.com` (mirrors Nomadly `sip.speechcue.com`). Added this session. Telnyx conn `3034191521164298080` ("Smadav Cloud Phone SIP", active). Twilio SIP domain `smadav-7937a0.sip.twilio.com` (Twilio-hosted, no DNS). Shared Twilio account with Nomadly, isolated via `TWILIO_SIP_DOMAIN_PREFIX=smadav`.
- Ops helpers (js/ops/, read the SAMDAV service by id): `smadav_discover.js`, `smadav_inspect.js`, `smadav_domains.js` (attach 1.* domains), `smadav_cf_apply.js` (railway DNS), `smadav_cf_redirects.js` (bare→1. 301), `smadav_env_update.js` (--apply), `smadav_sip_dns.js`, `smadav_sip_verify.js`, `smadav_provider_dump.js`.

## Honeypot Traps feature test accounts (sandbox, local Mongo `test`) — added 2026-06-25
- Re-seed: `cd /app && node scripts/seed_honeypot_test.js`
- MONTHLY hosting login (toggle ENABLED): username `hptestmonthly`, PIN `135790`, plan "Premium Anti-Red HostPanel", domain `hp-monthly-test.com`
- WEEKLY hosting login (toggle LOCKED): username `hptestweekly`, PIN `135790`, plan "Premium Anti-Red (1-Week)", domain `hp-weekly-test.com`
- Both owned by reseller-key owner chatId `5590563715`, so the reseller API endpoints `GET/POST /api/reseller/v1/hosting/honeypot/:domain` resolve them too.
- Web panel: `${REACT_APP_BACKEND_URL}/panel` → login → Security tab → "Honeypot Traps" row (data-testid `sec-honeypot-toggle` / `sec-honeypot-locked`).
