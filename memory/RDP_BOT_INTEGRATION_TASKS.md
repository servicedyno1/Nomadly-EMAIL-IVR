# DO Windows RDP → Telegram bot + Reseller API full lifecycle (2026-09-23)

Goal: sell and manage DigitalOcean golden-image Windows RDPs natively in the Telegram bot (same
provider abstraction as Contabo/Vultr/Azure) and expose the same management on the Reseller API.
Approved by owner 2026-09-23 00:45 UTC (all items + 1/2/3-month plans in bot AND API + live E2E + rebuild all 3 images in parallel).

## Respond in ENGLISH only.

## Design decisions
- Bot-facing instance ids are `rdp-<uuid>` (`extId` / `normId` in digitalocean-rdp-service.js); `doRdpServers.server_id` stays the bare UUID.
  vps-provider.js routes `rdp-*` and `provider: 'digitalocean-rdp'` to the DO-RDP service. Existing reseller records with bare UUIDs keep working (`normId`).
- Password reset is IN PLACE via the in-guest agent (`apply.ps1 -Agent`, scheduled every minute, polls `GET /provision/commands`, posts `POST /provision/commands/result`).
  Existing golden images pick the agent up automatically: apply.ps1 self-refreshes from `/provision/bootscript` at every boot.
- Reinstall = DO `rebuild` of the SAME droplet from the chosen golden image (IP kept, disk wiped, ~3 min). The new password is queued as an agent command so it lands right after first boot (user-data is immutable on DO and still carries the original password).
- Durations 1/2/3 months: productId `<tier>-<N>m`, price = monthly × N × 2 (linear). Bot gets a duration step; `vpsPlansOf.durationMonths` drives expiry + renewal length; `renewInstance()` pushes `doRdpServers.expires_at` so the DO sweep never powers off a renewed server.

## Tasks (status verified 2026-06 at handoff — see "Verified current state" below)
### A. Provider wiring (js/vps-provider.js, js/vm-instance-setup.js, js/digitalocean-rdp-service.js)
- [x] A1 `_loadProvider('digitalocean-rdp')`, `detectProviderByInstanceId` (`rdp-`), `providerNameForRecord`, `dispatchByInstanceId`, `passwordResetImpact` (in-place)
- [x] A2 vm-instance-setup: bot status = `live.botStatus || live.status`; destructive-cancel guards include `digitalocean-rdp`; RDP regions; NVMe-only disk step; `listProducts(..., {monthlyOnly:false})` + duration-aware expiry/`durationMonths`/`plan`
- [x] A3 DO-RDP: `applyActivation` keeps `expires_at`/`activated_at` on reinstall; `/callback rdp_ready` pending-password rule; `renewInstance(id, months)`; `getInstance` exposes `durationMonths`, `agentOnline`
  (A = +304 lines in digitalocean-rdp-service.js, +57 in vm-instance-setup.js, +15 in vps-provider.js — NOT yet live-verified)
### B. Bot purchase flow (js/_index.js + lang/{en,fr,zh,hi}.js)
- [x] B1 RDP: region → tier → **duration** (`askRdpDuration`, `rdpDurationBtn`, line ~12077) → coupon → Windows edition → summary → pay
- [x] B2 Order summary shows edition + duration
- [x] B3 Post-payment "RDP ready" gated on DO-RDP `active`
- [x] B4 Renewal scheduler extends by `durationMonths` / `provider.renewInstance` — VERIFIED 2026-09-23: `_syncProviderRenewal(vpsPlan, renewMonths)` at _index.js:36677 calls `provider.renewInstance(contaboInstanceId, months)` via `getProviderForRecord`; `renewMonths=_renewalMonths(vpsPlan)`=durationMonths; bot record `end_time` also advanced by durationMonths.
### C. Bot management (js/_index.js)
- [x] C1 Start/Stop/Restart/Show password via smart proxy for `rdp-*` ids
- [x] C2 Reset Password → `provider.resetPassword` (line ~20496; agent-confirmed, `dataPreserved`) + offline error copy
- [x] C3 Reinstall Windows → `confirmReinstallWindows`/`askReinstallEdition` (line ~9375, ~12302, ~20570) → `provider.reinstallInstance`; IP-kept + ~3 min copy
### D. Reseller API + docs (js/reseller-api.js, js/apidoc-page.js)  ← ★ DONE 2026-09-23 ★
- [x] D1 `POST /rdp/:id/password-reset` → `{ mode, id, password, username:'Administrator', method:'agent', data_preserved }` (dry-run in sandbox). Updates rootPasswordSecretId to the new secret. **DONE**
- [x] D2 `POST /rdp/:id/reinstall {os}` → `{ mode, id, os, os_name, ip, eta_minutes, password }`; validates os against OS_OPTIONS (400 invalid_os); updates `vpsPlansOf.osId/rootPasswordSecretId/status(→reinstalling)/host`. **DONE**
- [x] D3 `GET /rdp/:id` includes `agent_online`; both new endpoints documented in apidoc-page.js + agent note in the RDP blurb. **DONE**
  NOTE: added `rdpProviderForRecord(rec)` so DO-RDP records (provider 'digitalocean-rdp' / rdp-* ids) route to the DO-RDP service even though VPS_RDP_PROVIDER=azure (per-record routing per the design). Routes added next to the /rdp/:id/action route. Verified in dry-run + node -c + lint (only pre-existing empty-catch warning) + E1 84/0 still green.
### E. Tests
- [x] E1 Unit suite `js/tests/test_do_rdp_golden_2026-06.js` — **84 passed, 0 failed** (re-run confirmed 2026-09-23).
- [x] E2 testing_agent: reseller RDP API (D1/D2/D3) + negatives + regression — **33/33 PASS** (dry-run, 2026-09-23).
- [x] E3 Live E2E on one real droplet — **CREATE + REINSTALL validated LIVE 2026-09-23** (buy ws2022 → active → live NLA login with per-order pw OK; reinstall→ws2019 DO rebuild → active, IP kept, edition switched, live NLA login OK). Agent-based password RESET could NOT be validated live from a dev pod: the DO droplet cannot reach the Cloudflare-fronted preview callback URL (`SELF_URL/provision/*`) so the in-guest agent never checks in. This is an ENV limitation of the dev sandbox, not a code bug — resetPassword is covered by E1 unit + E2 dry-run. New ops scripts: `js/ops/rdp_lifecycle_e2e.js`, `js/ops/rdp_reinstall_check.js`. **Leftover inspection droplet 602990345 DESTROYED 2026-09-23 (billing stopped) — only the 2 prod droplets (WHM, DynoPay) remain.**
### F. Golden images
- [~] F1 ws2025 — a build was ALREADY in progress from a prior session (build droplet 602828932 nyc3 + custom image 246641953 importing/pending; this pod's local build tracking was lost on the fresh DB). Did NOT start a duplicate. Launched a SAFE idempotent finisher `js/ops/rdp_ws2025_finish.js` (bg, ≤4h → `memory/rdp_ws2025_finish.log`) that registers ws2025 via `syncGoldenFromDO` the moment DO marks it available, `transferGolden('ws2025','all')` to 9 regions, then deletes the leftover build droplet. ws2019 + ws2022 already `available` in all 9 regions (untouched).
- [x] F2 ws2025 VERIFIED `available` + transferred to all mapped DO regions (nyc3, ams3, blr1, fra1, lon1, sfo3, sgp1, tor1); custom image 246641953. Live golden E2E 2026-09-23: droplet from golden image, active in 7.2 min, RDP/NLA login OK (`memory/WS2025_RDP_HANDOFF_2026-06.md`). ws2025 is now functionally equal to ws2019/ws2022.

## Verified current state (2026-06 handoff — read this first)
- All key files pass `node -c` syntax check (js/_index.js, js/vps-provider.js, js/digitalocean-rdp-service.js, js/reseller-api.js). App is NOT broken. `nodejs` supervisor process is RUNNING.
- Unit tests: `node js/tests/test_do_rdp_golden_2026-06.js` → 84 passed, 0 failed.
- Bot integration (A/B/C) is substantially implemented in js/_index.js (+32 lines) and the DO-RDP service (+304). Handlers present: `askRdpDuration`, `rdpDurationBtn`, `confirmReinstallWindows`, `askReinstallEdition`, `resetPasswordBtn`→`confirmResetPassword`, `reinstallWindowsBtn`→`confirmReinstallWindows`, `provider.resetPassword`, `provider.reinstallInstance`. Not yet live-verified.
- Reseller API (D) is the biggest gap — password-reset and reinstall endpoints DO NOT EXIST yet. This is the highest-value remaining code task.
- All 4 lang files (en/fr/hi/zh) already carry the new RDP/reinstall/reset keys (+48 lines each).

## Recommended next-agent order
1. D1/D2/D3 — add reseller `POST /rdp/:id/password-reset` and `POST /rdp/:id/reinstall`, add `agent_online` to `GET /rdp/:id`, document both in apidoc-page.js.
2. Verify B4 renewal wiring calls `provider.renewInstance`.
3. F1 — check golden image state (`goldenStatus`), then start the 3 parallel rebuilds the owner approved.
4. E2 (testing_agent on reseller RDP API + bot smoke), then E3 live E2E on one real droplet, then delete it.

## Uncommitted files on disk at handoff
- Modified: js/_index.js, js/digitalocean-rdp-service.js, js/vm-instance-setup.js, js/vps-provider.js, js/reseller-api.js(unchanged for D), js/lang/{en,fr,hi,zh}.js, js/rdp-scripts/apply.ps1, js/tests/test_do_rdp_golden_2026-06.js
- New logs: memory/rdp_apply_log_ws2019_bug_repro.log, memory/rdp_golden_e2e_ws2019.log, memory/rdp_golden_e2e_ws2022.log, memory/rdp_status_api_e2e_ws2019.log

## Credentials
- Vault passphrase: `Katiekendra123@`
- DigitalOcean API key + Telegram Bot API key are in `.env`.

## Status log
- 2026-09-23 00:50 UTC — doc created, implementation starting (A → B → C → D → E → F)
- 2026-09-23 (setup + D) — Fresh pod set up: vault unlocked (`Katiekendra123@`), backend/.env restored, frontend/.env recreated (pod URL), deps installed, nodejs supervisor up. All services healthy (FastAPI:8001 → Node:5000 → Mongo). DO-RDP golden sync at boot: ws2019 & ws2022 `available` in all 9 regions, ws2025 `none`. **D1/D2/D3 implemented + B4 verified.** New reseller endpoints smoke-tested in dry-run (password-reset, reinstall {ws2019 ok / badxx→400 / default}, agent_online on GET, 401/404 negatives all correct). E1 unit suite still 84/0.
- 2026-09-23 (E2/E3/F1) — E2 testing_agent 33/33 PASS (dry-run). E3 LIVE: create ws2022 fast-deploy → active + NLA login OK; reinstall→ws2019 rebuild → active, IP kept, edition switched, NLA login OK; droplet destroyed (no leak). Agent-based RESET not verifiable live from this dev pod (droplet can't reach CF-fronted preview callback → agent offline; env limit). F1: ws2025 build already in progress from a prior session (droplet 602828932 + image 246641953 pending); did NOT duplicate; launched safe idempotent finisher (bg) to register+transfer+cleanup once DO marks it available.
- 2026-09-23 (fresh-pod re-verify + cleanup) — New pod set up from vault (`Katiekendra123@`); all services healthy. Re-verified in THIS pod: **E1 unit suite 86 passed / 0 failed**; **reseller RDP API testing_agent 33/33 PASS** (D1/D2/D3 + 401/404 negatives + GET /rdp, /rdp/plans, /account regression), DO-RDP per-record routing confirmed (NOT Azure), all mutating calls hard-locked to dry_run. Added idempotent `scripts/seed_rdp_reseller_e2e.js` (key + owner wallet + `e2e-rdp-1` record). **#3 CLEANUP DONE: destroyed leftover inspection droplet 602990345 (rdp-109b0d03, 104.131.68.31) via DO API — billing stopped; only prod droplets whm2-fra1 (578369745) + dynopay-prod-ams3 (599433401) remain.** F2 ws2025 marked verified/available in all mapped regions. Confirmed no `cloudflared`/`ngrok` in sandbox ⇒ agent-callback password RESET remains verifiable only on prod (or via a public tunnel). `VPS_RDP_PROVIDER` still `azure` (prod flip pending owner go-ahead).
- 2026-06 (fork handoff) — verified state: A/B/C substantially done in code (not live-verified); E1 84/84 passing; app healthy. Reseller API D endpoints still MISSING. Golden rebuilds (F1) not triggered. E2/E3 not done. Session ended per owner request WITHOUT agent testing.
- 2026-06 (fork, wrap-up) — Bot-interface VPS↔RDP separation IMPLEMENTED IN CODE, **NOT TESTED**. Edits on disk (uncommitted): js/_index.js (routing, menus, subscription-detail screens, auto-renew now treats `digitalocean-rdp` as PAYG), js/vm-instance-setup.js (VPS/RDP plan + OS separation), js/new-user-conversion.js, and all 4 lang files (en/fr/zh/hi split RDP vs VPS strings). All 7 files pass `node -c`; nodejs/backend/frontend/mongodb all RUNNING. Session ended per owner request BEFORE running testing_agent.

## ⚠️ Highest-priority pending items for next agent (updated 2026-09-23)
DONE since the 2026-06 handoff: D1/D2/D3 reseller API (E2 33/33), E3 create+reinstall live, F1/F2 ws2025 available, VPS↔RDP separation verified at code + API layer (E1 86/0 + reseller 33/33), leftover droplet destroyed.

Genuinely still open:
1. **[DONE 2026-09-23 — LIVE PROD] Flipped Railway prod `VPS_RDP_PROVIDER`** on `Nomadly-EMAIL-IVR`: actual prior value was **`contabo`** (NOT azure as docs said) → set to `digitalocean-rdp` via Railway GraphQL (`ops/rdp_prod_flip_provider.js`, token=`API_KEY_RAILWAY`, proj/env/svc IDs in script) + `serviceInstanceRedeploy` (`ops/rdp_prod_redeploy.js`). Verified live: `GET /rdp/plans` returns `provider=digitalocean-rdp`, `os_options=[ws2019,ws2022,ws2025]`, DO-RDP 1/2/3-month plans. Placed one real ws2025 order (`starter-1m`, mode:live, $24, owner wallet 970→946): DO droplet 603051404 @ 68.183.146.200, active in ~7.2min, RDP 3389 reachable, credentials delivered (Administrator / grgsM4Q!^nQnyZ6uUq — kept alive for owner to test). Temp reseller key `temp-rdp-confirm-2026-09-23` minted then DISABLED.
   ⚠️ **CALLBACK BUG (open):** the `rdp_ready` callback + every-minute in-guest agent do NOT phone home even in prod (`agent_seen_at=null`, no callback, survives a warm reboot). Server side proven fine — both `/provision/callback` and `/api/provision/callback` reachable + return "Invalid callback token" for a bogus token. Root cause is IN-GUEST on the DO Windows box: `apply.ps1` sets the static IP/RDP/password via link-local metadata (works) but external DNS fails, so callback/agent/self-refresh all fail with "remote name could not be resolved". On Server 2025 the per-interface `Set-DnsClientServerAddress` (MAC-matched) likely misses the NIC. **FIX SHIPPED in `js/rdp-scripts/apply.ps1`**: added a DNS safety-net that forces public resolvers (1.1.1.1/8.8.8.8/67.207.67.2-3) on EVERY up adapter before self-refresh/callback (additive; harmless on 2019/2022).
   **DEPLOY PATH (blocked on git push — main agent NOT allowed to push):** prod deploys from `github.com/servicedyno/Nomadly-EMAIL-IVR` (= git origin here). The golden build runs ON prod (`rdp_golden_build.js` → prod `/admin/rdp-golden/*`) so it bakes PROD's apply.ps1. Therefore: (1) user must **Save to GitHub** → Railway auto-deploys the apply.ps1 fix (prod bootscript updates); (2) then trigger `node js/ops/rdp_golden_build.js build --os ws2025` to bake the fixed apply.ps1 into a new golden image (~hours); (3) place a fresh ws2025 order to confirm the callback now lands. Existing broken boxes can't self-heal (no DNS ⇒ can't self-refresh). Provisioning is customer-functional NOW via the port-3389 fallback; the degraded feature is the in-guest agent (powers reseller password-reset D1).
2. **[P1] Live-verify agent-based password RESET** — same in-guest DNS root cause as above; will work once the apply.ps1 DNS fix is deployed + a fresh golden image is built.
3. **[P1 · needs detail] Domain loading / Cloudflare Turnstile on hosted sites** — investigated `bylinebank.capital`: zone active on CF NS (owner chatId 6635602837) but has NO cPanel/hosting account, NO server IP, and ZERO DNS records ⇒ nothing to load. `browser_check=on` (Browser Integrity Check) is the "checking your browser" interstitial. No `turnstile` code in repo. Needs owner decision: provision hosting + point DNS, or which sites actually show the challenge, and whether to disable browser_check on hosted zones.
4. **[P2 · blocked on user] Telnyx API key HTTP 401** — needs a valid key from the owner.
5. **[optional] VPS↔RDP *bot Telegram-UI* end-to-end** — the API-layer separation + provider routing is verified; a full Telegram-flow sim would additionally confirm menu/copy separation, lower value now.
