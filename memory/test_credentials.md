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
- ⚠️ 2026-10-20 re-setup (pod `https://ivr-features-lab.preview.emergentagent.com`, egress IP `34.170.12.145`, CR whitelist PASSED):
  upstream `webpack-dev-server` 6.1.0 + `webpack-dev-middleware` 8.4/8.5 (released 2026-10-17/18) break `yarn start`
  ("Can't import the named export 'Logger' … webpack-dev-middleware/client/utils/log.js"). Local-only workaround (no tracked
  change): temporarily set frontend `resolutions` → `"webpack-dev-server": "6.0.0"`, `"webpack-dev-middleware": "8.3.0"`,
  `yarn install --ignore-engines`, then restore the original package.json. Vault `DIGITALOCEAN_API_TOKEN` returns 401
  (stale/revoked in vault) → DO size/catalog/RDP sync fail on the dev pod only.
- ✅ 2026-10-22 re-setup (fresh pod, `/app` populated by platform): pod `https://ivr-features-lab.preview.emergentagent.com`
  (alias `https://ivr-features-lab.preview.emergentagent.com` routes to the same pod — both verified). Egress IP `34.170.12.145`
  (CR whitelist PASSED, WHM cPHulk whitelisted). Steps: vault unlock → `frontend/.env` (REACT_APP_BACKEND_URL=pod, WDS_SOCKET_PORT=443)
  → apt ffmpeg/whois/netcat + pip (parallel) → root yarn → frontend yarn (sequential, wds 6.0.0 / wdm 8.3.0 pin still required —
  upstream still 6.1.0/8.5.0; package.json restored after) → `setup-nodejs.sh` → restart backend+frontend → DEV bot (@Nomadlytestbot)
  setWebhook → `<pod>/api/telegram/webhook` → seed panel test account → deleted untracked yarn.lock files.
  Twilio READ-ONLY init reports "account AC754f… status 4 is not active" (vault Twilio creds — account inactive).
- ✅ 2026-10-22 (later) re-setup on pod `https://ivr-features-lab.preview.emergentagent.com`
  (alias `app-vault-setup-1.preview.emergentagent.com` also routes here — both verified /api/health 200). Same steps as above
  (wds 6.0.0 / wdm 8.3.0 pin still required). Egress IP now `35.193.209.116`: WHM cPHulk + Host Access whitelisted OK, but
  ConnectReseller whitelist FAILS (API 401 + browser automation "Login failed" → CR panel creds in vault likely stale;
  CR domain calls from this dev pod will fail). DEV bot webhook → `<pod>/api/telegram/webhook` (verified, no errors).
  Panel test account re-seeded (`wpapps01` / `246810`, login verified). `TWILIO_ENABLED` is NOT in the vault (unset = Twilio on).
- ✅ 2026-10-22 (3rd) re-setup on pod `https://ivr-features-lab.preview.emergentagent.com` (UUID alias
  `5ed988f7-3278-4d80-bc3c-55e8d98d9d26.preview.emergentagent.com` routes to the same pod — both /api/health 200).
  Same runbook steps; wds 6.0.0 / wdm 8.3.0 local pin STILL required (upstream 6.1.0 / 8.5.0), package.json restored.
  Egress IP back to `34.170.12.145`: CR whitelist PASSED, WHM cPHulk + Host Access OK. DEV bot webhook repointed from old
  `ac76aa2f…` pod → `<pod>/api/telegram/webhook` (no errors). Panel `wpapps01`/`246810` re-seeded + UI login verified.
  Startup alerts: Telnyx balance $7.38 (warn <$10), EdenAI $4.98 (warn <$5), Twilio 401 (account inactive — known).
- ✅ 2026-10-23 re-setup (fresh pod, `/app` populated by platform): pod `https://ivr-features-lab.preview.emergentagent.com`
  (UUID alias `839d2a0b-800d-4b9c-8cbb-5b901c2bf000.preview.emergentagent.com` → same pod, both /api/health 200).
  Egress IP `34.16.56.64`: CR whitelist PASSED, WHM cPHulk + Host Access OK. Frontend now resolves wds 5.2.7 / wdm 7.4.6
  (package.json resolution `~5.2.1`) → the old 6.0.0/8.3.0 local pin is NO LONGER needed. `WEB_CLOUDIVR_DRY_RUN` is NOT in
  the vault → appended `WEB_CLOUDIVR_DRY_RUN=true` to dev `backend/.env` (vault NOT re-locked — do this on every fresh pod
  until it is). DEV bot webhook repointed from old `vault-app-setup-3` pod → `<pod>/api/telegram/webhook` (no errors).
  Panel `wpapps01`/`246810` + CloudIVR Alice/Bob re-created (Alice dry-run number +13807100346, $380). TTS step of the smoke
  script skipped (spends provider credits). Startup alerts: Telnyx $5.01, EdenAI $4.81, Twilio 401 (known).
- ✅ 2026-10-23 (2nd) re-setup (fresh pod, `/app` populated by platform, no `.env` files): pod
  `https://ivr-features-lab.preview.emergentagent.com` (UUID alias `09487ecd-b7df-4e50-8814-23c73fce34e2.preview.emergentagent.com`
  → same pod, verified via access-log marker). Egress IP `35.193.209.116`: WHM cPHulk + Host Access OK; ConnectReseller whitelist
  FAILS (API 401 + browser "Login failed" — CR panel creds in vault stale; CR domain calls from this dev pod fail). Frontend resolves
  wds 5.2.7 / wdm 7.4.6 (no pin needed). NOT in the vault → appended to dev `backend/.env` (vault NOT re-locked on purpose so
  dev-only flags never reach prod via `railway_setup_prod.js`): `WEB_CLOUDIVR_DRY_RUN=true`, `TWILIO_ENABLED=false`,
  `CLOUDIVR_WEB_ON=true` (without it `/cloudivr` + `/api/cloudivr-web/*` return 404), `WEB_TRYCALL_LIVE=false`.
  `WEB_DYNO_PAY_API_KEY` is NOT in vault or secret store → preview top-ups show the PREVIEW placeholder address.
  DEV bot webhook repointed from old `vault-launch-6` pod → `<pod>/api/telegram/webhook` (no errors). Panel `wpapps01`/`246810`
  + CloudIVR Alice (dry-run +15156442785, Business, $380) / Bob ($500) re-created; UI logins verified on admin, /panel, /cloudivr.
  Seeded with a safe variant of cloudivr_web_smoke.sh (no TTS / top-up / campaigns). Startup alerts: Telnyx $14.99 ok,
  EdenAI $4.81 (warn), Twilio 401 (known).
- ✅ 2026-10-23 (3rd) re-setup (fresh pod, `/app` populated by platform, no `.env` files): pod
  `https://ivr-features-lab.preview.emergentagent.com` (UUID alias `bb9196c5-6b8c-411b-ba7f-ced8cddbd322.preview.emergentagent.com`
  → same pod, both /api/health 200). Same runbook; wds 5.2.7 / wdm 7.4.6 (no pin needed). Dev-only flags appended to
  `backend/.env` again (NOT in vault, vault NOT re-locked): `WEB_CLOUDIVR_DRY_RUN=true`, `TWILIO_ENABLED=false`,
  `CLOUDIVR_WEB_ON=true`, `WEB_TRYCALL_LIVE=false`. DEV bot webhook repointed from old `app-vault-launch-1` pod →
  `<pod>/api/telegram/webhook` (no errors). `APP_OPEN_API_KEY` verified (OpenAI /v1/models 200, `whisper-1` listed; a real
  transcription call returned status `empty` for a tone = code path OK). Panel `wpapps01`/`246810` + CloudIVR Alice/Bob re-created
  (see CloudIVR section). Startup alerts: Telnyx $14.99 ok, EdenAI $4.81 (warn), Twilio 401 (known).





## Environment notes
- Linkly (Shortit "Random" link provider since 2026-10-22): `LINKLY_API_KEY` (secret, in vault + all 4 droplet
  backend.env), `LINKLY_WORKSPACE_ID="414714"`. FREE plan = 100 links total across ALL bots — tests must create as few
  links as possible and delete them (DELETE /api/v1/workspace/414714/links/{id}); never delete linkly.link/2y2V3.
  Do NOT call Linkly analytics endpoints (/clicks, /counters: 100/month). list_links can 429 if called repeatedly.
- `BOT_ENVIRONMENT=development`, `SKIP_WEBHOOK_SYNC=true` (dev sandbox — does NOT touch production Telegram/Telnyx/Twilio).
- `TWILIO_ENABLED` (added 2026-10-22): reversible Twilio kill-switch. unset/`true` = current dual-provider
  behavior; `false` = Twilio hidden, purchases steered to Telnyx. Sandbox is set to `false` (Twilio account
  AC754fb3… is suspended). To restore Twilio when reactivated: set back to `true` (+ restart). PROD rollout:
  set in Railway `production` env AND droplet `/opt/nomadly/shared/{app-main,app-wl}/backend.env`.
  See memory/TWILIO_TO_TELNYX_MIGRATION_2026-10-22.md.

## Namecheap API (hosta.sh — vanity NS pilot)
- `NAMECHEAP_USERNAME=richbayo`, `NAMECHEAP_API_KEY` in backend/.env (vault). Whitelisted ClientIp: 136.108.30.124 (OLD pod).
- 2026-10-15 re-setup (fresh pod): vault unlock → `frontend/.env` created (`REACT_APP_BACKEND_URL=https://ivr-features-lab.preview.emergentagent.com`)
  → pip/ffmpeg/root yarn → frontend yarn (sequential) → `setup-nodejs.sh` → `supervisorctl restart backend` (it starts before
  pip finishes → `No module named 'apscheduler'`) → DEV bot setWebhook. Egress IP now `136.108.30.124` (CR whitelist check failing).
- ⚠️ 2026-10-14 re-setup: pod `https://ivr-features-lab.preview.emergentagent.com`, egress IP
  `136.70.105.25` — ConnectReseller startup check says it NEEDS whitelisting (Namecheap too). Dev bot webhook →
  `<pod>/api/telegram/webhook`. Pod has Node 20 → frontend needs `yarn install --ignore-engines` (webpack-dev-server 6
  wants Node ≥22.15). Delete the generated untracked `yarn.lock` files after install (avoid a needless prod deploy).
  Prod droplet SSH key restore: `VAULT_PASSWORD=... bash scripts/restore_infra_keys.sh`.
- ⚠️ 2026-10-13 re-setup: current pod egress IP is `34.170.12.145` — ConnectReseller startup check PASSED (already
  whitelisted); Namecheap API whitelist must include it for the hosta.sh pilot
  (previous pods: `35.196.223.235`, `136.108.30.124`). Dev bot webhook now → `https://ivr-features-lab.preview.emergentagent.com/api/telegram/webhook`.
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

## CloudIVR web app (preview, local DB) — 2026-10-23
- URL: `{REACT_APP_BACKEND_URL}/cloudivr` (login `/cloudivr/login`). Web-only accounts, separate from Telegram users.
- Account A: `civr.alice@example.com` / `AliceTest#2026` (owns dry-run US number, Business plan, ~$380 test wallet)
- Account B: `civr.bob@example.com` / `BobTest#2026` (no numbers, ~$500 test wallet) — use for isolation checks.
- 2026-10-23 (3rd) pod: Alice = `+15156445205` (Business, $380) with 6 seeded log rows (`phoneLogs.seed='civr-features-2026-10'`:
  2 voicemails — one transcript `done`, one `failed` — forwarded, SMS, off_hours, missed from +14155550122 + a peer-matched note).
  Bob = `+19565971129` (**Starter** — no voicemail / Call me first / SIP; use for plan-gating checks), ~$450.
- Re-create/fund: `bash scripts/cloudivr_web_smoke.sh` (registers both, tops wallets up to ≥$300 in the LOCAL DB, buys a dry-run number for A).
- Preview runs `WEB_CLOUDIVR_DRY_RUN=true`: purchases/calls/SIP are simulated; crypto top-ups are live only when `WEB_DYNO_PAY_API_KEY` is set.
- Free test call (landing): preview shows the OTP on screen (dry run). `WEB_TRYCALL_LIVE=true` in backend/.env (+ restart nodejs) = real calls
  and real emailed codes. Limits are per IP: clear `webTryCalls`/`webTryCodes` for qa.* emails between test runs. Owner's real test number
  +13025141000 is used for 30 days (records ip set to `owner-real-test`).
- 2026-10-24: Alice wallet ~$82.50 (Business, recording on); Bob trial reset (`db.webPrefs.updateOne({_id:'5000000000000002'},{$set:{ivrTrialUsed:false}})`, DB `test`).
  Extra QA accounts (password `QaTest#2026x`): qa.cpn1792774767@example.com (Pro dry-run number), qa.coupon1792775586@example.com.
- Google sign-in: hidden until `GOOGLE_OAUTH_CLIENT_ID` (owner's own Google app) is set. No Google test identities yet.

