# ROADMAP: single prioritized backlog (updated 2026-10-10)

Sources: `HOSTING_CAPABILITIES_2026-10.md` (H#) and `RESELLER_FEATURE_REQUESTS_2026-10-10.md` (R#). Effort: S < 1 day, M 1–3 days, L > 3 days or infra.

## P0-a: Broken today (fix first, small)
1. **Blacklist false positive** (R1, S). Count only real 127.0.0.x answers; check the origin IP, not the CF edge IP. `js/safe-browsing-service.js`.
2. **Keep customer .htaccess rules on anti-red redeploy** (H1, S–M). Preserve the WordPress block, SPA fallback (build|dist) and a "Custom Rules" block. Today WordPress permalinks and app deep links silently 404 after every redeploy.
3. **Safe Browsing key** (R2, S, needs the owner's Google API key). Set GOOGLE_SAFE_BROWSING_KEY on both bots.

## P0-b: Retention features (biggest impact)
4. **Expiry / renewal / low-balance webhooks** (R3, M). *.expiring T-7/3/1, *.renewed, hosting.unsuspended, domain.expiring/expired, account.low_balance + PUT /account/alerts.
5. **Origin health check + site_down / site_recovered webhooks + auto DNS repair** (R4, M).
6. **Longer prepaid hosting terms (3/6/12 months) + loyalty credit in the API** (R6, M–L).
7. **Backups & restore (cPanel), VPS/RDP snapshots, restore after termination** (R5, L, needs off-server storage).

## P1: Smart and unique
8. **Usage threshold events** (R7, S–M). The data already exists.
9. **Change-activity log per service** (R12, M).
10. **One-click WordPress / apps, in HostPanel + API** (H2 + R9, L). Needs #2 first.
11. **Pause instead of cancel** (R11, M).
12. **Protection activity feed / weekly protection report** (R8, M–L). Needs new counters in the worker.
13. **Domain transfer-in + domain auto-renew** (R10, M–L).

## P2: Nice to have
14. **Webhook test + delivery log** (R17, S).
15. **Email deliverability check** (R15, S).
16. **Status / incident feed** (R14, S–M).
17. **Per-request sandbox mode** (R13, M).
18. **Shortener bulk analytics + smart routing + QR** (R16, M).
19. **Node.js app hosting** (H3, L). A server-wide EA4 change: ea-nodejs + Passenger + a HostPanel tab.

## Other carried-over items
- Translate the renewal flow's "account terminated" message + plan-details dates into fr/hi/zh (S).
- Customer Telegram notice when the renewal price changes after an upgrade (S).
- Weekly admin billing audit: renewal price ≠ plan price (S).
- Legacy failing suites (test_reseller_api_grace_2026-06, test_vps_scheduler_fix, test_cancellation_flows): owner said no need to fix.

## Security / ops
- **fail2ban on the droplet** (S). Re-checked 2026-10-10: inactive; auth.log has 3,724 failed/invalid SSH logins. Was deferred by the owner.
- **Secret rotation + vault re-lock** after the repo went private (owner action).
- WHM whm2-fra1 stability watch: it rebooted twice on 09-28, and cpsrvd went stale for 32h. This is now detected by the heartbeat breaker.
- Boot-time Telegram ping when DO power-cycles a server (S).

## Blocked on owner (credentials / money)
- ConnectReseller 401 on domain pricing: reset the CR panel password, whitelist 146.190.238.190, update CR_PANEL_PASSWORD (both envs + vault).
- Contabo API auth failing, so Contabo VPS provisioning is broken: needs new credentials.
- Telnyx balance low (~$8 at last check): top up.
- Google Safe Browsing API key (= item 3 above).

## Monitoring / pilots
- Branded nameservers ns1/ns2.hosta.sh pilot (14 days from ~2026-10-07): watch whether CF's periodic NS re-check marks zones "moved". The BrandedNS worker auto-reverts.
- SIP fix 2026-10-04: confirm a real bridge call logs `[Twilio] Bridge found:` on app-main.

## Future / low priority
- Bot hosting upgrade still uses the old loyalty-credit quote while the API uses pro-rata (fold into item 6).
- Bot plan change is wallet-only: add a crypto/bank checkout for the pro-rata amount.
- Stale-zone sweep: 96 registeredDomains carry cfZoneIds not in our CF account (self-heals lazily today).
- Panel test-email / EmailBlast use ports 25/465/587, which DO blocks from the droplet (only matters if those features are used there).
- WhiteLabel sync commits as 2-parent merges (cosmetic; test the GITHUB_TOKEN workflow restriction first).

## Closed
- 2026-10-10: droplet ops done (pm2-logrotate installed, legacy /opt/nomadly/app-main|app-wl removed, /opt/nomadly/deploy.sh = scripts/droplet_deploy.sh).
- Declined by the owner: don't bill failed SIP bridges / refund @Login4six8.
- 2026-10-10: namewords.sbs DNS teardown RCA. Fixed, deployed, restored. The reseller deleted name1d6a/name303c through the guarded path; the DNS was kept (re-verified).
