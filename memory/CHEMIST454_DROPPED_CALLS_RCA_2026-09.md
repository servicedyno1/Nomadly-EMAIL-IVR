# @chemist454 — Cloud IVR "dropped calls" RCA (SIP outbound)

## Who
- Telegram @chemist454 → **chatId 6587790422** (nameOf/chatIdOf, prod db `test` on roundhouse).
- Wallet: in $175 / out $99.81 → ~$75 balance. No owned numbers array (SIP outbound user).
- Caller ID (ANI): **+1 888 330 4418 — a TOLL-FREE number** (Pro plan, Telnyx, bought 2026-09-02).
- Usage: heavy **rapid outbound SIP dialing** to many different US numbers (lead-gen / war-dialer pattern) via softphone registered to Telnyx SIP connection `2898118323872990714` (sip.speechcue.com), credential `gencred0u53hd…`.

## Data (prod walletLedger + Railway logs, ~4 days to 2026-09-21)
- 111 outbound-call hangups analysed. Hangup causes:
  - **originator_cancel / caller: 72 (65%)** — caller side dropped WHILE RINGING (never answered).
  - normal_clearing / callee: 37 (33%) — answered, callee hung up (normal).
  - normal_clearing / caller: 2.
- Duration: p50=9s, p90=33s, max=62s. **Only 1 call ≥60s.** 58 calls were 1–9s.
- No Telnyx 429/rate-limit or API errors in the window (the "429" hits were substrings of call-control-ids).

## Call flow (from prod logs)
1. Softphone dials → Telnyx `call.initiated` (A-leg, direction=outgoing, from_sip_uri=gencred → cleaned +18778570205). Code identifies user, Concurrency-Guard reserves $0.30, charges $0.03 connection fee, issues Telnyx **`transfer`** to route A-leg → destination with `from`=+18883304418 (per-call ANI).
2. Telnyx creates the outbound **PSTN B-leg** and fires ITS OWN `call.initiated` (direction=outgoing, from=+18883304418, **no from_sip_uri / credentialExtracted=false**).
3. Destination rings; if the softphone user gives up first → `originator_cancel`.

## Defects found (code, fixable)
### D1 (PRIMARY) — the outbound PSTN B-leg re-enters the full inbound→outbound SIP pipeline
Because the B-leg arrives as `direction=outgoing` on the SIP connection with no credential, `handleCallInitiated`→`handleOutboundSipCall` treats it as a NEW outbound call:
- Runs `telnyxService.listSIPCredentials(connectionId)` → **"Found 250 Telnyx credentials on connection"** and loops all 250 against the DB on EVERY outbound call.
- Resolves the **WRONG user** via the "most-recent-credential-creation / recent-activity" heuristic (logs show it resolving to random test accounts like 5168006768 / chatId 6277663071).
- Wastes ~3–6s and heavy Telnyx API + DB load per call; the destination starts ringing ~3s late.
- In the general case (when the reverse lookup resolves FAST, e.g. cache hit), the wrong-user's test-call-limit / rate-limit / wallet-cooldown branches can call `hangupCall(bLegCc)` → **tears the PSTN leg down mid-ring = a real drop** and could double-charge a connection fee. (For THIS user the lookup was slow, so the teardown didn't fire, but the latency + wrong-user attribution did.)
- The B-leg is otherwise "untracked" at hangup (billing is on the A-leg session / autoRoutedPendingBilling), so it should never have been re-routed.

**Fix:** tag the transfer's NEW leg with Telnyx `target_leg_client_state` (base64) = `nomadly_pstn_leg`. In `handleCallInitiated`, if `client_state` decodes to that marker → early-return (skip re-routing/reverse-lookup). Backup signal: short-TTL guard keyed `connectionId|destination|ani` set right before `transferCall`. No regression if Telnyx doesn't echo it (falls back to current behaviour).

### D2 (CONTRIBUTING, not code) — toll-free number used as OUTBOUND caller ID
+1888… is a toll-free (inbound) number. Presenting it as ANI on outbound long-distance calls yields poor STIR/SHAKEN attestation and carrier mistreatment (spam-flagging, low answer rates, some carriers drop). This, plus impatient rapid dialing (avg ~14s ring before the caller cancels), is the biggest driver of the *user-perceived* "dropped/failed" calls. Recommend the user dial from a **standard local/long-code DID**, not the toll-free.

## Edge case FIXED — unidentified-credential cost leak (2026-09)
Concern: if Leg A fails user identification, Telnyx still bills the (billable) inbound SIP leg + Call Control per-leg fee while we charge no one, and a stuck softphone re-dialing repeats it. (Note: rejected calls return BEFORE the `transfer`, so no PSTN B-leg is created — the leak is the recurring inbound leg + the wasteful 250-cred reverse lookup, not a double PSTN charge.)
Fix in `js/voice-service.js`:
- New short-lived guard mirroring `_expiredTestBlockSet`: `_recordUnidentifiedFailure` / `_isUnidentifiedBlocked` / `_clearUnidentifiedFailure` (defined ~L139). After **3 consecutive identification failures within 5 min**, the credential is hard-blocked for **10 min**.
- Early block check (right after the expired-test check ~L2560): blocked credentials are hung up instantly BEFORE findNumberBySipUser / reverse lookup / transfer → stops the recurring billable leg + wasted work.
- `!chatId || !num` branch (~L2830) now records the failure, blocks on the 3rd, and writes a `unidentifiedCallLeaks` doc `{sipUsername,from,destination,callControlId,isAutoRouted,blocked,createdAt}` for operator visibility/reconciliation.
- Self-heals: block auto-expires (10 min) and is cleared on the next successful identification, so a transient DB hiccup won't lock out a legit user.
- `handleAutoRoutedRealTimeBilling` (Fix #5) is dead code (never called) — left as-is; not needed because reject paths return before the transfer so no PSTN leg exists to recover a connection fee for.
- Test: `js/tests/test_sip_unidentified_leak_block_2026-09.js` — ALL PASSED (3 failures→block; blocked calls short-circuit before identification with no extra work/leak rows; no false PSTN transfer; self-heal on clear).

## Provider cost / margin (answered, no code change)
Telnyx bills a Call-Control transfer **per leg**: inbound SIP leg (~$0.003/min + $0.002 CC fee) AND outbound PSTN leg (~$0.005–0.007/min + $0.002 CC fee). We charge the customer ONCE (anchored on Leg A): $0.03 conn fee + ceil(min)×$0.15 US / $0.50 intl. Both provider legs ≈ ~$0.013/min US vs $0.15/min charged → ~90% margin; single customer charge covers both legs. Expensive intl prefixes protected by `dialGuard.getHighCostRate` (cost×markup). Sandbox `TELNYX_API_KEY` is a placeholder (CDR API returns auth-failed) so live per-leg CDRs can't be pulled here.

## Billing integrity after D1 (verified — no leak, no double-charge)
The D1 skip only early-returns in `handleCallInitiated` for the B-leg; it does NOT touch `call.answered`/`call.hangup`. All SIP-outbound billing is anchored on the **A-leg** cc: connection fee (`type:connection_fee` in handleOutboundSipCall ~L2967), mid-call `sip_per_minute` timer, and hangup bill (`billCallMinutesUnified(..., callRef:'telnyx_<aLegCc>')` ~L4100). The B-leg is "untracked" at hangup (no session) and was never a billing anchor. Note: the connection fee has NO callRef, so before D1 a fast-resolving re-entered B-leg could have charged a SECOND connection fee — D1 also removes that over-bill risk.
- New test `js/tests/test_sip_billing_no_leak_2026-09.js` simulates A-leg initiated → B-leg initiated(marked) → hangup → duplicate hangup → B-leg hangup against an in-memory walletLedger (ground truth). Asserts: exactly 1 connection fee ($0.03), 1 outbound_call ($0.30 for 2 min), duplicate hangup is idempotent, B-leg adds ZERO charges, total $0.33 reconciles to wallet usdOut, exactly 2 ledger rows. **ALL PASSED.**
- Prod ledger for chatId 6587790422 confirms single connection_fee + single outbound_call per destination (no pre-existing doubles).

## Tooling built this session (read-only)
- `js/ops/prod_lookup_chemist.js` — read-only prod Mongo lookup (chatId, wallet, ledger, calls). Output `investigations/chemist_ivr/`.
- `js/ops/railway_log_pull.js` — read-only Railway GraphQL env-log pager (project New Hosting / env production `889fd56a…` / svc Nomadly-EMAIL-IVR `b9c4ad64…`). Token = project-scoped `API_KEY_RAILWAY`, header `Project-Access-Token`, endpoint `backboard.railway.com/graphql/v2`.
