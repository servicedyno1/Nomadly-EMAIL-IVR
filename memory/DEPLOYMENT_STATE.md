# Nomadly Droplet Deployment State

## DigitalOcean droplet (production target)
- Droplet name: `nomadly-prod-ams3`
- Droplet ID: `604420852`
- Region: `ams3` (Amsterdam)
- Size: `s-2vcpu-4gb` ($24/mo)
- Image: `ubuntu-24-04-x64`
- Public IP: `146.190.238.190`
- SSH key name: `nomadly-prod-ams3-deploy` (DO key id `59656597`)
- SSH private key: `/root/.ssh/nomadly_droplet` (also backed up base64 in `backend/.env` as `DROPLET_SSH_KEY_B64`)
- SSH access: `ssh -i /root/.ssh/nomadly_droplet root@146.190.238.190`

## Repo
- GitHub: `github.com/servicedyno1/Nomadly-EMAIL-IVR`
- Branches: `main` (brand #1), `WhiteLabel` (brand #2), 3rd instance TBD
- Deploy uses GitHub PAT (classic) supplied by user — stored only on droplet, never committed.

## Plan (3 Node apps on one droplet)
- app-main  -> PORT 5000 (branch main)      -> panel/webhook subdomain 1
- app-wl    -> PORT 5001 (branch WhiteLabel) -> panel/webhook subdomain 2
- app-3     -> PORT 5002 (TBD)               -> panel/webhook subdomain 3
- nginx reverse proxy (subdomain -> port) + catch-all for customer domains (route by Host)
- PM2 process manager, autostart on boot
- MongoDB: reuse existing external MONGO_URL from vault (DB_NAME=test = production data, 49 collections). Each extra brand should get its own DB_NAME.
- SSL: Cloudflare proxied (preferred) or certbot
- Node 22 + ffmpeg required. Puppeteer via external Browserless.

## Verified working (in Emergent workspace, vault creds)
- DigitalOcean token: OK (account active)
- Telnyx: OK (balance $8.99 USD)
- Twilio: OK (account "Speechcue", active)

## Domain-attach code change needed
- `js/rl-save-domain-in-server.js` currently uses Railway/Render custom-domain API.
- On droplet: replace with A-record -> droplet IP (146.190.238.190) via Cloudflare + nginx catch-all + Cloudflare TLS.

## Progress
- [x] Droplet provisioned (ams3, active)
- [x] Base server setup (Node22, nginx, PM2, ffmpeg)
- [x] Deploy app-main (production) — `/opt/nomadly/app-main`, PM2 `app-main`, port 5000, env at `backend/.env`
- [x] nginx + SSL (Let's Encrypt DNS-01 via Cloudflare) for `2.speechcue.com`; nginx proxies straight to Express → **no `/api` prefix on the droplet**
- [x] Telegram webhook LIVE (2026-09-28) — see "Telegram DNS-cache lesson" below
- [x] Twilio webhooks re-synced on boot (8 numbers); Telnyx voice app → `https://2.speechcue.com/telnyx/voice-webhook`, SMS profile → `/telnyx/sms-webhook`
- [x] `panel.2.hostbay.io` moved to droplet (CF A DNS-only → 146.190.238.190, LE cert `certbot --dns-cloudflare`, nginx `sites-available/panel-2-hostbay` → :5000)
- [x] Domain-attach code change (droplet-native) — see "Customer domains on the droplet"
- [x] Nomadly shortener customer domains migrated (7 live; 32 had no CF zone anymore; 20 repurposed by customers — untouched)
- [~] SMADAV (WhiteLabel): cloned to `/opt/nomadly/app-wl`, code patches applied (`scripts/apply_droplet_patches.py`), `backend/.env` written from the exact Railway SAMDAV vars + droplet overrides. NOT yet: npm install, frontend build, certs, nginx, DNS, PM2, push to `WhiteLabel`.
- [ ] 3rd instance — user said "repo Nomadly-EMAIL-IVR branch Whitelabel" (same as SMADAV?) — clarify

## Auto-deploy / CI-CD (2026-09-28)
- **Mechanism:** GitHub Actions → SSH → droplet (`git pull` + smart deps + `pm2 reload`). No extra service on the box; logs live in the repo's Actions tab.
- **Trigger:** push to `main` (and manual `workflow_dispatch`). WhiteLabel (`app-wl`) will be added to the workflow **after** app-wl is live under PM2.
- **Files (in repo):** `.github/workflows/deploy.yml` (runner job) + `scripts/droplet_deploy.sh` (canonical deploy logic). Executable copy installed on droplet at `/opt/nomadly/deploy.sh`.
- **GitHub Actions secrets (repo `servicedyno1/Nomadly-EMAIL-IVR`):** `DROPLET_SSH_KEY` (the existing `/root/.ssh/nomadly_droplet` deploy key), `DROPLET_SSH_KNOWN_HOSTS` (ssh-keyscan of the droplet, strict host-key check), `DROPLET_HOST=146.190.238.190`, `DROPLET_USER=root`. Created via the GitHub API with the user's classic PAT.
- **`deploy.sh` behaviour:** backs up any uncommitted tree (tracked diff → `.patch`, untracked → `.tgz` in `/opt/nomadly/deploy-backups/`) → `git fetch` + `git reset --hard origin/<branch>` → `npm install --omit=dev` **only when `package.json` changed** (root package-lock is NOT committed, so we key off `package.json`, matching `nixpacks.toml`) → frontend `npm install --legacy-peer-deps` + `npm run build` **only when the `frontend/` tree changed** → `pm2 reload <app> --update-env` (zero-downtime; never auto-starts a brand-new app). Verified: runner SSH path under strict host-key check ✓, deploy logic on a throwaway clone ✓, `bash -n` ✓.
- **Activation:** ships on the next "Save to GitHub". The first push adds the workflow AND the domain-save code together, so the first auto-deploy's `reset --hard` is a content no-op (droplet ≡ /app, sha1-verified). UFW already allows :22 from anywhere, so runners can reach the box.
- **To add WhiteLabel later:** add a `WhiteLabel` branch to `on.push.branches` + a `deploy-wl` job calling `bash /opt/nomadly/deploy.sh app-wl` (needs `app-wl` registered in PM2 first).

## Customer domains on the droplet (URL shortener "Activate" flow) — 2026-09-28
- `HOSTED_ON=droplet` makes `js/rl-save-domain-in-server.js` a facade: `saveDomainInServerRailway/removeDomainFromRailway/getExistingRailwayDNS/listRailwayCustomDomains` delegate to `js/droplet-domain-server.js`. Call sites unchanged.
- Attach = Cloudflare Origin CA cert (`cf-service.generateOriginCACert([d, *.d])`) → `/etc/nginx/nomadly-certs/<d>/` + nginx block `/etc/nginx/nomadly-domains/<d>.conf` (`server_name d *.d`, :80 + :443, proxy → `127.0.0.1:$DROPLET_APP_PORT`) → `nginx -t && systemctl reload nginx` → zone SSL `strict` (or `full` + fallback LE cert when Origin CA unavailable) → returns `{server: DROPLET_PUBLIC_IP, recordType:'A'}`; `domain-service.addShortenerCNAME` now writes a proxied apex **A** record when handed an IPv4 (removes stale Railway CNAME).
- "Shortener active" detection everywhere = `isShortenerDnsRecord(r)` (legacy Railway CNAME OR A == DROPLET_PUBLIC_IP). Reconciler upstream = nginx conf list.
- nginx.conf has `include /etc/nginx/nomadly-domains/*.conf;` (shared by all brands; each app writes blocks pointing to its own port).
- Env (app-main): `HOSTED_ON=droplet DROPLET_PUBLIC_IP=146.190.238.190 DROPLET_APP_PORT=5000 DROPLET_FALLBACK_CERT/KEY=/etc/letsencrypt/live/2.speechcue.com/…`. Optional: `CLOUDFLARE_ORIGIN_CA_KEY` (not set; Origin CA works with the global key for zones in the account).
- Migration tool: `node js/ops/droplet_migrate_shortener_domains.js --dry|--domain d|--all` (skips zones not in CF account, apex repurposed by customer; DNS-first then nginx). Unit tests: `js/tests/test_droplet_domain_server_2026-09.js` (10/10).
- ⚠️ Incident during first bulk run: blocks were written before DNS for zones that no longer exist → `ShortenerReconciler` (5-min tick) "healed" 8 of them (removed block, status `needs_reactivation`, Telegram notice to owner): huntingtononlinebanking.it, myyxct.org, carrssafddpt.de, secureonlinebanking.de, rsvpartygath.de, trssainusaa.de, novelle.icu, coinspotsupport.org. Those zones were already gone from Cloudflare (domains dead/moved), so the notice was accurate; script now checks zone liveness + does DNS first.
- Live now: bannerbank.sbs, coastcapitalsavings.app, wealthsimple-helpagent.com, onlinechaseportal.com, servicingmail.com, rbc-clientdashboard.com, verify-navy.com (all CF-proxied, strict, Origin CA).

## Telegram DNS-cache lesson (2026-09-28)
- Symptom: DNS for `2.speechcue.com` was correct everywhere (146.190.238.190) but `getWebhookInfo` showed `ip_address: 69.46.46.98` (Railway anycast) + `Wrong response from the webhook: 404`. Telegram caches the resolved webhook IP for hours after a host move; re-calling setWebhook alone does NOT refresh it.
- Fix: `setWebhook` with `ip_address=146.190.238.190` → delivery switched instantly (46 pending updates flushed).
- Made persistent: `js/_index.js` `setupTelegramWebhook` reads optional env `TELEGRAM_WEBHOOK_IP` and passes it as `ip_address`. Set on the droplet (`backend/.env` → `TELEGRAM_WEBHOOK_IP=146.190.238.190`). Same patch applied to the droplet checkout by hand (repo change lands on `main` at next "Save to GitHub"; droplet needs `git pull` after that — the manual patch is textually identical so the pull will be clean or trivially resolvable).
- For app-wl / app-3: set the same `TELEGRAM_WEBHOOK_IP` in their `.env`.
