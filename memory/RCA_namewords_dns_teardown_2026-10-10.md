# RCA — namewords.sbs (name65fb) offline: teardown deleted a live account's DNS (2026-10-10)

## What happened
- 2026-10-08 12:29:49–50 UTC, prod app-main log: the reseller called `DELETE /hosting/nameb594`, a FAILED (`duplicate_provisioning_prevented`) record for namewords.sbs. Cleanup removed 3 worker routes, then:
  `[CF] Removed hosting record: CNAME namewords.sbs → b395cebc-….cfargotunnel.com` (+ www), `cleanupAllHostingRecords: 2 records removed`.
- Cause: every teardown path (reseller DELETE, bot cancel x2, panel cancel, addon unlink x4, change/set-primary x4) called `removeWorkerRoutes(domain)` + `cleanupAllHostingRecords(zone, domain)` BY DOMAIN NAME, never checking whether another live account used the domain.
- Worker routes came back with the 10-09 plan-change redeploy; the DNS did not, so the site went offline.

## Done 2026-10-10
- PROD restore: re-created apex + www proxied CNAME → tunnel in zone 29b0f2ae…; resolves via 1.1.1.1. The tunnel (whm2-fra1-20260617) is healthy with catch-all ingress → http://68.183.77.106:80, so no per-host ingress was lost.
- PROD audit (read-only + auto-restore if missing): Nomadly 14 live accounts, WhiteLabel 12 → 0 other affected.
- Code: `js/hosting-dns-teardown.js` (guard), `js/hosting-dns-repair.js` (self-heal), `POST /hosting/:user/dns/repair`, anti-red/deploy DNS check, failed records ignored by `findOwnedAccountByDomain`, suspend sets suspendedAt, plan-change history `legacy = !billing`.
- Tests: `js/tests/test_hosting_dns_teardown_2026-10.js` 19/19; testing agent iteration_74 100%.

## PENDING (after the user's Save to GitHub → auto-deploy)
- Delete failed records name1d6a + name303c on prod through the NEW guarded teardown (expect `kept_in_use_by_another_account`), then re-check namewords.sbs DNS is still present.
