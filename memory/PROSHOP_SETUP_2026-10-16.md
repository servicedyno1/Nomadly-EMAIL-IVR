# PROSHOP white-label — setup record (2026-10-16)

Fourth brand on the same droplet (`nomadly-prod-ams3`, 146.190.238.190), same code as Smadav/Voodoo
(branch `WhiteLabel`), branded only by its own `backend.env`.

## Runtime
- App: `app-proshop` — PM2 slots `app-proshop-a` :5004 / `app-proshop-b` :5104 (blue/green, `deploy.sh app-proshop`)
- Env: `/opt/nomadly/shared/app-proshop/backend.env` (built by `js/ops/proshop_env_build.py` from app-wl + overrides;
  PROSHOP-only secrets in `/root/proshop_secrets.env` (0600): bot token, Mongo URL, Dynopay key)
- Repo mirror: `/opt/nomadly/repo/app-proshop.git` (copy of app-voodoo.git), `shared/app-proshop/branch` = WhiteLabel
- nginx: `/etc/nginx/sites-available/proshop` (enabled by `/root/proshop_cert_watch.sh` once certs exist), upstream `app_proshop`
- Certs (LE, dns-cloudflare, ecdsa): `proshopivr.xyz`, `panel.proshophost.xyz` — issued by the watcher after .xyz delegation
- DB: own Railway Mongo (owner-supplied, Mongo 8.0.34), `DB_NAME=proshop`
- CI: `deploy.yml` job `deploy-proshop` (needs deploy-voodoo; `app=whitelabel` = wl → voodoo → proshop); sync-whitelabel dispatch text updated
- First releases: 20261016T124334Z-576d004 (b) → 20261016T125155Z-576d004 (a, active) — hot-patched with brand assets + APK
  (`patched=` in RELEASE) until "Save to GitHub" syncs main → WhiteLabel.

## Domains / DNS (OpenProvider, Cloudflare NS, **auto-renew OFF** per owner, expire 2027-10-16)
- `proshopivr.xyz` OP 30423411, CF zone c13803ebc100a1c443a3697f746aaef5 — A → droplet (dns-only): SELF_URL, webhooks, /call, /sms-app/download
- `www.proshopivr.xyz` → 301 https://proshopivr.xyz
- `sip.proshopivr.xyz` A 192.76.120.10 + SRV `_sip._udp/_sip._tcp` 5060, `_sips._tcp` 5061 → sip.telnyx.com
- `proshophost.xyz` OP 30423409, CF zone b62b004091cab34d0d1fafc3d59e97a4 — `panel.proshophost.xyz` A → droplet (HostPanel + storefront)
- `proshophost.xyz`, `www.proshophost.xyz` → 301 https://panel.proshophost.xyz
- Scripts: `js/ops/proshop_domains.js`, `js/ops/proshop_cf_dns.js` (idempotent, dry-run unless --apply)

## Accounts
- Own: Telegram bot @ProshopHQ_bot (id 8747245456), Mongo, Dynopay API key (validated getSupportedCurrency 200; wallet token / webhook secret unset)
- Shared with Nomadly: Telnyx account — own SIP connection 3071980031044486973, Call Control app 3071980044264933183,
  messaging profile 4001a144-b64b-4182-9f1b-fb47ad6d6766 (`js/ops/proshop_telnyx_setup.js`, ids in shared/app-proshop/telnyx_ids.json);
  OpenAI, EdenAI, Twilio (SIP prefix `proshop`), Cloudflare, OpenProvider, DigitalOcean, WHM (WHM_LICENSE_LIMIT=100), Safe Browsing
- Contabo / Railway keys blank (VPS = DigitalOcean only). Admin chat 5590563715 (shared) — must /start @ProshopHQ_bot.
- Support + channel: **@proshopHQ / https://t.me/proshopHQ** (owner-supplied).
- PHONE_SERVICE_ON=true (day one). HIDE_BECOME_RESELLER=false (💼 Reseller shown).
- Sales dashboard: https://proshopivr.xyz/sales — `SALES_DASHBOARD_PASSWORD` generated in the PROSHOP backend.env (kept across rebuilds).

## Brand
- `CHAT_BOT_BRAND="PROSHOP"` → slug `proshop`; accent #F59E0B (amber), bg #0f0d0a; "PS" mark + "PROSHOP" wordmark
- Sources rendered with PIL (`sms-app/brands/proshop/source-*.jpg`) → `scripts/brand_assets.py proshop`
- Assets: `sms-app/brands/proshop/*`, served at `/brand/{mark,wordmark,logo}.png` (`js/assets/brand/proshop`)
- SMS app: `com.proshop.sms` v2.8.0, `static/proshop-sms.apk` (+ backend/static), api base https://proshopivr.xyz
- Auto-promo: no `assets/promo/proshop` → text-only promos (no other brand's banner leaks)
- Fix: `sms-app/android/gradle/wrapper/gradle-wrapper.jar` was missing from the repo (APK builds failed) — restored official 8.2.1 jar.

## Verified
- Boot: webhook set (https://proshopivr.xyz/telegram/webhook, pinned IP), Telnyx resources wired to PROSHOP webhooks,
  number migration "0 migrated, 3 external skipped" (no other brand's numbers touched). Frontend bundle: PROSHOP + #F59E0B + @proshopHQ,
  0 Smadav/Voodoo strings. /brand/logo.png 200, /sms-app/download/info → PROSHOP SMS.
