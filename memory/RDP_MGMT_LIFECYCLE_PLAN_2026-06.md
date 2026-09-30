# RDP Management Lifecycle — Test + 3-Day Grace Auto-Destroy (PLAN for next agent)

_Investigation done 2026-06 (this fork). User PAUSED before implementation and asked to document the plan._
_Respond to the user in ENGLISH only._

## What the user asked (verbatim intent)
1. **"can we test all RDP management like re-install, off, on, restart, renew, etc"** — user chose **option (a): a full LIVE end-to-end test on ONE real DigitalOcean droplet** (real billing, auto-destroy at end).
2. **"ensure droplet destroys if not renewed after 3 days grace period (droplets from DigitalOcean should behave this way because they charge us per hour/min)"** — i.e. an unrenewed/expired RDP droplet must be **DESTROYED (not just powered off)** after a **3-day grace period**, because DO bills powered-off droplets too.

### ✅ DECISIONS (locked by user 2026-06 — do NOT re-ask)
- **Live test box:** **OS = ws2022, Region = US** (agent's call, approved by user via "decide the two above for me"). ws2022 is the reference edition.
- **Grace clock start:** **at end of subscription** (i.e. from `expires_at` / `vpsPlansOf.end_time`). Destroy = `expiry + 3 days` if not renewed.
- **Notifications REQUIRED** on entering the 3-day grace AND on final deletion, to BOTH:
  - the **bot user** (Telegram), and
  - the **reseller API** consumer (surfaced in API responses — the reseller API is pull-based, there is NO webhook system; see Part 2C).

---

## PART 1 — RDP management surface (ALL already implemented; verified in code)

### Service methods — `js/digitalocean-rdp-service.js`
| Op | Function | Line | Behaviour |
|----|----------|------|-----------|
| provision | `createInstance` | 1074 | golden fast path |
| status | `getInstance` | 1174 | live DO + agent state |
| **on** | `startInstance` | 1302 | `power_on` → status `active` |
| **off** | `stopInstance` | 1303 | `power_off` → status `suspended` |
| shutdown | `shutdownInstance` | 1304 | graceful `shutdown` → `suspended` |
| **restart** | `restartInstance` | 1305 | `reboot` |
| **reinstall** | `reinstallInstance` | 1243 | DO **rebuild** from golden image, **keeps IP**, can switch edition |
| password reset | `resetPassword` | 1222 | in-place via agent (needs `agent_online`) |
| **renew** | `renewInstance` | 579 | extends `expires_at` by 30×months; powers ON if expired/suspended |
| destroy | `cancelInstance` | 1307 | deletes droplet + volume + secret; sets `doRdpServers.status='destroyed'` |
| expiry sweep | `processExpiries` | 1321 | **hourly** (`setInterval` L378). Today only **powers off** expired → `status='expired'`. **NEVER destroys** ← the billing leak to fix |
- Power helper: `_dropletActionByServer` (L1293). Exports at L1419.

### Reseller API — `js/reseller-api.js`
- `POST /rdp/:id/action` `{action: start|stop|reboot|restart|shutdown}` → `vpsActionHandler` (L514; map L518).
- `POST /rdp/:id/password-reset` (L~560) → `resetPassword`.
- `POST /rdp/:id/reinstall` `{os}` (L580) → `reinstallInstance`.
- `GET /renewals` (L879) lists rdp/vps/domain/hosting; RDP rows read from `vpsPlansOf`.
- **No `POST /rdp/:id/renew` endpoint exists.** RDP renew is only the service method, wired into the bot VPS scheduler (see below). If the user wants API-driven renew, add `POST /rdp/:id/renew {months}` → `prov.renewInstance` (mirror the reinstall handler).

---

## PART 2 — THE 3-DAY GRACE DESTROY (core of the user request)

### CRITICAL: there are TWO expiry engines — reconcile them, do not create a double-destroy
1. **RDP service `processExpiries()`** — `digitalocean-rdp-service.js` L1321-1333. Sweeps `doRdpServers` where `status='active' && expires_at<=now` → `power_off` + `status='expired'`. Runs hourly (L378) **only when `SKIP_WEBHOOK_SYNC!=='true'`** (⇒ **DISABLED on this sandbox**). `expires_at` is set at activation = `activated + 30×duration_months days` (`applyActivation`, L566-571).
2. **Bot VPS scheduler** — `js/_index.js` from **L36640**, operates on `vpsPlansOf` (the customer-facing catalog). This is the authoritative renew/cancel engine:
   - `_isPAYGProvider()` (L36654) → **true for `digitalocean-rdp`**, vultr, azure.
   - Phase 1 (T-24h, L36680): auto-renew if `autoRenewable`; else `PENDING_CANCELLATION`. PAYG NOT early-cancelled.
   - Phase 1.5 (T-5h, L36784): pre-emptive Contabo cancel; **PAYG skipped**.
   - **Phase 2 (end_time<=now && PENDING_CANCELLATION, L36873): `deleteVPSinstance` → DESTROY. For PAYG incl. DO-RDP this destroys AT end_time with ZERO grace.** ← conflicts with the user's 3-day-grace ask.
   - Phase 3 (L36936): stale RUNNING past expiry → PENDING_CANCELLATION.
   - Phase 4 (L36977): T-3d..T-1d reminders.
   - `vpsPlansOf.autoRenewable` **defaults to `false`** (`vm-instance-setup.js` L932). `deleteVPSinstance`→ per-record dispatch → for DO-RDP calls `svc.cancelInstance`.

**Net today:** an unrenewed DO-RDP box is destroyed by the bot scheduler at end_time (0 grace), while the RDP-service sweep would only power it off. To honour the user's **3-day grace** we must pick ONE owner and stop the other from destroying early.

### RECOMMENDED implementation — bot VPS scheduler OWNS the DO-RDP grace lifecycle; RDP-service sweep is the safety net
Because the **bot user must be notified** (Telegram) and only the bot scheduler has `send`/`chatId`/`lang`/`translation`, make the **bot VPS scheduler (`_index.js`) the single owner** of the DO-RDP grace lifecycle. The RDP-service `processExpiries()` becomes a defensive safety net. Both write the SAME grace fields so the reseller API reads a consistent state.

**Grace fields (write on both `vpsPlansOf` AND `doRdpServers`):**
- `expired_at` — when the subscription ended / server was powered off.
- `grace_until` = `expiry + T.graceDays days` — the destroy deadline.
- `status`: active-subscription → (expiry) `expired`/`EXPIRED_GRACE` (powered off, in grace) → (grace elapsed) `destroyed`/`CANCELLED` with `destroy_reason:'expired_grace'`.

**A. Bot VPS scheduler — `js/_index.js` (~L36640, `vpsPlansOf`)**
For records where provider is **`digitalocean-rdp`** (use `_isPAYGProvider` + a `digitalocean-rdp` sub-check):
1. **At end_time (Phase 2 / stale Phase 3):** do NOT `deleteVPSinstance`. Instead `provider.stopInstance(vpsId)` (power off, stops customer access), set `{status:'EXPIRED_GRACE', expired_at:now, grace_until: end_time+3d}` on `vpsPlansOf`, and **notify the bot user** (new locale key `rdpGraceStart`, see 2C) with a Renew CTA. Also mirror to `doRdpServers` (`_graceUntil`/`expired_at`).
2. **~24h before `grace_until` (optional reminder):** send `rdpGraceReminder` (guard with a `_graceReminderSent` flag).
3. **When `now >= grace_until`:** `deleteVPSinstance(chatId, vpsId)` → destroys the DO droplet (routes to `svc.cancelInstance`), set `{status:'CANCELLED', cancelledAt:now, cancelReason:'expired_grace'}`, and **notify the bot user** (new locale key `rdpDeletedAfterGrace`). Keep the existing throttled admin alerts + retry logic from Phase 2.
4. Renewal (Phase 1 auto-renew, or manual renew path) must **clear** `expired_at`/`grace_until`/`EXPIRED_GRACE` and power the box back on (renew already calls `_syncProviderRenewal` → `svc.renewInstance`, which powers on).

**B. RDP-service safety net — `js/digitalocean-rdp-service.js`**
1. Add `T.graceDays: 3` (T is L133).
2. `init` (L357): store `_db = db` (to mirror `vpsPlansOf`).
3. `processExpiries()` (L1321): keep Sweep-1 (active past `expires_at` → power_off + `status:'expired'` + set `expired_at`/`grace_until`). Add Sweep-2 as a **safety net**: `{status:'expired', do_droplet_id:{$ne:null}, grace_until:{$lte: now}}` → `cancelInstance` + `destroy_reason:'expired_grace'` + mirror `vpsPlansOf`. This only fires if the bot scheduler missed the record (it normally won't, since the scheduler owns it). Defensive try/catch per row.
4. `renewInstance` (L579): add `expired_at:null, grace_until:null` to the `set` on reactivation.
   - `vpsPlansOf` linkage: RDP records use `contaboInstanceId = vpsId = String(instanceId) = extId(server_id)` (`vm-instance-setup.js` L910-940). Mirror with `{$or:[{contaboInstanceId: extId(id)},{vpsId: extId(id)}]}`.

**Why the scheduler owns it and the service is the net:** avoids the double-destroy (today Phase 2 destroys DO-RDP at end_time with 0 grace — that MUST change to the power-off + grace flow above), keeps all user-facing Telegram copy in the bot, and still guarantees teardown (stops DO billing) even if the scheduler misses a cycle.

### Part 2C — NOTIFICATIONS (bot user + reseller API)
**Bot user (Telegram)** — add locale keys to ALL 4 files `js/lang/{en,fr,zh,hi}.js` (keep `npm run lint:lang` parity green):
- `rdpGraceStart(displayName, deleteDate)` — "🖥 **{name}** expired and was **powered off**. It will be **permanently deleted on {deleteDate}** (3-day grace) unless you renew. Renew now: VPS/RDP → Manage → Renew." Send when entering grace.
- `rdpGraceReminder(displayName, deleteDate)` — optional ~24h-before-deletion reminder.
- `rdpDeletedAfterGrace(displayName)` — "🗑 **{name}** was **permanently deleted** after the 3-day grace period ended without renewal. All data is gone." Send at deletion.
- Existing generic keys (`util_1` expiring, `util_5` deleted) are Contabo/VPS-worded — add RDP-specific keys rather than reuse, to avoid the "VPS" wording leak.

**Reseller API (pull-based — surface state; NO webhook exists)** — `js/reseller-api.js`:
- `GET /rdp/:id` (L~503-509): add a `grace` block when the server is in grace, e.g. `grace: { in_grace: true, expired_at, delete_at: grace_until, days_remaining }`, and reflect `status:'expired'`→`'destroyed'` with `destroy_reason:'expired_grace'` after deletion. Source from `vpsPlansOf` (`expired_at`/`grace_until`) + live `getInstance`.
- `GET /renewals` (L879): for rdp/vps rows already computed, add `in_grace`, `delete_at`, `days_until_deletion` when `status` is expired/EXPIRED_GRACE so a polling reseller sees the pending deletion.
- (Optional, if the user later wants push) there is no webhook framework today; a future `webhook_url` per reseller key + an event emitter would be a separate feature — document as backlog, don't build now.
- If adding API-driven renew: `POST /rdp/:id/renew {months}` → `prov.renewInstance` (mirror the reinstall handler) so a reseller can clear the grace via API.

### Sandbox testing note
`SKIP_WEBHOOK_SYNC='true'` on this pod ⇒ `processExpiries` interval is OFF and the bot scheduler may be gated too. To test the grace path, **call `processExpiries()` manually** (or seed `expired_at` 4 days in the past) rather than waiting on the interval.

---

## PART 3 — LIVE E2E TEST PLAN (user picked option a)

### Existing coverage
`js/ops/rdp_lifecycle_e2e.js` already does: create (golden fast) → NLA login → wait agent → resetPassword → NLA login → reinstall (other edition) → NLA login → destroy. It does **NOT** cover off/on/restart/renew/grace.

### Build `js/ops/rdp_full_mgmt_e2e.js` (extend the existing one)
Provision ONE real droplet, then run in order and assert each:
1. create → active + fast_deploy + NLA login (default pw)
2. wait `agent_online`
3. **stopInstance (off)** → DO droplet `status=off`, `doRdpServers.status='suspended'`
4. **startInstance (on)** → DO `status=active`, `doRdpServers.status='active'`, port 3389 back, NLA login
5. **restartInstance (reboot)** → reboot action completes, 3389 recovers
6. **resetPassword** → new pw, NLA login with new pw
7. **reinstallInstance (other edition)** → active + IP kept + os switched + NLA login (reinstall boots the **user-data** pw; see `rdp_reinstall_check.js`)
8. **renewInstance(1)** → `expires_at` extended ~30 days; `expired_at` cleared
9. **grace-destroy** → set `{status:'expired', expired_at: now-4d, grace_until: now-1d}` on the `doRdpServers` doc, `await svc.processExpiries()` (safety-net sweep), assert droplet destroyed at DO (404) + `doRdpServers.status='destroyed'`, `destroy_reason='expired_grace'`, `vpsPlansOf` mirrored to CANCELLED. (The bot-scheduler-owned path can't run on sandbox — `SKIP_WEBHOOK_SYNC=true` — so the live E2E exercises the RDP-service safety net; test the scheduler path + notifications in the unit test.)
10. finally `cancelInstance` (idempotent) — always on SIGINT/TERM/HUP + normal exit (existing scripts already do this)

Run: `node js/ops/rdp_full_mgmt_e2e.js --os ws2022 --region US` (needs nodejs supervisor up — serves `/provision` + agent commands). Set `DO_RDP_GOLDEN_AUTOSYNC=false` in the script (like the others) so it never resumes golden builds.

### Expectations / gotchas
- **Cost:** ~$0.05-0.10, one droplet ~25-30 min. Always destroyed on exit.
- **NLA login checks are INFORMATIONAL** — pod egress to :3389 may be blocked, and the golden-image callback to the sandbox preview host does not resolve (known artifact; backend still declares active ~90s after 3389 opens). Judge PASS on DO/Mongo state, not on NLA.
- Golden images ws2019/ws2022/ws2025 are all `available` → fast path works right now.

### Also add a unit test (no droplet): `js/tests/test_rdp_grace_destroy_2026-06.js`
Mock the DO client + local mongo; assert:
- expiry → power_off + `expired_at`/`grace_until` set on both `doRdpServers` and `vpsPlansOf`;
- in grace (`now < grace_until`) → NOT destroyed; server powered off;
- grace elapsed (`now >= grace_until`) → `cancelInstance`/`deleteVPSinstance` called + status destroyed + `vpsPlansOf` mirrored;
- renew clears `expired_at`/`grace_until` and reactivates;
- **notifications fire**: `rdpGraceStart` sent on grace entry, `rdpDeletedAfterGrace` sent on deletion (spy on `send`);
- locale-key parity: all new keys exist in en/fr/zh/hi.
Fold into the golden suite pattern.

---

## PART 4 — Regression + verification after coding
- `node js/tests/test_do_rdp_golden_2026-06.js` (currently **91/91** — keep green).
- `node js/tests/verify_rdp_tasks_render.js` (44).
- New `test_rdp_grace_destroy_2026-06.js`.
- If reseller API wiring changed (e.g. added `/rdp/:id/renew`): `testing_agent` for the reseller endpoints (backend only). Use sandbox reseller API key in `memory/test_credentials.md`.
- Then the LIVE `rdp_full_mgmt_e2e.js` once.

---

## GUARDRAILS (do not break)
- 🚧 **Golden image rebuilds are STILL IMPORTING** (3 running; ws2022 importing at DO; ws2019/ws2025 waiting for the import slot). Watcher process `bash /app/memory/_golden_watch.sh` (PID 3277) logs to `memory/golden_rebuild_2026-09-24.log`. **Do NOT restart supervisor/nodejs or interrupt these.** A new fast-path test droplet is independent and safe.
- Production Mongo is LIVE (Railway). Grace-destroy touches `doRdpServers` + `vpsPlansOf` — test on sandbox / a fresh throwaway droplet first.
- `SKIP_WEBHOOK_SYNC='true'` and `BOT_ENVIRONMENT='production'` in `/app/backend/.env` — never change.
- `VPS_RDP_PROVIDER='azure'` in sandbox .env (vault restores it). DO-RDP path is reached via per-record dispatch; the E2E script calls the DO service directly so the env value doesn't block the ops test.
- Prod currently has **0 live DO-RDP orders**. DO inventory = WHM + dynopay + the 3 golden-build droplets (auto-destroyed after import).
- Vault password (handoff): `Katiekendra123@`. Reseller API key: `memory/test_credentials.md`.

## Files to touch
- `js/_index.js` — VPS scheduler (~L36640): DO-RDP grace lifecycle OWNER (power-off at end_time, set `expired_at`/`grace_until`, user notifications, destroy after grace). Replace the current 0-grace Phase-2 destroy for `digitalocean-rdp`.
- `js/digitalocean-rdp-service.js` — `T.graceDays`, `_db` in `init`, `processExpiries` safety-net Sweep-2, clear `expired_at`/`grace_until` in `renewInstance`.
- `js/lang/{en,fr,zh,hi}.js` — new keys `rdpGraceStart`, `rdpGraceReminder`, `rdpDeletedAfterGrace` (lint:lang parity).
- `js/reseller-api.js` — `grace` block on `GET /rdp/:id`; `in_grace`/`delete_at`/`days_until_deletion` on `GET /renewals`; (optional) `POST /rdp/:id/renew {months}`.
- New: `js/ops/rdp_full_mgmt_e2e.js`, `js/tests/test_rdp_grace_destroy_2026-06.js`.

## Suggested order of execution
1. Implement the DO-RDP grace lifecycle in the bot VPS scheduler (Part 2A) + grace fields.
2. Add RDP-service safety-net sweep + `renewInstance` clear (Part 2B).
3. Add locale keys + user notifications (Part 2C, bot side).
4. Add reseller API grace fields (Part 2C, API side) + optional `/rdp/:id/renew`.
5. Unit test `test_rdp_grace_destroy_2026-06.js` + regression suites green (`test_do_rdp_golden_2026-06.js` 91/91, `verify_rdp_tasks_render.js` 44, `npm run lint:lang`).
6. `testing_agent` (backend) for reseller RDP endpoints if wiring changed.
7. Build + run the LIVE full-mgmt E2E once on **ws2022 / US** (Part 3); confirm every op + safety-net grace-destroy; auto-destroy the box.
8. `finish` + update PRD.md / test_credentials.md.

## Backlog (not now)
- Reseller **push** webhooks (`webhook_url` per key + event emitter for `rdp.grace_start` / `rdp.deleted`) — no framework exists today; API is pull-only. Build only if the user asks.

---

## ✅ IMPLEMENTATION STATUS (2026-06 fork — updated end of session)
Code + mocked tests COMPLETE and self-verified. Only the LIVE E2E (Part 3) remains.

- ✅ **Part 2A/2B/2C DONE + testing_agent-verified (iteration_53)**: bot scheduler owns the DO-RDP grace lifecycle (`js/_index.js` Phase 2-RDP), RDP-service safety-net sweep + `markGrace`/`markGraceDestroy` + `renewInstance` grace-clear (`js/digitalocean-rdp-service.js`), 4-locale keys, reseller API grace fields on `GET /rdp/:id` + `GET /renewals`, new `POST /rdp/:id/renew {months}` (bundle-priced, clears grace).
- ✅ **Reminder lead time is now CONFIGURABLE** (`js/rdp-grace-lifecycle.js`): `RDP_GRACE_REMINDER_LEAD_HOURS` env (default 24). Exposed as `REMINDER_LEAD_HOURS`/`REMINDER_LEAD_MS`.
- ✅ **Reseller PUSH webhooks BUILT** (moved out of backlog): `js/reseller-webhooks.js` (`emit()` — plain POST, no signature, auto-retry/backoff, idempotent per `(keyId,event,instanceId)` via `resellerWebhookDeliveries`). Events: `rdp.grace_start`, `rdp.deleted`. Wired into BOTH the bot scheduler (`applyRdpGrace` `notifyReseller` dep) and the RDP-service safety-net sweep (`_emitResellerWebhook`, fire-and-forget). Resellers register a URL via `PUT /account/webhook {webhook_url}` (GET to read, null to clear); `GET /account` returns `webhook_url`. Documented in `js/apidoc-page.js`.
- ✅ **Tests**: `js/tests/test_rdp_grace_destroy_2026-06.js` = **73/73** (state machine, Sweep-1/Sweep-2 vs fake DO + local Mongo, renewInstance, markGrace/markGraceDestroy, 4-locale parity, reminder-lead config, webhook emit/dedup/delivery). Regression green: golden 91/91, render 44/44, phone-scheduler 34/34, `lint:lang` OK. Live curl checks: `/renewals` grace + `/rdp/:id` grace block + `/rdp/:id/renew` ($56/$100.8/$142.8, 404, 409) + `/account/webhook` set/read/invalid-400/clear.
- ⚠️ **items 3 (reminder config) + 4 (webhooks) were NOT re-run through testing_agent** (self-tested via the unit suite + live curl only). Optional: run testing_agent on the webhook endpoints + emit path for a second opinion.
- ✅ **DONE — LIVE E2E (Part 3) RAN + PASSED** (`js/ops/rdp_full_mgmt_e2e.js`, ws2022/US, real DO droplet, ~$0.01 actual). Verified live: create(fast)→active, off→suspended+DO off, on→active+DO active+3389, restart→3389 recovered, resetPassword→agent-confirmed, reinstall→ws2019 IP-kept+os-switched, renew→expires_at +30d & grace cleared, and grace-destroy via `svc.processExpiries()` → doRdpServers destroyed/expired_grace + vpsPlansOf CANCELLED/expired_grace + **DO droplet 404 (confirmed via DO API)**. 0 leaked droplets (DO inventory checked). Script's `grace_droplet_404` check hardened to poll DO's async DELETE up to 90 s. Details in PRD.md "LIVE E2E RAN + PASSED".
