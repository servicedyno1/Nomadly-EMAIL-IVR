# SMADAV `.it` silent domain swap — 2026-10-16 (DONE)

## Problem
SMADAV user chatId 8514352552 (cPanel `nsan2e0c`, Golden Anti-Red HostPanel 1-Month, $130 wallet) ordered hosting on
`73sandoresworld.it` (2026-10-16 08:59Z). OpenProvider kept it in `REQ` because the .it registrant-verification email went to
the owner handle `MR971932-IT` email `cloakhost@tutamail.com` (mailbox lost). DnsHealer escalated ("prohibited for current
domain status"). Owner approved: silently swap to `72sandoresworld.it` + change OP email to `hosta1@proton.me`.

## Executed (ops script `memory/ops/smadav_it_swap_exec.js`, run inside the app-wl release with its shared env)
| step | result |
|---|---|
| email | OP `MR971932-IT` email cloakhost@tutamail.com → hosta1@proton.me (verified GET) |
| cancel_old | OP DELETE domain 30421768 (73sandoresworld.it) → code 0, no longer in account |
| register_new | `domainService.registerDomain('72sandoresworld.it','OpenProvider','cloudflare')` → CF zone 0e19f39f2e34c509a184dde5b02ae067 (anderson/leanna), NAST 2/2 in 4s, OP id **30422145** (status REQ until .it verification is clicked in hosta1@proton.me) |
| whm_swap | WHM `modifyacct` nsan2e0c → domain 72sandoresworld.it ✅; `cpanelAccounts` domain/previousPrimaryDomain/primaryChangedAt/primarySwapReason; `hostingTransactions` + `transactions` (TXN-20261016-BB5B4 metadata) domain → new, `originalDomain` kept; old `registeredDomains`/`domainsOf`/`dnsHealState`/`safeBrowsingFlags` rows removed; `nsAuditLog` row `silent_primary_swap` |
| dns | old CF zone 6b54f670… deleted (3 Anti-Red routes removed first); `addonFlow.runDnsAndProtection` (bot=null → no user DMs): tunnel CNAMEs @ + www, HTTPS, AOP, hardened Anti-Red worker + .htaccess |
| verify | all consistent (WHM, OP, CF, Mongo); no leftover refs to the old domain except audit fields |

No message was sent to the customer. Same cPanel username/PIN/files.

## Follow-ups / notes
- ⚠️ Owner must click the .it verification link sent to **hosta1@proton.me**; until then the domain stays REQ (no public DNS).
- Origin CA cert step skipped ("zone not part of your account") — pre-existing: `CLOUDFLARE_ORIGIN_CA_KEY` not set; SSL mode stays flexible+AOP.
- `MAIL_RELAY_HOST` unset → no MX for hosting domains (pre-existing, all brands).
- All OP handles on cloakhost@tutamail.com moved to hosta1@proton.me (owner request) via `memory/ops/op_handles_email_bulk.js` → 0 left on old, 181 on new (HS932003-US client-timeout but applied).
