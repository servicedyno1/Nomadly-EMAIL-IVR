# PRD — Nomadly Cloud IVR + Telegram Bot


## 2026-10-10b — Plan Change History API + bot hosting-upgrade renewal-price fix + admin repair — DONE (sandbox; awaiting Save-to-GitHub + redeploy)
- Reseller API: GET /plan-changes (account-wide; filters product=hosting|vps|rdp (comma list), since, until, status=completed|failed|running, via=api|bot; limit 1-200 + opaque cursor; total/has_more/next_cursor) + per-item GET /hosting/:user/plan-changes, /vps/:id/plan-changes, /rdp/:id/plan-changes. Owner-scoped (chatId), deleted/terminated resources included. Builder: js/plan-change-history.js.
- Recording: VPS/RDP engine now pushes FAILED (refunded) attempts to planChangeHistory too (status, reason, refund_usd) and richer completed entries (names, renewal price, started_at). Hosting API entries get id/status/renewal_price_usd. Bot hosting upgrades now push a full entry (via 'bot', billing 'new_term', loyalty_credit_usd). Legacy data (hosting upgradedAt/downgradedAt, VPS last failed planChange) → legacy:true best-effort entries.
- BUG FIX (user-approved): bot hosting upgrade never updated price-locked renewalPriceUsd → upgraded accounts renewed at the OLD price (weekly $30 → Golden renewed at $30; Premium $75 → Golden at $75). Now sets renewalPriceUsd = getPlanPrice(new plan) + planChangedAt; debit result checked (overdraft-safe).
- ADMIN REPAIR (run ONCE on PROD after deploy): GET /api/admin/hosting-renewal-price-repair?key=<SESSION_SECRET[0:16]> = preview (affected list + total $ difference per renewal); POST same URL + &apply=true (optional body {"usernames":[…]}) = apply. Criteria: upgradedAt set, last upgrade not stamped with planChangedAt (i.e. old bot path), not repaired since, numeric renewalPriceUsd ≠ current plan list price, not deleted/terminated. Compare-and-set, idempotent, admin Telegram summary on apply. Module js/hosting-renewal-price-repair.js. Does NOT refund/charge past renewals.
- Docs: /apidoc new "Plan Change History" group (#plan-history) + per-item endpoints + "Plan-change history" card in the Plan changes guide.
- Tests: js/tests/test_plan_change_history_2026-10.js (17/17); regressions 23/23, 28/28, i18n pass; testing agent iteration_72: 100%.


## 2026-10-10 — Plan-change rules (hosting / VPS / RDP) + weekly renew cap + race fixes + API docs — DONE (sandbox; awaiting Save-to-GitHub + redeploy)
- Hosting (reseller API): Premium Monthly ↔ Golden Monthly = resources only (upgrade pro-rata (new−old)×days/30, downgrade $0 no refund, expiry NEVER moves). Weekly → Premium/Golden Monthly = monthly price − unused weekly credit (account's locked weekly price × days left / 7) + FRESH 30-day term (billing "new_term"; legacy stacked-weekly safety net: credit > monthly → $0 + credit converted to days ≥ 30). Monthly → Weekly NEVER (hidden from plan-options; POST → 409 weekly_downgrade_not_allowed). Bot hosting upgrade left as-is (upgrade-only, no Golden→Premium) per user.
- Weekly renewals (API + Telegram bot): ONE week at a time (periods>1 → 400 weekly_single_period_only) and only once ≤ 7 days left (→ 409 weekly_renew_too_early + renew_available_at). GET /hosting/:user, GET /hosting, GET /renewals expose renewable:false + renew_available_at. Monthly plans can still prepay up to 12 periods.
- VPS/RDP: in-place DigitalOcean resize on the SAME droplet (id/IP/data kept) — expiry AND term length never change; renewal price = new plan's price for the same term (RDP 1/2/3-month bundle, discount kept); upgrade charge uses 1-month list prices × days/30 (user confirmed). NEW: needs ≥ 1 h left in term (409 term_ending_soon).
- Race fixes: hosting plan-change atomic lock (cpanelAccounts.planChangeLock, 10-min stale takeover, re-quote on locked doc); API + bot hosting renew compare-and-set on {expiryDate, plan} (loser refunded / debit reversed); bot renew now checks the overdraft-safe debit result; hosting scheduler skips locked/changed accounts; VPS auto-renew query skips planChange running/reconciling.
- New webhook: hosting.plan_changed (API path). /apidoc: new "Plan changes" guide (#plan-changes, live prices, worked examples, error table, integration flow, webhook payloads) + updated endpoint docs/error table.
- Files: js/hosting-plan-change.js, js/reseller-api.js, js/reseller-webhooks.js, js/hosting-scheduler.js, js/do-plan-change.js, js/_index.js, js/lang/{en,fr,hi,zh}.js, js/apidoc-page.js. Tests: js/tests/test_hosting_plan_rules_2026-10.js (23/23), js/tests/test_do_plan_change_2026-10.js (28/28), i18n coverage pass; testing agent iteration_71: 100%.
- Known pre-existing failing suites (user: do NOT fix): test_reseller_api_grace_2026-06 (live smoke w/ hardcoded key + old-pod fixtures), test_cancellation_flows (provider default → OVH + shared fake collection), test_reseller_site_status_2026-06 (assumes SKIP_WEBHOOK_SYNC toggles dry-run).
- ⚠️ Sandbox note: vault sets RESELLER_API_LIVE=true → this pod's reseller API is LIVE against real DO/WHM (harmless while local DB has no API keys).


## 2026-10-08 — OPS: OpenProvider registrant / service email cloakhost@tutamail.com → gidineter@gmail.com (PROD, both bots) — DONE & verified
- Why: @ricodeljalisco's ccTLD domain (nationalbcverifservicesonetimelink.ch) was orphaned at OpenProvider (code 320, not in account) because the registrant/service email cloakhost@tutamail.com was unmonitored, so registry contact-validation never completed. Monitored gidineter@gmail.com now used so future .ch/.it/… validations pass.
- Code (sandbox, awaiting Save-to-GitHub + redeploy): `js/op-service.js` SERVICE_EMAIL default → gidineter@gmail.com (no cloakhost literal, SERVICE_EMAIL exported); test `js/tests/test_op_service_email.js` 3/3.
- Env (source of truth): sandbox `backend/.env` NOMADLY_SERVICE_EMAIL + SINGAPORE_ADMIN_EMAIL = gidineter; vault `memory/nomadly.vault.enc` re-locked (0 cloakhost).
- Production (DO droplet 146.190.238.190): replaced both vars in `/opt/nomadly/shared/{app-main,app-wl}/backend.env` (backups `.bak.cloakhost.20261008T200337Z`), zero-downtime blue/green reactivation of the current release per app (app-main-a:5000, app-wl-b:5101), both /health 200, dotenv confirms gidineter on both apps. The hardcoded `|| 'cloakhost...'` fallback still exists in the deployed op-service.js but is now dead (env overrides); removed on next redeploy.

## 2026-10-07 — DigitalOcean NVMe VPS plans (Premium AMD + Intel) + live stock filter — DONE
- User asked if reseller VPS on DO is SSD-only (yes, it was). User choices: add BOTH Premium AMD + Intel, ALL available sizes, same 200% markup (×3); Telegram bot ALSO gets an NVMe/SSD choice; out-of-stock plans HIDDEN using DO live availability refreshed hourly.
- `digitalocean-service.js`: `PRODUCT_CATALOG_NVME` = 24 plans (9 `s-*-amd` + 15 `s-*-intel`, incl. Intel extra-disk sizes), name `NVMe <AMD|Intel> <c>vCPU/<r>GB/<d>GB`, diskType `nvme`, `do_size_slug`, tier = price order. Regular 6 `s-*` SSD plans unchanged. Prices EU: $21 … $576/mo.
- Live stock: `refreshSizeAvailability()` (GET /v2/sizes, on load + every 1h, skipped when NODE_ENV=test; logs price drift), `isProductAvailable()`, `listProducts(region, isWin, 'ssd'|'nvme'|undefined=both)` hides out-of-stock sizes; before the first fetch everything is listed. Snapshot 2026-10-07: regular SSD NOT in nyc1/nyc3/sfo3 (US-east/US-central/US-west), Intel NOT in nyc1/nyc3 → EU 6+24, US-east/central 9 AMD, US-west 24 NVMe.
- Region fixes (pre-existing bugs): `_customerRegion()` accepts case-insensitive codes (reseller API sends `US-EAST`, which never matched before) and DO slugs (`fra1` from live records, so bot upgrade menus can be priced); `createInstance` uses it too.
- Reseller API: `GET /vps/plans?storage=nvme|ssd` (400 `invalid_storage`), `vcpus` now filled for DO plans, NVMe plans return `cpu` AMD/Intel + `storage_type` "NVMe SSD"; `POST /vps` with an out-of-stock plan → 409 `out_of_stock` before billing; `/pricing` includes NVMe; apidoc updated.
- Bot: `fetchAvailableDiskTpes` (DO) shows `⚡ NVMe SSD — Premium` / `💾 SSD — Standard` only for classes with stock (one class → step auto-skipped); `askVpsDiskType` intro in en/fr/hi/zh says NVMe costs more; upgrades: `diskSwitchTarget()` for the SSD↔NVMe swap (same size, in stock), plan upgrades never offer a smaller disk.
- Also fixed: `/health` handler at `_index.js` ~45711 referenced an undeclared `voiceService` (ReferenceError → 500).
- Tests: `js/tests/test_do_nvme_plans_2026-10.js` 16/16; jest 33/33 (updated `tests/digitalocean-provider.test.js`); testing agent iteration_68: 100% incl. bot E2E 19/19 (`tests/test_bot_nvme_storage.py`, mock Telegram).
- PENDING (user): "Save to GitHub" + redeploy app-main so production gets this AND the branded-NS-off code.
- Side request (read-only): `schwabcustomersupport.com` at OpenProvider = status DEL / softQuarantine, restore quote $45.00 (renew $16.98, create $11.98), restorable until 2026-10-30 17:06 UTC. NOT purchased.


## 2026-10-07 — Reseller API switched BACK to Cloudflare nameservers (branded NS paused) — DONE
- User decision: Reseller API defaults to the Cloudflare-assigned names again; leave the hosta.sh vanity NS for now. Telegram bot unchanged (always Cloudflare).
- Code: `branded-ns.js` `isEnabled()` is now OPT-IN (`RESELLER_BRANDED_NS_ENABLED=true` to re-enable; unset = off). When off: `ns_choice "branded"` AND `nameservers:[ns1/ns2.hosta.sh]` quietly fall back to `cloudflare`; error texts never offer "branded"; the worker reverts any `branded` doc and cancels any `activating` doc. `reseller-api.js`: PUT `/dns/:domain/nameservers` with the branded pair → sets the Cloudflare-assigned names (creates the zone via switchToCloudflare if missing); `/account/webhook` hides `domain.nameservers_*` events. `apidoc-page.js`: all branded text is conditional on `isEnabled()` → 0 hosta.sh mentions when off.
- Tests: `js/tests/test_branded_ns_2026-10.js` 30/30, `js/tests/test_reseller_branded_ns_api_2026-10.js` 26/26 (includes the new "flag off" sections), jest 33/33 suites (449 tests).
- Ops: test domain `hostanscktmjd3n.click` reverted to anderson/leanna (OpenProvider + .click registry verified) and its brandedNsDomains doc cancelled. hosta.sh pilot reverted (Namecheap + .sh registry → anderson/leanna) and STOPPED (`enabled:false`, ticks/cron return `not-enabled`). Glue records ns1/ns2.hosta.sh (172.64.35.177 / 108.162.194.151) KEPT at Namecheap so this can be re-enabled.
- Production (droplet app-main): appended `RESELLER_BRANDED_NS_ENABLED=false` to `/opt/nomadly/shared/app-main/backend.env` (backup `backend.env.bak.20261007T125643Z`), zero-downtime re-activation of the SAME release `20261007T121731Z-75238bd` → now `app-main-b :5100`, log `[BrandedNS] init — enabled=false`. app-wl untouched.
- PENDING (user): "Save to GitHub" + redeploy app-main so prod also gets the new code. Until then, prod's old code still shows hosta.sh on `/apidoc`, and prod's old code still accepts an explicit `nameservers:[ns1/ns2.hosta.sh]` as branded. The default is already Cloudflare.
- To re-enable later: set `RESELLER_BRANDED_NS_ENABLED=true`, then `POST /api/admin/ns-pilot/start` + switch for hosta.sh.


## 2026-10-07 — Branded NS LIVE end-to-end check — PASSED
- Real domain `hostanscktmjd3n.click` registered via `POST /api/reseller/v1/domains/register` (default ns_choice=branded, OpenProvider id 30368620, real cost ~$1.99). Owner = TEMP test owner `999100990` in the PRODUCTION reseller DB (`RESELLER_DB_URL`), wallet credited $30 → charged $30 (net 0); temp API key DISABLED afterwards.
- Timeline (UTC): 11:59 registered on anderson/leanna + CF zone `c143a83402b4d3756dbb102cf33381d3` (pending) → 12:02 CF active → 12:04 BrandedNS worker switched registrar → 12:06 .click registry delegates to ns1/ns2.hosta.sh. Cold trace: registry → .sh glue (172.64.35.177 / 108.162.194.151) → aa answer = CF edge IPs; HTTP/HTTPS served by Cloudflare (cf-ray), no origin leak. API `GET /dns/:domain/nameservers` → `nameserver_status: branded`.
- While the zone is still PENDING, Cloudflare returns the origin IP (DNS-only), so the worker only switches after activation and a leak check.
- Glue IPs answer authoritatively for zones on BOTH account NS pairs (anderson/leanna 269 zones, jose/joselyn 4 zones) — 12/12 pass.
- Known limitation: an apex `dig NS` (child side) still returns anderson/leanna; registry/WHOIS show hosta.sh.
- Still open: whether CF's periodic NS re-check marks zones `moved` (hosta.sh pilot runs 14 days; BrandedNS worker reverts automatically if the zone stops being active).
- Scripts: `scripts/branded_ns_livecheck.js` (glue vs all CF NS pairs), `scripts/branded_ns_domain_check.js <domain> [--tick]`, `scripts/branded_ns_trace.js <domain>` (cold iterative resolution).
- Side finding: ConnectReseller still returns 401 on pricing (P1, blocked on user); OpenProvider works.


## 2026-10 — Vanity nameservers ns1/ns2.hosta.sh (Free CF plan) — PILOT RUNNING (14 days)
Goal: reseller API domains/hosting delegated to `ns1.hosta.sh`/`ns2.hosta.sh` instead of `*.ns.cloudflare.com` while keeping CF protection.
- Facts verified: CF Account Custom NS = Business(+support)/Enterprise only (our account → "feature not enabled"). Free zones activate ONLY when the registry lists the exact CF-assigned names. **Pending zones serve proxied records as DNS-only = ORIGIN IP LEAK** (verified live on hosta.sh: pending → `pilot.hosta.sh A 192.64.119.228`). Any CF NS IP answers for any zone in the account (verified). Apex `NS` lookups still show anderson/leanna (CF serves its own names).
- Approach under test ("2-step glue"): register/activate on CF-assigned names → then registrar switched to vanity names whose glue = CF NS IPs (ns1 → 172.64.35.177 anderson, ns2 → 108.162.194.151 leanna). Unknown = whether CF's periodic re-check marks the zone `moved` (→ deleted after 7d on Free).
- Code: `js/namecheap-service.js` (Namecheap XML API: getInfo, dns.getList/setCustom/setDefault, ns.create/getInfo/update/delete, ensureChildNameserver; ClientIp auto-detected, key never logged). `js/ns-pilot.js` (state machine init→awaiting_activation→ready_to_switch→monitoring→passed | reverted; checks: CF zone status, raw registry delegation via TLD servers, authoritative answer via glue IPs, DoH 1.1.1.1/8.8.8.8, HTTP cf-ray; ALARM (zone≠active | origin leak | non-CF answer) → auto-revert registrar to CF names; Telegram notifyAdmin on every transition + daily digest). Mounted in `_index.js` after reseller API.
- Endpoints: `/api/admin/ns-pilot/{status,start,tick,revert,switch,stop}?key=<SESSION_SECRET[0..15]>`; cron `POST /api/cron/ns-pilot-tick` (Bearer `WEBHOOK_CRON_SECRET`, 202 + X-Webhook-Id idempotency). `.emergent/crons.yml` hourly — platform reconcile API was UNREACHABLE from pod (10.99.32.226 timeout), so an in-app fallback watchdog (5-min poll, runs tick only if none in last 55 min / 14 min while activating) keeps it going. Mongo (pod-local db): `nsPilot`, `nsPilotChecks`, `nsPilotCronRuns`.
- hosta.sh: CF zone `0f8c3ca124ab1a5c2ccdaae8d5391143` (Free, active 2026-10-07 10:52Z), `pilot.hosta.sh` proxied + anti-red shared Worker route; switched to vanity 2026-10-07 10:53Z. Namecheap email forwarding dropped (user OK).
- Env added (vault re-locked): `NAMECHEAP_API_KEY`, `NAMECHEAP_USERNAME=richbayo`, `WEBHOOK_CRON_SECRET`. Namecheap API whitelist = pod IP 136.108.30.124 (must re-whitelist if pod IP changes).
- NEXT (only if pilot passes): reseller API vanity mode — register on CF names → after activation auto-switch registrar to ns1/ns2.hosta.sh; dns-healer/ns checks must accept vanity names; `nameservers` override param already exists on POST /domains/register.


## 2026-06 — Reseller API: ASYNC provisioning for hosting/VPS/RDP (fast 202 + client_ref idempotency + auto-refund) — DONE & tested (17/17 async + 42/42 regression)
Root cause of the orphaned-account incident (`nameb447`): `POST /hosting` (and `/vps`, `/rdp`) ran the provider build SYNCHRONOUSLY inside `billedProvision`, so a >30s WHM/registrar build made the reseller's HTTP client time out — leaving a charged, half-created account with no client binding. Fix: the 3 create routes now return a fast **HTTP 202** and defer the real build to a persisted background queue.
- **[P0] POST /hosting, /vps, /rdp → 202** `{ status:"provisioning", mode, product, job_id, username(+id for hosting)|id(uuid for vps/rdp), domain|region, plan, price_usd, wallet_balance_usd, poll_url, credentials_url, note }`. The cPanel username (`whmService.generateUsername`) / VPS-RDP uuid is minted UP-FRONT so the reseller gets a stable handle immediately; `createAccount` receives it as `customUsername` (plumbed through `registerDomainAndCreateCpanel` via `info.customUsername`).
- **[P0] Persisted job queue** `resellerProvisionJobs` (js/reseller-api.js): `chargeForAsync` (up-front wallet guard + atomic charge; 402 on insufficient funds, dry_run = balance-check only, never charges), `runHostingJob`/`runVpsJob` (the real build), `processJob` (atomic pending→processing claim, safe against double-run), `provisionWorkerTick` (straggler sweep + reconcile of 'processing' jobs orphaned by a deploy flip — checks WHM for the account, else refund + fail). Worker scheduled via `activeSlot.singletonInterval('reseller-provision-worker', …, 30s)` → ACTIVE SLOT ONLY (standby never double-provisions). Each create also fires `processJob(jobId)` immediately (non-blocking).
- **[P0] client_ref idempotency** — optional `client_ref` on all 3 creates; a retry with the same (owner, client_ref) echoes the SAME 202 handle (`jobHandle()`, `idempotent:true`) — no second charge, no second account. `findJobByClientRef`.
- **[P0] Auto-refund on failure** — if the background build ultimately fails, the up-front wallet charge is refunded (`refundWallet`) and `hosting.provision_failed`/`vps.provision_failed`/`rdp.provision_failed` is emitted (payload carries reason + refunded:true). WHM-temporarily-down → job is DEFERRED/retried (kept pending, NOT refunded) up to 5 attempts before giving up. On success emits `hosting.provisioned`/`vps.provisioned`/`rdp.provisioned`.
- **[HIGH] State on reads** — `GET /hosting` list + `GET /hosting/:user` detail now report `state: provisioning | online | suspended | grace | failed | terminated` (+ `provision_state`, `provision_failed_reason`, `job_id` while provisioning/failed; a provisioning/failed account short-circuits BEFORE the WHM read). VPS/RDP list+detail add `provision_state` (status already shows 'provisioning'→'RUNNING').
- **[HIGH] Webhooks** — added `hosting.provisioned`/`hosting.provision_failed`/`vps.provisioned`/`vps.provision_failed`/`rdp.provisioned`/`rdp.provision_failed` to `reseller-webhooks.EVENTS` (14 events total, all HMAC-signed `X-Nomadly-Signature`). Surfaced on `GET /account/webhook`.
- **[P1] Job status + ETA** — `GET /jobs/:job_id` (owner-scoped) polls an async create for live progress: `status` (provisioning|provisioned|failed), a 0-100 `progress` bar, `stage`/`stage_label`, and an `eta_seconds`/`eta_at` countdown (coarse, product-aware: hosting ≈120s, Linux VPS ≈180s, RDP fast_deploy ≈180-300s, full Windows install ≈2700s — `estimateEtaSeconds`/`jobProgress`). The same progress+ETA fields are now embedded in all three 202 create responses, in the idempotent re-hit, and in the `GET /hosting/:user` + `GET /vps|/rdp/:id` provisioning reads (with `job_status_url`). 404 for a job_id you don't own.
- **[P1] /apidoc** — POST /hosting, /vps, /rdp docs rewritten to the 202 async shape + `client_ref` param + the new provisioned/provision_failed webhooks; added a `GET /jobs/:job_id` entry (progress bar + ETA example); hosting blurb + webhook-events blurb + the two `events` example arrays updated (14 events). `/apidoc` HTTP 200.
- Tests: `backend/tests/test_reseller_async_provision.py` 17/17 (iteration_66; now self-seeds the owner at import so it never fails on a rotated key) — 202 shape, idempotency (same job_id + wallet unchanged), validation-before-charge, duplicate-domain 409, state surfacing, no-auth 401. Regression: `test_reseller_lifecycle.py` 21/21 + `test_reseller_renew.py` 21/21 (run INDEPENDENTLY — both re-seed owner at import). ⚠️ LIVE-only paths (real build failure → refund + *.provision_failed webhook) NOT exercisable on sandbox (dry_run: RESELLER_API_LIVE unset, SKIP_WEBHOOK_SYNC=true) — verify on staging/prod.
- Sandbox-verified only. ⚠️ Needs "Save to GitHub" to deploy to app-main/app-wl.

## 2026-06 — Reseller API: lifecycle parity, no-charge renew pre-flight, hosting/VPS webhooks, HMAC signing (7-gap close) — DONE & tested (21/21)
Backend-only, Node reseller API (`js/reseller-api.js` + `js/reseller-webhooks.js` + `js/hosting-scheduler.js` + `js/_index.js` VPS scheduler + `js/apidoc-page.js`). Sandbox stays dry_run; all new read fields + the dry_run pre-flight work on a LIVE key too.
- **[HIGH] Hosting lifecycle on reads** — `GET /hosting/:user` + list now expose `state` (online|suspended|grace|terminated), `grace` block (in_grace, expired_at, delete_at = expiry+48h, grace_hours:48, days/hours_remaining), `renewable`, `renew_blocked_reason`, top-level `panel_url`/`server_ip`. TERMINATED account → HTTP 200 state:'terminated', terminated:true, renewable:false, `suspended:false` (legacy boolean forced false), deliverables+credentials NULLED, keeps domain/plan/expires_at/`terminated_at` for catalog reconciliation (no more suspended:true + live deliverables contradiction).
- **[HIGH] renewable + renew_blocked_reason** on hosting/vps/rdp detail reads, VPS/RDP list, and every `/renewals` item. Reasons: account_terminated | already_destroyed | not_supported | pricing_unavailable.
- **[HIGH] No-charge renew pre-flight** — `POST /hosting|vps|rdp/:id/renew {"dry_run":true}` returns price + renewability + would_expire_at with ZERO charge/writes (works on a live key). Every blocked item 409/400/501 BEFORE any charge path, for both dry_run and live.
- **[HIGH] hosting.* + vps.* webhooks** — `hosting.grace_start`/`hosting.suspended`/`hosting.deleted`/`hosting.auto_renew_failed` (hosting-scheduler) + `vps.grace_start`/`vps.deleted` (_index.js VPS scheduler, PAYG). RDP unchanged. Payload: top-level event+product+occurred_at, data:{id,product,domain,reason,…}. Added to GET /account/webhook events list (8 events).
- **[HIGH] Webhook HMAC signing** — every delivery signed `X-Nomadly-Signature: sha256=<hex of HMAC(webhook_secret, raw_body)>`. Secret minted on first PUT /account/webhook (returned once, persisted, shown on GET). `emit()` gained `dedupKey` so grace/auto_renew_failed re-fire each billing cycle while *.deleted stays once.
- **[HIGH] Auto-renew observability** — scheduler records `autoRenewNextAttemptAt` (next hourly tick), emits `hosting.auto_renew_failed` on insufficient funds, then falls into 48h grace (NOT immediate termination). Worker documented in /apidoc hosting blurb.
- **[MED] /renewals terminated** — default EXCLUDES terminated (actionable items only); `?include_terminated=true` surfaces items terminated in the last 90 days (status:'terminated', terminated_at, renewable:false).
- **[MED] Dead duplicate `POST /hosting/:user/renew` removed** (the non-periods handler was shadowed/dead); kept the periods+dry_run one. /apidoc renew body documents periods + success shape + pre-flight.
- **[LOW] List-vs-detail consistency** — list + detail both use the shared `hostingLifecycle()` (same suspended + state), detail adds top-level panel_url/server_ip.
- Tests: `backend/tests/test_reseller_lifecycle.py` 21/21 (iteration_65); `js/tests/test_rdp_grace_destroy_2026-06.js` 73/73 (no regression); inline HMAC/dedup/per-cycle node check all pass; /apidoc HTTP 200 with all new content. Seeds: `scripts/seed_reseller_lifecycle_fixtures.js` (grace/suspended/terminated/CANCELLED/RDP-grace fixtures).
- ⚠️ Needs "Save to GitHub" to deploy to app-main/app-wl (sandbox-verified only; webhook SEND paths live in schedulers gated off by SKIP_WEBHOOK_SYNC=true on sandbox, so only exercisable on prod).

## 2026-06 — Reseller API: hosting `id` field for cross-product consistency
- Answer to "why can't we have a hosting id": hosting already HAS a stable id — the cPanel username (`cpanelAccounts._id`) — it was just surfaced as `username` while VPS/RDP use `id`. Added an explicit `id` field (= username) to hosting responses (`GET /hosting` list items, `GET /hosting/:user` detail, and the renew `request`/result) so every product reads the same way. `username` kept for backward-compat; the `:user` path segment is that same id. Doc blurb clarifies it. Additive, curl-verified. Files: `js/reseller-api.js`, `js/apidoc-page.js`.

## 2026-06 — Reseller API: manual renew for hosting / VPS / RDP — DONE & tested (21/21)
- Gap: only RDP had a manual renew; **hosting** (doc promised `POST /hosting/:user/renew` but it was never implemented) and **VPS** had none. Added both; generalized the RDP handler into a shared `vpsRenewHandler(isRDP)`.
- **`POST /hosting/:user/renew`** `{periods?:1..12}` — charges plan price × periods (`getPlanPrice`×`getPlanDuration`), verifies the WHM account still exists (else refund + mark terminated), extends `expiryDate` from max(now, current), unsuspends, re-deploys anti-red. Mirrors the bot's `confirmRenewNow`.
- **`POST /vps/:id/renew`** `{months?:1..12}` — price = `record.planPrice × months`; provider `renewInstance` is OPTIONAL (PAYG DO/Vultr/Azure keep running → wallet+expiry only; mirrors the bot's `_syncProviderRenewal`).
- **`POST /rdp/:id/renew`** `{months?:1..3}` — unchanged behavior: month-bundled provider pricing (term discounts), powers box back on + clears grace.
- All wallet-billed via `billedProvision` (dry_run on sandbox). Files: `js/reseller-api.js`, `js/apidoc-page.js` (added VPS-renew doc + fixed the hosting-renew doc to the real `result.expires_at`/`periods` shape). Seeds: `scripts/seed_reseller_test_vps_rdp.js`, `scripts/seed_reseller_test_hosting.js`.
- Testing: backend agent **21/21 pass, 0 issues** (`backend/tests/test_reseller_renew.py`, report iteration_64) — happy paths, clamping, 404s, 401s, apidoc render, /renewals regression.
- ⚠️ Needs "Save to GitHub" to deploy.
 (honeypot + all plan-gated features) — VERIFIED correct + status parity added
- **Question**: is honeypot management plan-based, and does it (and other plan-gated features) enforce correctly on the API endpoints? **Audit result: enforcement was already correct everywhere — no gate bug.** The API exactly mirrors the canonical HostPanel gates (`js/cpanel-routes.js` `requireGold`/`requireMysqlEligible`/inline `cpIsGold`/`isWeeklyPlan`).
- Plan-gated features (API ↔ panel, all match): **Honeypot** = Monthly only (`isWeeklyPlan` → GET reports is_monthly/eligible/note, POST 403 `monthly_plan_required`); **MySQL** (all `/mysql/*`) = Monthly, rejects 1-week trial (403 `mysql_requires_monthly`); **Visitor Captcha / Geo / JS-Challenge** = Golden only (403 `gold_only`). Ungated features (email, subdomains, SSL/AutoSSL, anti-bot, anti-red deploy, safe-browsing, blacklist) correctly remain ungated on the API too.
- Verified live via curl across 3 tiers (Golden `apifix01`, Premium-Monthly `apifix02`, Weekly-Trial): all 403s and dry-run passes land exactly as the plan dictates. `resolveDomainCfState` confirmed to return `honeypotOff` so the honeypot state is accurate.
- **Enhancement (additive, no behavior change)**: `GET /hosting/:user/security/status` now also returns `is_monthly`, `captcha_gold_only`, `honeypot_monthly_only`, a per-feature `eligibility` map (visitor_captcha/geo_blocking/js_challenge/mysql/honeypot) and the live honeypot state — mirroring the panel so API consumers can discover plan gating without trial-and-error. `/apidoc` security/status example updated. Files: `js/reseller-hosting-mgmt.js`, `js/apidoc-page.js`.
- ⚠️ Needs "Save to GitHub" to deploy (sandbox only so far).

- New `js/reseller-shortener.js` mounted into `reseller-api.js` (after hosting-mgmt). Reuses the existing self-hosted shortener (`fullUrlOf`/`linksOf`/`clicksOn`/`expiryOf` + `app.get('/:id')` redirect) — no new infra.
- **Domains**: `POST /shortener/domains {domain, source}` where source = `buy` (register via domain flow, wallet-billed at domain price, then auto-activate), `existing` (owned on-account domain → free, auto CNAME+TXT via Cloudflare), `external` (domain hosted elsewhere → free; returns CNAME+TXT to add, then `POST /shortener/domains/:domain/verify`). Plus `GET /shortener/domains`, `DELETE /shortener/domains/:domain`. Activation chain reused: `ensureCloudflare` → `saveDomainInServerRailway/Render` → `addShortenerCNAME` → mark completed. Non-live pods return a `dry_run` envelope.
- **Links** (free, own activated domains only): `POST /shortener/links {domain, url, alias?, expires_in_days?}`, `GET /shortener/links[?domain=]`, `GET /shortener/links/:slug?domain=` (+click analytics), `PATCH /shortener/links/:slug {disabled?, expires_in_days?}` (disable/enable + expiry — mapped onto `expiryOf` which the redirect's `isValid()` already honors, redirect handler untouched), `DELETE /shortener/links/:slug?domain=`. Custom-alias validation + reserved-word + collision guards.
- Billing: 1a (buy billed; activation + links free). External: CNAME+TXT then /verify. Owner-scoped via `req.reseller.ownerChatId`.
- `/apidoc`: new "URL Shortener" group (between DNS and VPS) + PATCH badge styling.
- Testing: backend testing agent **29/29 pass, 0 issues** (`backend/tests/test_reseller_shortener.py`, report iteration_63). Seed: `scripts/seed_reseller_test_shortener.js` (owner 999000111, domain golink-test.com).
- ⚠️ Not yet deployed — needs "Save to GitHub" to ship to app-main/app-wl. Live activation is only exercisable on a production pod (`RESELLER_API_LIVE`).


## 2026-06 — `/apidoc` page audit: brought reseller API docs to full parity
- Audited `js/apidoc-page.js` vs. implemented routes (`reseller-api.js` + `reseller-hosting-mgmt.js`, 120 routes). Result: 0 stale entries; doc already covered endpoint families via inline sibling mentions. Only 2 truly-undocumented reseller-facing endpoints were missing → added: `GET`/`POST /hosting/honeypot/:domain` (honeypot-traps toggle, Monthly-gated) under *Hosting · Security*, and `POST /hosting/:user/change-primary` (promote any owned domain) under *Hosting · Advanced*. Blurbs updated. Verified: `/apidoc` HTTP 200, 82→84 endpoints, 0 render errors.
- Side-check: RapidAPI URL-shortener key in `backend/.env` (`srtn-me-url-shortener.p.rapidapi.com`) is **working** (live 200); the key in the user's screenshot is the **same integration** (same host/endpoint) and also works — `.env` left unchanged per the "only if broken" condition.

## 2026-06 — Redeploy-safe runtime state: call-aware deploy drain + callSessions persistence + scheduler single-writer (CODE DONE, tested; droplet ops PENDING)
- **Goal**: blue/green nginx flips must not drop live calls or double-run money crons (follow-up to the @Login4six8 SIP fix).
- **Issue 1 — call-aware deploy drain** (`scripts/droplet_deploy.sh`): new `drain_calls()` holds the nginx flip until the OLD slot's `/health` `calls.total` hits 0, capped at `DRAIN_MAX_SECONDS` (default 1800 = 30 min), then flips anyway. Wired via `activate_release "$REL" drain` (deploy path only; rollback stays instant). Gracefully reads 0 if the old slot predates the feature.
- **/health fix** (`js/_index.js`): `const app = earlyApp`, so the EARLY handler (~line 471) wins and the enriched one at ~45619 was dead code. Enriched the early handler to expose `calls` (`getLiveCallCounts()`) + `slot` (`activeSlot.describe()`). Verified live: `/health` now returns `calls.total` + `slot`.
- **Issue 2 — callSessions Mongo persistence** (`js/call-session-store.js` NEW + `js/voice-service.js`): the four in-flight maps (`activeCalls`, `pendingBridges`, `outboundIvrCalls`, `twilioIvrSessions`) are wrapped in a write-through Proxy (create/delete → Mongo). Plus boot warm-load, 15s periodic snapshot (catches nested mutations like `callSid`), and read-through on webhook miss (`handleVoiceWebhook`). Collection `callSessions` is TTL-indexed (`CALL_SESSION_TTL_SECONDS`, default 7200s). Timers/`_`-internal fields stripped on persist; Date fields revived on load. `getLiveCallCounts()` added + exported.
- **Issue 3 — scheduler single-writer** (`js/active-slot.js` was already wired for node-schedule via `patchNodeSchedule` + `singletonInterval`): extended coverage to the raw-`setInterval` MONEY/CUSTOMER crons in `_index.js` (stuck payments, stale orders, stale payment-intents, orphan bundles, abandoned carts, pending bundles, Fincra reconcile, scheduled-call executor, SMS-campaign scheduler, marketplace stale-convos, escalation reminder) → now `singletonInterval`. `js/hosting-scheduler.js` runCheck/startupEnforcement/self-heal (setTimeout+setInterval) wrapped with `activeSlot.singleton`/`singletonInterval`. `js/scheduler-registry.js` `every()` now skips on the standby slot. Rationale: the new up-to-30-min pre-flip drain means the standby slot runs for that whole window — unguarded money crons would double-execute.
- **Tests**: `tests/active-slot.test.js` 11/11; new `tests/call-session-store.test.js` 5/5 (write-through, timer stripping, warm-load no-clobber, read-through by sid + by data.callControlId, snapshot, no-op when uninit). `node --check` + `bash -n` clean on all touched files. Bot restarted; `/health` live-verified.
- **PENDING (droplet ops — deferred, user to run or approve SSH)**: install `pm2-logrotate` (10M×7, compressed); delete legacy `/opt/nomadly/app-main` + `/opt/nomadly/app-wl` folders; copy updated `scripts/droplet_deploy.sh` → `/opt/nomadly/deploy.sh`; then "Save to GitHub" so app-main + app-wl pick up the code.


## 2026-10-04 — P0: SIP outbound calls "Call routing session expired" (@Login4six8, 5739696549) — ROOT-CAUSED, HOTFIXED, CODE FIX READY
- **Symptom**: SIP dialer → Telnyx → bot answers → transfers to Twilio bridge `sip:bridge_x@speechcue-7937a0.sip.twilio.com`
  → Twilio answers → ~4 s later hangs up; user hears our TwiML "Call routing session expired" (`_index.js` `/twilio/sip-voice`)
  and is still billed $0.03 connection + $0.15 first minute per attempt (8 attempts Oct 3 ≈ $1.44; NOT refunded — user chose skip).
- **Root cause**: app-main (Nomadly) and app-wl (Smadav) share ONE Twilio account. `initializeTwilioResources()` hardcoded the
  `speechcue-` SIP domain and set its Voice URL to its own `SELF_URL` at boot on BOTH bots. Deploys start app-main then app-wl, so
  app-wl always won → Voice URL = `https://1.smadavspeech.com/twilio/sip-voice` → callback hit the Smadav process whose in-memory
  `pendingBridges` had no entry → "session expired". `TWILIO_SIP_DOMAIN_PREFIX=smadav` in app-wl env was never read. Flipped each time
  either bot restarted (Oct 2: 118 OK because app-main restarted last; Oct 3: 1 OK / 11 fail). 5 users hit this path since Sep 30.
- **Hotfix (live 07:26Z)**: Twilio API → `speechcue-7937a0` Voice URL back to `https://2.speechcue.com/twilio/sip-voice`.
- **Code fix** (`js/twilio-service.js`): `SIP_DOMAIN_PREFIX = TWILIO_SIP_DOMAIN_PREFIX || 'speechcue'`; `initializeTwilioResources` /
  `getTwilioResourcesFromEnv` only find/create/update `<prefix>-<sid6>.sip.twilio.com`; legacy `nomadly-` fallback only for default
  prefix. app-wl will manage `smadav-7937a0.sip.twilio.com` (already exists; Smadav DB has 0 phone users → safe). `_index.js`
  bridge-miss log now says which host served it + hints at the prefix. Test: `tests/twilio-sip-domain-prefix.test.js` (5/5).
- **Deploy — DONE & VERIFIED 2026-10-04 08:00Z**: user saved `c9cccb2c` → deploy.yml app-main-a (:5000, release 20261004T075810Z-c9cccb2)
  + Sync main→WhiteLabel `da00248` → app-wl-a (:5001). Boot logs: app-main `SIP domain prefix 'speechcue-'` → updated speechcue-7937a0
  → 2.speechcue.com; app-wl `prefix 'smadav-'` → updated smadav-7937a0 → 1.smadavspeech.com. Twilio API confirms both domains point at
  their own bot (speechcue updated 07:59:30 by main, smadav 07:59:57 by wl — main's URL untouched by wl boot). /health 200 both, 0 boot errors.
  First real SIP bridge call after deploy not yet observed in logs — watch for `[Twilio] Bridge found:` on app-main.
- **Not done (user chose skip)**: don't bill failed bridges (release $0.30 reservation / refund $0.03 when `Bridge found` never logs);
  refund @Login4six8.

## 2026-10-04 — Jest suite green again (31/31 suites, 433 tests; was 12 suites / 31 tests failing)
- All failures were stale tests, none a product bug. Fixed test-only:
  - Source-text guards that drifted after intentional refactors → now assert behaviour via real helpers
    (`vps-provider.isDestructiveCancelProvider`, `crypto-credit.computeDepositCreditUsd`, evaluated `_isPAYGProvider`).
  - Store/DynoPay tests pre-dated the forged-webhook fix → now send V2-signed webhooks (`X-Dynopay-Signature-V2`, `webhookSecret` dep,
    `express.json({verify})` rawBody) + new cases: unsigned+gateway-down → HELD, tampered sig → HELD, gateway-reported underpaid → failed.
  - Azure tests → Dsv6 catalog (`RDP 10/20/30` = D2s/D4s/D8s_v6, $90/$156/$288).
  - 4 standalone `node` harnesses moved to `tests/scripts/` (outside Jest `testMatch`) and run via `tests/node-scripts.test.js` (spawn, exit 0).
  - `protection-heartbeat` dev-guard test: needs WHM env + `jest.isolateModules` (require.cache deletion is a no-op under Jest).

## Original problem statement (this fork session, Feb 2026)
User inherited a fully-set-up Nomadly bot pod pointed at LIVE PRODUCTION. Task became: mine Railway production logs, identify complaints from real users (starting with @blacknmilds), find root causes, and ship fixes.

## Architecture (unchanged from previous fork)
- React frontend (port 3000)
- FastAPI proxy (port 8001) — forwards `/api/*` to Node
- **Node.js Express + Telegram Bot API** (port 5000) — most business logic lives here
- MongoDB — sandbox uses LOCAL `mongodb://localhost:27017`; production uses Railway Mongo `roundhouse.proxy.rlwy.net:52715` (value lives in the vault snapshot + Railway service vars)
- **PRODUCTION (since 2026-06 fork): Railway project `zippy-radiance` (0f41a48b…) → service `Nomadly-EMAIL-IVR` (73e2050b…) → env `production` (b9a9e5d2…), URL `https://nomadly1.up.railway.app`, custom `2.speechcue.com` + `panel.2.hostbay.io`.** The old `New Hosting` project service is dead (all deployments REMOVED). Ops: `js/ops/railway_setup_prod.js` (vars/domains/deploy) + `js/ops/railway_log_pull.js` (logs). Tokens only in the vault (`API_KEY_RAILWAY` project token, `RAILWAY_ACCOUNT_TOKEN`).
- **DigitalOcean Droplet (`146.190.238.190` - `nomadly-prod-ams3`)**: Multi-tenant server running bots via PM2 behind Nginx (`app-main` for Nomadly, `app-wl` for Smadav).
- **WHM Hosting Droplet (`68.183.77.106` - `whm2-fra1`)**: cPanel/WHM production box managing customer domains (30-account license limit).

## Guardrails (never touch)
- Sandbox `/app/backend/.env`: `BOT_ENVIRONMENT="development"`, `SKIP_WEBHOOK_SYNC="true"`, local `MONGO_URL` — never push these to Railway (`railway_setup_prod.js` strips/overrides them automatically)
- Vault (`memory/nomadly.vault.enc`, passphrase in test_credentials.md) is the single source of truth for credentials; after editing `.env` always `vault.sh lock`, then `railway_setup_prod.js apply` to sync production
- **Never "Save to GitHub" onto `WhiteLabel`** and never `git merge main` into it — that clobbers the Smadav branding (7129cae9). Use the **"Sync main → WhiteLabel"** GitHub Action (below).


## 2026-10-03 — One-click brand-safe "Sync main → WhiteLabel" (GitHub Action)
- Finding: GitHub `main` (5384b468) == workspace == live app-main runtime (e376022). `WhiteLabel` (16bb4dd7, live
  on app-wl) was missing main's custom-domain shortlink click-count fix (`js/shortener-analytics.js`) + 2 dev-only
  check endpoints (`/dev/shortlink-analytics-test`, `/dev/rdp-pricing-test` in `js/_index.js`). Every other
  main↔WL difference is intentional Smadav branding (`frontend/src/{App.js,App.css,index.js,index.css,branding.js,
  pages/SalesDashboard.js}`, `frontend/.env.production`, `frontend/public/smadav-*`, `js/branding.js`,
  `js/routes/sales.js`, `/admin/sales` + `/branding` mount in `_index.js` ~38047) + WL-only `js/vps-ssh-reachability.js`.
- Agent may NOT push to GitHub (platform rule) → built `.github/workflows/sync-whitelabel.yml` (workflow_dispatch;
  inputs `dry_run`, `deploy`) + `scripts/sync_whitelabel.py`: per-file 3-way merge on git objects (no checkout),
  base = `main=` in `.whitelabel-sync` on WhiteLabel (bootstrap `e92a09ed`), skips docs/brand/workflow files
  (Actions token can't modify `.github/workflows/*`), runtime conflict ⇒ exit 2 nothing pushed, broken JS/PY ⇒ exit 3,
  fast-forward push only, then `gh workflow run deploy.yml --ref main -f app=app-wl`.
- deploy.yml `paths-ignore` += `.github/**`, `.whitelabel-sync`, `scripts/sync_whitelabel.py`, `scripts/test_sync_whitelabel.sh`.
- Tests: `bash scripts/test_sync_whitelabel.sh` (throw-away bare repo in /tmp from REAL main+WL) — 16/16 pass.
- USER STEPS: just "Save to GitHub" (main) — since 2026-10-03 10:30Z the sync also runs **automatically on every push to
  main** (docs-only pushes ignored; no marker-only commits; pause with repo variable `WL_AUTO_SYNC=false`). Manual
  run/preview still available (Actions → "Sync main → WhiteLabel" → Run workflow). First save after the button was
  added did NOT sync because the workflow was manual-only (0 runs on GitHub) — fixed by the push trigger.
- Repo made PRIVATE by owner 2026-10-03 ~10:20Z. Droplet mirrors still fetch (credential.helper=store, /root/.git-credentials);
  app-main deployed c1709532 OK after the save. Secret rotation + vault re-lock still pending (owner).
- ✅ VERIFIED LIVE 2026-10-03 10:22Z: save 7bda58cc → auto run 37116152861 (push, success) → WhiteLabel 16bb4dd7→480ec0e6
  (shortener-analytics fix + merged _index.js, brand files untouched) → dispatched deploy run 37116166198 (deploy-wl success)
  → droplet app-wl release 20261003T102156Z-480ec0e on :5101, /health healthy, /branding = Smadav, fix live, 0 boot errors.
- Cosmetic: GitHub compare still shows WhiteLabel "31 behind / 124 ahead" main because sync commits copy changes rather
  than recording main as a merge parent. Possible follow-up: make sync commits 2-parent merges (tree unchanged) — CAUTION:
  GitHub may reject GITHUB_TOKEN pushes whose newly-reachable history touches .github/workflows (community #151442); test first.


## 2026-10-03 — Reseller API flipped to LIVE on production main bot (env-only change)
- Finding: `RESELLER_API_LIVE` was absent from both `/opt/nomadly/shared/{app-main,app-wl}/backend.env`, so
  `/reseller/v1/*` ran in `dry_run` on prod (gate in `js/reseller-api.js:134`:
  `RESELLER_API_LIVE==='true' && SKIP_WEBHOOK_SYNC!=='true'`).
- Change (user-approved: **main only**, blue/green): appended `RESELLER_API_LIVE=true` to
  `shared/app-main/backend.env` (backup `backend.env.bak.20261003T092653Z`), ran `/opt/nomadly/deploy.sh app-main deploy`
  → release `20261003T092654Z-e376022` on `app-main-a :5000`, nginx flipped, `app-main-b` retired, zero downtime.
- Verified: `http://127.0.0.1:5000/reseller/v1/health` and public `https://2.speechcue.com/api/reseller/v1/health`
  → `mode: live`; `app-wl` (:5001) untouched → `dry_run`. Bot `/health` healthy, no boot errors.
- NOTE: prod main is still at GitHub `e376022`; this session's local commits (shortlink analytics fix, RDP
  diag endpoints, HEAD `29ab43ff`) are NOT yet pushed — user must use "Save to Github" then redeploy.
- Also sync vault/`memory/test_credentials.md` env snapshot if the vault is regenerated (new key not in vault yet).


## 2026-10-02 — RDP order failure (@morganfreebandzz) — FIXED, tested, deployed to both bots
- **Symptom**: user ordered a Windows RDP; provisioning failed and the bot/admin message said "…your Monthly **VPS** Plan".
- **Root cause 1 (provisioning)**: `VPS_RDP_PROVIDER=azure` on app-main → Azure subscription returned 404. Switched to
  `digitalocean-rdp` (DO Ubuntu→Windows conversion service, `js/digitalocean-rdp-service.js`) in local `.env`, vault,
  and BOTH droplet envs (`/opt/nomadly/shared/app-main|app-wl/backend.env`). `VPS_DEFAULT_PROVIDER=digitalocean` on both.
- **Root cause 2 (message)**: `vp.errorPurchasingVPS` template was `plan => "...${plan} VPS Plan"`. Now
  `(plan, isRDP) => "...${plan} ${isRDP ? 'RDP' : 'VPS'} Plan"` in `js/lang/{en,fr,hi,zh}.js`; all 4 call sites in
  `js/_index.js` (`buyVPSPlanFullProcess` ×2, `upgradeVPSDetails` ×2) pass `vpsDetails.isRDP`.
- **Diagnostics**: `GET /admin/vps-flow-check?key=<SESSION_SECRET[:16]>&lang=en|fr|hi|zh` → `errorPurchasingMessage.rdpSaysRDP/vpsSaysVPS`;
  `GET /admin/vps-catalog-check?key=…` → `providers.rdp.name === 'digitalocean-rdp'`, `providers.vps.name === 'digitalocean'`.
- **Tests**: testing agent iteration_58 — 7/7 backend checks pass (4 langs, catalog routing, 403 auth guard, call-site grep).

## 2026-10-02 (follow-up) — Provisioning poll-hardening + Morgan credential re-send
- **Poll-hardening shipped & deployed** (`main` e92a09ed, `WhiteLabel` 16bb4dd7, both bots live): `buyVPSPlanFullProcess`
  now aborts immediately when `getInstance` reports `failed`/`destroyed`/`error` (the DO 403 outstanding-balance case),
  deletes the orphan `vpsPlansOf` record, marks progress failed, and sends the RDP-aware failure message — instead of
  polling 25 min then DMing credentials for a server that never existed. Setup-tracker title, wallet-refund message and
  the background IP-ready note are all RDP-aware now. Guard logic unit-tested (12/12, regex anchored). Verified present
  in both live releases, `/health` 200, pm2 online.
- **@morganfreebandzz (7706803914) delivery closed**: the original comp-vps #2 provision left NO retained log and there is
  no outbound-message collection, so the original Telegram delivery was unprovable. Re-sent creds + `.rdp` via Bot API
  (Telegram ACK message_id 3354723 + 3354724 → delivery proven). Fixed a wrong `rootPasswordSecretId` pointer so in-bot
  "Show Password" returns the applied password. Details in `memory/RDP_MORGANFREEBANDZZ_MANUAL_COMPLETION_2026-10-02.md`.

## 2026-10-02 — Full i18n: central keyboard-button localization (fr/hi/zh)
- **Dictionaries + hosting-panel locales 100% translated**: `scripts/check_untranslated.js` reports 0 English leaks across `js/lang/*.js`, `js/i18n/*.json`, and `frontend/src/locales/*.json`.
- **Central button interceptor populated** (`js/kb-i18n-buttons.js`, was empty): 40 high-traffic CUSTOMER-facing hard-coded buttons — IVR outbound-call setup, bulk-campaign scheduling, payment, feedback, URL shortener, marketplace/escrow. `js/tg-opts.js` localizes them OUTBOUND via the chatId→lang cache; `js/_index.js` `canonicalizeIncoming` (line ~7507) maps the localized press back to English BEFORE the literal `message === '...'` handlers run.
- **Safety rule (why only a subset)**: only PURE labels were centralized — hard-coded English labels that are NOT a lang-dict value, so no `message === trans()/vp.key/btn.key` matcher exists for them and canonicalize can never hijack a legitimately-translated button. Admin buttons stay English (per user). Brand tokens kept untranslated (Cloud IVR, HostPanel, Anti-Red, BulkSMS, Bit.ly, SIP, VPS/RDP, CSV/TXT, USD/NGN).
- **NOT centralized (intentional, would break handlers)**: dict/helper-backed labels matched via their translated value — `✅ Confirm` (`confirmChangeBtn`, VPS flows `message === vp.confirmChangeBtn`), `📝 Type Text (AI Voice)` (`btn.typeText`), `🎙️ Upload Audio` (`btn.uploadAudio`). These remain handled by the existing dict/helper path.
- **New guard** `tests/kb-i18n.test.js` (8 tests): full fr/hi/zh coverage, per-lang uniqueness (incl. generic Back/Cancel/Main Menu), no collision with a dict value of a DIFFERENT English canonical (caught + fixed a bulk-campaign vs SMS `⏰ Schedule for later` clash → bulk now `⏰ Programmer plus tard` etc.), every key present in `_index.js`, canonicalize round-trip.
- **Tests**: Jest i18n/keyboard suites 32/32 pass; `scripts/journey_crawler.js` FR depth-3 walked 134 screens with 0 issue markers (NO_REPLY/STRANDED/JS_ERROR none) — nav + feature buttons localized correctly. (HI/ZH crawl not re-run this session; FR exercises the same central path.)
- **Deploy**: committed + pushed to `WhiteLabel` (app-wl Smadav) and `main` (app-main Nomadly) on `servicedyno1/Nomadly-EMAIL-IVR`. The `/admin/sales` + `/branding` WL wiring (`_index.js` ~line 38018) is untouched — translation changes all sit below line ~34000, so the cross-branch propagation does not re-introduce the historical white-label clobbering.
- **Files**: `js/kb-i18n-buttons.js` (map), `js/kb-i18n.js` + `js/tg-opts.js` (interceptor, from prior session), `js/_index.js` (canonicalize wiring + codemod), `js/lang/*.js` + `frontend/src/locales/fr.json` (dictionaries), `scripts/check_untranslated.js` + `scripts/i18n_fill/` (lint/codemod tooling), `tests/kb-i18n.test.js`.


## 2026-09-30 — Anti-Red P0/P1 Improvements

### P0 #1: Scanner IP Auto-Refresh (Dynamic IPs)
- **Problem**: `SCANNER_IP_RANGES` in `anti-red-service.js` was static. Scanner networks (Censys, Shodan, GreyNoise) regularly rotate/add IPs that slipped through unblocked.
- **Solution**: New `js/scanner-ip-refresh.js` service fetches public scanner IP feeds daily, merges with the hardcoded base list, persists to MongoDB (`scannerIPFeeds` collection), and auto-redeploys the CF Worker when new IPs are found.
- **New function**: `getAllScannerIPs()` — merges base + dynamic IPs for use in Worker/htaccess generation.
- **Admin override**: `addAdminOverrides(ips, reason)` — manually add scanner IPs via code/Telegram.
- **Boot**: Wired into `_index.js` — loads cached IPs from MongoDB immediately, then refreshes from feeds 5 min after boot and every 24h.

### P0 #2: Chrome Version Ceiling Auto-Calculation
- **Problem**: `calculateBotScore()` hardcoded Chrome version thresholds (`>165`, `<90`) that go stale as Chrome releases ~monthly.
- **Solution**: `getChromeVersionCeiling()` dynamically calculates thresholds based on Chrome's release cadence (Chrome 120 = Dec 2023, +1 every 4 weeks). Returns `{ stable, suspicious: +15, maybeDev: +10, old: -40 }`. Embedded into both the CF Worker script and the client-side challenge page at generation time.

### P1 #3: Protection Files Moved Outside public_html
- **Problem**: `.user.ini` and `.antired-challenge.php` in `public_html` were vulnerable to accidental user deletion (uploads, zip extracts, File Manager).
- **Solution**: Protection PHP now deploys to `/home/<user>/.antired/challenge.php` (outside public_html). `.user.ini` remains in public_html (PHP requires it there) but is now a tiny 2-line pointer. `isProtectedAntiRedFile()` also guards the new `/.antired/` directory. Legacy files get a "MIGRATED" stub.
- **Heartbeat**: `checkAndRepair()` now checks both old and new locations (prefers protected).

### P1 #4: HTTP Health Probe as STUCK Second-Opinion
- **Problem**: False STUCK alerts when WHM reads are unreliable but the CF Worker is actually cloaking fine at the edge.
- **Solution**: `probeProtectionHealth(domain)` — before marking an account STUCK, does an HTTP GET with a scanner UA to see if cloaking/challenge/redirect is active. If protection works at the edge, resets the repair counter instead of alerting.

### P1 #5: Telegram Alert Dedup/Digest
- **Problem**: During WHM load spikes, each stuck account fired its own Telegram message (28 messages in the 2026-06-24 incident).
- **Solution**: `queueStuckAlert()` collects alerts during the heartbeat cycle; `flushStuckAlerts()` sends a single digest message at the end. Single-account alerts still get full detail; multi-account alerts get a bulleted summary.

### Brevo API Key Update (2026-09-30)
- Updated `BREVO_API_KEY` on both production bots (`app-main` + `app-wl`) on DO droplet + local dev `.env`.

## 2026-09-29 — Anti-Red CF Worker AJAX Bypass Fix
- **Problem**: Customer `stelworxllc.com` reported Live Panel showing empty (no sessions) on our WHM hosting. Same panel code worked on `redroom.ke` (LiteSpeed, no Cloudflare).
- **Root cause**: The Anti-Red Cloudflare Worker intercepted AJAX requests to `poll_sessions.php` with the "Verifying your browser" challenge HTML page. Since background XHR cannot complete an interactive PoI challenge, `$.getJSON` failed silently → no session cards rendered.
- **Fix**: Added Step 4b in the Worker's `handleRequest()` — detects same-origin AJAX requests via `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` (browser-only "forbidden" headers) and passes them directly to origin. IP bans, honeypots, and scanner redirects (botScore>=100) still execute before this bypass.
- **File changed**: `js/anti-red-service.js` (lines ~1950-1970 in `generateHardenedWorkerScript()`)
- **Deployed**: Both `main` and `WhiteLabel` branches pushed to GitHub; both `app-main` and `app-wl` deployed on DO droplet; CF Worker upgraded automatically at startup.
- **Verification**: `curl` with `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Dest: empty` returns PHP JSON (`X-AntiRed: ajax-passthrough`); without those headers, challenge page still served (`X-AntiRed: challenge`).

## 2026-06 (forked session) — /sales branding, Telnyx cleanup, cPanel audit

### FIXED & DEPLOYED — `/sales` showed Nomadly on WhiteLabel (app-wl)
- **Root cause**: the "Merge main into WhiteLabel" commit (7129cae9) resolved
  `frontend/src/App.js` and `js/_index.js` in favour of `main`, dropping the WhiteLabel
  white-label wiring: App.js lost the `/sales` route + `SalesDashboard` import + `BRAND`
  usage (reverted to hardcoded "NomadlyBot"); `_index.js` lost the `/admin/sales` API mount
  and the `/branding` endpoint. `SalesDashboard.js`, `branding.js`, `routes/sales.js` and
  `frontend/.env.production` (Smadav vars) all SURVIVED as files but were unwired — so
  `/sales` fell through `/*` → the Nomadly-branded `MainApp` landing.
- **Fix** (commit e78077f1 on WhiteLabel, pushed → CI auto-deployed app-wl):
  - `_index.js`: re-mount `routes/sales.js` at `/admin/sales` + re-add `GET /branding`.
  - `App.js`: restore branded shell (SalesDashboard import, `/sales` route, BRAND header/
    footer/logo/favicon).
  - `branding.js` + `index.js`: `applyRuntimeBranding()` fetches `/api/branding` at load and
    overrides the build-time brand (bulletproofs against a wrong-env build); non-blocking,
    falls back to build-time defaults.
  - `tailwind.config.js` + `index.css` + `public/index.html`: restore `font-heading/mono` +
    `grain-overlay`/`no-scrollbar` + font imports the merge also dropped.
- **Verified LIVE**: `https://1.smadavspeech.com/sales` serves new bundle `main.bdad10d4.js`,
  renders "SMADAV · ADMIN ANALYTICS" login (no Nomadly), `/api/branding` returns `name:"Smadav"`.
  Testing agent iteration_58 = 100% backend + 100% frontend.
- Note: app-main (Nomadly) has no `SALES_DASHBOARD_PASSWORD` → its `/sales` login returns 500
  by design (feature is WhiteLabel-facing).

### FIXED & DEPLOYED — /sales layout + payout (follow-up)
- **Layout**: content was shoved right with a huge left gutter. Cause: the merged `App.css`
  had `.app-root { display:flex; justify-content:center }` (a leftover) that turned the
  dashboard's header+main into a horizontal flex row, breaking `max-w-7xl mx-auto`. Restored
  `.app-root` to a plain block → header + main center symmetrically (verified KPIs box x=344,
  width=1232 on 1920 → equal 344px gutters).
- **Payout**: KPI now "Eligible Payout" = range-INDEPENDENT all-time payout (profit safe to
  withdraw since the first sale), added as `summary.eligiblePayout` in routes/sales.js
  (computed over ALL transactions regardless of the selected range). Replaces "This Week's
  Payout". Deployed live (bundle main.2f1faf21.js).

### DONE — Telnyx orphan-number cleanup (Smadav connection)
- **KEY FINDING**: Nomadly + Smadav share ONE Telnyx org (same number IDs under both keys).
  Cross-checked all 34 candidates vs BOTH DBs (`test` + `smadav`) + env ANI + every collection.
- Released **30** confirmed-unowned numbers (HTTP 200 each). **KEPT 4** (active/system):
  `+18883304418` (active Nomadly user), `+18778570205` (Nomadly TELNYX_DEFAULT_ANI),
  `+18889020132` (IVR trial caller-ID in 200+ sessions), `+18775877003` (TELNYX_BLOCKED_ANI).
  Verified: Smadav Telnyx account now holds exactly those 4. Scripts in `scripts/*.js`, audit in
  `memory/SMADAV_ORPHAN_NUMBERS_2026-09-30.md`.

### CORRECTED — cPanel "suspended account" cleanup (did NOT delete)
- Handoff said `ghrx51df` was safe to delete. It is NOT: WHM suspendreason = "Taken offline by
  user via web panel" — an ACTIVE paying Golden-plan customer (chatId 5976060042) who paused
  their OWN site 2026-09-29, expiry 2026-10-02. **Left intact.**
- The genuinely expired one is `sequfa15` (sequeldex.de, "Plan expired", expired 2026-09-29).
  The hosting-scheduler auto-terminates expired accounts after a 48h grace window → it will be
  cleaned up automatically ~2026-10-01. No manual action taken (would block last-minute renewal).

### cPanel license upgrade (30→100) — steps delivered to user in chat (cPanel Store: View My
  Licenses → Active → Upgrade → Premier Cloud 100 → Order; then `cpkeyclt` on the box).

## 2026-10-01 — Production log audit (DO droplet, both bots) — see memory/PROD_LOG_AUDIT_2026-10-01.md
- **No real crashes** (PM2 ↺=0). Earlier "16 FATAL / 4 crashed / 429s" were scheduler `tick crashed` lines during a
  5-min Railway-Mongo blip + phone numbers containing "429".
- FIXED & DEPLOYED (main af732fb8 / WhiteLabel 04c9c3c0): binary leads upload → Telegram parse error (bulk IVR),
  `allIPs` ReferenceError in .htaccess deploy, ProtectionHeartbeat WHM-timeout circuit breaker + outage paging,
  `ensureCloudflare` stale-cfZoneId self-heal (96 stale zone ids in DB).
- ENV FIXED on droplet: `MAIL_PORT=2525` (DO blocks 587/465 — hosting-credential emails were timing out) and the
  Brevo key that was "rotated" 09-30 but never reached the live env (`/opt/nomadly/shared/<app>/backend.env` is the
  runtime env; legacy `/opt/nomadly/<app>/backend/.env` is now a symlink to it). Both apps blue/green redeployed.
- NGINX cleaned: stale `accedzonelienusageuniquedonotshare.ch` vhost, duplicate `nomadly-domains` include, duplicate
  `panel.2.hostbay.io` site → `nginx -t` warning-free.
- **USER ACTION**: ConnectReseller panel password expired ("reset your password and enable 2FA") → IP
  146.190.238.190 cannot be auto-whitelisted → domain price checks 401 on both bots. Telnyx balance ~$8.

## 2026-10-01 — Bot journey dead-end audit ("user couldn't select a plan") — see memory/BOT_JOURNEY_AUDIT_2026-10-01.md
- ROOT CAUSES FIXED (5): FR/ZH/HI phone-plan buttons unmapped (`planByButton` EN-only) → "Veuillez sélectionner un
  forfait" loop; `/start` resume prompt returned before resetting `action` → "Complete My Order" swallowed forever;
  node-telegram-bot-api mutating shared `reply_markup` objects (now cloned in `js/tg-opts.js`); stale first-session
  intent buttons mis-routed (AI/reset/silence); `/start` debounce lying mid-flow. PLUS 20 hi/zh locale templates
  that threw ReferenceError (`${phoneConfig.plans.starter.मिनट}`, `${sp.hint}`, …) → HI/ZH never saw "Choose a Plan".
- TOOLING: `scripts/journey_crawler.js` (walks every reply/inline button; flags NO_REPLY/STRANDED/UNRECOGNIZED/
  AI_FALLBACK/INVALID_OPT/KB_LOST/NO_PROGRESS/JS_ERROR), `scripts/journey_scenarios.js` (scripted purchase journeys
  incl. free text), `scripts/lib/tg_sim.js`, dev-only `[tg-out]` trace, `js/tests/mock_telegram_api.js`
  (sandbox `TELEGRAM_API_BASE_URL=http://127.0.0.1:5099`). Jest: `tests/tg-reply-markup-mutation.test.js`,
  `tests/phone-plan-buttons-i18n.test.js`, `tests/locale-templates-render.test.js`.
- RESULTS: crawler depth 3 EN 273 / FR 274 / HI 313 / ZH 313 screens = 0 issues; scenarios EN 8/8, FR 8/8.
- DEPLOYED 2026-10-01 08:40Z: main 092363f0 → app-main-a, WhiteLabel fc9b943c → app-wl-b (blue/green, /health 200, no boot errors).

## Resolved — 2026-10-06 (reseller API doc — VPS management endpoints + ssh-key alias)
- **4 VPS management endpoints were registered but undocumented** in `/apidoc`
  (`js/apidoc-page.js`): `POST /vps/:id/password-reset`, `POST /vps/:id/ssh-key`,
  `GET /vps/:id/ssh-keys`, `POST /vps/:id/reinstall`. All now documented (the VPS
  section previously stopped at `/vps/:id/renew`; RDP was already complete). Also
  added the create-time `ssh_keys` param to the `POST /vps` doc entry.
- **Plural POST alias added**: `POST /vps/:id/ssh-keys` now routes to the same
  handler as the singular `POST /vps/:id/ssh-key` (`js/reseller-api.js`) — kills the
  `404 Cannot POST` footgun from the singular-write / plural-read naming mismatch.
  Running-server key injection (SSH append to root authorized_keys) was always
  supported; the "provider has no API for this" claim was incorrect.

## Resolved — 2026-10-06 (prod log-anomaly follow-up; see PROD_ANOMALY_FIXES_2026-10-06.md)
- **Crypto IPN / global handler 500 on malformed JSON → now 400 (CODE FIX, verified)**:
  global Express error handler in `js/_index.js` now respects body-parser 4xx errors
  (malformed JSON → 400 "Invalid request body") instead of always 500. Stops
  vulnerability-scanner junk from logging as false-alarm 500s.
- **BifurcationHealCron path — already fixed in repo**: code uses portable relative
  `require('../scripts/heal_bifurcated_domains')`; loads + schedules cleanly in-pod.
  Prod error is from an old release → resolve by redeploying current code (ensure
  `scripts/` is bundled).

## Resolved — 2026-10-08 (in-place plan change: VPS / RDP on DigitalOcean + Hosting)
- **Engine** `js/do-plan-change.js` (DigitalOcean only): plan options + pro-rata quote, lock → wallet charge →
  background resize (graceful shutdown → hard power_off fallback → resize CPU/RAM only by default → restore
  previous power state) → persist (productId, planPrice, do_size_slug, diskGb, planChange, planChangeHistory;
  RDP also doRdpServers.tier_slug/product_id). Failure = auto-refund. `reconcileStale` (in reseller
  provisionWorkerTick, live only) finishes/refunds changes orphaned >90 min by a restart.
- **Policy (user-approved)**: upgrade charged now = (new monthly − current monthly) × days left / 30; downgrade
  immediate, NO refund; new price from next renewal; term end never moves; disk growth opt-in only
  (`resize_disk:true` / bot "Grow disk (permanent)"); targets with a disk smaller than the droplet's current
  disk are blocked (`disk_too_small`); only in-stock sizes listed.
- **Reseller API**: `GET /vps|rdp/:id/plan-options`, `POST /vps|rdp/:id/upgrade` (+ `/change-plan` alias) →
  202 running, `{dry_run:true}` pre-flight, 402 shortfall, 409 in-progress; `GET /vps|rdp/:id` → `plan_change`;
  webhooks `vps|rdp.plan_changed` / `vps|rdp.plan_change_failed`. Hosting: `GET /hosting/:user/plan-options`,
  `POST /hosting/:user/upgrade` (+ `/change-plan`) rewritten (js/hosting-plan-change.js): daily-rate pro-rata,
  downgrades free/no refund, expiry unchanged, 409 expired / account_suspended / too_many_addon_domains.
  Old loyalty-credit logic removed from the API (bot hosting upgrade still uses loyalty credit).
- **Bot**: "⬆️ Upgrade" on a DigitalOcean VPS/RDP now opens one list of upgrades/downgrades with pay-now amounts
  → disk keep/grow screen (only when the target disk is larger) → summary → Confirm (wallet only) → completion
  message (en/fr/zh/hi). Non-DO servers keep the legacy flow.
- `digitalocean-service.isProductAvailable` accepts raw DO region slugs (RDP ams3/tor1/nyc2…);
  `digitalocean-rdp-service` exports `serversCollection`. Docs in `js/apidoc-page.js`.
- **Tests**: `js/tests/test_do_plan_change_2026-10.js` 28/28 (fake DO/WHM); jest 33 suites green; LIVE test
  (iteration_69) on a throwaway droplet: bot upgrade s-1vcpu-1gb→s-1vcpu-2gb ($11.99 pro-rata, ~90 s) and
  downgrade back ($0, ~100 s) both real; droplet destroyed after. Re-run script: `tests/test_bot_plan_change_live.js`.
- **Not live in production until "Save to GitHub" + redeploy.**

## Resolved — 2026-10-08 (VPS / RDP usage endpoints, API only)
- `GET /reseller/v1/vps/:id/usage` and `GET /reseller/v1/rdp/:id/usage` (`?period=1h|24h|7d|30d`, default 24h),
  DigitalOcean servers only (`js/do-usage.js`). Returns specs (incl. monthly_transfer_gb), CPU % now/avg/peak,
  memory used/total + now/avg/peak, disk used/total, load (VPS), public bandwidth now/avg/peak Mbps + GB in/out
  (estimated from DO's sampled rate), sample_interval_seconds, notes. Cache 1 min (1h) → 30 min (30d).
- VPS: DO Monitoring API (agent installed at creation via monitoring:true; without it memory/disk/load null).
- RDP: bandwidth from DO; CPU/RAM/C: from our in-guest agent — `apply.ps1` Get-AgentMetricsQuery appends
  cpu/mem/disk to the every-minute `/provision/commands` poll → `doRdpServers.agent_metrics` + 5-min samples in
  `doRdpAgentMetrics` (TTL 31 d). Existing RDPs start reporting after their next restart (bootscript self-update).
  apply.ps1 parse-checked with pwsh 7.4.6 (0 errors, invariant number formatting).
- Tests: `js/tests/test_do_usage_2026-10.js` 11/11; iteration_70 green (live read-only DO probe plausible).

## Pending Issues (carried forward)

### P1
- **ConnectReseller 401 (domain pricing) — BLOCKED on user**: reset CR panel password, whitelist 146.190.238.190,
  update `CR_PANEL_PASSWORD` in both `shared/*/backend.env` + vault. (Was listed as two issues: Domain Price API 401 +
  CR-Whitelist login 401 — same root cause.)
- Contabo API Auth Failing (VPS Provisioning broken) — BLOCKED on user credentials
- Telnyx balance low (~$8) — top up

### P2
- Droplet SSH Security Vulnerability (Root brute-force attacks) — need fail2ban (user deferred this session)
- Delete unused cPanel accounts on WHM — RESOLVED: `ghrx51df` is an active user-paused account (DO NOT delete); `sequfa15` auto-terminates via 48h scheduler.
- Panel test-email / EmailBlast transports use ports 25/465/587 → blocked from the droplet by DO policy (only matters if those features are used from the droplet)

### P2 (Future)
- Bot hosting upgrade still uses the old loyalty-credit quote (API now pro-rata + no-refund downgrades) — align if wanted
- Bot plan change is wallet-only (no crypto/bank checkout for the pro-rata amount)
- Boot-time Telegram ping for DO power-cycles
- WHM `whm2-fra1` stability: rebooted twice on 09-28; cpsrvd stopped serving per-user API reads for 32h afterwards until its nightly restart (now detected + paged by the heartbeat breaker)
- Stale-zone sweep: 96 registeredDomains carry cfZoneIds not in our CF account (now self-healed lazily on next DNS action; a one-off sweep could clear them proactively)
