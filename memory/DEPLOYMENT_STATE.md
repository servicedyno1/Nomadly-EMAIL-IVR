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
- [ ] WhiteLabel + 3rd instance
- [ ] Domain-attach code change

## Telegram DNS-cache lesson (2026-09-28)
- Symptom: DNS for `2.speechcue.com` was correct everywhere (146.190.238.190) but `getWebhookInfo` showed `ip_address: 69.46.46.98` (Railway anycast) + `Wrong response from the webhook: 404`. Telegram caches the resolved webhook IP for hours after a host move; re-calling setWebhook alone does NOT refresh it.
- Fix: `setWebhook` with `ip_address=146.190.238.190` → delivery switched instantly (46 pending updates flushed).
- Made persistent: `js/_index.js` `setupTelegramWebhook` reads optional env `TELEGRAM_WEBHOOK_IP` and passes it as `ip_address`. Set on the droplet (`backend/.env` → `TELEGRAM_WEBHOOK_IP=146.190.238.190`). Same patch applied to the droplet checkout by hand (repo change lands on `main` at next "Save to GitHub"; droplet needs `git pull` after that — the manual patch is textually identical so the pull will be clean or trivially resolvable).
- For app-wl / app-3: set the same `TELEGRAM_WEBHOOK_IP` in their `.env`.
