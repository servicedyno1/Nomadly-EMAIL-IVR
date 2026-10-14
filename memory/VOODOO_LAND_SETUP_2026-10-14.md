# Voodoo Land white-label — setup record (2026-10-14)

Third brand on the same droplet (`nomadly-prod-ams3`, 146.190.238.190), same code as Smadav
(branch `WhiteLabel`), branded only by its own `backend.env`.

## Runtime
- App: `app-voodoo` — PM2 slots `app-voodoo-a` :5003 / `app-voodoo-b` :5103 (blue/green, `deploy.sh app-voodoo`)
- Env: `/opt/nomadly/shared/app-voodoo/backend.env` (built by `js/ops/voodoo_env_build.py` from app-wl + overrides)
- Repo mirror: `/opt/nomadly/repo/app-voodoo.git` (copy of app-wl.git), `shared/app-voodoo/branch` = WhiteLabel
- nginx: `/etc/nginx/sites-available/voodoo` (+ sites-enabled link), upstream `app_voodoo` in `conf.d/nomadly-upstreams.conf`
- Certs (LE, dns-cloudflare): `voodooivr.xyz`, `panel.voodoohost.xyz`
- DB: own Mongo (Railway URL supplied by owner), `DB_NAME=voodoo`
- CI: `deploy.yml` job `deploy-voodoo` (needs deploy-wl); `sync-whitelabel.yml` dispatches `app=whitelabel` (wl then voodoo)

## Domains / DNS (Cloudflare, same account; `js/ops/voodoo_cf_dns.js`)
- `voodooivr.xyz` A → droplet (dns-only) — SELF_URL: Telegram/Telnyx/Twilio webhooks, `/call` page, `/sms-app/download`
- `www.voodooivr.xyz` → 301 `https://voodooivr.xyz`
- `sip.voodooivr.xyz` A 192.76.120.10 + SRV `_sip._udp/_sip._tcp` 5060, `_sips._tcp` 5061 → sip.telnyx.com
- `panel.voodoohost.xyz` A → droplet (dns-only) — HostPanel + landing/storefront
- `voodoohost.xyz`, `www.voodoohost.xyz` → 301 `https://panel.voodoohost.xyz`

## Accounts
- Own: Telegram bot @Voodoo_landbot, Mongo, Dynopay API key (webhook secret/wallet token unset → server-to-server re-verify)
- Shared with Nomadly: Telnyx API key (own SIP connection 3070492034289632530, Call Control app 3070492048516711701,
  messaging profile 4001a13a-23a5-430d-8c9c-8e7c4f6bdc4a — `js/ops/voodoo_telnyx_setup.js`), OpenAI, Twilio
  (SIP domain prefix `voodoo`), Cloudflare, OpenProvider, DigitalOcean, WHM, Safe Browsing
- Contabo / Railway keys intentionally blank (VPS = DigitalOcean only)
- Placeholders until owner supplies: support = @onarrival1, TG channel/handle = @Voodoo_landbot

## Brand
- `CHAT_BOT_BRAND="Voodoo Land"` → slug `voodooland`; accent #14B8A6, bg #0b1215; "VL" mark + "VOODOO LAND" wordmark
- Assets: `sms-app/brands/voodooland/*`, served at `/brand/{mark,wordmark,logo}.png` (`js/assets/brand/voodooland`)
- SMS app: `com.voodoo.sms`, `static/voodooland-sms.apk` (+ backend/static), api base https://voodooivr.xyz

## Safety fixes made for a shared Telnyx account
- `migrateNumbersToCallControlApp`: empty bot-number list no longer means "all numbers" (a fresh brand DB would
  have re-pointed every number on the account — Smadav's 3 numbers — to Voodoo's call app).
- Telnyx resource names are brand-scoped (`${CHAT_BOT_BRAND} Cloud Phone …`) so a brand never adopts Nomadly's app by name.
- deploy.sh exports the app's `REACT_APP_*` into its frontend build (`fe_env` signature in RELEASE) — otherwise
  WhiteLabel's `frontend/.env.production` (Smadav) would be baked into Voodoo's UI.

## Release hot-patch (until "Save to GitHub" syncs main → WhiteLabel)
The first Voodoo release (`20261014T112332Z-9b30149`) was patched in place with the files above +
`/brand/` catch-all passthrough + PhoneTestPage brand fix + voodooland APK/assets (RELEASE has `patched=` lines).
After the owner saves to GitHub, the normal sync → `deploy.yml app=whitelabel` ships all of it to app-wl and app-voodoo.
Smadav's active release also got the rebuilt smadav-sms.apk (Subscribe link fix, same v2.8.0 → no broadcast).

## Sales & Profit dashboard
- URL: https://voodooivr.xyz/sales (same as Smadav's https://1.smadavspeech.com/sales; the panel host only serves the HostPanel)
- Password: owner-set `SALES_DASHBOARD_PASSWORD` in the Voodoo backend.env (kept across `voodoo_env_build.py` re-runs). Verified 2026-10-14:
  wrong pw → 401, login → JWT, /overview /transactions /users /export.csv → 200, UI branded "Voodoo Land" (no other-brand text).
