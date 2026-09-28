# PRD — Nomadly Cloud IVR + Telegram Bot

## Original problem statement (this fork session, Feb 2026)
User inherited a fully-set-up Nomadly bot pod pointed at LIVE PRODUCTION. Task became: mine Railway production logs, identify complaints from real users (starting with @blacknmilds), find root causes, and ship fixes.

## Architecture (unchanged from previous fork)
- React frontend (port 3000)
- FastAPI proxy (port 8001) — forwards `/api/*` to Node
- **Node.js Express + Telegram Bot API** (port 5000) — most business logic lives here
- MongoDB — sandbox uses LOCAL `mongodb://localhost:27017`; production uses Railway Mongo `roundhouse.proxy.rlwy.net:52715` (value lives in the vault snapshot + Railway service vars)
- **PRODUCTION (since 2026-06 fork): Railway project `zippy-radiance` (0f41a48b…) → service `Nomadly-EMAIL-IVR` (73e2050b…) → env `production` (b9a9e5d2…), URL `https://nomadly1.up.railway.app`, custom `2.speechcue.com` + `panel.2.hostbay.io`.** The old `New Hosting` project service is dead (all deployments REMOVED). Ops: `js/ops/railway_setup_prod.js` (vars/domains/deploy) + `js/ops/railway_log_pull.js` (logs). Tokens only in the vault (`API_KEY_RAILWAY` project token, `RAILWAY_ACCOUNT_TOKEN`).

## Guardrails (never touch)
- Sandbox `/app/backend/.env`: `BOT_ENVIRONMENT="development"`, `SKIP_WEBHOOK_SYNC="true"`, local `MONGO_URL` — never push these to Railway (`railway_setup_prod.js` strips/overrides them automatically)
- Vault (`memory/nomadly.vault.enc`, passphrase in test_credentials.md) is the single source of truth for credentials; after editing `.env` always `vault.sh lock`, then `railway_setup_prod.js apply` to sync production

## What was implemented in this Feb 2026 fork
See CHANGELOG.md for the running log. High-level list:
- ✅ WAV → MP3 auto-transcode at upload time (`audio-library-service.js`)
- ✅ Audio-proxy Content-Type derived from file extension for legacy WAVs already in `ivrAudioStore`
- ✅ Bulk IVR NANP normalization (10-digit paste → `+1XXXXXXXXXX`, was `+40…` = Romania)
- ✅ AI Support KB disambiguates Quick IVR (TTS) vs Bulk IVR (uploaded audio); NANP fix documented
- ✅ `editMessageText "message can't be edited"` fallback spam — terminal-error short-circuit + per-session log dedup + streaming short-circuit
- ✅ VPS deletion spam — Contabo "already been canceled" now treated as idempotent success; admin alert throttled to ≥6h with 10-retry hard-stop; `Auto-Deleted` post skipped for no-op cycles

## 2026-09-14 — User-journey / conversion audit (analysis only, no bot changes)
- Report: `/app/memory/USER_JOURNEY_AUDIT_2026-09-14.md` (exec summary, journey map, pain-point register, ranked recs, 30-day plan)
- Data: read-only 7-day Railway log sample in `/app/investigations/journey7d/` via `ops/railway_journey_pull.js`; analysis `ops/journey_funnel_analysis.py`
- Headline: 36 new users → 1 deposit, 0 purchases; VPS checkout 8/8 failed (Contabo invalid_client); social proof is seeded random; `markPurchased` fires before balance check (kills recovery nudges); no order resume after top-up; 10k promos/week with zero /start lift; 0/30 welcome coupons redeemed.

## 2026-06 (fork) — 11 approved Quick Wins IMPLEMENTED + VERIFIED
Implemented fixes #1,#3,#4,#5,#6,#7,#8,#9,#10,#11,#12 from the audit (skipped #2 + VPS bug per user).
Verified by testing_agent iteration_46: Node suite `js/tests/test_quickwins_2026-09.js` = **82/82 pass**; live `POST /api/dev/support-routing-test` = pass:true; nodejs healthy; zero regressions.
- #1 purchased-flag ordering — `_finalizeWalletPurchase()` fires after a successful charge (`_index.js`)
- #3 single price source — overage/forwarding rate read from env in `monetization-engine.js` (matches `phone-config.js`); `$0.04` copy removed
- #4 cart-nudge copy — dead `/menu → Daily Coupon` replaced by live coupon line + `t.me/?start=open_<hub>` deep link (`cart-abandonment.js`)
- #5 pre-filled balance wall — `getInsufficientBalanceMessage` (`improved-messages.js`) + `💵 Deposit $N` tap jumps to coin/method picker (`_index.js`)
- #6 actionable underpayment — `sentLessMoney` rewritten + main-menu keyboard on all sends (lang/*.js, `_index.js`)
- #7 trial → Pro CTA — `TRIAL_PRO_CTA` after /testsip pre-selects Pro + surfaces welcome coupon (`_index.js`)
- #8 hosting total line — `generateDomainFoundText(...total...)` shows plan+domain=Total today (lang/*.js, `_index.js`)
- #9 domain shortener prompt — reworded to recommend register-first (lang/*.js)
- #10 menu hierarchy — row 1 = Cloud IVR + Hosting; Refer & Earn/Marketplace pushed down (lang/*.js)
- #11 typed-text → AI support — help/trouble intents routed via `isColdSupportQuestion` (`_index.js`; live check `/api/dev/support-routing-test`)
- #12 welcome-offer deep link — links to most-browsed hub via `buildWelcomeCta`/`HUB_DEEPLINKS` (`new-user-conversion.js`, `_index.js`)

## 2026-06 (fork) — Phase 2 structural conversion enhancements
Approved audit items executed (all verified via custom Node suites + testing_agent iteration_47/48):
- ✅ #16 Order Resume, #22 Early Floors, #19 First-Purchase Bundle, #17 First-Session Intent Funnel (prior turns).
- ✅ #18 Lifecycle Diet + Mute + Lift Metric — `js/lifecycle-diet.js` shared throttle (1/24h cap on marketing, <72h welcome-window suppression, active-balance-wall pause, cart-nudge mute button, per-blast /start+hub-tap lift into `promoStats` with zero-lift admin alert). Wired into AutoPromo, cart-abandonment, new-user-conversion, low-balance & day-12 nudges.
- ✅ #21 Localization Parity — per-locale reverse DNS record-type map (fixed a real FR/ZH/HI DNS-add breakage where `t[recordType]` was undefined), translated `dnsProxiedChoice*` + `vp.vpsSshBlockedHelp` into FR/ZH/HI, and a global `/language` + 🌍 Change Language handler that works from any state.
- ✅ VPS credentials copy: `vpsBoughtSuccess` readiness note min→minutes in en/fr (locale parity).
- New tests: `js/tests/test_lifecycle_diet_2026-06.js` (24), `test_promo_lift_metric_2026-06.js` (13), `test_localization_parity_2026-06.js` (79). Regression: quickwins 82, all Phase 2 + i18n suites green.

## 2026-09-16 (fork) — Git commit blocker fixed
- Platform auto-commit was failing (`git add failed: ... ignored ... .env`) because `/app/.env` existed as a gitignored symlink → `backend/.env`; git literally matches an ignored root `.env` against the platform's `':(exclude).env'` pathspec → exit 1.
- Fixed: symlink removed; `js/config-setup.js` loads `[cwd/.env, ../backend/.env]`; `scripts/setup-nodejs.sh` + `scripts/vault.sh` no longer create it; 5 tests point at `/app/backend/.env`. Staging rc=0, nodejs healthy, all suites green. **Never create a root `/app/.env` again.**

## 2026-09-16 (fork) — Hosting checkout usability (user-approved 5/5)
Hosting purchase went from 9–10 screens to **4 taps** (menu → plan → domain → email/skip → 1-tap pay). New module `js/hosting-checkout-ux.js` (pure copy/keyboard/parsers, 4 locales) + wiring in `js/_index.js`:
- ✅ #1 Plan menu = comparison card with prices, durations, specs, ⭐ Most popular (`submenu3` → `hcx.planMenuText`). Buttons unchanged.
- ✅ #2 Buy screen removed — domain options live on the plan-details screen; user's hostable owned domains listed inline as `📂 example.com` (max 3, excludes domains already on an active `cpanelAccounts` plan). `buyPlan` is now an alias; `currentPlanAction()` fixes the old "Back always downgraded to Premium Weekly" bug. New `goto.selectOwnedDomain`.
- ✅ #3 Email step: no "Use this email?" confirm screen, ↩️ Back button, `✅ Use last@email` 1-tap (`state.lastOrderEmail`).
- ✅ #4 Invoice shows wallet balance; first button `👛 Pay $X from Wallet` (charges via `walletOk['hosting-pay']`, no Yes/No) or `💵 Deposit $short` (pre-fills amount + saves Order-Resume session). Loyalty applied once via `applyHostingLoyaltyOnce` (guarded by `preLoyaltyPrice`, reset in `proceedWithEmail`). Fixed: wallet confirm/resume screens showed the *domain* price instead of total for hosting; coupon Skip/apply no longer trips the 30s payment lock.
- ✅ #5 Domain taken → `checkAlternativeTLDs` (12s race) → tappable `🌐 name.sbs — $30` buttons, hosting-friendly TLDs ranked first; tapping re-runs the normal check.
- Bonus: `user.freeTrial` → `goto.freeTrial()` (was calling `selectPlan('freeTrial')` which throws); `connectExternalDomain` input validated with `isDomainLike` (previously accepted anything containing a dot).
- **DEV-only** `POST /dev/hosting-flow-sim` (404 in prod): seeds a synthetic chat (wallet/domains/lastEmail), feeds taps through the REAL handler via `bot.processUpdate`, captures replies for that chat only, refuses payment-confirming taps. Body: `{chatId, seed:{usdBal,domains,lastOrderEmail,lang,keep}, steps:[...], settleMs, cleanup}`.
- Tests: `js/tests/test_hosting_checkout_ux_2026-06.js` (101). Regression: nav_mainmenu_escape 109, quickwins 82, wallet_no_stale_charge 18, localization_parity 79 — all green. Live sim verified: owned-domain path, insufficient→Deposit→coin picker+resume session, typed/invalid email, coupon skip, Golden Back routing, register-new → taken → alternatives → tap → invoice $60 (domain+hosting), external-domain validation.

## 2026-09-16 (fork) — Domain checkout parity
- `goto['domain-pay']` now shows the wallet balance line and the same 1-tap `👛 Pay $X from Wallet` / `💵 Deposit $short` keyboard as hosting; Deposit saves an Order-Resume session (`flowType: domain-purchase`). Shared closure helpers in `_index.js`: `applyCheckoutLoyaltyOnce(step)` (price for domain / totalPrice for hosting), `checkoutWalletView(step, total, label)`, `startCheckoutDeposit(step, amount)`. `walletSelectCurrency` skips loyalty re-application for both steps. Legacy `👛 Wallet` tap still works for stale keyboards.
- Suite now 109 assertions; live sim: domain search → No → invoice w/ balance → coupon Skip → Back → re-invoice, and $15 balance → `💵 Deposit $24` → coin picker + resume session `{price:39, step:'domain-pay'}`.

## 2026-09-16 (fork) — Unified checkout layer (Cloud IVR, digital products, VPS, vCard, shortener plan, leads, bundles)
Every "choose payment method" screen now renders through one closure layer in `_index.js` (`checkoutOrder` → `checkoutWalletView` → `checkoutScreen`; taps via `hcx.parseCheckoutTap` → `runCheckoutTap` → `walletOk[key]`):
- Screens converted: `phone-pay` (Cloud IVR — **order summary + payment merged into one screen**, the "✅ Proceed to Payment" hop is gone; legacy `cpOrderSummary` forwards), `digital-product-pay` (keeps 💬 Ask Question), `virtual-card-pay`, `vps-plan-pay`, `vps-upgrade-plan-pay`, `plan-pay`, `leads-pay` (walletOk key = buyLeads/validator), `bundleConfirm` (wallet-only — no crypto/bank handlers exist), Cloud IVR plan-upgrade (`cpUpgradePayRows`, inline handler). Email Blast already had 1-tap; targeted leads has its own deposit CTA — both untouched.
- `checkoutOrder(step)` is the single price source mirroring each walletOk read (cpPrice / dpPrice / vcAmount+fee / vpsDetails / bundlePrice / price / totalPrice). Legacy `walletSelectCurrency` + `walletSelectCurrencyConfirm` (Order Resume) now display exactly that — fixes the old confirm screen showing a **stale `info.price` from a previous flow** for phone/digital/vcard/VPS (also caused by un-awaited `set(lastStep)`; step is now derived from the live action).
- Loyalty: prices at rest are undiscounted; `applyCheckoutLoyaltyOnce` mutates the charged field transiently at Pay-tap/Resume (identity-guarded → no compounding), `restoreLoyaltyMutation` undoes it on any invoice re-render. Only steps whose walletOk honours price/newPrice/totalPrice are eligible (`CHECKOUT_LOYALTY_STEPS`: plan/domain/hosting/leads/red). **Decision point for owner:** phone / digital / vcard / VPS / bundle charge fixed fields, so no tier discount is shown or applied there (previously a discount was *displayed* but the full price charged).
- Fixed along the way: Cloud IVR coupon handler was missing (`askCoupon + 'cpOrderSummary'` → codes silently ignored) — now discounts `cpPrice` in place with `cpPriceBase` for the strikethrough; bundle wallet tap was unhandled (k.pay → nothing); bundle price subtracted a stale `loyaltyDiscount`; bundle/cp state reset on fresh selection; global `💵 Deposit $N` matcher now routes through `startCheckoutDeposit` so lastStep is preserved for resume.
- Verified live via `/dev/hosting-flow-sim` (`seed.state` deep-seeding): Cloud IVR summary+pay → coupon STA158 → $46.75 → Deposit $17 → coin picker + resume `{price:46.75, step:'phone-pay'}`; bundle wallet-only deposit; digital legacy Wallet tap shows $80 (not stale $12); vCard $170 short → Deposit $70; plan-pay; leads $40 1-tap; Gold user domain: $35.10 button, no compounding on No, price restored to $39 on Back. Suite: 143 assertions + 12 regression suites green.

## 2026-09-16 (fork) — GitHub Actions `lint` workflow fixed (was MODULE_NOT_FOUND)
- Root cause: `scripts/check_lang_parity.js`, `scripts/check_panel_lang_parity.js`, `scripts/lint_async_in_if.js` hardcoded `/app/...`; the runner checks out at `/home/runner/work/<repo>/<repo>` → `require('/app/js/lang/en.js')` → MODULE_NOT_FOUND. All three now use `path.resolve(__dirname, '..')`.
- Second latent failure: `lint-lang` job had no install step but `js/lang/plan-copy.js` requires `dotenv` → added `npm install dotenv --no-save` step. Job now also runs `check_panel_lang_parity.js`.
- Panel locale drift fixed: 16 `store.*` keys (Storefront pricing/trust/login copy) added to `frontend/src/locales/{fr,hi,zh}.json`; `npm run lint:lang` green.
- Verified: both jobs simulated at `/tmp/runner/work/repo` with only the YAML-installed deps → rc=0; FR storefront renders all new keys, no raw `store.*` leaks; i18n suites 79/79 + 26/26.
- **Rule:** scripts under `scripts/` must never hardcode `/app` — CI runs elsewhere.

## 2026-09-16 — Cloud IVR production billing audit (Railway logs, 7d) + fixes F2/F3/F4- Full report: `memory/CLOUDIVR_BILLING_AUDIT_2026-09-16.md`. Log tooling: `ops/railway_billing_pull.js`, `ops/railway_grep_billing.js` (read-only, Railway GraphQL via `API_KEY_RAILWAY`).
- F2 fixed: `/twilio/voice-dial-status` billed $0 for months — `parseInt(chatId)` vs string `phoneNumbersOf._id`. Now `String()` + legacy fallback; bridge legs excluded (Telnyx leg bills them).
- F3 fixed: reconciler `altCallRef` (Telnyx leg) + master-account lookup for bridge rows → no more 560/589 false `no_charge`, no double-settle.
- F4 fixed: ghost "Twilio direct fallback" calls removed (`_abandonBridge`).
- F1 OPEN (P0 over-billing): mid-call timers deduct per minute AND hangup bills full minutes (`voice-service.js` L356/L3057/L3243). User deferred. Refund needs prod `walletLedger` query (in report).
- Tests: `js/tests/test_dial_status_billing_fix_2026-09.js`, `test_reconciler_altcallref_2026-09.js`, `test_no_ghost_direct_call_2026-09.js`; 9 existing SIP/billing suites + `/dev/reconciler-widen-test` + `/dev/call-reconciler-test` green.


## 2026-09-17 — 48h prod log audit + self-heal loop fixes
- Report: `memory/PROD_LOG_AUDIT_2026-09-17_48h.md`. Tooling: `ops/railway_48h_anomaly.js` (read-only). Payments/billing/Twilio/DB/bot all healthy; F2/F3/F4 billing fixes visibly working (all 161 "not billed" lines are correct bridge/transfer-leg exclusions).
- **FIXED (code)** — cPanel self-heal thrash on SUSPENDED accounts (ghrx51df, 38×/48h): `_repairCpPass` detects terminal WHM `/passwd` reasons (`_isTerminalPasswdReason`) and backs off `CPPASS_SUSPENDED_COOLDOWN_MIN` (6h) instead of retrying a rotation that can never succeed. Tests: `test_cpanel_suspended_selfheal_2026-09.js` 15/15.
- **QUIETED (code)** — Contabo auth spam (~200 lines/48h): `getAccessToken` auth circuit breaker (`VPS_AUTH_DOWN`, `CONTABO_AUTH_COOLDOWN_MIN` 30m) + `isAuthHealthy()`; VPS self-heal skips the whole Contabo sweep in one log when auth is down. Tests: `test_contabo_auth_breaker_2026-09.js` 10/10. Infra creds (`invalid_client`) still invalid — owner to fix.
- **IGNORED (per user)** — Connect Reseller 401 infra (prod IP not whitelisted / CR portal login broken); OpenProvider fallback covers domain pricing. CR loop already throttled per-process; residual volume is restart-amplified.

## 2026-09-22 — Windows RDP on DigitalOcean: golden images (fast ≤3-min deploys)
Goal: `POST /api/reseller/v1/rdp` must return a working Windows server in ~3 min for ws2019/ws2022/ws2025 instead of a 20-45 min QEMU conversion.
Runbook: `memory/RDP_GOLDEN_IMAGES.md`; lessons: `memory/DO_RDP_LESSONS.md`.
- ❌ Droplet **snapshots** of a converted Windows disk are unusable on DO (create/rebuild action errors, droplet auto-deleted) — reproduced 4×. Both legacy snapshots deleted.
- ✅ Pipeline rewritten to **DO Custom Images**: build droplet → QEMU install → QEMU first boot (RDP probe) → Windows self-shutdown → **offline ntfs-3g verify** (apply.ps1 sha + CloudInitApply task) → `qemu-img convert` qcow2 → HTTP serve → `POST /v2/images` (distribution Unknown) → poll → register → delete build droplet → transfer to 9 regions.
- ✅ apply.ps1 now ships on the answer ISO and is copied from the CD by FirstLogonCommands (certutil -decode silently failed on WS2019/WS2025). Verified OK on WS2022 + WS2019 + WS2025.
- ✅ Build-size fallback on `422 Size is not available` (live `GET /v2/regions` sizes; 50 GB-disk candidates only).
- ✅ Direct (customer) conversion: robust finalize (`dd` O_DIRECT + sysrq remount-ro + builtins-only reboot).
- ✅ Fast path falls back to full conversion automatically if DO deletes the droplet (create errored).
- ✅ **WS2025 fix (this fork)**: 24H2 Setup appends a 681 MB WinRE partition after C: → offline verify mounted the wrong partition (2 failed builds). `convert_to_windows.sh` now finds the OS partition by content and `sfdisk --delete`s trailing partitions so C: can grow. ws2025 build passed verify first time after the fix.
- ✅ **P0 password bug fixed (this fork)**: `provisionServer` sent `ADMIN_PASSWORD=undefined` (password lives in the secret store, not on `doRdpServers`) → Windows rejected it → customers could never log in (fast AND slow path). Diagnosed live on a kept droplet via RDP (`memory/rdp_apply_log_ws2019_bug_repro.log`). Fix: load from `getSecretPassword()`; unit tests now assert the real password in user-data + autounattend.
- ✅ apply.ps1 hardened: public DNS (67.207.67.2/3, 1.1.1.1) before DO's VPC resolver (10.x timed out for 5+ min after boot → callbacks failed), `net user /y`, SetPassword retry, `Clear-DnsClientCache` before callback retries, bootscript self-refresh retried 3×. Baked into future builds; existing images self-refresh it on later boots.
- ✅ Region transfer race: DO 422 "already being transferred" now waits for the region instead of marking it FAILED. `callbackGraceMs` 150→90 s.
- ✅ **E2E PASS**: ws2019 (image 246589188) fast path active in 3.2 min, NLA login with per-order password OK; ws2022 (image 246587962) 3.7 min, login OK. Logs in `memory/rdp_golden_e2e_ws*.log`.
- ✅ testing_agent iteration_49: 11/11 reseller RDP API + admin status + unit suite 66/66.
- ✅ **Order status via API (this fork)**: `GET /rdp/:id` returns `provisioning {status, stage, stage_label, message, progress, fast_deploy, os, eta_minutes, eta_seconds, eta_at, elapsed_seconds, time_to_active_s, credentials_ready, password_confirmed, steps[4], logs}` + top-level `credentials_ready` / `credentials_url`; `vpsPlansOf` host/status kept in sync; `/credentials` now resolves the live IP (was null for RDP). Docs updated. Live run via public API: `js/ops/rdp_status_api_e2e.js` ws2019 → active in 3.5 min, countdown/steps correct, NLA login OK (`memory/rdp_status_api_e2e_ws2019.log`).
- ✅ **Admin Telegram alerts (this fork)**: `init(db, { notifyAdmin })`; alerts (10-min de-dup) for order failed, fast-path order not active after `T.fastTargetMs` (3 min) with stuck stage, fast→slow fallback, password not applied, golden build failed, region transfer failed; `sendDailyDigest()` every 24 h (orders, fast/slow avg+max time-to-active, misses, failures) — digest disabled on the sandbox (SKIP_WEBHOOK_SYNC). Unit suite now 81/81; testing_agent iteration_50: 10/10.
- ✅ Leaked E2E droplets destroyed; E2E scripts now destroy their droplet on SIGINT/SIGTERM/SIGHUP. DO inventory = WHM, dynopay + the 2 golden-build droplets serving the pending imports (auto-destroyed after import).
- ⏭ Image refresh (rebuild with hardened apply.ps1) — SKIPPED per user.
- ⏳ Still importing at DO (22:40 UTC): ws2022 rebuild image 246589203 (queued 19:30) and ws2025 image 246605289 (queued 21:02). Registration + old-image deletion + 9-region transfer are automatic (resumable across restarts). **ws2025 E2E not yet run** (needs its image `available`): `node js/ops/rdp_golden_e2e.js --os ws2025 --region US`.
- Sandbox reseller API key in `memory/test_credentials.md`.

## 2026-09-23 (fork) — ws2025 golden image availability check (user request)
- Live DO check (token from `backend/.env`): ws2019 `246589188` + ws2022 `246587962` available in all 9 regions. **ws2025 `246641953` (`golden-ws2025-1790110923-r2`) was `available` on DO but the app showed `golden_status: none`** → the `-r2` suffix (manual re-import) did not match `^golden-ws2025-\d+$` in `syncGoldenFromDO()`/`listGoldenImages()`.
- ✅ Fix: `goldenSnapRe`/`goldenAnyRe` now accept an optional `-<suffix>` (`js/digitalocean-rdp-service.js`). Unit suite `js/tests/test_do_rdp_golden_2026-06.js` +2 assertions → 86/86.
- ✅ After nodejs restart auto-sync registered ws2025 (`available`, fast_deploy=true, 5 regions: sfo3 nyc3 lon1 fra1 ams3). Transfer to tor1/blr1/sgp1/syd1 queued via `POST /admin/rdp-golden/transfer` (DO copies sequentially; `golden_regions` grows as each lands).
- Note: `VPS_RDP_PROVIDER="azure"` in `.env` → public `GET /rdp/plans` advertises Azure; DO-RDP golden path is reached via bot / per-record routing (`digitalocean-rdp`). ws2025 E2E (`node js/ops/rdp_golden_e2e.js --os ws2025 --region US`) still not run.

## 2026-09-24 (fork) — RDP DNS fix + "slow browser" performance fixes for ALL editions / plans
- **DNS (prev. turn)**: DO VPC resolver (10.x) times out after boot → `DNS_PROBE_FINISHED_NXDOMAIN`. Live box 165.22.43.171 patched (1.1.1.1/8.8.8.8); `apply.ps1` self-tests DNS and auto-remediates. Golden rebuilds ws2019/ws2022/ws2025 triggered (builds `build-dbef380b549a` / `build-668dcb3a48fb` / `build-7338adc4a34b`, status via `node js/ops/rdp_golden_build.js status`; watcher log `memory/golden_rebuild_2026-09-24.log`).
- **Slow-browser RCA (live snapshot, `js/ops/rdp_diag_perf.ps1` via `rdp_run_ps.sh`)**: 4 GB box swapping (commit 4.17 GB > RAM, 292 pages/s), Chrome 70 procs ≈2 GB, Defender = #1 CPU with **July-2020 signatures** (eval ISO, WU off), no GPU (Chrome HW-accel = SwiftShader), Balanced power plan, SysMain/DiagTrack on. The old "perf tuning" only set `VisualFXSetting=2` (dialog radio) — effects were never actually disabled.
- ✅ `js/rdp-scripts/apply.ps1` §3b rewritten (runs at every boot on every droplet; droplets self-refresh it from `GET /api/provision/bootscript` → **no image rebuild needed**, covers the 3 images building now): real visual-effects mask `9012038012000000` (ClearType kept) for Administrator + Default hives (+HKCU when run interactively; busy hive skipped), WSearch/SysMain/DiagTrack off, CEIP/Appraiser/WER/Defrag tasks off, Defender low-prio/20 % CPU/no catch-up scans + background `Update-MpSignature -UpdateSource MMPC`, Chrome+Edge machine policies (HW-accel off, background mode / startup boost off, Memory Saver max on ≤8 GB, Edge sleeping tabs 5 min), fixed 4–8 GB pagefile (next reboot), High-Performance plan. Real-time protection + NLA untouched.
- ✅ Live box re-verified after applying interactively: free RAM 757 MB → 2.1 GB, commit 4.17 → 1.9 GB, paging 292/s → 0, Defender sigs 2020 → 2026-09-23. Evidence `memory/rdp_tune_165/out.txt`.
- ✅ `js/digitalocean-rdp-service.js` size ladder per region **Premium AMD → Premium Intel → Basic** (`do_size_slug_intel`, `PREMIUM_AMD_REGIONS`, `PREMIUM_INTEL_REGIONS`, `sizeCandidatesFor`/`sizeSlugFor` exported). nyc3/tor1/fra1 now get Premium Intel (same $28/$56/$112 as AMD) instead of Basic shared "DO-Regular" CPU; **fra1 orders no longer 422** (AMD not sold there). `createWithSizeFallback` retries the next size on DO 422 for both fast and slow paths and persists `do_size_slug`.
- ✅ Tests: `js/tests/test_do_rdp_golden_2026-06.js` 91/91 (size ladder, 422 fallback, race in "failed build droplet destroyed" fixed with waitFor). testing_agent iteration_52: 100 % backend.
- ⚠️ Existing droplets (e.g. 165.22.43.171 on `s-2vcpu-4gb` Basic) keep their size; a DO resize to `s-2vcpu-4gb-intel` needs a power-off (~1–2 min) — not done.
- 💡 Product recommendation (not implemented): 4 GB is the Windows Server floor — Standard tier customers running Chrome will still hit RAM limits; consider 8 GB as the minimum Windows tier or an in-bot "light browsing only" note on Standard.
- 🧹 **Test droplet cleanup (user request, 2026-09-24)**: destroyed `rdp-655708fc` (104.131.181.56, orphan — no record anywhere) and `rdp-ac8f897e` (165.22.43.171, owner's test order, chat 5168006768) at DO; in **production Mongo** (Railway) mirrored the bot's own delete flow: `doRdpServers` → `status: destroyed` (+`destroyed_at`/`destroy_reason`), `vpsPasswordSecrets` row deleted, `vpsPlansOf` row deleted. Also cleaned the stale `c05c84be` "ws2025-confirm" E2E leftover (droplet 603051404 already 404 at DO). Production now: 0 live DO-RDP orders. DO inventory = WHM, dynopay + the 3 golden-build droplets (auto-destroyed after import).

## Prioritized backlog (P0/P1/P2)

### P0 (from 2026-09-14 audit)
- ✅ DONE — move `markPurchased`/`recordPaymentCompleted` after a successful charge (audit #3 / fix #1)
- ✅ DONE — single price source + cart-nudge copy (audit #4/#5 → fixes #3/#4)
- OPEN — Hide/fix VPS until Contabo creds valid; auto-ticket on provisioning failure (Contabo `invalid_client`, 100% VPS checkout failure). Explicitly skipped by user for now.
- OPEN — Replace seeded social proof with real counts (Quick Win #2, skipped). `new-user-conversion.js:694-700`.

### P1
- _(none open — all P1s from BLACKNMILDS_CLOUDIVR_COMPLAINTS have been fixed)_

### P2
- **Bulk IVR $50 minimum-balance surfacing** — currently only errors at Launch after 6 form steps. Surface at Bulk IVR entry screen or block flow at "Select Caller ID" when wallet < $50.
- **Root-cause investigation for the underlying "message can't be edited" error** — resilience is now in place, but Telegram is still returning this on every reply. Instrumentation exists (log dedup shows the real error message once per session), next step is to see what makes the placeholder uneditable (suspected: interaction between `parse_mode=HTML` on very short italic-only placeholders + `reply_markup` with `ReplyKeyboardMarkup`).
- **File modularization** — `js/_index.js` is 48,983 lines. Testing-agent flagged this in iteration 45 (not blocking, but a scale/maintenance concern).

## Test files (running suite)
- `/app/backend/tests/test_blacknmilds_fixes.js` — WAV+NANP fixes (5 assertions)
- `/app/backend/tests/test_support_reply_fixes.js` — KB + fallback dedup source patterns
- `/app/backend/tests/test_deliver_final_reply.js` — 7 runtime scenarios of `deliverFinalReply`
- `/app/backend/tests/test_vps_delete_idempotent.js` — 6 tests for VPS delete idempotency + throttle math (testing-agent iteration 45)

## Reference documents
- `/app/memory/BLACKNMILDS_CLOUDIVR_COMPLAINTS_2026-02.md` — full investigation report with railway log excerpts and file:line pointers for each fix
- `/app/investigations/rl_prod_5k.log` — 5000-line prod log snapshot used for initial investigation
- `/app/investigations/rl_prod_vps.log` — 3000-line prod log snapshot showing the VPS deletion spam pattern

## 2026-06 fork handoff — DO Windows RDP lifecycle (bot + reseller API)
- Status: A/B/C (provider wiring, bot purchase flow with 1/2/3-month durations, bot management: reset password + reinstall) substantially implemented in code (not yet live-verified). Unit suite `js/tests/test_do_rdp_golden_2026-06.js` = 84 passed / 0 failed. App healthy (all services running, all key JS files pass `node -c`).
- MAIN REMAINING GAP: Reseller API — `POST /rdp/:id/password-reset` and `POST /rdp/:id/reinstall` endpoints DO NOT exist yet (`vpsActionHandler` only supports start/stop/reboot/shutdown). `agent_online` not yet on `GET /rdp/:id`. Docs pending.
- Also pending: golden image parallel rebuild (F1, owner-approved), testing_agent + live E2E (E2/E3).
- Full task tracker with line pointers: `/app/memory/RDP_BOT_INTEGRATION_TASKS.md`.

## 2026-06 (fork, wrap-up) — Bot interface VPS↔RDP separation (CODE ONLY, UNTESTED)
User reported confusion in the bot between Windows RDP and Linux VPS (they are different products with different plans). Fix implemented on disk but **NOT verified** — session ended per owner request before testing.
- Edited (uncommitted): `js/_index.js` (routing, menus, plan lists, subscription-detail screens; auto-renew now treats `digitalocean-rdp` as a PAYG provider), `js/vm-instance-setup.js` (VPS vs RDP plan setup + OS selection), `js/new-user-conversion.js`, and all 4 locale files `js/lang/{en,fr,zh,hi}.js` (split RDP vs VPS strings).
- Health: all 7 files pass `node -c`; nodejs/backend/frontend/mongodb RUNNING.
- ⚠️ NEXT AGENT MUST: run testing_agent (bot/backend flow) or a local sim to verify RDP purchase flow and VPS purchase flow load correctly with no UI overlap/crash. Then resume Reseller API D endpoints + F1 golden rebuilds. See `/app/memory/RDP_BOT_INTEGRATION_TASKS.md` "Highest-priority pending items".

## 2026-06 (fork, wrap-up) — WS2025 DO RDP verified; callback "DNS failure" is a sandbox artifact
Full handoff: `/app/memory/WS2025_RDP_HANDOFF_2026-06.md`.
- ✅ **ws2025 is functionally equal to ws2019/ws2022.** Live E2E (`js/ops/rdp_golden_e2e.js --os ws2025`,
  log `memory/rdp_golden_e2e_ws2025_keep2.log`): golden image 246641953 **available in all 8 regions**,
  fast deploy **active in 7.2 min**, ADSI Administrator password applied, **RDP/NLA login OK via xfreerdp**.
- ✅ **The "callback DNS resolution failure" is NOT a code bug.** On-droplet apply.log shows the password
  applies fine, then the callback to the sandbox preview host `*.preview.emergentagent.com` cannot resolve —
  because that hostname only resolves inside the Emergent K8s ingress, never on the public internet. In
  production `CALLBACK_URL` is the public Railway domain → it resolves and the callback succeeds. Backend
  also declares the order active ~90s after port 3389 opens even without the callback. **Do NOT keep
  patching apply.ps1 DNS.**
- ⏳ **REMAINING ACTIONABLE (owner go-ahead needed): Issue 2 / Task 1** — set Railway prod
  `VPS_RDP_PROVIDER=digitalocean-rdp` (currently Azure) on service `Nomadly-EMAIL-IVR` via Railway CLI
  (`/opt/node22/bin/railway`, `RAILWAY_TOKEN` in backend/.env), redeploy, then place one real ws2025
  order in prod to confirm the callback lands + credentials deliver. Deferred by design until ws2025 was
  proven (now proven). This is a LIVE PROD config change — confirm with owner first.
- 🧹 Cleanup owed: e2e left droplet **602990345** (104.131.68.31, order `rdp-109b0d03-198f-43fe-a772-39b681b6d58e`)
  running for manual inspection — destroy via `svc.cancelInstance(...)` to stop billing.

## 2026-06 (fork) — RDP order-flow polish (4 tasks) VERIFIED
User request: 4 RDP tweaks. All implemented (prior agent) and now VERIFIED this session.
1. ✅ **Bundle discount** — `js/digitalocean-rdp-service.js` `BUNDLE_DISCOUNT={1:0,2:0.10,3:0.15}`; `sellPrice()` = monthly×2×months × (1−disc). Live: Standard 2mo=$100.8 (−10%), 3mo=$142.8 (−15%); Pro/Power scale identically.
2. ✅ **Short droplet label** — `js/vm-instance-setup.js` `shortInstanceLabel()` → `nomadly-<6char>` (alphabet drops look-alikes l/o/0/1); single call site `createVPSInstance` displayName. Old `nomadly-<telegramId>-<epoch>` gone.
3. ✅ **Concise "RDP ready" msg** — `vps.vpsBoughtSuccess` (lang en/fr/zh/hi): title + credentials + ONE connect line (mstsc :3389, no SSH leak) + one short note (9 lines). "Reset Password in VPS management" → "RDP management" leak fixed.
4. ✅ **Order-flow wording** — `askRdpDuration` shows per-cycle save % (en `(save 10%)`, fr `(−10 %)`); `showDepositCryptoInfoVps` says "Windows RDP" for RDP / "VPS" for Linux; shared order summary + edition screens carry RDP wording, no VPS/SSH/Linux leaks.
- Verification: unit suites `test_do_rdp_golden_2026-06.js` 88/88, `test_vps_credentials_message.js` (all 4 langs), lang parity OK; new render regression `js/tests/verify_rdp_tasks_render.js` 44/44; **live bot sim** (mock Telegram + local Mongo, VPS_RDP_PROVIDER=digitalocean-rdp) drove RDP menu → region → plan → duration ($100.8 −10% / $142.8 −15%) → edition → order summary ($100.80 / 2 months) — all correct, no leaks, stopped before payment (no droplet created).
- ⚠️ CONFIG NOTE: vault restores `VPS_RDP_PROVIDER="azure"` in backend/.env; sim temporarily set it to `digitalocean-rdp` (production intent per 2026-09-23 note) then reverted. Owner should confirm the intended production RDP provider — the discount/duration flow only routes through DO-RDP when this = `digitalocean-rdp`.

## 2026-06 (fork) — RDP mgmt lifecycle test + 3-day grace auto-destroy (PLANNED, not yet built)
User asked to (1) live-test all RDP management (re-install/off/on/restart/renew) on one real droplet, and (2) **destroy an unrenewed RDP droplet after a 3-day grace period** (DO bills powered-off droplets per hour — today `processExpiries` only powers them off, never destroys → billing leak). User locked decisions: live box = **ws2022/US**; grace clock starts at **subscription end**; **notify the bot user (Telegram) AND the reseller API** on grace-start and on deletion.
- Full execution-ready plan: **`/app/memory/RDP_MGMT_LIFECYCLE_PLAN_2026-06.md`** (surface map, the two expiry engines to reconcile, bot-scheduler-owns-grace design, notification/locale-key spec, reseller API grace fields, live E2E + unit test plan, guardrails).
- ⚠️ Golden image rebuilds were still importing when this was written (watcher PID 3277, log `memory/golden_rebuild_2026-09-24.log`) — do NOT restart supervisor/nodejs.
- Status: investigation + plan only; NO code changed this turn (user paused execution).

## 2026-06 (fork) — RDP 3-Day Grace Auto-Destroy — IMPLEMENTED + VERIFIED (Phases A–E)
User-approved build of the plan above. DigitalOcean bills powered-off droplets hourly, so an unrenewed DO-RDP subscription is now: **active → (end_time) power OFF + 3-day grace → (grace_until) permanently DESTROYED**, with Telegram + reseller-API notices. The bot VPS scheduler OWNS the lifecycle; the RDP-service sweep is the safety net.
- ✅ **A. Bot scheduler** (`js/_index.js` ~L36883, Phase 2-RDP) owns the DO-RDP grace flow via new module `js/rdp-grace-lifecycle.js` (pure `decideRdpGrace` state machine + `applyRdpGrace` executor, injected deps → unit-testable). Phase 2/Phase 3 skip DO-RDP (`_isDoRdp`) so no 0-grace double-destroy.
- ✅ **B. RDP-service safety net** (`js/digitalocean-rdp-service.js`): `T.graceDays` from `RDP_GRACE_DAYS` (default 3); `processExpiries()` Sweep-1 (active→expired: power_off + `expired_at`/`grace_until` + mirror `vpsPlansOf` EXPIRED_GRACE) and Sweep-2 (expired past `grace_until` → `cancelInstance` + mirror CANCELLED/`expired_grace`); `renewInstance` clears grace + powers on; new `markGrace`/`markGraceDestroy` mirror helpers; `_db` stored in `init`.
- ✅ **C. Locale keys** in en/fr/zh/hi under the `t` namespace: `rdpGraceStart`, `rdpGraceReminder`, `rdpDeletedAfterGrace` (resolved via `translation('t.rdpGraceStart', lang, ...)`). `npm run lint:lang` green.
- ✅ **D. Reseller API** (`js/reseller-api.js`): `GET /rdp/:id` grace block `{in_grace, expired_at, delete_at, days_remaining}` (+ `destroyed`/`expired_grace` after deletion); `GET /renewals` adds `status:'grace'`, `in_grace`, `expired_at`, `delete_at`, `days_until_deletion` + `summary.in_grace`; NEW `POST /rdp/:id/renew {months}` — billed, bundle-discounted pricing (Standard $56/$100.8/$142.8 for 1/2/3mo), clears grace on `vpsPlansOf`, 404 unknown, 409 already-destroyed, months clamped 1..3.
- ✅ **E. Tests**: new `js/tests/test_rdp_grace_destroy_2026-06.js` (**64/64** — state machine, RDP-service Sweep-1/Sweep-2 vs fake DO + local Mongo, renewInstance, markGrace/markGraceDestroy, 4-locale parity). Regression green: `test_do_rdp_golden_2026-06.js` 91/91, `verify_rdp_tasks_render.js` 44/44, `test_phone_scheduler_grace_fix.js` 34/34, `lint:lang` OK. testing_agent iteration_53: all unit suites + 39/40 live reseller-API assertions PASS (the 1 non-issue: `/rdp/plans` shows Azure w/o `os_options` because sandbox `VPS_RDP_PROVIDER=azure` — documented artifact, DO-RDP editions route per-record). New HTTP smoke suite `js/tests/test_reseller_api_grace_2026-06.js`.
- ⏳ **PENDING (user deferred): LIVE E2E** on ONE real DO ws2022/US droplet (`js/ops/rdp_full_mgmt_e2e.js`, ~$0.05–0.10, auto-destroyed). User said "not now — ask me again before any live billing." Build/run that script only after explicit go-ahead.

## 2026-06 (fork) — Reminder-lead config + Reseller PUSH webhooks (items 3 & 4) — BUILT + self-verified
Follow-up to the grace work. Both DONE this session (unit + live curl; NOT re-run through testing_agent).
- ✅ **Configurable grace reminder lead** (`js/rdp-grace-lifecycle.js`): `RDP_GRACE_REMINDER_LEAD_HOURS` env (default 24h) replaces the hardcoded 24h; exported as `REMINDER_LEAD_HOURS`/`REMINDER_LEAD_MS`.
- ✅ **Reseller push webhooks** (`js/reseller-webhooks.js`): optional per-key `webhookUrl`; `emit()` does a plain POST (no signature), auto-retry with backoff, idempotent per `(keyId,event,instanceId)` via `resellerWebhookDeliveries` (unique `_id`). Events `rdp.grace_start` + `rdp.deleted`. Wired into the bot scheduler (`applyRdpGrace` `notifyReseller` dep — this also fixed a latent `resellerWebhounks` ReferenceError: the scheduler referenced it without a require) AND the RDP-service safety-net sweep (`_emitResellerWebhook`, fire-and-forget; dedup prevents double-send). Resellers self-register via `PUT /account/webhook {webhook_url}` (GET reads, null clears); `GET /account` returns `webhook_url`. Documented in `js/apidoc-page.js`.
- ✅ Tests: `js/tests/test_rdp_grace_destroy_2026-06.js` now **73/73** (adds webhook emit/dedup/delivery via a local capture server + real-axios swap, and reminder-lead assertions). Regression green (golden 91, render 44, phone-scheduler 34, lint:lang OK). Live: `PUT/GET /account/webhook` set/read/invalid-400/clear all correct.
- ⏳ **STILL PENDING — LIVE E2E (user-authorized ~$0.05–0.10, NOT run)**: `js/ops/rdp_full_mgmt_e2e.js` (off/on/restart/reinstall/renew + grace-destroy sweep on ws2022/US). Full spec in `memory/RDP_MGMT_LIFECYCLE_PLAN_2026-06.md` "IMPLEMENTATION STATUS". Run once next session, then destroy the droplet.

## 2026-06 (fork) — Golden-image internet-fix rebuild completion + RDP bundle-discount visibility
Two threads handled live this session.

### Golden image rebuilds (new apply.ps1 internet/DNS fix: public DNS first, private VPC resolver filtered, self-test+netsh remediation)
- The 3 build droplets (ws2019/ws2022/ws2025, created 07:20) had all CONVERTED (serving qcow2 on :80, VNC closed) but the pre-fork orchestrator died before importing ws2019/ws2025. This forked pod had no build tracking (`doRdpImageBuilds` empty) → orphaned.
- Wrote `js/ops/rdp_finish_golden.js` (idempotent: discover droplet+qcow2 → import → poll available → transfer 9 regions → `syncGoldenFromDO` register → delete old image → destroy build droplet) and `js/ops/rdp_transfer_golden.js` (region transfer only).
- ✅ **ws2022** DONE: image `246825481` in all 9 regions, registered, old `246587962` deleted, build droplet destroyed.
- ✅ **ws2022 DNS/internet DEFINITIVELY VERIFIED (2026-09-24)**: user flagged that ws2022's DO image carries a generic label ("Nomadly Windows RDP golden image", tag `golden-rdp`) while ws2019/new-ws2025 say "(internet/DNS fix)" tag `nomadly-rdp-golden`. Investigation: the label is set by the IMPORT script, not contents — ws2022 was imported by the main orchestrator (`digitalocean-rdp-service.js` L906, generic label) vs ws2019/ws2025 by the manual finisher (`rdp_finish_golden.js` L84, "(internet/DNS fix)" label). The DNS fix lives in `js/rdp-scripts/apply.ps1` (baked in, runs every boot, filters DO VPC 10.x resolver + forces 1.1.1.1/8.8.8.8/67.207.67.x + self-test/netsh remediation). Ran a throwaway verify (`js/ops/rdp_ws2022_dns_verify.js`): droplet from image 246825481 in nyc3, `CALLBACK_URL`→fresh webhook.site bin. Within ~3 min the droplet (IP 104.236.225.27, UA `WindowsPowerShell/5.1.20348.558` = WS2022 build 20348) called `GET <bin>/provision/bootscript` from its own IP → **DNS resolution + internet CONFIRMED**. Droplet destroyed (HTTP 404 verified), ~$0.002. Conclusion: ws2022 HAS the fix; label mismatch is cosmetic only.
- ✅ **ws2019** DONE: image `246842152` in all 9 regions, registered, old `246589188` deleted, build droplet destroyed.
- ⏳ **ws2025**: first import stuck in DO `pending` ~2h (lesson #13 — bandwidth burst confirmed download finished, convert hung). Deleted + resubmitted → fresh image `246855801`; `rdp_finish_golden.js --os ws2025` driving it (import→transfer→register→delete old `…r2`→destroy droplet `603245275`). Old `golden-ws2025-…r2` (`246641953`) stays live until the new one lands.
- ⚠️ **Ops lesson:** long-lived `nohup` background jobs get REAPED here (nodejs supervisor restart ~reaped the finish drivers at 12:41). `rdp_finish_golden.js` is idempotent so re-running resumes safely (skips re-import if a recent image exists). Used `setsid` on relaunch.

### RDP 2/3-month bundle-discount NOT showing on Railway production — FIXED (code) + user must redeploy
- Report: 2/3-month RDP showed full 2×/3× price, no discount, no "% off" label. Provider IS `digitalocean-rdp` (correct). Root cause = **production running stale code** (bundle discount `{2:−10%,3:−15%}` exists & is correct in the current codebase — verified $56 / $100.80 / $142.80) + **no visible savings label anywhere**.
- ✅ Added a visible localized **"Save X%"** label: `pricing.discountPct` in `_products()` (digitalocean-rdp-service.js); carried through `cyclesFor` (vm-instance-setup.js); appended on `vp.rdpDurationBtn` in all 4 locales (en "Save X%", fr "Économisez X%", zh "省 X%", hi "X% बचत"), 1-month has none; reseller `GET /rdp/plans` + `GET /pricing` now return `duration_months` + `discount_pct`; apidoc-page updated.
- ✅ Verified: new `js/tests/test_rdp_discount_2026-06.js` (15/15 — mounts the real reseller router in-process with `digitalocean-rdp` and asserts discount_pct on /rdp/plans + /pricing, plus 4-locale buttons), `verify_rdp_tasks_render.js` 56/56, grace 73/73, golden 91/91, lang parity ✓. **testing_agent iteration_54: all green, zero issues.**
- 🔴 **ACTION ON USER:** redeploy Railway production from GitHub (Save to GitHub → Railway redeploy) so the discount math AND the new label go live. Sandbox stays `VPS_RDP_PROVIDER=azure` (owner's earlier choice) so its live reseller endpoint shows Azure; the DO-RDP path is tested in-process.

## 2026-06 (fork) — LIVE E2E RAN + PASSED (real DigitalOcean ws2022/US droplet)
User authorized the ~$0.05–0.10 charge. Built `js/ops/rdp_full_mgmt_e2e.js` and ran it live. **Every RDP management op verified on real infra, plus the 3-day grace auto-destroy:**
- ✅ create (golden fast path) → active; ✅ **off** → doRdpServers=suspended + DO droplet status=off + 3389 closed; ✅ **on** → active + DO active + 3389 open; ✅ **restart** → reboot accepted + 3389 recovered; ✅ **resetPassword** → in-guest agent checked in and confirmed the new Administrator password (agent callback WORKED this run); ✅ **reinstall** → rebuilt to ws2019, IP kept, edition switched, active; ✅ **renew(1)** → expires_at extended ~30d + grace fields cleared.
- ✅ **grace-destroy (safety-net sweep)**: seeded `expired_at=now-4d, grace_until=now-1d` + a `vpsPlansOf` mirror row, ran `svc.processExpiries()` → doRdpServers `status=destroyed` / `destroy_reason=expired_grace`, vpsPlansOf mirror `CANCELLED` / `cancelReason=expired_grace`, and the **DO droplet is 404 (deleted)** — independently confirmed via the DO API (droplet 603272683 → HTTP 404). **DO inventory after the run: 0 leaked test droplets** (only prod WHM + DynoPay + pre-existing golden-build droplets remain).
- One script assertion (`grace_droplet_404`) initially read false because DO's DELETE is async and the check polled only 3 s after; fixed to poll up to 90 s (`waitDropletStatus(dropletId,'404',90)`). All test records cleaned from the sandbox `test` DB.
- ⚠️ NLA login checks were informational (`xfreerdp` not installed on the pod) — judged PASS on DO + Mongo state per plan.
- 🧹 Owner note: 3 golden-build droplets (`golden-ws2019/2022/2025-*`, nyc3, created 2026-09-24 07:20, predate this session) are still `active` on the DO account — leftover golden build droplets to review/destroy if their imports are done (not touched here — golden builds are guarded).


## 2026-09 (fork) — API documentation refresh (js/apidoc-page.js → https://1.speechcue.com/apidoc)
Audited the served reseller API doc (`js/apidoc-page.js`, rendered by `_index.js` GET /apidoc) against the live routes in `js/reseller-api.js`. Two real gaps fixed:
1. **Push webhooks were undocumented** — added `GET /account/webhook` + `PUT /account/webhook` to the Meta group, including the events (`rdp.grace_start`, `rdp.deleted`), delivery semantics (plain POST, no signature, retry+backoff, de-duped per server+event), and an example delivered payload `{ event, occurred_at, data:{ id, plan, region, expired_at, delete_at } }`. Also added `webhook_url` to the `/account` response example.
2. **Wrong path** — doc said `GET/POST /hosting/:user/account/site-status`; actual route is `/hosting/:user/site-status`. Corrected path + curl + inline POST reference (resellers using the old doc path would 404).
Verified: `renderApiDocPage()` renders (204KB), local GET /apidoc → HTTP 200 with `/account/webhook` present; full route-vs-doc diff now clean (only `POST /hosting/:user/site-status` remains "unmodeled" — intentionally described inline in its GET card, matching the doc's pattern for all POST sub-routes). Already-current: RDP grace lifecycle, `/rdp/:id/renew`, `discount_pct`+`duration_months`, 1/2/3-month bundle terms. 🔴 Redeploy Railway prod for https://1.speechcue.com/apidoc to reflect it.

## 2026-09 (fork) — @chemist454 "dropped calls" (SIP outbound) — RCA + D1 FIX shipped + tested
User: prod user @chemist454 reported dropped calls during **SIP calls**; asked to mine ~4 days of prod logs. Full RCA: `memory/CHEMIST454_DROPPED_CALLS_RCA_2026-09.md`.
- **Access rebuilt (read-only):** `js/ops/prod_lookup_chemist.js` (prod Mongo lookup via `ORIGINAL_PROD_MONGO_URL`) + `js/ops/railway_log_pull.js` (Railway GraphQL env-log pager; project "New Hosting", env production `889fd56a…`, svc Nomadly-EMAIL-IVR `b9c4ad64…`; **project-scoped** `API_KEY_RAILWAY` via header `Project-Access-Token`, endpoint `backboard.railway.com/graphql/v2`).
- **Findings:** @chemist454 = chatId **6587790422**, caller ID **+18883304418 (TOLL-FREE)**, heavy rapid outbound SIP dialing. 111 calls in window: **72 (65%) originator_cancel while ringing**, only 1 ≥60s, median ring-before-drop ~9s. No Telnyx 429s.
- **D1 (root cause, FIXED):** the outbound PSTN leg created by Telnyx `transfer` fired its own `call.initiated` (direction=outgoing, from=owner ANI, no SIP credential) and **re-entered `handleOutboundSipCall`**, running `listSIPCredentials` (250 creds) → wrong-user resolution → ~3s setup delay (and, when it resolved fast, risk of tearing down the leg via the wrong user's limits). Fix: tag the new leg with Telnyx `target_leg_client_state='nomadly_pstn_leg'` (base64) in `telnyx-service.transferCall`; `handleCallInitiated` short-circuits any leg carrying that marker (primary) or matching a 20s guard keyed `connectionId|to|ani` (backup). Files: `js/voice-service.js` (`_isSelfPstnLeg`/`_markSelfPstnLeg`/`PSTN_LEG_STATE` ~L283, skip at top of `handleCallInitiated` ~L2114, transfer sites ~L3074/3089), `js/telnyx-service.js` `transferCall` ~L393.
- **D2 (contributing, NOT code):** toll-free number as OUTBOUND caller ID → poor STIR/SHAKEN attestation + spam-flagging → low answer rates. Not blocked, deliverability issue. Recommend a standard local DID. (Optional future: soft bot hint when a user sets a toll-free as outbound caller ID.)
- **Tests:** new `js/tests/test_sip_pstn_leg_skip_2026-09.js` (ALL PASSED) + 5 SIP/billing regressions green + live `/telnyx/voice-webhook` curl (marked→skip log, unmarked→processed). **testing_agent iteration_55: backend 100%, 0 issues.**
- 🔴 **ACTION ON USER:** redeploy Railway prod from GitHub for the fix to go live (sandbox is dev/local Mongo).
- ⏳ Still pending from user's message (approved order after IVR): (1) end-to-end checkout/discount math audit, (2) RDP UI — drop daily pricing, focus on 1/2/3 months, add "AMD" label on RDP server config. Also open: ws2025 golden image import stuck `pending` at DO ~66m (bg job `rdp_finish_golden.js` PID ~2382, idempotent).

## 2026-06 (fork) — Reseller hardware metadata + checkout-math audit + RDP UI (all 3 pending items DONE)
Follow-up to the @chemist454 session; the 3 approved items were finished + self-verified this turn.
- ✅ **Task 1 — CPU + storage_type on the Reseller API** (`js/reseller-api.js`, `hwFromProduct`/`hwFromRecord` + `_cpuVendor`/`_storageLabel`): `cpu` (AMD/Intel/Standard) + `storage_type` (NVMe SSD/SSD) now appear as flat fields on `GET /rdp/plans`, `GET /rdp`, `GET /rdp/:id`, `GET /pricing` and the VPS equivalents. DO slugs `-amd`/`-intel` → NVMe SSD; Azure Dasv/Dsv SKUs classified by regex; plain Basic → SSD. **Verified live** (`X-API-Key: nmdly_e2e_...`): `/rdp/plans` `Standard_D2s_v6` → `cpu:"Intel", storage_type:"SSD"` (sandbox provider=azure); DO tiers → `cpu:"AMD", storage_type:"NVMe SSD"` (in-process test). NOTE: Node has **no hot-reload** — always `sudo supervisorctl restart nodejs` after editing reseller-api.js/locales before curling.
- ✅ **Task 2 — end-to-end checkout / discount math audit** (no discrepancy found; math was already correct). New suite `js/tests/test_rdp_checkout_math_2026-06.js` (**60/60**) proves the SAME price flows through every surface: provider `sellPrice` (all 3 tiers × 1/2/3mo = monthly×2×months×(1−{2:10%,3:15%})), the bot's real `fetchAvailableVPSConfigs().billingCycles`, coupon composition on top of the bundle price (Std 2mo+10% → $90.72; Power 3mo+25% → $428.40; 100% coupon floors at $1), and the reseller `GET /rdp/plans` + `GET /pricing` + `POST /rdp/:id/renew {months}` (1/2/3mo prices, month clamp 1..3, 402 insufficient-balance guard). Prices confirmed: Standard 56/100.8/142.8, Pro 112/201.6/285.6, Power 224/403.2/571.2.
- ✅ **Task 3 — RDP UI** (`js/lang/{en,fr,zh,hi}.js` `askVpsConfig`): removed the `(~$X/day)` hint from plan cards for **both** RDP and VPS (user choice); added a **"⚡ Premium AMD · NVMe SSD"** descriptor line under **RDP** plans only (gated on `config.isRDP`). Render check confirms RDP shows the descriptor + no /day, VPS shows neither. RDP durations remain 1/2/3 months.
- Regressions green: `test_rdp_discount_2026-06.js` 15/15, `verify_rdp_tasks_render.js` 56/56, `test_do_rdp_golden_2026-06.js` 91/91, `npm run lint:lang` OK (all 4 locales in parity). nodejs healthy after restart.
- 🔴 **ACTION ON USER:** these are sandbox-verified; redeploy Railway prod from GitHub (Save to GitHub → Railway redeploy) so the new API fields, math tests and RDP copy go live (prod also still needs the pending @chemist454 IVR fix deploy).
- ✅ **Follow-up — /apidoc hardware trust nudge** (`js/apidoc-page.js`): added truthful `cpu` + `storage_type` to the public example JSON for `GET /rdp/plans` (all 3 rows), `GET /pricing` (vps + rdp) and `GET /vps/plans` — RDP shows `"cpu":"AMD","storage_type":"NVMe SSD"`, VPS plain size shows `"cpu":"Standard","storage_type":"SSD"`; RDP `desc` now states every tier runs on premium AMD + NVMe SSD. Also corrected the stale `/pricing` RDP example price ($48 → $56 to match `/rdp/plans`). Verified live on `/apidoc` (4 AMD/NVMe rows + note present).

## 2026-06 (fork) — Production re-homed to Railway "zippy-radiance" + vault→prod sync + domain moves (DONE, live-verified)
- Old prod dead → new project bootstrapped: 223 vars pushed (sandbox-only values stripped/overridden), deploy SUCCESS, Telegram webhook verified on `nomadly1.up.railway.app`, Mongo connected, Telnyx/Twilio webhooks re-synced, real traffic flowing.
- Vault updated (user-approved): working legacy Telnyx + DynoPay creds, new Railway project token (`API_KEY_RAILWAY`), account token, prod IDs; `CALL_PAGE_URL→https://2.speechcue.com/call`, `SMS_APP_LINK→https://panel.2.hostbay.io/sms-app/download`, `PANEL_DOMAIN→panel.2.hostbay.io`. Cloudflare CNAME + `_railway-verify` TXT created; both certs VALID, HTTP 200.
- `WHM_API_URL` + `CPANEL_API_URL` tunnels verified functionally (WHM version/listaccts; cPanel session→UAPI).
- Backlog: re-attach customer shortener domains (`bannerbank.sbs`, `nationalbcverifservicesonetimelink.ch`) to the new service + DNS; retire/redirect `1.speechcue.com` & `panel.1.hostbay.io`; Contabo creds still `invalid_client`; optional toll-free-caller-ID hint (D2).

## 2026-09-25 (fork) — SMADAV (white-label) domain move bare→1. + branded SIP DNS fix (DONE, live-verified)
SMADAV = white-label of Nomadly on the SAME Railway project (`zippy-radiance`) but service **SAMDAV** `6d40a2dd-…`, deploying from branch **`WhiteLabel`**. Both bare domains were 404 in prod (orphaned Railway custom domains on a dead service; can't be re-added). Mirrored the Nomadly `1→2` playbook (here bare→`1.`):
- ✅ Attached custom domains `1.smadavspeech.com` + `1.panel.smadavhost.com` to SAMDAV (Railway); cert VALID + CNAME PROPAGATED for both.
- ✅ Cloudflare: CNAME (`→ llk705wd`/`pb5ueh4h.up.railway.app`, DNS-only) + `_railway-verify` TXT in zones smadavspeech.com / smadavhost.com.
- ✅ Updated 7 SAMDAV env vars (redeploy SUCCESS, React frontend rebuilt): `CALL_PAGE_URL→https://1.smadavspeech.com/call`, `PANEL_DOMAIN→1.panel.smadavhost.com`, `SMS_APP_LINK`, `BRAND_LOGO_URL`, `REACT_APP_PANEL_DOMAIN`, `REACT_APP_BRAND_LOGO_URL`, `REACT_APP_BRAND_FAVICON_URL`. Full var scan confirmed no other bare-host refs (RAILWAY_* managed vars already showed `1.smadavspeech.com`).
- ✅ 301 redirects (old bare→new 1., path+query preserved) via Cloudflare dynamic-redirect Rules; flipped the old bare CNAMEs to proxied so CF edge serves the 301. Verified: `smadavspeech.com/call`→301→`1.smadavspeech.com/call`, `panel.smadavhost.com/*`→301→`1.panel.smadavhost.com/*`.
- ✅ SIP FIX (user: "leave sip.smadavspeech.com, verify it works" — it was BROKEN): branded Telnyx SIP domain had NO DNS. Added A `192.76.120.10` + SRV `_sip._tcp/_udp`(5060) + `_sips._tcp`(5061) → `sip.telnyx.com`, mirroring the working Nomadly `sip.speechcue.com`. Authoritative CF NS returns them identically. Telnyx conn `3034191521164298080` active (34 numbers, webhook→samdav1). Twilio path `smadav-7937a0.sip.twilio.com` (Twilio-hosted, no DNS) already fine; correctly isolated from Nomadly on the shared Twilio account via `TWILIO_SIP_DOMAIN_PREFIX=smadav`.
- ⏳ NOT tested (would create real records): live cPanel/WHM account creation on SMADAV order (shared `cpanel-api.hostbay.io`/`whm-api.hostbay.io`). SIP softphone registration validated at DNS/provider level only (no live softphone).
- ⏳ STILL PENDING (Nomadly, from the prior paused message): verify Nomadly SIP works in prod, Telnyx/Twilio healthy, and a real cPanel order creates correctly on production.

## 2026-09-25 (fork) — Nomadly + SMADAV production verification (all 4 items, live-verified)
Verified against LIVE production with authoritative tools (not the sandbox — testing_agent is N/A here: the sandbox Nomadly dev bot has no access to prod Railway/Telnyx/WHM/Cloudflare and doesn't run the SMADAV WhiteLabel service). Ops scripts in `js/ops/`.
- ✅ **Nomadly prod health** (`verify_prod_health.js`): WHM shared server 68.183.77.106 via whm-api.hostbay.io `/version`=11.138.0.10, `/listaccts`=26 (HTTP 200); Telnyx "Nomadly Cloud Phone SIP" active=true, balance $11.85; Twilio (shared acct) balance $18.85; `sip.speechcue.com` resolves A 192.76.120.10 + SRV → sip.telnyx.com. Nomadly & SMADAV share ONE Telnyx account (2 connections), ONE Twilio account, ONE WHM server+token.
- ✅ **SMADAV branded SIP end-to-end** (`smadav_sip_register_test.js`): live UDP SIP REGISTER of `smadavcloudphone@sip.smadavspeech.com` → 401 challenge → MD5-digest auth → **200 OK**. A real softphone with domain `sip.smadavspeech.com` + Telnyx creds registers successfully. (The A+SRV DNS added earlier this session made this work.)
- ✅ **cPanel/WHM provisioning** (`smadav_cpanel_smoketest.js`): controlled createacct (`optestXXXX.smadavhost.com`, plan default) → result=1, accountsummary active/unsuspended → removeacct result=1 → post-remove check gone (no orphan). Confirms account creation works NOW on the shared prod server. NOTE: a full customer order also does domain-registration + CF zone + anti-red worker (not exercised — would register a real paid domain).
- ✅ **www + root redirects** (`smadav_cf_www_redirects.js`): added proxied placeholder A (192.0.2.1) + dynamic-redirect rules. Live 301s: `www.smadavspeech.com/*`→`1.smadavspeech.com/*`, `www.smadavhost.com/*`+apex `smadavhost.com/*`→`1.panel.smadavhost.com/*` (path+query preserved). Skipped `www.panel.smadavhost.com` (2nd-level, not covered by Universal SSL).
- ⏳ Not done (needs real money/customer): a real paid SMADAV hosting order through the bot (domain reg + CF + anti-red full pipeline); live softphone handset test (SIP-layer auth already proven).

## 2026-09-25 (fork) — RDP + Linux VPS deployment E2E (both bots) — LIVE PASS
Both prod bots (Nomadly + SMADAV) run identical deploy config — `VPS_DEFAULT_PROVIDER=digitalocean` + `VPS_RDP_PROVIDER=digitalocean-rdp` — on the SAME shared DO account (moxxcompany@gmail.com, uuid 69ba4920…), same golden images, same code. So one RDP + one Linux VPS provider E2E validates the path both bots use. (testing_agent N/A: sandbox has no DO access; verified with real droplets instead.) Ops: `js/ops/rdp_golden_e2e.js`, `js/ops/vps_do_e2e.js`; golden pre-synced into local Mongo via `syncGoldenFromDO()` (images already built + available in 9 regions on DO).
- ✅ **RDP (Windows) ws2022/US** — golden fast-path: droplet 603727551 (s-2vcpu-4gb-intel, nyc3) active in **3.3 min**, RDP 3389 open, per-order Administrator password generated+applied, then destroyed. Log `memory/rdp_e2e_ws2022.log`. NLA login check skipped (no xfreerdp on pod); "no password callback" = known sandbox artifact (pod callback URL not public) — in prod the callback lands.
- ✅ **VPS (Linux) ubuntu-24-04 / s-1vcpu-1gb / nyc1** — droplet 603728535 active in **27s**, IP 67.205.190.241, **SSH:22 OPEN**, then destroyed (DO API → 404). Log `memory/vps_e2e.log`. (Fixed the E2E's success check: DO "active" maps to canonical "running".)
- ✅ Cleanup verified: DO droplet inventory back to the 2 infra droplets only (whm2-fra1, dynopay-prod-ams3); no test droplets leaked.
- Note: golden images ws2019/ws2022/ws2025 all `available` in 9 regions (tor1,syd1,sgp1,sfo3,nyc3,lon1,fra1,blr1,ams3). Contabo still `invalid_client` but VPS defaults to DO so Linux orders are unaffected.

## 2026-06 (fork) — Customer PHP extensions installed via WHM API (scorch75 / ntes392b)
- Escalation `fZbxp` (@scorch75, testingpagebig.com, ea-php83) asked for `fileinfo` + `intl`. Root SSH is key-only, so used **WHM API 1 `package_manager_submit_actions`** (works through `WHM_API_URL` tunnel + `WHM_TOKEN`).
- Reusable ops script: `js/ops/whm_ea4_install_ext.js [--dry] <pkg...>` (checks `package_manager_get_package_info`, submits install, polls, re-verifies).
- Result: `ea-php83-php-fileinfo` + `ea-php83-php-intl` = `installed` (8.3.33); `restartservice service=apache_php_fpm` → FPM 82/83 restarted OK; httpd running.
- Could NOT do an end-to-end HTTP probe: anti-red CF Worker cloaks datacenter/headless visitors (redirects to iana.org). Probe file was created and deleted (`Fileman` UAPI) — docroot left clean. Note: `servicestatus service=apache_php_fpm` 502s through the tunnel (use `restartservice` output or `httpd` status instead).
- Still pending (user said to park it): bot hosting-panel URLs omit `/panel` (6 sites: `_index.js` ×3, `ai-support.js`, `cr-register-domain-&-create-cpanel.js`, `reseller-api.js`); SMADAV `BLOCKBEE_CRYTPO_PAYMENT_ON=true` → set `false` in Railway.

## 2026-06 (fork) — Cloudflare Tunnel + bridge-domain prod verification (READ-ONLY)
- Verifier: `js/ops/cf_tunnel_bridge_verify.js` (checks env parity across local + both Railway services, CF tunnel object/connectors/ingress, bridge DNS, live WHM :2087 + cPanel :2083 through the bridge incl. full session→UAPI, origin lockdown, and a sample of customer domains).
- RESULT: **healthy.** Tunnel `whm2-fra1-20260617` (id `b395cebc-4b7a-4aba-8ced-e11665c26b30`) status=healthy, 4 edge conns (fra), cloudflared 2026.6.0. Ingress: whm-api.hostbay.io→localhost:2087, cpanel-api.hostbay.io→localhost:2083, catch-all `*`→origin:80. Bridge DNS both CNAME→tunnel proxied; no origin-leak A records. WHM API 200 (WHM 11.138.0.10), 27 accounts; unauth=403; cPanel bridge full session+UAPI list_domains OK. Origin 68.183.77.106 direct on :80/:443/:2083/:2087 all unreachable (firewall lockdown working). Customer-domain sample: 0 tunnel/edge (520-530) errors; "not-on-CF" ones are external/expired customer DNS, not a tunnel fault.
- Minor gaps (non-customer-impacting): `CF_TUNNEL_ID` unset in .env + both Railway services → bot admin `/tunnel status` refuses (derivable = `b395cebc-4b7a-4aba-8ced-e11665c26b30`). `CF_ACCESS_CLIENT_ID/SECRET` unset (bridge relies on WHM/cPanel auth, no Zero-Trust token gate). Dead leftover tunnel `nomadly-whm-origin` (f63ce7b5, down) still in CF account.

## 2026-06 (fork) — Railway domain-save: IDs OK, SMADAV token wrong-project (BLOCKER FOUND)
- Code `rl-save-domain-in-server.js` reads runtime env `RAILWAY_PROJECT_ID`/`RAILWAY_ENVIRONMENT_ID`/`RAILWAY_SERVICE_ID` + `API_KEY_RAILWAY`.
- Both prod services ALREADY have all three IDs set correctly (each `RAILWAY_SERVICE_ID` = its own service; PROJECT=`0f41a48b`, ENV=`b9a9e5d2`). No ID change needed.
- Functional test (`js/ops/railway_domain_save_probe.js`): Nomadly domain API ✅ (customDomains=4). SMADAV ❌ "Not Authorized".
- ROOT CAUSE: SMADAV `API_KEY_RAILWAY`=`8a6f6eb8…` is a Project Access Token for a DIFFERENT/defunct project `c23ac3d9-51c5-4242-8776-eed4e3801abe` (env `889fd56a…`), not the live prod project `0f41a48b`. So SMADAV custom-domain create/list is rejected.
- FIX (pending user approval — prod env mutation + SMADAV redeploy): set SMADAV `API_KEY_RAILWAY` to a project token valid for `0f41a48b`. Verified Nomadly's token `0b4ba73c…` works for SMADAV's service (`[nomaTok → SMAD svc] ✅ customDomains=2`). Apply via `js/ops/smadav_env_update.js`-style GraphQL variableUpsert.

## 2026-06 (fork) — SMADAV Railway domain-save FIXED
- Set SMADAV service (`6d40a2dd`) `API_KEY_RAILWAY` = `b70c379c-bcd1-465a-ae8f-a416e01ab1ba` (user-supplied Project Access Token for prod project `0f41a48b`, env `b9a9e5d2`). Old token `8a6f6eb8…` (defunct project `c23ac3d9`) removed via `variableCollectionUpsert` (replace:false). Triggered SMADAV redeploy.
- Verified (`js/ops/railway_domain_save_probe.js`): BOTH bots now ✅ — Nomadly customDomains=4, SMADAV customDomains=2 (`1.panel.smadavhost.com`, `1.smadavspeech.com`), serviceDomains samdav1.up.railway.app. The 3 RAILWAY_* IDs were already correct on both and unchanged.

---

## Update 2026-06-25 — Honeypot Traps toggle across all 3 surfaces + Worker JSON-safety + /panel fix

**Implemented & verified:**
- CF Worker `injectHoneypots` safety guard (only inject into real HTML) — fixes JSON/API corruption (@scorch75 P0). Unit-tested.
- New KV `honeypot_off:{domain}` bypass + `setDomainHoneypot()`; other anti-red layers unaffected.
- Telegram bot toggle "🍯 On/Off Honeypot Traps" (Monthly-only; Weekly locked+upgrade) — en/fr/zh/hi.
- Web HostPanel Security-tab Honeypot toggle (Monthly toggle / Weekly locked) — backend `/security/honeypot/toggle` + status fields. Tested via curl + testing agent (iteration_56, 3/3 PASS).
- Reseller API `GET/POST /hosting/honeypot/:domain` (monthly-gated) — curl-verified.
- AI KB updated. `/panel` URL builders fixed (bot/email/registration/reseller/AI KB) to append `/panel`.

**Pending (deploy-dependent):**
- Deploy updated CF Worker to Railway → auto-fixes @scorch75's JSON API. Then (optionally) set KV `honeypot_off:testingpagebig.com` and send the customer their fix confirmation from production (dev pod uses mock Telegram, cannot reach real users).

## 2026-06 (fork) — P0 forged DynoPay webhook exploit FIXED (see CHANGELOG for full detail)
- `POST /store/crypto-webhook` trusted the unauthenticated body for the credited amount (`req.body.base_amount`) and paid-status → forged `base_amount:9999` self-credited wallets. FIXED: amount + paid decision now come from DynoPay server-to-server (`getPaymentStatus/:payment_id`), never the body; `classifyStoreWebhook` HOLDs on gateway-contradiction / unreachable-unsigned; DynoPay HMAC webhook signatures (`X-Dynopay-Signature-V2`) verified when `DYNO_PAY_WEBHOOK_SECRET` set (invalid → 401).
- Verified 8/8 integration + live curl + dev route + 29/29 regression; node healthy. Backend-only, sandbox-verified.
- **P1 backlog still open from user's 3 prod bugs:** (2) `accesd-securite.ca` DNS — registry NS not delegated to Cloudflare (zone "moved"); registrar-side fix + optional bot/panel "zone moved" warning. (3) Web order / guest-checkout anomaly audit (`/guest/checkout`).
- **User action to activate signatures:** save webhook URL in DynoPay dashboard → set `DYNO_PAY_WEBHOOK_SECRET` in Railway (both services); then redeploy.


## 2026-06 (fork) — DynoPay `payment.created` idempotency bug FIXED (see CHANGELOG)
- Bot deposit/order webhook (`authDyno` in `_index.js`) claimed the `payment_id` idempotency slot on DynoPay's new `payment.created` event, blocking the later confirmed/settled from crediting → $20 ETH deposit (ref VwIBe, chat 5168006768) stuck. FIXED with a positive `isPaidStatus` gate so only paid events claim+credit; web-store `/crypto-webhook` also skips `created`. Verified 5/5 live E2E + 9/9 store regression.
- **Open user actions:** (1) credit the one stuck deposit manually (chatId 5168006768 / $20); (2) **deploy** (Save to GitHub → Railway) so prod stops re-blocking; (3) DynoPay webhook signature (`DYNO_PAY_WEBHOOK_SECRET`) is live in sandbox+vault — confirm on Nomadly prod, then decide SMADAV + flip `DYNO_PAY_WEBHOOK_SIG_ENFORCE=true` once logs show sig=valid.
- **P1 backlog still open:** `accesd-securite.ca` DNS zone-moved warning; guest-checkout/web-order anomaly audit.

## 2026-06 (fork) — Phase 1 UX/UI Gap Pass DONE (points 2–7; #1 CANCELLED). Full detail in CHANGELOG.md
Approved order #4→#7→#2→#3→#5→#6, all implemented + sandbox-verified (syntax/parity/compile/screenshots). Point #4 kept intentionally SIMPLE per user ("active/inactive, skip CTA").
- #4 DNS status: bot Check DNS + web NS badge now say plain **Active/Inactive** (not "0/6 resolving").
- #7 HostPanel empty states: reusable `PanelEmptyState.jsx` (icon+title+desc+CTA) in Email/Domains/Analytics tabs.
- #2 Storefront polish: green ✓ checks, plan-card accent strip, trust band (entrance animation removed — `both` fill-mode bug).
- #3 Bot home: "📊 Your services: 📞·🏠·🌐" glance line for returning customers only.
- #6 Web checkout recovery: localStorage-persisted pending crypto order + Resume banner/modal (frontend-only).
- #5 Lifecycle: plan expiry chips + renewal hint on storefront My Plans.
- **TESTING DONE (2026-09-28 fork):** ✅ All pending Phase 1 tests PASS via testing agents on a dev-sandbox pod (local Mongo, mock Telegram, SKIP_WEBHOOK_SYNC=true — no prod side-effects).
  - BOT (deep_testing_backend_v2, sim harness): #3 glance line shows `📊 Your services: 📞·🏠·🌐` for a returning customer and is absent for a new user; #4 Check DNS shows `✅ Active — N/6 resolving` (example.com) and `⚠️ Inactive — …still activating` (non-resolving domain). Fixtures: `scripts/seed_phase1_botsim.js`.
  - STOREFRONT (auto_frontend_testing_agent, `/store`): #2 polish (12 green `store-feat-check` ticks, plan cards opacity=1 i.e. no faded animation, trust band); #5 lifecycle chips on My Plans (`store-exp-chip--ok/warn/exp` = "30d left" / "Expires in 3d"+hint / "Expired"+hint+SUSPENDED); #6 resume banner (`store-resume-banner`) renders from localStorage `nomadly_pending_order`, "Resume payment →" opens `store-resume-modal`, Dismiss clears it — **the previously-unconfirmed #6 render is now confirmed**. Fixtures: store user phase1tester@example.com / Phase1Test!234 + `scripts/seed_phase1_store.js`.
  - HOSTPANEL (auto_frontend_testing_agent, `/panel`, login hptestmonthly/135790): #7 empty-state cards on Domains/Email/Analytics tabs (`dl-empty`/`em-empty`/`an-empty` with titles + CTAs) and #4 web NS badge ("🟢 Active" via `dl-ns-active-*`, "🔴 Inactive" via `dl-ns-unknown-*` — old "NS Active/NS Unknown" copy gone). Verified via Playwright route-mocking of the panel data endpoints because the sandbox has no live cPanel/WHM/Cloudflare (real login works on local Mongo; fixtures `scripts/seed_honeypot_test.js`). **All of Phase 1 (#2–#7) now testing-agent verified.**
- **NEXT AGENT / OPEN:** (1) ✅ testing complete (see above). (2) User to deploy (Save to GitHub → Railway) for all Phase 1 (#2–#7) to go live. (3) Still-open pre-existing: stuck $20 deposit (chat 5168006768), `accesd-securite.ca` registry serverHold (manual/registrar), guest-checkout/web-order anomaly audit, DynoPay sig-enforce flip.


## 2026-09-28 (fork) — Railway → DigitalOcean droplet migration (Nomadly `main`) — LIVE
Production now runs on droplet `146.190.238.190` (PM2 `app-main`, nginx, LE certs). Full state + runbook: `memory/DEPLOYMENT_STATE.md`.
- ✅ Telegram webhook fixed: DNS was right but Telegram cached Railway's IP → `setWebhook ip_address=<droplet>`; persisted via new env `TELEGRAM_WEBHOOK_IP` in `setupTelegramWebhook` (`js/_index.js`).
- ✅ `panel.2.hostbay.io` re-homed (was CNAME→Railway 404): CF A record, LE DNS-01 cert, nginx block.
- ✅ DynoPay: `DYNO_PAY_WEBHOOK_SECRET` identical to Railway prod; dashboard webhook URL = `https://2.speechcue.com/store/crypto-webhook` (bot flows pass per-payment `https://2.speechcue.com/dynopay/…`). `DYNO_PAY_API_KEY` on droplet = key user supplied this session (differs from Railway's old one).
- ✅ Custom-domain attach refactor (URL shortener): `js/droplet-domain-server.js` + facade in `rl-save-domain-in-server.js` (`HOSTED_ON=droplet`), `addShortenerCNAME` A-record support, `isShortenerDnsRecord` predicate replaces all `.up.railway.app` checks (`_index.js`, `shortener-reconciler.js`, `cpanel-routes.js`, `cr-register…`). Cloudflare-proxied A → droplet, Origin CA cert + per-domain nginx block, zone SSL strict/full. Tests `js/tests/test_droplet_domain_server_2026-09.js` 10/10; reconciler/addon suites green. 7 customer domains migrated live (`js/ops/droplet_migrate_shortener_domains.js`); 8 dead-zone owners got a "re-activate" notice from the reconciler (see DEPLOYMENT_STATE incident note).
- ⏳ SMADAV (WhiteLabel) on the same droplet: checkout + patches + exact Railway `.env` done at `/opt/nomadly/app-wl`; install/build/certs/nginx/DNS/PM2 + push to `WhiteLabel` pending. 3rd instance TBD.
- Ops: droplet checkout must be synced after "Save to GitHub" (`cd /opt/nomadly/app-main && git checkout -- js && git pull`).
