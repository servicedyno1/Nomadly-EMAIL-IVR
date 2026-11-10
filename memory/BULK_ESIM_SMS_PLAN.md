# eSIM BulkSMS (USA/Canada) — plan & decisions (2026-11-10)
User choices: shared pool of platform eSIMs; bookings 500–2000 SMS paid via existing bot checkout (wallet / crypto / bank);
full spec except customer web dashboard; SEPARATE Spenza account (env SPENZA_BULK_API_KEY / SPENZA_BULK_API_SECRET);
all four bots (code under js/ syncs to WhiteLabel; never require js/cloudivr-web web-only files from new non-web code
except wallet.js which WL already has).
Spenza facts: POST /api/v1.1/sms 30/min ACCOUNT-wide (+120/min all endpoints), sync 201, no message id, no delivery receipts,
Idempotency-Key header supported; inbound via signed webhook (x-spenza-signature v1=HMAC(ts.raw)); renew-number = replacement.
Design: js/bulk-esim/ modules (provider adapter, inventory, quota, capacity/bookings, queue worker, inbound/sessions, health,
compliance STOP/HELP/suppression, admin API), bot flow js/bulk-esim/bot.js hooked into _index.js BulkSMS submenu.
Low Spenza credit (user req): credit watch every 2 min + send errors of kind 'credit' → platform paused (reason provider_credit),
admin alerted; auto-resume when credit >= cfg.minCredit; admin alerted again.
Multi-bot: ONE shared Mongo for pool/queue (env BULK_ESIM_MONGO_URL/BULK_ESIM_DB; default = own DB). Customer id = brand:chatId.
Single worker via lock doc (leader). Each bot delivers its own customers' notices by polling bsNotify where brand = its brand.
Test sends: max 2 per campaign during setup, not counted in booking volume, count against daily quota.

## 2026-06 update (user decisions)
- Start with ONE eSIM, scale as needed (minEsims=1, autoProvision=false). NO eSIM bought yet — admin runs /bulkprovision when ready.
- Contacts: paste or .txt/.csv upload (<=2MB); file copy saved to Emergent Object Storage (js/bulk-esim/storage.js, bsUploads) only after it passes the 500-number minimum.
- STOP (punctuation-tolerant) = platform-wide block (bsSuppression cid:'*'), saved even if line/sender unmatched; one confirmation per number; HELP auto-reply max once/day/number.
- DO NOT DEPLOY until user says so. Tests: js/tests/test_bulk_esim_engine.js (28/28), test_bulk_esim_stop_upload_iter239.js (32/32), bot_flow + bot_pay OK. Run with nodejs stopped.
- Pending: buy first live eSIM, register webhook (/bulkwebhook), live send/receive check, deploy.

## 2026-06 round 2 (user-approved fixes 1,2,3,5,7,8 + per-part pricing + translations)
- No bookings with 0 healthy eSIMs (capacity 0 → err_no_lines).
- Pricing per SMS PART: plain $0.10 (=$50/500), link/phone $0.15 (=$75/500). Customer picks; checkContent double-checks (generic domain + 7+ digit phone detection).
- Volume/min/max/allowance all in SMS parts (countSegments=true). Payment reserves allowance on booking day (bsDaily); campaign msgs prepaid (quotaDay, expireAt=start+2d).
- Refund at campaign end: failed+rejected+expired parts × unitPrice → wallet (refundUnsent, once). expireStale also fails stuck processing/submitted.
- Compliance: OPT line '\nReply STOP to opt out' on campaign/test/one-off texts; quiet hours 8–21 recipient local (tz.js area codes; bookings only in mainland-wide window); consent step (bse-consent); US/CA only via libphonenumber-js (no Caribbean/territories/toll-free).
- Live mode requires BULK_ESIM_MONGO_URL (shared DB for all 4 bots) — must be set before deploy.
- i18n.js: en/fr/zh/hi/fa; notices stored as key+args, translated on delivery.
- Tests: engine 39/39, iter239 suite 86/86, bot_flow 16/16, bot_flow_i18n 5/5, bot_pay OK (iteration_240).
- Open (need user OK): one-off SMS are free (only allowance), delay notices, admin view of held replies, START opt-in, re-check capacity after eSIM loss.


## 2026-06 round 3 — automation layer (user decisions: 400/line/day + warm-up; accept + auto-buy for bookings ≥2 days ahead; credit forecast; auto renew/replace; keep 1 line now)
- Per-line cap: esimDailyLimit 400, warm-up warmupDays 5 from warmupStart 50 → 80/160/240/320/400 (lineCap/lineAge). Counter bsEsimDaily `${esim}:${day}` (dayKey). Session replies bypass the cap. Worker returns 'starved' (tick breaks) when no line has room.
- Capacity: capacity(date) = perHour (Spenza 30/min vs lines×esimPerMin) + perDay (Σ line caps ×0.8). Dates ≥ leadDays(2) also count buyable() lines (needs autoProvision && !manualApproval; bounded by maxEsims, provisionBudget, forecast). Pending lines count from tomorrow (selling) / always (shortfall). allocate(dayFree) caps a booking by the day.
- Math: 1 mature line = 320 bookable/day (< 500 min booking!) → 2k/day customer ≈ 7 lines, 4k/day launch ≈ 13 lines; buy ~1 week before launch (raise minEsims).
- confirmBooking: status set first (P1 hold-expired fix), then provisionFor() = lock('provision') → linesShort(date) → provisionMany. Booking 'provisioning' until autoscale sees healthy-only shortfall 0 or start passed.
- autoscale (30 min): need = max(minEsims gap, linesShort over next 7 days incl. unmetDemand() for days ≥ leadDays) under the same lock. bsDemand records refusals only for real capacity refusals within 0..7 days; cleared on successful booking.
- Credit: forecast {credit, committed = queued prepaid parts×providerSmsCost(0.01) + volume-only paid bookings + renewals(≤30d)×lineCost, available = credit−committed−minCredit, runway}. creditWatch: warn once/day (runway<creditWarnDays 3 or available<0), bookings blocked (err_no_lines) via creditShort(), provisionOne blocked when available<cost (and each purchase $inc forecast.available −cost), paused below floor with hourly 'Still paused' nag, auto-resume.
- Replace: autoReplace() on provider SUSPEND/restricted (syncInventory + healthCheck; max maxReplacesPerDay 3, alert once/line/day) → replaceEsim(verify:true) → new number 'testing' must pass verifyLine(): 'CloudIVR line check <code>' to a peer pool line, reply via webhook (bsTests type verify) → available; 2 no_reply → failed + provisionOne (if auto). Suspended lines re-checked: lifted → back to pool. No peer → joins unverified (alert).
- Expiry: P.subscription(iccid).endDate synced each healthCheck → expirationDate; past → status 'expired' + alert (Spenza renews itself from balance; renewals are in the forecast).
- Dry-mode fakes: BULK_ESIM_FAKE_CREDIT, BULK_ESIM_FAKE_SUSPENDED=<iccid,..>, BULK_ESIM_FAKE_EXPIRED=<iccid,..>.
- /bulk shows forecast, today/tomorrow perDay, unmet demand, auto-buy/replace state, per-line today/cap + plan end.
- Tests (nodejs stopped): engine 39/39, autoscale 25/25 (js/tests/test_bulk_esim_autoscale.js), iter239 86/86, agent probes test_bulk_esim_autoscale_iter241.js 21/21 (P4 probe's "+12" is correct warm-up math for a same-day booking, no re-buy loop). bot_flow 16/16 with nodejs running. iteration_241.
- Still NOT done: no live eSIM, no deploy, autoProvision stays OFF until user flips (/bulkset autoProvision true + /bulkset manualApproval false), real Spenza plan/SMS cost unknown (providerSmsCost default 0.01 — set after first live test).

## 2026-06 round 4 — "customers send now" (user decisions)
- NO warm-up by default (warmupDays 0 → lineCap = esimDailyLimit 400 from day 1; ramp still available via /bulkset warmupDays N). leadDays 1. spareDaily 2000: autoscale keeps bookings + 2,000 SMS/day spare from tomorrow on (≈7 idle mature lines) so same-day bookings always fit.
- Learning infrastructure for a future data-driven warm-up: bsEsimDaily per line/day {age, n(new convs), out, session, sent, failed, in, stops}; incident 'line_suspended' snapshots {age, lifetime stats, last7 days}; admin /bulklines prints 14-day history per line; core.lineHistory().
- Still nothing bought (autoProvision off, minEsims 1) — user will say when. Tests: autoscale 30/30, iter241 probes 21/21 (none), engine 39/39, iter239 86/86, bot_flow 16/16.

## 2026-06 round 5 — fully dynamic scaling (user: "no daily benchmark")
- demandModel(c): byDay = booked volume (bsBookings confirmed..completed) + refused (bsDemand.date) over demandDays(14); peak = busiest past day; target(date) = min(dayCeiling, max(booked(date) + (reserveBooking ? maxVolume : 0), peak)).
- dayCeiling(date) = platformPerMin×60×openHours(date)×util (≈14,400 with 10 mainland-open hours); maxLines = cfg.maxEsims || ceil(ceiling/(esimDailyLimit×util)) ≈ 45. provisionBudget 0 = no monthly cap (credit forecast is the budget). maxEsims 0 = auto.
- plan(c) → 7 rows {date, booked, target, have, ceiling, short}; autoscale buys max(short over days ≥1, minEsims gap) ≤ maxLines−live, under the provision lock. /bulkplan prints it. linesShort hour-shortfall capped by the platform rate (lines can't beat 30/min).
- Removed spareDaily. Example: 4×2000 + 6×500 = 11,000/day → 35 lines, 7.6 of 10 open hours, within ceiling; growth past ~12k/day needs Spenza to raise 30/min (or a 2nd account).
- Tests: autoscale 36/36, iter241 probes 21/21, engine 39/39, iter239 86/86, bot_flow 16/16.

## 2026-06 round 6 — monitor eSIM, round-trip checks, credential bootstrap, 1+2 start
- Roles: bsEsims.role 'monitor' | 'service'. Monitor never sends campaigns (excluded from fleet/pickEsim/liveCount). Defaults: monitorEsims 1, minEsims 2, autoProvision TRUE, manualApproval FALSE (user: "system should create eSIMs needed if balance is enough").
- Checks (bsTests type 'check', kind pre_use|periodic|spike): line → monitor "CloudIVR line check CODE" (legs.out via webhook on the monitor) → monitor auto-replies "… CODE ok" (legs.back via webhook on the line) → passed, lastCheckOkAt/checkedSubmitted set. Timeout 10 min → no_delivery (sendMiss++) or no_return (recvMiss++). Dry run auto-passes unless BULK_ESIM_FAKE_CHECKS=manual.
- Rules: new/replaced line (status testing) needs a passed pre_use check (no peer → joins unchecked, alert once); 2 failed pre_use → status failed + provisionOne(role). Active line: periodic every testEveryHours only if it sent since last pass; spike (3 fails/h) → check now. sendMiss ≥2 → sending_failure → suspended → autoReplace (renew-number first, new eSIM only if that fails or new number fails twice). Monitor: periodic self-check against a service line regardless of traffic; ≥2 distinct lines no_delivery to the same monitor within 30 min → tests voided (monitor_fault), sendMiss restored, monitor suspended + replaced.
- bootstrap(): on start, sha256(SPENZA_BULK_API_KEY) vs bsConfig.provider.keyHash; changed → retire old lines (status 'retired'), syncInventory (first adopted SIM becomes monitor if none), creditWatch, registerWebhook(SELF_URL, live only), autoscale (buys monitor + minEsims if forecast allows), alert summary. GONE statuses = replaced/failed/expired/retired.
- Demand model: reserve (room for one more booking) applies only once any booking/refusal exists in the 14-day window → fleet stays 1+2 until the first customer, then grows.
- Tests: autoscale 51/51, iter241 20/20, engine 39/39, iter239 86/86 (these three suites force auto-buy OFF), bot_flow 16/16. Preview has no SPENZA_BULK key → bootstrap skipped; on deploy with real keys + credit it WILL buy 1 monitor + 2 service eSIMs.
- Verified (docs.spenza.com "Request a new phone number"): POST /api/v1.1/sims/{iccid}/renew-number = new phone number on the same eSIM (NOT plan renewal); sync, 200 without the new number (arrives on the SIM record → syncInventory), 20 req/min, 409 state / 501 operator unsupported / monthly number-change quota → engine falls back to a new eSIM. Live-test checkpoint: confirm renew-number works on the BulkSMS plan.

## 2026-06 round 7 — tester line + buy-on-first-booking (user decisions)
- Roles: 'tester' (customers' 2 test texts per campaign route through it via pickEsim m.test; never campaigns), 'monitor', 'service'. AUX = monitor+tester excluded from fleet/pool/liveCount. testerEsims 1.
- bootstrap (new credentials): sync, credit, webhook, buy ONLY the tester line. First PAID booking (confirmBooking): ensureRoles → monitor, then provisionFor need = max(linesShort, minEsims(2) − live). autoscale buys roles/minimum only once `started` (lines exist or demandModel.hasDemand). Demand model uses paid-status bookings only (awaiting_payment excluded) + capacity refusals.
- Tests: autoscale 53/53, iter241 20/20, engine 39/39, iter239 86/86, bot_flow 16/16.

## 2026-06 round 8 — next free day + dead-line cancellation
- nextFreeDay(parts, fromDate): first of the next 14 days where the parts fit (availability + allocate with dayFree). Bot: day step accepts any date 0..14 days ahead; when the picked day is full (no open hour or dayFree < parts) or the hour step returns err_slot → message no_cap_day + next_free(date) (i18n en/fr/zh/hi/fa) with the next day as a one-tap button.
- cancelDead(c) hourly: 'failed' lines (>1 h) and 'suspended' lines (> cancelDeadAfterDays 3) with an iccid and no other live doc on that iccid → P.cancelSubscription (POST /api/v1.1/subscriptions/{iccid}/cancel, period-end cancel) → cancelledAt, alert, audit cancel_line. Replaced originals whose eSIM lives on are skipped; expired already over; retired = other account.
- Tests: autoscale 59/59, bot_nextday 11/11 (js/tests/test_bulk_esim_bot_nextday.js, nodejs running), bot_flow 16/16, engine 39/39.

## 2026-06 round 9 — replacement + dead detection for every role
- Order for any dead line (service/monitor/tester): renew-number (same eSIM) → wait for number → pre-use round-trip check → pool. New eSIM (same role) only if renew-number refused, new number fails 2 checks, or number never arrives (stuckLines: alert 2 h, retire+rebuy 24 h).
- Dead triggers: provider SUSPEND/BLOCK, sms service off, plan ended, sendMiss ≥2 (checks), fail rate >30%/20, technically_failed × apiFailsToReplace(3) consecutive, monitor-fault vote. Checks: pre_use, periodic (6 h; AUX roles traffic or not, service when it sent), volume (every checkEveryTexts=100 texts), spike (3 fails/h).
- roleCount excludes suspended → ensureRoles buys a new monitor/tester when replacement is capped. Dry fakes: BULK_ESIM_FAKE_BROKEN (API error), BULK_ESIM_FAKE_RENEW_FAIL (501 on renew-number).
- Tests: autoscale 67/67, iter241 20/20, engine 39/39, iter239 86/86.

## 2026-06 round 10 — interplay audit (replacement ↔ booking ↔ sending)
- Verified: queued texts are line-agnostic (chosen at send time) → replacement mid-campaign is free; sessions reassign; lost capacity → linesShort → autoscale, else texts expire at start+2d and refundUnsent pays back; AUX roles never in the pool.
- Fixed: queueCampaign releases texts per allocated hour (notBefore = slot) instead of all at startAt; n_late notice once when <50% out 2 h after start (i18n ×5); cancelDead cancels an iccid once even if both the suspended line and its failed replacement are dead.
- Known/accepted: replies to the OLD number after renew-number are lost (number gone at the operator); booking hours are UTC slots but recipient quiet hours still apply per area code.
- Tests: autoscale 71/71, engine 39/39, iter239 86/86, iter241 20/20, bot_flow 16/16.

## 2026-06 round 11 — Spenza rate-limit headers
- Docs: POST /api/v1.1/sms = 30 req/60 s per account (+120/min general); 429 RATE_LIMITED with Retry-After; X-RateLimit-Limit/Remaining/Reset on 2xx.
- provider-spenza: noteRate() stores headers from /sms calls (and 429 → remaining 0, resetAt = Retry-After); smsRate() getter (dry: BULK_ESIM_FAKE_RATE='limit,remaining,resetSec').
- core: paceByHeaders(c) in tick — adopts a changed limit as platformPerMin when platformPerMinAuto (default true) + alert/audit; holds the worker while remaining < 1 until reset. Per-send check inside the loop too. healthCheck spaces provider calls 600 ms apart in live mode (general budget).
- Tests: autoscale 74/74, engine 39/39, iter239 87/87, iter241 20/20, bot_flow 16/16.

## 2026-06 round 12 — multiple Spenza accounts + send now / schedule (−10%)
- provider-spenza: accounts() from env (SPENZA_BULK_API_KEY[_n]/SECRET[_n], optional IMEI[_n]/EMAIL[_n], n ≤ 9); every call takes the account id; per-account token + X-RateLimit state. Dry: BULK_ESIM_FAKE_ACCOUNTS=n, BULK_ESIM_FAKE_CREDIT[_n], BULK_ESIM_FAKE_RATE[_n].
- core: cfg().accounts (perMin learned from headers or platformPerMin, low, credit, forecast); bsAccounts collection; ratePerMin = Σ; acctMaxLines/dayCeiling per account (45 lines / 14,400 SMS at 30/min, 10 open h); acctRoom() picks the least-loaded account with credit; creditWatch per account (low account sits out, global pause only when all low); worker windows per account (win.acct); pinned/session texts on a throttled account are skipped (max 50/tick) instead of blocking the queue; bootstrap connects/retires/disables accounts (legacy bsConfig.provider migrated); registerWebhook for every account, onWebhook tries every signing secret; adviseAccounts() once/day/account-count at ≥80% of ceiling or demand > ceiling → "set SPENZA_BULK_API_KEY_{n+1}"; /bulkaccounts + accounts line in /bulk.
- "45 lines" = useful ceiling per account from the 30 SMS/min cap (30×60×10h×0.8 = 14,400/day ÷ 320/line), not a Spenza SIM limit. More capacity = more accounts.
- Send now vs schedule: availability() current hour open pro rata; whenOptions(); createBooking({now:true}); scheduleDiscountPct 10 for starts ≥ scheduleMinHours 24 ahead (SMS part only); booking has mode/discountPct/listPrice/unitPrice (refunds use the discounted unit). Bot step bse-when (🚀 Send now / ⏱ Earliest today HH:00 / 📅 Schedule).
- claimWorker() exported for tests (the preview app holds the worker lock on the shared DB). Preview backend/.env: BULK_ESIM_FAKE_CREDIT=500 (dry mode only).

## 2026-06 round 13 — opt-out choice, one-SMS rule, AI variants, paid replies
- checkContent(content, withLinks, optOut): every version + opt-out line (if kept) must be ONE SMS (138 chars with the line, 160 without, 70 unicode) → err_too_long [max]; text-only may hold no link/phone in any version; createBooking re-validates the stored text against the paid type (manipulation guard). bodyOf(cp,i) builds texts (opt-out optional; STOP keyword always honoured).
- aiVariants(): Python POST /api/internal/bulk-esim/variants (loopback only) → Claude Opus 5.5, automatic fallover to OpenAI gpt-5.6-terra (OPENAI_API_KEY if set, else the universal key) with admin alert once/hour; both down → err_ai + alert. Variants re-validated (one SMS, type rule, no URL/phone the original lacks, no dups), logged in bsAiVariants. Dry without EMERGENT_LLM_KEY → simulated. Bot: bse-variants (✨ 5 AI variants / keep) → bse-variants-pick (use all / "1 3 5" / 5 more, max 3 rounds / keep).
- Paid replies: campaign.replies via bse-replies (+cfg.replyFee 20, never discounted, refunded only when nothing was sent). onWebhook attributes a reply to the newest SENT text (matched line first); replies=false → stored 'kept', not forwarded (report() hides them); STOP/HELP always processed. replyImpact() in replaceEsim → admin alert listing paid-reply campaigns that texted from the lost number within sessionHours.
- Re-added account: retired lines still listed by Spenza come back as 'testing'.
- Tests: accounts 33/33, replies_variants 28/28, autoscale 74/74, engine 40/40, iter239 88/88, iter241 20/20, bot_flow, nextday 15/15, i18n 5/5, bot_pay, iter242 probe 53/53 + wizard 37/37 + reply_edge (testing agent, report iteration_242.json).

## 2026-06 round 14 — test-text abuse controls (user picked 1+2+4+5, wallet gate completes 3)
- Verified own numbers: requestTestNumber (US/CA, max testNumbersMax 3, 6-digit code by SMS through the tester line, 15 min, 5 attempts, 1/min) → verifyTestNumber; testNumbers(cid). Bot: bse-test → wallet must cover the campaign price (test_locked) → pick a verified number / ➕ Add a number (bse-test-add → bse-test-code).
- testCheck/testSend: verified number only, cfg.testSends per campaign, account quota testsPerDay 4 / testsPerWeek 10 across all drafts (bsMessages test:true, non-system), charge = unit price × parts (bot debits wallet before testSend, credits back on error); campaign.testCharges; refundTestCharges() on paid confirmBooking → bsNotify 'refund' n_test_refund (wallet credit on delivery). testedHash = contentHash(cp) frozen at the first test → createBooking err_content_changed if the text differs.
- Send now: nowSlot() = current hour, or next hour when < 5 min remain (null at 23:55+).
- Tests: test_bulk_esim_test_abuse 21/21; bot_flow (add → code → send, charge 0.1, refund notice), engine 40, iter239 88, autoscale 74, accounts 33, replies_variants 28, i18n 5.
