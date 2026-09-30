# Cloud IVR Billing Audit — Production (Railway) — 2026-09-16

Source: Railway env logs for service `Nomadly-EMAIL-IVR` (project "New Hosting"), window 2026-09-09 → 2026-09-16 (7d).
Deployed commit `fe5167c3` == local HEAD (code analysed == code running). Raw pulls: `/app/investigations/billing7d/*.jsonl`.
Tools: `ops/railway_billing_pull.js` (bulk filters → JSONL), `ops/railway_grep_billing.js '"filter"' ...` (ad-hoc).

## Traffic (7d)
| Flow | Count | Billed as |
|---|---|---|
| SIP outbound via Twilio bridge (Telnyx SIP → Twilio PSTN) | 496 calls, 322 connected (304 PSTN-min) | `SIPOutbound` on Telnyx hangup (495 rows, ~$97) + $0.03 conn fee |
| Twilio call forwarding (inbound → forwardTo) | 27 connected (64 min) | `Twilio_Forwarding` — **only via 30-min sweeper** |
| Twilio direct-fallback ("ghost") calls | 32 (4 answered) | nothing |
| Inbound to Twilio numbers | 49 completed | `Twilio_Inbound` plan minutes (47) |
| Bulk IVR campaigns | 918 (507 connected) | `[BulkCall] Billed` 917 rows, 1,124 min, $168.60 ✔ |
| IVR outbound / transfers | 73 / 9 | ✔ |

## Findings

### F1 (P0, over-billing) — SIP outbound calls are charged TWICE for minutes ≥ 60s
`voice-service.js` mid-call monitors **deduct** the per-minute rate every 60s **and** the hangup handler bills the full `ceil(duration/60)` again; nothing nets them:
- L356 auto-routed (`sip_per_minute`), L3057 Telnyx-number outbound (`sip_per_minute`), L3243 Twilio-bridge (`twilio_bridge_per_minute`) — all `smartWalletDeduct(rate)` with **no callRef, no log, no loyalty discount**.
- L4121-4130 hangup: `billCallMinutesUnified(SIPOutbound, ceil(d/60))` with callRef `telnyx_<cc>` → deducts again.
- The user's "SIP Call Ended — N min deducted" message shows only the hangup amount.
- Contrast: OutboundIVR monitor (L4646) correctly only *checks* balance (`getBalance`) and hangs up.
Evidence: wallet balance snapshots (`Concurrency Guard` lines) vs logged charges — chatId 8944352220: drop $47.03 vs logged $29.55 (**$17.48 unexplained**); chatId 6604316166: drop $66.57 vs logged $38.26 (**$28.31 unexplained**). Short (<60s) calls reconcile to the cent; ≥60s calls show +$0.15–0.45 each. Timer model predicts ≥$31 of hidden deductions for these two users in 7d (221 timer fires, all users).
Exact per-user amounts: `db.walletLedger.aggregate([{$match:{type:{$in:['sip_per_minute','twilio_bridge_per_minute']}}},{$group:{_id:{c:'$chatId',t:'$type'},n:{$sum:1},usd:{$sum:'$amount'}}}])` (prod, read-only).

### F2 (P0, dead webhook) — `/twilio/voice-dial-status` has billed $0 in 7 days (0/589 webhookOk)
`_index.js:48048` `chatId = parseInt(rawChatId)` → `get(phoneNumbersOf, <Number>)`, but `phoneNumbersOf._id` is a **string** (bot: `String(msg.chat.id)` L7376; voice-status even comments `String(user._id) // Ensure string for consistency`). Lookup → `undefined` → `numbers=[]` → completed path silently skips (no else-log); unanswered path logs the misleading "not a Nomadly-owned Twilio number … which is correct" (206×/7d). Provider-drift self-heal `updateOne({_id: chatId})` is a no-op for the same reason.
Impact: forwarding revenue (27 calls/64 min) depends 100% on the reconciler sweep (15–30 min late, no user notification, wallet not debited in real time). IVR-transfer `fwdTo` legs share the path. All 29 `Twilio_*` "Outbound billed" rows in 7d are timestamped :00/:30 +≤20s = sweeper.
⚠️ Fixing the lookup naively will **double-bill every bridge call** (Telnyx leg already bills `SIPOutbound`) — `type=sip_bridge` must skip Twilio-leg billing (or the Telnyx leg must skip).

### F3 (P1) — Reconciler mis-closes bridge legs as `no_charge` (560/589 rows)
Bridge parent + `<Dial>` child live on the **master** Twilio account (SIP domain), but `recordPendingBill` stores `subAccountSid` and `fetchTwilioLegDuration` queries only that account → `connected:false` → `no_charge`. Verified on 4 SIDs via Twilio API (children found @master, none @sub). Also the 2 bridge rows it *did* settle ($0.27) were double charges on top of the Telnyx-leg billing. `Dial status: undefined` (33×) = direct-fallback `statusCallback` sends `CallStatus`/`CallDuration`, not `DialCallStatus`.

### F4 (P2) — Ghost PSTN calls after the SIP caller hung up
`voice-service.js:3311-3314`: if the SIP leg is already dead after the 200ms settle window, the code still places a Twilio direct call to the destination (32/7d, 4 answered, 126s, Twilio cost $0.05). Nobody is on the line; destination gets a silent call; call is unbillable.

### OK / no gap
- Bridge calls: Telnyx-leg minutes track PSTN talk closely (300 matched: 512 vs 497 min, avg 11s ring overhead). "Dual-leg" code path is dead because `call.bridged` flips phase→`bridged` before hangup (only the 29 hung-up-during-setup calls hit `Telnyx_SIP_Leg`).
- Bulk IVR: 917 billed ≈ 507 completed + 304 no-answer + 107 busy (1-min min) ✔. Untracked hangups (762) all 0s B-legs ✔. Inbound: all plan minutes, no overage ✔.

## Status 2026-09-16 (same day)
- **F2 FIXED** (`_index.js` `/twilio/voice-dial-status`): `String(rawChatId)` + `lookupNumbersOwner()` (legacy numeric `_id` fallback); explicit "NOT BILLED — owner not found" warn; `type=sip_bridge` legs are never billed on the Twilio side (completed or unanswered); webhook now calls `markBillSettled(callRef,'webhook')`. Live test `js/tests/test_dial_status_billing_fix_2026-09.js` (13 assertions).
- **F3 FIXED** (`call-billing-reconciler.js`, `/twilio/sip-voice`): bridge pending rows carry `altCallRef: telnyx_<callControlId>` + `subAccountSid: null`; sweeper reconciles on either leg's ledger row (`settledVia: other_leg`); `fetchTwilioLegDuration` falls back to the master account. Test `js/tests/test_reconciler_altcallref_2026-09.js`.
- **F4 FIXED** (`voice-service.js`): `_attemptTwilioDirectCall` removed; all 4 failure sites → `_abandonBridge()` (drop bridge, hang up Telnyx leg, release reservation, notify once; silent when the caller hung up). Test `js/tests/test_no_ghost_direct_call_2026-09.js`.
- **F1 OPEN (user decision)** — mid-call per-minute deductions (`sip_per_minute`, `twilio_bridge_per_minute`) still stack on top of hangup billing.
- Expected prod signal after deploy: `[CallRecon] sweep:` shows `webhookOk>0`; `Forwarded Call billed via unified` lines appear in real time; `Twilio direct fallback` lines disappear; `Dial status: undefined` disappears.
1. Monitors L356/L3057/L3243 → balance-check-only (mirror L4646); hangup billing is the single charge. Refund script for `sip_per_minute`/`twilio_bridge_per_minute` ledger rows.
2. `voice-dial-status`: `String(rawChatId)`; explicit "owner not found" log; skip Twilio-leg billing for `type=sip_bridge`; read `CallStatus`/`CallDuration` for `type=sip_outbound`.
3. Bridge `recordPendingBill` → `subAccountSid: null` + mark settled from Telnyx hangup (or don't record); sweeper tries master then sub.
4. Dead SIP leg → clean up, no direct fallback call.
5. Alert when a sweep reports `webhookOk=0` with `scanned>0` for >24h.
