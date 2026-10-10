# Reseller API feature requests from hosta.sh (received 2026-10-10)

Reseller confirmed after our deploy:
- namewords.sbs restored (new cfRecordIds 855e05f6… / baed3778…); dns/repair dry-run = ok.
- Honeypot now resolves to name65fb.
- They deleted the failed duplicates name1d6a / name303c themselves; cloudflare_cleanup = kept_in_use_by_another_account. We re-checked via 1.1.1.1 DoH on 2026-10-10: apex + www still resolve. The namewords incident is CLOSED.

Our notes: "Verified" = checked in our code on 2026-10-10. Effort: S < 1 day, M 1–3 days, L > 3 days or infra.

## Still open from earlier reports (bugs)
1. **Blacklist false positive.** security/status shows blacklist.listed:true for 172.67.199.112 (a shared CF anycast IP) on zen.spamhaus.org.
   VERIFIED in `js/safe-browsing-service.js` ~L60-100: it resolves the DOMAIN (so it gets the CF edge IP, not the origin) and counts ANY A answer as "listed", including 127.255.255.25x ("public resolver refused").
   Fix: only count 127.0.0.2–127.0.0.255 return codes, excluding 127.255.255.x. Check the origin IP (WHM_HOST / account server_ip) instead of the edge IP. Effort S.
2. **Safe Browsing not configured.** safeBrowsing.error "GOOGLE_SAFE_BROWSING_KEY not configured". VERIFIED: the env var is missing.
   Needs a Google Safe Browsing API key from the owner (Google Cloud console). Config only, then a redeploy. Effort S.

## P0 — biggest effect on retention
3. **Expiry & health webhooks.** Today the first expiry event is grace_start, which fires after the service is already down. Requested:
   - `hosting|vps|rdp|domain.expiring` at T-7d / T-3d / T-1d (data: expires_at, renewal_price_usd, auto_renew, wallet_balance_usd)
   - `hosting|vps|rdp|domain.renewed`, `hosting.unsuspended`
   - `domain.expiring` / `domain.expired` (no domain lifecycle events exist today)
   - `account.low_balance` with a configurable threshold: `PUT /account/alerts {low_balance_usd}`

   VERIFIED existing events: hosting.provisioned / provision_failed / deleted / grace_start / auto_renew_failed / plan_changed / suspended; vps|rdp provisioned / provision_failed / deleted / grace_start / plan_changed / plan_change_failed; domain.nameservers_*. None of the requested ones exist.
   Builds on `js/reseller-webhooks.js` + the schedulers (dedupe per resource+stage). Effort M.
4. **Origin health behind the protection layer.** Datacenter traffic gets decoy pages (correct), so resellers can't monitor real uptime. Requested:
   - `GET /hosting/:user/health` → { dns:{apex,www,ok}, tunnel:{connected}, origin:{http_status, ttfb_ms, checked_at}, ssl:{valid_until}, php_errors_last_24h }, probed from inside our network / through the tunnel.
   - Webhooks hosting.site_down / site_recovered (debounced: 3 failed checks).
   - Auto dns/repair when the DNS check fails.

   Reuse: `js/hosting-dns-repair.js`, protection-heartbeat HTTP probe, CF tunnel API (status/conns). Effort M.
5. **Backups & restore + snapshots.** There's no backup endpoint at all. Requested:
   - `POST/GET /hosting/:user/backups` (full/home/db), `POST /hosting/:user/backups/:id/restore`, `GET …/:id/download` (signed URL).
   - Daily automatic backups with 7-day retention on monthly plans.
   - `POST/GET/restore/DELETE /vps|rdp/:id/snapshots` (wallet-billed per GB).
   - Keep the last backup 7–14 days after *.deleted, plus `POST /hosting/restore {username}` (billed) as a win-back offer.

   Needs storage (object storage / off-server), WHM backup API (UAPI Backup::fullbackup_to_*), DO snapshot billing. Effort L.
6. **Longer prepaid terms + loyalty parity.**
   - Hosting plan_ids for 3/6/12 months at a discount; renew with {months}. RDP already has 2/3-month bundles and VPS goes up to 12 months.
   - API parity for loyalty_credit_usd (the bot gives it on upgrades, the API doesn't).
   - Optional volume tiers per reseller.

   Touches billing, plan-change rules (`js/hosting-plan-change.js`), scheduler, bot. Effort M–L.

## P1 — makes the service feel smart and unique
7. **Usage threshold events.** hosting.usage_threshold (disk/bandwidth/inodes ≥ 80/95%) and vps|rdp.usage_threshold (CPU > 90% for 15 min, RAM > 90%, disk > 85%). /usage and /stats data already exist; this only adds the push. Effort S–M.
8. **Protection activity feed.** `GET /hosting/:user/security/events?days=7` → daily counts (scanners blocked, JA3 matches, challenges passed/failed, top countries) + summary. Today only static signature counts are exposed. Likely needs NEW counters in the CF worker / challenge (CF Analytics or worker KV/D1). Effort M–L.
9. **One-click apps + site starter.** `POST /hosting/:user/apps {app: wordpress|static|laravel, path, admin_email}` → async /jobs/:id, and `GET /hosting/:user/apps` (versions, update available). Same work as HOSTING_CAPABILITIES roadmap #2. It depends on the .htaccess fix (roadmap #1), and Laravel needs a Composer/CLI story (no shell). Effort L.
10. **Domain transfer-in + domain auto-renew.** `POST /domains/transfer {domain, auth_code}`, `GET /domains/:domain/transfer-status`, webhooks domain.transfer_completed|failed, `POST /domains/:domain/auto-renew {enabled}`. Uses the OpenProvider/registrar API. Effort M–L.
11. **Pause instead of cancel.** `POST /hosting/:user/pause {days: 7–30}`: maintenance page, data kept, small or no fee, expiry extended by the paused days. Effort M.
12. **Change-activity log per service.** `GET /activity?resource=…` with actor api|bot|system for suspend/unsuspend, dns.repair, anti-red deploy, plan change, auto-renew attempt, cleanup. Partial data exists (planChangeHistory, logs). Needs one central activity collection written at each action. Effort M.

## P2 — nice to have
13. **Per-request sandbox.** Header `X-Nomadly-Mode: test` or a second test key; today the key is account-wide live. Effort M.
14. **Status / incident feed.** `GET /status` (components, incidents, maintenance) + platform.incident webhook. Effort S–M.
15. **Email deliverability.** `GET /hosting/:user/email/deliverability` (SPF/DKIM/DMARC + fix-it action). Effort S.
16. **Shortener analytics + smart routing.** `GET /shortener/links/stats?since=` (clicks per day per link, country, device, referrer), routing rules targets:[{country|device, url}], QR code (?format=svg). Effort M.
17. **Webhook test + delivery log.** `POST /account/webhook/test`, `GET /account/webhook/deliveries` (status, attempts, last error). Effort S.
