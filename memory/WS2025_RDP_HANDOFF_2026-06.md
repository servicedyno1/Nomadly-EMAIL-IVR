# WS2025 DO RDP — session wrap-up & handoff (2026-06)

## TL;DR — ws2025 is DONE and functionally equal to ws2019/ws2022
The task ("check ws2025 RDP on DigitalOcean is available just like ws2019 and ws2022")
is **functionally complete**. The remaining "callback DNS failure" is a **sandbox artifact,
NOT a code bug** — do not keep patching apply.ps1 DNS for it.

## Evidence (2026-09-23 live E2E)
`node js/ops/rdp_golden_e2e.js --os ws2025 --region US` → `memory/rdp_golden_e2e_ws2025_keep2.log`:
- golden_status=**available**, image=246641953, min_disk=32,
  regions = tor1,sgp1,sfo3,nyc3,lon1,fra1,blr1,ams3 (all 8 mapped regions).
- Droplet from golden image, fast deploy, **active in 7.2 min**.
- **RDP credential check: OK via xfreerdp after 1 attempt** (NLA login with per-order password succeeded).
- `RESULT: PASS — ws2025 fast path active in 7.2 min`.

So: golden image sync ✅, fast-deploy ✅, ADSI Administrator password ✅, RDP/NLA login ✅.
(One earlier run showed STATUS_ACCOUNT_LOCKED_OUT — that was the login-probe hammering a *stale*
password before apply.ps1 finished; the clean keep2 run confirms creds are correct.)

## The "callback DNS" thing — why it is NOT a bug
On-droplet `C:\cloudinit\apply.log` (copied to `memory/rdp_applylog_104.131.68.31/apply.log`):
```
metadata reached ... configure ... 104.131.68.31/18
Administrator password applied (ADSI) for 109b0d03-...   <-- WORKS
callback attempt 0..9 failed: The remote name could not be resolved:
    '8e6012f3-4ce9-4f94-b688-3183f1db3b96.preview.emergentagent.com'
```
The Windows VM applies the password fine, then tries the callback and cannot resolve the host.
The host is the **Emergent sandbox preview URL**, which only resolves *inside* the Emergent
K8s ingress — it is NOT a public DNS record, so no host on the public internet (incl. a DO
Windows VM) can resolve it. This has nothing to do with in-guest DNS config: apply.ps1 already
puts public resolvers first (67.207.67.2/3 + 1.1.1.1, see DO_RDP_LESSONS.md #10). `nslookup 1.1.1.1`
works; the sandbox hostname simply does not exist publicly.

Why it does not matter for provisioning:
1. **Prod uses a public URL.** `CALLBACK_URL` is built from the running service's base URL. On
   Railway production that is the public Railway/custom domain, which IS publicly resolvable → the
   callback will succeed. The failure is exclusive to the sandbox preview hostname.
2. **There is already a callback-independent fallback.** The backend polls port 3389 and declares
   the order `active` ~90s after the port opens even if no `rdp_ready` callback arrives
   (see RDP_GOLDEN_IMAGES.md "Customer fast path"). The e2e above went active with no callback.

### If you MUST prove the callback end-to-end in sandbox
Don't touch apply.ps1. Instead temporarily set `CALLBACK_URL` (or the base-URL env the service
derives it from) to a **publicly resolvable** tunnel (e.g. a cloudflared/ngrok URL pointing at
the local Node on :5000), or just verify it on Railway prod after the provider switch below.

## THE one remaining actionable item — Issue 2 / Task 1 (NOT done, deferred by design)
Switch Railway **production** env `VPS_RDP_PROVIDER` from Azure → `digitalocean-rdp`.
- Deferred intentionally until ws2025 was proven stable (now it is).
- This is a **production config change** (flips live RDP provisioning). Get explicit owner
  go-ahead before flipping. Railway CLI is available in the sandbox:
  `/opt/node22/bin/railway` with `RAILWAY_TOKEN` from backend/.env (read PRD.md line 11).
  Set the var on the `Nomadly-EMAIL-IVR` service, then redeploy.
- After the switch, place ONE real ws2025 order in prod and confirm the `rdp_ready` callback
  now lands (it will, because the prod CALLBACK_URL is public) + credentials are delivered.

## Cleanup owed
The keep2 e2e left a droplet running to allow manual login inspection:
- droplet **602990345**, IP 104.131.68.31, Administrator / `3Jd7b96aYPtBLmpE_D`,
  order id `rdp-109b0d03-198f-43fe-a772-39b681b6d58e`.
- Destroy it when no longer needed: `svc.cancelInstance('rdp-109b0d03-198f-43fe-a772-39b681b6d58e')`
  (or DO API delete droplet 602990345) so it stops billing.

## Sandbox safety state (leave as-is)
- `TELEGRAM_API_BASE_URL=http://127.0.0.1:5099` → mock server (`js/tests/mock_telegram_api.js`) so
  the sandbox never hijacks the prod Telegram webhook. `SKIP_WEBHOOK_SYNC=true`.

## Carried-over, still open (unrelated to ws2025)
- Domain loading / Turnstile page on hosted sites (e.g. bylinebank.capital) — P1, not started.
- Telnyx API key HTTP 401 — P2, blocked on a valid key from the user.

## Files of record
- Orchestrator: `js/digitalocean-rdp-service.js` · boot script: `js/rdp-scripts/apply.ps1`
- E2E: `js/ops/rdp_golden_e2e.js` · logs: `memory/rdp_golden_e2e_ws2025_keep2.log`,
  `memory/rdp_applylog_104.131.68.31/apply.log`
- Runbook: `memory/RDP_GOLDEN_IMAGES.md` · lessons: `memory/DO_RDP_LESSONS.md`
