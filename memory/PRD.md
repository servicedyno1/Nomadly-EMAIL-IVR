# PRD — Nomadly / CloudIVR / Smadav / Speechcue / Voodoo Land / ProShop

## Original Problem Statement
Multi-brand telecom platform with virtual numbers, IVR, call forwarding, voicemail, SIP extensions, AI receptionist, and customer-managed numbers. Brands: Nomadly, CloudIVR, Smadav/Speechcue, Voodoo Land, ProShop.

## Core Architecture
- **Frontend**: React (CRA + Craco) at `/app/frontend/`
- **Backend**: FastAPI (Python) at `/app/backend/` + Express/Node.js bot at `/app/js/`
- **Database**: MongoDB via `MONGO_URL`/`DB_NAME`
- **SIP Stack**: Self-hosted Kamailio SBC + Asterisk PBX + RTPengine on DigitalOcean (`nomadly-sip-1`)
- **Providers**: Bird (outbound/bulk), Telnyx (inbound DID), SignalWire (legacy), DIDWW (assessed), Zadarma (assessed), Multitel (assessed)

## What's Been Implemented

### Completed (Agent-Tested, Not User-Confirmed)
1. **Telnyx SIP inbound-only provider** — numbers, SIP trunk, Asterisk routing, 12/12 tests
2. **Customer migration from SignalWire** — 19 Nomadly + 3 Voodoo swapped
3. **AI migration to Bird/CallEngine** — outbound/inbound AI, RTP bridge, 25/25 tests
4. **Meechchop6 campaign** — caller ID migrated, Bird verified, resumed pending-only
5. **Bird AMD (answering machine detection)** — 16/16 tests, live machine detected
6. **Early campaign failure alerts** — Telegram when most of first 10 calls fail
7. **Spenza eSIM safeguard** — no auto-rebuy on provider failures, alert only (deployment unverified)
8. **Deployment verification** — deploy_verify.sh with retry and Telegram alerts

### Completed 2026-11-14
9. **Multitel DID provider assessment**
   - API credentials working (v3 REST API)
   - 99 countries, 17 no-paperwork, US 2,267 areas
   - US: $0 setup + $0.60/mo (cheaper than Telnyx)
   - Account needs ~$5 top-up to buy

10. **Inbound email pipeline (richard@cloudivr.net)**
    - MX record: cloudivr.net → receive.forge.rmta.net (Cloudflare)
    - Resend receiving enabled + verified
    - Webhook: cloudivr.net/api/cloudivr-web/email-inbound/webhook
    - Backend: `/app/js/cloudivr-web/inbound-email.js` (webhook + admin API)
    - Frontend: `/app/frontend/src/cloudivr/pages/admin/InboxAdmin.js`
    - Wired into AdminApp.js as "Inbox" tab
    - Local webhook test: ✅ stored in MongoDB
    - **Needs production deployment for live email flow**

11. **Zadarma number ordered** (+1 646 795 8069)
    - Status: "checking" (activation pending)
    - SIP forwarding configured to sip-tls.cloudivr.net:5061
    - Asterisk pjsip_zadarma.conf and dialplan created
    - Provider adapter built: `/app/js/zadarma/provider.js`

### Provider Comparison (US Local Numbers)
| Provider | Setup | Monthly | Inbound/min | Status |
|----------|-------|---------|-------------|--------|
| Telnyx | $1 | $1 | ~$0.01 | Active (current) |
| Multitel | $0 | $0.60 | $0.006 | Ready (needs top-up) |
| Zadarma | €0 | €3.20 | included | Number activating |
| DIDWW | varies | $1.20-$5 | varies | $0 balance, no setup |

## P0 — Immediate
- [ ] Top up Multitel account, buy test US number, test full SIP routing
- [ ] Deploy inbound email code to production
- [ ] Verify Zadarma number activation

## P1 — Next
- [ ] Build full Multitel provider adapter (search/buy/release/SIP)
- [ ] Wire Multitel into voice-service, Bird caller-ID, QuickIVR
- [ ] Country catalog in CloudIVR number selection (17 no-paperwork countries)
- [ ] Verify Spenza eSIM safeguard in production (deployment race)

## P2 — Backlog
- [ ] DIDWW implementation (when funded)
- [ ] VoIP.ms KYC completion
- [ ] AWS Chime SDK manual review
- [ ] Number porting from Telnyx to Multitel
- [ ] International number coverage expansion

## Key Files
- `/app/js/zadarma/provider.js` — Zadarma DID adapter
- `/app/js/zadarma/index.js` — Zadarma API client
- `/app/js/telnyx-sip.js` — Telnyx SIP adapter
- `/app/js/cloudivr-web/inbound-email.js` — Resend inbound email handler
- `/app/frontend/src/cloudivr/pages/admin/InboxAdmin.js` — Admin inbox UI
- `/app/ops/sip-server/asterisk/pjsip_zadarma.conf` — Zadarma SIP trunk config
- `/app/ops/sip-server/asterisk/extensions.conf` — Dialplan with from-zadarma context
- `/app/memory/zadarma_no_id_cities.csv` — Zadarma US/CA cities (no ID required)
- `/app/memory/zadarma_all_countries.csv` — Zadarma all-country availability

## 2026-11-14 — Prod admin login "busy or restarting" (RESOLVED in prod config)
- Root cause: Telnyx blocked both Telnyx accounts ("This user has been marked as blocked", since 2026-11-12 12:07 UTC). MAIL_PROVIDER=telnyx on all 4 brands → every app email failed (541+), incl. admin sign-in codes → /admin/login returned 502 → Cloudflare replaced it with its own page → UI showed generic "busy" text.
- Fix: droplet shared envs (app-main/wl/voodoo/proshop) → MAIL_PROVIDER=resend + RESEND_API_KEY (backups backend.env.bak-20261114T102347). All 4 redeployed via deploy.sh (call drain). Real Resend send from prod verified.
- Code (preview, needs Save to GitHub): app errors 502→503 in cloudivr-web admin-auth/ai/fax/leads/phone-auth so Cloudflare passes the real message.
- Open: Telnyx account block (inbound Telnyx numbers/SIP list failing). User chose to handle email only for now.
