# Ecosystem Rebuild Runbook — Nomadly / Smadav / Voodoo Land / PROSHOP + WHM hosting

> **Audience:** a future agent (or engineer) rebuilding the whole business on a **new DigitalOcean account**
> from scratch, or recovering after losing a droplet. Facts are as of **2026-10-16**.
> **Never print secret values** in chat/logs. All secrets live in the encrypted vault
> (`memory/nomadly.vault.enc`, unlock with `VAULT_PASSWORD=… bash scripts/vault.sh unlock` — passphrase is held by
> the owner and noted in `memory/test_credentials.md`) and in each brand's `/opt/nomadly/shared/<app>/backend.env`.
> Companion docs: `memory/DEPLOYMENT_STATE.md` (history), `memory/BLUEGREEN_DEPLOY_HANDOFF_2026-06.md` (deploy design),
> `memory/VOODOO_LAND_SETUP_2026-10-14.md` + `memory/PROSHOP_SETUP_2026-10-16.md` (worked brand bring-ups),
> `memory/CPANEL_TUNNEL_ROUTING.md`, `memory/DO_FIREWALL_LOCKDOWN.md`.

---

## 0. Golden rules

1. **One code base, many brands.** All 4 Node bots run the same repo (`servicedyno1/Nomadly-EMAIL-IVR`). Nomadly
   deploys branch `main`; every white-label (Smadav, Voodoo, PROSHOP) deploys branch `WhiteLabel` and is branded **only
   by its own `backend.env`**. Never hardcode a brand in code.
2. **Each brand = its own Telegram bot + its own MongoDB (or DB_NAME) + its own Dynopay key + its own domains.**
   Shared: Telnyx account, OpenAI, EdenAI, Cloudflare, OpenProvider, DigitalOcean, WHM box, Safe Browsing.
3. **Never point two brands at the same DB_NAME**, and never let two brands share a Telnyx Call Control app /
   messaging profile (the boot migration would steal numbers — guarded since 2026-10-14, keep it that way).
4. **Production env files are not in git.** They live at `/opt/nomadly/shared/<app>/backend.env` (0600) and are
   symlinked into every release. Back up before editing (`cp -p f f.bak.<reason>.<UTC-ts>`), edit with a script that
   preserves newlines (never `echo >>` / heredoc-append).
5. **Hot patches are lost on the next deploy** — anything patched directly on the droplet must also be in `/app` and
   shipped with "Save to GitHub". Never `git merge`/"Save to GitHub" onto `WhiteLabel` (it is fed by the sync workflow).
6. Reload one PM2 slot at a time and only at `/health` → `calls.total == 0`.

---

## 1. Ecosystem map

```
                        ┌──────────────────────── Cloudflare (1 account, ~310 zones) ────────────────────────┐
 Telegram users ──▶     │ brand infra domains (A, DNS-only → bot droplet)   customer hosting domains          │
                        │ customer shortener domains (proxied A → bot)       (CNAME → <tunnel>.cfargotunnel)  │
                        │ Workers: antired-challenge, nomadly-api-config     Tunnel ingress → WHM box          │
                        └───────────────┬─────────────────────────────────────────────────┬──────────────────┘
                                        │                                                 │
          ┌─────────────────────────────▼────────────────────────┐        ┌───────────────▼──────────────────────┐
          │ BOT DROPLET  nomadly-prod-ams3 (ams3, s-2vcpu-4gb-amd) │        │ WHM DROPLET  whm2-fra1 (fra1,         │
          │ Ubuntu 24.04 · Node 22 · nginx 1.24 · PM2 · certbot     │        │ s-2vcpu-4gb-120gb-intel) AlmaLinux 9 │
          │  app-main-{a,b}    :5000/5100  Nomadly   (branch main)  │  WHM   │ cPanel/WHM 138 · license 100 accts    │
          │  app-wl-{a,b}      :5001/5101  Smadav    (WhiteLabel)   │ API ──▶│ ea-php82/83 · AutoSSL (Let's Encrypt) │
          │  app-voodoo-{a,b}  :5003/5103  Voodoo    (WhiteLabel)   │ via    │ cloudflared (token mode) ──▶ CF tunnel│
          │  app-proshop-{a,b} :5004/5104  PROSHOP   (WhiteLabel)   │ tunnel │ DO firewall: only 22 + ICMP inbound   │
          │  app-hb   :5002  HostingBotNew (Python redirect bot)    │        └───────────────────────────────────────┘
          │  hosta-api / hosta-deploy-hook  (hosta.sh product)      │
          └───────┬──────────────────────────────────────────────────┘
                  │ MONGO_URL per brand (Railway Mongo)   Telnyx / Twilio / Dynopay / OpenAI / EdenAI / OpenProvider …
```

Separate droplet `dynopay-prod-ams3` (Dynopay gateway) exists on the same DO account — **not covered here**; document
it separately before any migration.

### 1.1 Brand inventory

| Brand | PM2 app (slots/ports) | Branch | DB | Bot | Webhook/SELF_URL host | Panel host | SIP | Support |
|---|---|---|---|---|---|---|---|---|
| Nomadly | `app-main` 5000/5100 | main | Railway Mongo, `DB_NAME=test` | @Nomadlybot | `2.speechcue.com` | `panel.2.hostbay.io` | — | (env) |
| Smadav | `app-wl` 5001/5101 | WhiteLabel | `DB_NAME=smadav` | (env) | `1.smadavspeech.com` | `1.panel.smadavhost.com` | — | (env) |
| Voodoo Land | `app-voodoo` 5003/5103 | WhiteLabel | own Railway Mongo, `voodoo` | @Voodoo_landbot | `voodooivr.xyz` | `panel.voodoohost.xyz` | `sip.voodooivr.xyz` | @Voodoo_land |
| PROSHOP | `app-proshop` 5004/5104 | WhiteLabel | own Railway Mongo, `proshop` | @ProshopHQ_bot | `proshopivr.xyz` | `panel.proshophost.xyz` | `sip.proshopivr.xyz` | @proshopHQ |
| HostingBotNew | `app-hb` 5002 | repo `HostingBotNew` / `Groupmessage` | Railway Postgres | redirect bot | `3.hostbay.io` | — | — | — |

Port **5002 is taken by app-hb** — new brands start at 5005 (+100 for slot b).

---

## 2. Accounts & credentials to have BEFORE starting

Grouped by service → env keys (names only; values from the vault / owner):

| Service | Env keys | Notes |
|---|---|---|
| DigitalOcean | `DIGITALOCEAN_API_TOKEN` | droplets, firewalls, VPS/RDP product |
| Telegram (per brand) | `TELEGRAM_BOT_TOKEN_PROD` (+`_DEV`), `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_DEV_CHAT_ID`, `TELEGRAM_NOTIFY_GROUP_ID`, `TELEGRAM_WEBHOOK_IP` | admin must /start each bot |
| MongoDB (per brand) | `MONGO_URL`, `DB_NAME` | Railway Mongo 8 |
| Cloudflare | `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY` (global key), `CF_TUNNEL_CNAME`, `CF_DISCOVERY_SYNC` | Origin CA works with the global key (Origin CA Service Keys were retired 2026-09-30 — don't use `CLOUDFLARE_ORIGIN_CA_KEY`) |
| WHM/cPanel | `WHM_HOST`, `WHM_IP`, `WHM_TOKEN`, `WHM_ROOT_PASSWORD`, `WHM_API_URL`, `CPANEL_API_URL`, `WHM_DROPLET_ID`, `WHM_SSH_USER`, `WHM_BOX_SSH_KEY_B64`, `WHM_LICENSE_LIMIT=100` | API goes through the CF tunnel hostnames |
| OpenProvider | `OPENPROVIDER_USERNAME`, `OPENPROVIDER_PASSWORD`, `NOMADLY_SERVICE_EMAIL` | contact handles' email = `hosta1@proton.me` |
| ConnectReseller / Namecheap | `API_KEY_CONNECT_RESELLER`, `CR_PANEL_*`, `NAMECHEAP_*` | CR returns 401 until droplet IP is whitelisted |
| Telnyx (shared) | `TELNYX_API_KEY`, `TELNYX_SIP_CONNECTION_ID`, `TELNYX_CALL_CONTROL_APP_ID`, `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_SIP_USERNAME/PASSWORD`, `TELNYX_DEFAULT_ANI`, `TELNYX_BLOCKED_ANI` | IDs are **per brand** |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SIP_DOMAIN_PREFIX` | prefix per brand |
| Payments (per brand) | `DYNO_PAY_API_KEY`, `DYNO_PAY_BASE_URL`, `DYNO_PAY_WALLET_TOKEN`, `DYNO_PAY_WEBHOOK_SECRET`, `API_KEY_BLOCKBEE`, `FINCRA_*` | |
| AI / TTS | `OPEN_API_KEY`, `APP_OPEN_API_KEY` (direct OpenAI TTS fallback), `EDENAI_API_KEY` | EdenAI is prepaid — watch credits |
| Email | `BREVO_API_KEY`, `MAIL_*`, `EV_WORKER_URL/SECRET` | `MAIL_RELAY_HOST` unset → no MX for hosting |
| VPS providers | `CONTABO_*`, `OVH_*`, `VULTR_API_KEY`, `AZURE_*`, `VPS_*` | Contabo creds were stale (invalid_client) |
| Misc | `GOOGLE_SAFE_BROWSING_KEY`, `BROWSER_WS_ENDPOINT` (Browserless), `RAPIDAPI_KEY`, `NEUTRINO_*`, `API_KEY_RAILWAY`, `RESELLER_DB_URL`, `SESSION_SECRET`, `SALES_DASHBOARD_PASSWORD` (white-labels use the owner standard), `WEBHOOK_CRON_SECRET` | |
| GitHub | `GITHUB_PAT_CLASSIC`, `GITHUB_REPO` | repo is PRIVATE; droplet fetches with a PAT in `/root/.git-credentials` |
| Droplet-only (prod env) | `PORT`, `DROPLET_PUBLIC_IP`, `DROPLET_APP_PORT`, `DROPLET_UPSTREAM`, `DROPLET_FALLBACK_CERT/KEY`, `HOSTED_ON=droplet`, `SELF_URL(_PROD)`, `WEBSITE_URL`, `RESELLER_BRANDED_NS_ENABLED` | must be rewritten for a new IP |

---

## 3. Phase A — new DigitalOcean account

1. Create the account/project, an API token (read+write) → `DIGITALOCEAN_API_TOKEN` in every brand env.
2. Generate two ed25519 keys (keep private halves in the vault as base64):
   - bot droplet ops/CI key → `DROPLET_SSH_KEY_B64` / `DROPLET_SSH_PUB` (also GitHub secret `DROPLET_SSH_KEY`)
   - WHM box root key → `WHM_BOX_SSH_KEY_B64` / `WHM_BOX_SSH_PUB`
3. Upload both public keys to DO; attach on droplet create.
4. Decide regions: current = bot **ams3**, WHM **fra1**. Enable DO backups if budget allows (currently OFF on both).

---

## 4. Phase B — WHM / cPanel hosting droplet (do this FIRST; bots depend on it)

**Spec now:** `s-2vcpu-4gb-120gb-intel`, AlmaLinux 9, hostname `<ip>.cprapid.com`, cPanel 138, 28 accounts, license tier
**100 accounts** (set `WHM_LICENSE_LIMIT=100` in every brand env — the code defaults to 30 when unset).

1. Create droplet (AlmaLinux 9). Install cPanel: `cd /home && curl -o latest -L https://securedownloads.cpanel.net/latest && sh latest`.
   Buy/attach the cPanel license for the new IP (license is IP-bound — moving IP = re-issue).
2. WHM basics: nameservers irrelevant (DNS is Cloudflare); enable **AutoSSL (Let's Encrypt)**; EasyApache with
   **ea-php82 + ea-php83** (PHP-FPM); WP Toolkit (installed).
3. Create the hosting **packages** (names are referenced by the bots' plan mapping — keep them exact):
   `Golden-Anti-Red-HostPanel-1-Month`, `Premium-Anti-Red-1-Week`, `Premium-Anti-Red-HostPanel-1-Month` (+ `default`).
4. WHM API token (root, full ACL) → `WHM_TOKEN`; root password → `WHM_ROOT_PASSWORD`.
5. **Cloudflare Tunnel** on the box (token mode):
   - CF dashboard → Zero Trust → Tunnels → create → copy token → on the box:
     `cloudflared service install <TOKEN>` (systemd `ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token …`).
   - Ingress (dashboard, "published application routes"):
     - `cpanel-api.hostbay.io` → `https://localhost:2083` (noTLSVerify, httpHostHeader `localhost`)
     - `whm-api.hostbay.io` → `https://localhost:2087` (same options)
     - catch-all → `http://localhost:80` (customer sites; the box's Apache/cPanel vhosts)
   - DNS: proxied CNAMEs `cpanel-api.hostbay.io`, `whm-api.hostbay.io` → `<TUNNEL_ID>.cfargotunnel.com`.
   - Set `CF_TUNNEL_CNAME=<TUNNEL_ID>.cfargotunnel.com`, `WHM_API_URL=https://whm-api.hostbay.io`,
     `CPANEL_API_URL=https://cpanel-api.hostbay.io` in every brand env. Current tunnel CNAME:
     `b395cebc-4b7a-4aba-8ced-e11665c26b30.cfargotunnel.com`.
6. **DO Cloud Firewall** (`hostbay-tunnel-only`): inbound **tcp/22 + ICMP only**, outbound all. 80/443/2083/2087/mail
   stay closed — everything reaches the box through the tunnel. (OS firewall csf/firewalld: inactive.)
7. Root SSH key for ops (`WHM_BOX_SSH_PUB` in `/root/.ssh/authorized_keys`) — used by
   `js/ops/whm_fpm_orphan_sweep.js` and RCAs.
8. **Moving existing customers:** WHM → Transfer Tool from the old box (or `/scripts/pkgacct <user>` +
   `/scripts/restorepkg`) — keep cPanel usernames identical (Mongo `cpanelAccounts._id` = cPanel user). Afterwards
   `/scripts/php_fpm_config --rebuild` and restart `ea-php8x-php-fpm` (orphan pool configs kill a whole PHP master).
9. Update every brand env: `WHM_HOST`, `WHM_IP`, `WHM_DROPLET_ID`, then reload bots.

Hosting domain pattern created by the bots: CF zone → `@` and `www` CNAME (proxied) → `CF_TUNNEL_CNAME`, SSL Full, AOP on,
Anti-Red worker routes, Origin CA cert installed on cPanel (self-heal in `protection-enforcer.js` `ensureOriginCert`).

---

## 5. Phase C — Bot droplet

**Spec now:** `s-2vcpu-4gb-amd`, Ubuntu 24.04, ams3. RAM headroom: each Node bot ≈165 MB; frontend builds are
memory-heavy (the 2 GB swap matters); deploys are serialised.

### 5.1 Base setup (`/root/01-base-setup.sh` on the current box — reproduce):
```bash
apt-get update -y && apt-get install -y curl git build-essential ffmpeg nginx ufw ca-certificates gnupg \
  certbot python3-certbot-dns-cloudflare dnsutils
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs     # Node 22.x
npm install -g yarn pm2 && pm2 startup systemd -u root --hp /root && pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 7 && pm2 set pm2-logrotate:compress true
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && yes | ufw enable
# keep unattended-upgrades but never let needrestart bounce PM2 mid-day:
cat > /etc/needrestart/conf.d/90-nomadly-pm2.conf <<'EOF'
$nrconf{override_rc}{qr(^pm2-root\.service$)} = 0;
EOF
```
Cloudflare DNS-01 credentials for certbot: `/root/.cloudflare.ini` (0600) with `dns_cloudflare_email` +
`dns_cloudflare_api_key` (global key). certbot.timer handles renewals.

### 5.2 Layout (`/opt/nomadly`)
```
deploy.sh                       ← copy of scripts/droplet_deploy.sh (self-updates after each app-main deploy)
repo/<app>.git                  ← bare mirrors (git clone --mirror https://github.com/servicedyno1/Nomadly-EMAIL-IVR.git)
shared/<app>/backend.env        ← the brand's env (0600)          shared/<app>/branch ← "main" or "WhiteLabel"
releases/<app>/<ts>-<sha>/      ← immutable releases (newest 3 kept)   current/<app> → active release
logs/deploy-<app>.log
```
Private repo fetch: `git config --global credential.helper store` + `/root/.git-credentials` with a PAT
(prefer a fine-grained read-only token or a deploy key over the old classic PAT).

### 5.3 nginx
- `/etc/nginx/nginx.conf` http{} must include: `conf.d/*.conf`, `sites-enabled/*`, **`/etc/nginx/nomadly-domains/*.conf`**
  (customer shortener domains written by the bots; certs in `/etc/nginx/nomadly-certs/<domain>/`).
- `/etc/nginx/conf.d/nomadly-upstreams.conf` — one line per app; `deploy.sh` rewrites the port on every flip:
  ```
  upstream app_main { server 127.0.0.1:5000; }
  upstream app_wl { server 127.0.0.1:5001; }
  upstream app_voodoo { server 127.0.0.1:5003; }
  upstream app_proshop { server 127.0.0.1:5004; }
  ```
- One site per brand in `sites-available/<brand>` (enabled via symlink). Template (PROSHOP):
  ```nginx
  server { listen 80; listen [::]:80; server_name <ivr-host>;
           location /.well-known/acme-challenge/ { root /var/www/html; } location / { return 301 https://$host$request_uri; } }
  server { listen 443 ssl; listen [::]:443 ssl; server_name <ivr-host>;
           ssl_certificate /etc/letsencrypt/live/<ivr-host>/fullchain.pem; ssl_certificate_key /etc/letsencrypt/live/<ivr-host>/privkey.pem;
           ssl_protocols TLSv1.2 TLSv1.3; client_max_body_size 60M;
           location / { proxy_pass http://app_<slug>; proxy_http_version 1.1; proxy_set_header Host $host;
             proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
             proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
             proxy_read_timeout 300s; proxy_connect_timeout 60s; } }
  # …same two blocks again for <panel-host>
  ```
  Nomadly's file also holds the `server_name _` default. Other sites: `panel-2-hostbay`, `smadav`, `voodoo`, `proshop`,
  `3-hostbay` (app-hb via `snippets/proxy-app-hb.conf`), `hosta` (hosta.sh via `snippets/hosta-app.conf`).
- Certs (DNS-01, one per host):
  `certbot certonly --non-interactive --agree-tos --dns-cloudflare --dns-cloudflare-credentials /root/.cloudflare.ini --dns-cloudflare-propagation-seconds 25 --key-type ecdsa -d <host>`
  Current: `2.speechcue.com`, `panel.2.hostbay.io`, `1.smadavspeech.com`, `1.panel.smadavhost.com`, `voodooivr.xyz`,
  `panel.voodoohost.xyz`, `proshopivr.xyz`, `panel.proshophost.xyz`, `3.hostbay.io`, `hosta.sh`.

### 5.4 Deploy engine (`deploy.sh <app> [status|rollback [dir]]`)
Blue/green: `git archive` the branch head into a new release → symlink `backend/.env` → reuse/hardlink deps if
`package.json`/frontend tree+REACT_APP env unchanged, else `npm install --omit=dev` + CRA build → start the **idle** slot
(`<app>-a` = `PORT`, `<app>-b` = `PORT+100`) → wait `/health` = healthy → drain live calls (cap 30 min) → rewrite the
upstream line + `nginx -t` + reload → stop old slot → Telegram ✅/❌ to the brand admin. A failure never touches the
active release. A brand-new app's first run: `bash /opt/nomadly/deploy.sh <app>` by hand.

### 5.5 Other processes on the bot droplet
- **app-hb** — Python FastAPI redirect bot; code MUST live at `/app` (hardcoded), venv `/app/venv`, `/app/run.sh` →
  `uvicorn backend.server:app --host 127.0.0.1 --port 5002`, env `/app/.env`, Railway Postgres `DATABASE_URL`,
  public `3.hostbay.io`, webhook `/api/webhook/telegram`.
- **hosta.sh** — `/opt/hosta` (backend `hosta-api` → `/opt/hosta/backend/bin/www`, `hosta-deploy-hook`
  `/opt/hosta/bin/deploy-hook.js`, own `deploy.sh`, cron `0 9 * * * /opt/hosta/bin/cron-usage-alerts.sh`), nginx site
  `hosta`, cert `hosta.sh`. Emergent cron `ns-pilot-tick` (hourly, `.emergent/crons.yml`) monitors its vanity NS pilot.
- `pm2 save` after any process change (resurrect on reboot is enabled).

---

## 6. Phase D — Cloudflare (single account)

- Account id currently `ed6035ebf6bd3d85f5b26c60189a21e2` — **hardcoded** in `js/anti-red-service.js` (3×),
  `js/cloudflare-discovery-sync.js`, `js/honeypot-service.js`, `js/_index.js` and `js/ops/cf_tunnel_bridge_verify.js`.
  A new CF account means replacing it in all of them (`grep -rn ed6035ebf6bd3d85f5b26c60189a21e2 js/`), ideally moving
  it to an env var (`CLOUDFLARE_ACCOUNT_ID`) first.
- Workers: **`antired-challenge`** (per-zone routes added by the bots for hosting domains) and
  **`nomadly-api-config`** (`https://nomadly-api-config.nomadly-cfg.workers.dev/`, brand-keyed discovery for the SMS
  apps; each bot re-publishes it on boot when `CF_DISCOVERY_SYNC=true`).
- Infra zones per brand: IVR domain + host-panel domain, records **DNS-only A → bot droplet IP**; www/root redirects
  via dynamic redirect rules; SSL mode Full. SIP host: `A sip.<ivr> 192.76.120.10` + SRV `_sip._udp/_sip._tcp` 5060 and
  `_sips._tcp` 5061 → `sip.telnyx.com`. Scripts: `js/ops/<brand>_cf_dns.js`.
- `hostbay.io` zone holds the tunnel API hostnames and `panel.2.hostbay.io` / `3.hostbay.io`.

---

## 7. Phase E — Data

- One Railway MongoDB per brand (Mongo 8). Nomadly prod data is `DB_NAME=test` (~49+ collections). Migrate with
  `mongodump --uri "$OLD" --db <name>` → `mongorestore --uri "$NEW" --nsInclude '<name>.*'`.
- app-hb: Railway Postgres. Reseller API: `RESELLER_DB_URL`.
- The Emergent preview pod uses a LOCAL Mongo by design (sandbox isolation) — prod `MONGO_URL` only in the vault.

---

## 8. Phase F — GitHub & CI

- Repo `servicedyno1/Nomadly-EMAIL-IVR` (private). Branches: `main` (Nomadly + source of truth), `WhiteLabel`.
- Actions secrets: `DROPLET_HOST`, `DROPLET_USER=root`, `DROPLET_SSH_KEY` (private ops key),
  `DROPLET_SSH_KNOWN_HOSTS` (`ssh-keyscan <ip>`). **Update all four for a new droplet.**
- Workflows:
  - `deploy.yml` — push to `main` → `deploy-main`; push to `WhiteLabel` → `deploy-wl` → `deploy-voodoo` →
    `deploy-proshop` (chained, never two builds at once); manual dispatch `app=` `app-main|app-wl|app-voodoo|app-proshop|whitelabel|both`.
    Docs-only pushes (`memory/**`, `**.md`, …) are ignored.
  - `sync-whitelabel.yml` + `scripts/sync_whitelabel.py` — on every runtime push to `main`, brand-safe 3-way sync
    main → WhiteLabel, then dispatches `deploy.yml app=whitelabel`. Pause with repo variable `WL_AUTO_SYNC=false`.
  - `lint.yml`.
- Adding a brand to CI: copy the `deploy-proshop` job (needs the previous brand job), add the app to the dispatch
  options and the `whitelabel` chain text in `sync-whitelabel.yml`.

---

## 9. Phase G — bring up ONE white-label brand (the proven recipe, ~1 h)

Use the PROSHOP scripts as templates: copy `js/ops/proshop_{domains.js,cf_dns.js,telnyx_setup.js,env_build.py}` to
`<slug>_*`, change the constants (domains, names, ports, accent, support). Run JS ops scripts from inside the **active
app-main release** on the droplet (`cd $(readlink -f /opt/nomadly/current/app-main) && node js/ops/<script> [--apply]`).

1. **Inputs from owner:** brand name, bot token (BotFather), Mongo URL, Dynopay key, 2 domains (IVR + host panel),
   support/channel handle, phone on/off, reseller button on/off, auto-renew choice.
2. **Validate:** bot `getMe`; Mongo ping/listDatabases (should be empty); Dynopay `GET /api/user/getSupportedCurrency` = 200;
   domain availability via `op.checkDomainAvailability`.
3. **Domains:** `<slug>_domains.js --apply` → CF zones + OpenProvider registration with CF NS (`registerDomain`
   defaults `autorenew: off`), CF SSL Full.
4. **DNS:** `<slug>_cf_dns.js --apply`.
5. **Droplet scaffold:** `mkdir shared/app-<slug>` + `branch`=`WhiteLabel`; `cp -a repo/app-voodoo.git repo/app-<slug>.git`
   + fetch; upstream line `upstream app_<slug> { server 127.0.0.1:<port>; }`; nginx site from template (do **not**
   enable until certs exist).
6. **Telnyx:** `<slug>_telnyx_setup.js` → own SIP connection + Call Control app + messaging profile on the shared account
   (`OVP 2897375459551478845`), ids → `shared/app-<slug>/telnyx_ids.json`.
7. **Env:** secrets in `/root/<slug>_secrets.env` (0600) → `python3 <slug>_env_build.py` (from app-wl + overrides; prints
   any leftover other-brand strings — must be `none`). Sales dashboard password = owner standard.
8. **Brand assets:** render `sms-app/brands/<slug>/source-{mark,wordmark}.jpg` (PIL; dark square + accent monogram, accent
   wordmark on white) → `python3 scripts/brand_assets.py <slug>` → `js/assets/brand/<slug>/{mark,wordmark,logo}.png`;
   add `icon.png` 640×640 for the BotFather avatar (served at `https://<panel>/brand/icon.png`); add the brand to
   `sms-app/brands/brands.json`.
9. **SMS APK:** `bash scripts/build_apk.sh <slug>` (aarch64 pod; installs JDK/SDK; needs
   `sms-app/android/gradle/wrapper/gradle-wrapper.jar` — restored 2026-10-16) → `static/<slug>-sms.apk` (+json, +backend/static).
10. **Certs:** wait for registry delegation (`.xyz` took ~35 min), then certbot per host; enable site; `nginx -t && reload`.
    `/root/proshop_cert_watch.sh` automates wait → certs → enable.
11. **First deploy:** `bash /opt/nomadly/deploy.sh app-<slug>`; until "Save to GitHub" + WhiteLabel sync ship the
    brand files, extract them into the release and restart the slot.
12. **CI job** (Phase F), **Save to GitHub**, then owner /starts the bot from the admin chat and sets the avatar
    (`/setuserpic`).
13. **Verify:** `/health` healthy; boot log shows webhook set + Telnyx migration "0 migrated, N external skipped";
    public `https://<ivr>/health`, panel 200, `/brand/logo.png` 200, `/sms-app/download/info` = brand, redirects 301,
    `POST /admin/sales/login` 200, Telegram `getWebhookInfo` no errors; bundle contains no other brand strings.

---

## 10. Phase H — moving everything to a NEW DigitalOcean account (cut-over order)

1. Lower TTLs is unnecessary for proxied records; DNS-only infra records use TTL 300.
2. Build the **WHM box** (Phase B), transfer all cPanel accounts, create a **new tunnel** (or move the token), point
   every hosting zone's `@`/`www` CNAME to the new `<tunnel>.cfargotunnel.com` (bulk script over `cpanelAccounts`),
   update `CF_TUNNEL_CNAME`/`WHM_*` in all envs.
3. Build the **bot droplet** (Phase C), copy `/opt/nomadly/shared/*`, `/root/*_secrets.env`, `/root/.cloudflare.ini`,
   `/etc/nginx/{sites-available,conf.d,nomadly-domains,nomadly-certs,snippets}`, `/etc/letsencrypt` (or re-issue),
   `/opt/hosta`, `/app` (app-hb). Rewrite in every env: `DROPLET_PUBLIC_IP`, `TELEGRAM_WEBHOOK_IP`, `WHM_*`.
4. First-deploy each app by hand (`deploy.sh <app>`), `pm2 save`.
5. Flip DNS-only A records of every infra host (and proxied customer shortener domains) to the new IP.
6. Telegram: each bot calls `setWebhook` with `ip_address=TELEGRAM_WEBHOOK_IP` on boot — Telegram caches the old IP
   for hours otherwise. Telnyx/Twilio webhooks are re-synced on boot from `SELF_URL`.
7. Update GitHub secrets (`DROPLET_HOST`, `DROPLET_SSH_KNOWN_HOSTS`, key), ConnectReseller IP whitelist, any provider
   IP allow-lists (Dynopay webhook, OpenProvider API IP restrictions if enabled).
8. Verify every brand (Phase G step 13) + a hosting site per brand + one inbound/outbound call + an SMS.
9. Keep the old droplets powered off (not destroyed) for 7 days.

---

## 11. Monitoring built into the bots (no extra setup)
`/health` (status, database, calls.total, slot), BalanceMonitor (Telnyx, Twilio, **EdenAI** credits, 2 h),
WhmDiskMonitor (disk + license `accounts=N/LIMIT`, 6 h), WhmAccountDigest (daily), ProtectionEnforcer (6 h:
SSL/AOP/Origin CA self-heal/anti-red), DnsHealer, cPanel Health, ShortenerReconciler (5 min), deploy notices.
Alerts go to `TELEGRAM_ADMIN_CHAT_ID` of each brand.

---

## 12. Gotchas that already cost time (read before touching prod)
- Telegram caches webhook IPs → always set `TELEGRAM_WEBHOOK_IP`.
- needrestart/unattended-upgrades used to bounce PM2 (fixed by the drop-in above). DO hypervisor reboots happen —
  PM2 resurrect handles it.
- Removing cPanel accounts without `removeacct` leaves orphan PHP-FPM pools → whole ea-php8x master fails → 503 on every
  site of that PHP version. Use `js/ops/whm_fpm_orphan_sweep.js --confirm`.
- Origin CA cert requested while a new CF zone is still activating fails with "zone not part of your account" — the
  enforcer self-heals later; don't chase `CLOUDFLARE_ORIGIN_CA_KEY`.
- `.it` registrations need the owner-handle email verification (handles now use `hosta1@proton.me`).
- EdenAI is prepaid; at $0 every TTS call 402s → bots fall back to direct OpenAI (`APP_OPEN_API_KEY`) and alert.
- `WHM_LICENSE_LIMIT` must match the purchased license or alerts show the wrong cap.
- Blue/green slot names flip (`-a`/`-b`) on each deploy — always resolve the live slot from the upstream file/`pm2 jlist`.
- Hot patches vanish on the next deploy; the WhiteLabel branch only gets code via the sync workflow.
- `log-redact.js` masks domains/tokens in ops-script output (`***`) — expected.
- Promo banners: `js/assets/promo/<brand>/`; brands without a folder get text-only promos (no cross-brand leak).
- Security debt: the repo was public until 2026-10-03 with vault + passphrase doc → rotate all secrets and re-lock the
  vault with a new passphrase when rebuilding; replace the over-scoped classic PAT.
