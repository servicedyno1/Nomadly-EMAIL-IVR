# Email Blast System — Credentials & Configuration Reference

## 1. VPS / Mail Server (Contabo)

| Key | Value |
|-----|-------|
| **VPS Host (IP 1)** | `5.189.166.127` |
| **VPS Host (IP 2)** | `109.199.115.95` |
| **SSH User** | `root` |
| **SSH Password** | `<REDACTED — see server SSH creds in backend/.env>` |
| **OS** | Linux (Postfix + OpenDKIM) |

## 2. Postfix / SMTP

| Key | Value |
|-----|-------|
| **SMTP User** | `nomadlybot@mail.tracking-assist.com` |
| **SMTP Password** | `<REDACTED>` |
| **DKIM Selector** | `mail2025` |
| **SMTP Port** | `25` (direct Postfix delivery) |

## 3. Sending Domains

| Domain | Notes |
|--------|-------|
| `tracking-assist.com` | Primary sending domain (IP 1) |
| `efirstportal.com` | Secondary domain (IP 2 — pending Gmail DNS cache resolution) |

## 4. Cloudflare (DNS Management)

| Key | Value |
|-----|-------|
| **Email** | `expressdrop247@gmail.com` |
| **API Key** | `<REDACTED — CLOUDFLARE_API_KEY in backend/.env>` |
| **Env Vars** | `CLOUDFLARE_EMAIL`, `CLOUDFLARE_API_KEY` in `backend/.env` |

## 5. Brevo (Test Email Sending)

| Key | Value |
|-----|-------|
| **API Key** | `<REDACTED — BREVO_API_KEY in backend/.env>` |
| **SMTP Host** | `smtp-relay.brevo.com` |
| **SMTP Port** | `587` |
| **SMTP User** | `76a914001@smtp-brevo.com` |
| **SMTP Password** | `<REDACTED — MAIL_AUTH_PASSWORD in backend/.env>` |
| **Sender Address** | `hosting@priv.host` |
| **Env Vars** | `BREVO_API_KEY`, `MAIL_DOMAIN`, `MAIL_PORT`, `MAIL_AUTH_USER`, `MAIL_AUTH_PASSWORD`, `MAIL_SENDER` in `backend/.env` |

## 6. Telegram Bot

| Key | Value |
|-----|-------|
| **Bot Token** | `<REDACTED — TELEGRAM_BOT_TOKEN_PROD in backend/.env>` |
| **Admin Chat ID** | `5590563715` |
| **Env Vars** | `TELEGRAM_BOT_TOKEN_PROD`, `TELEGRAM_ADMIN_CHAT_ID` in `backend/.env` |

## 7. MongoDB

| Key | Value |
|-----|-------|
| **Connection URL** | `<REDACTED — MONGO_URL in backend/.env>` |
| **DB Name** | `test` |
| **Env Vars** | `MONGO_URL`, `DB_NAME` in `backend/.env` |

### Email Blast Collections
| Collection | Purpose |
|------------|---------|
| `emailCampaigns` | Campaign records (subject, content, recipients, status, stats) |
| `emailDomains` | Sending domains (domain, dkimKey, assignedIps, status) |
| `emailSuppressions` | Suppressed/bounced addresses |
| `emailSettings` | Global email blast settings (pricing, rate limits) |
| `emailIpWarming` | IP warming stage tracking (dailySent, hourlySent, stage) |

## 8. IP Warming Schedule (8 Stages)

| Stage | Days | Daily Limit | Hourly Limit |
|-------|------|-------------|--------------|
| Seed | 1–3 | 20 | 5 |
| Foundation | 4–7 | 50 | 10 |
| Ramp-up | 8–14 | 100 | 20 |
| Building | 15–21 | 300 | 50 |
| Scaling | 22–30 | 800 | 120 |
| Maturing | 31–45 | 2,000 | 300 |
| Warm | 46–60 | 5,000 | 750 |
| Full | 61+ | 10,000 | 1,500 |

## 9. Default Email Blast Settings

| Setting | Value |
|---------|-------|
| **Price Per Email** | $0.10 |
| **Min Emails** | 500 |
| **Max Emails** | 5,000 |
| **Global Rate/Min** | 25 |

## 10. Key Files

| File | Purpose |
|------|---------|
| `/app/js/email-blast-service.js` | Core sending engine (campaigns, queue, SMTP, DKIM, IP rotation) |
| `/app/js/email-warming.js` | 8-stage IP warming schedule & limit enforcement |
| `/app/js/email-validation.js` | Recipient email validation |
| `/app/js/email-dns.js` | Cloudflare API wrapper for DNS record management |
| `/app/js/email-config.js` | Action constants for the email blast feature |
| `/app/js/spintax.js` | Spintax processor for content uniqueness |
| `/app/js/disposable-domains.json` | Throwaway domain blocklist for validation |
| `/app/backend/.env` | All environment variables |

## 11. DNS Records Required Per Domain

For each sending domain, the following records must exist:

| Record Type | Name | Value/Purpose |
|-------------|------|---------------|
| **A** | `mail.domain.com` | Points to VPS IP |
| **MX** | `domain.com` | `mail.domain.com` (priority 10) |
| **TXT (SPF)** | `domain.com` | `v=spf1 ip4:<IP1> ip4:<IP2> ~all` |
| **TXT (DKIM)** | `mail2025._domainkey.domain.com` | DKIM public key |
| **TXT (DMARC)** | `_dmarc.domain.com` | `v=DMARC1; p=none; ...` |
| **PTR** | Set at VPS provider (Contabo) | Reverse DNS for each IP |

## 12. Resolved Issues

| Issue | Status |
|-------|--------|
| IP2 (`109.199.115.95`) Gmail delivery — SPF/DKIM `none` | ✅ DNS cache resolved — SPF/DKIM/DMARC all resolving correctly. `getTransporter` fixed to route through correct IP. |
| Email Blast menu missing in FR/ZH/HI languages | ✅ Fixed — emailBlast button + virtualCard button added to all language keyboards |
