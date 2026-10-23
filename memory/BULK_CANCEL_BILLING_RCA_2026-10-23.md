# Bulk IVR "balance still going down after cancel" — RCA + fix (2026-10-23)

User: @draggadem876 (8666352410, Nomadly). Escalation Viude 08:36Z.

## Timeline (UTC, campaign eafefe7c, 102 leads, caller +18888924979)
- 08:26:54 start → 10 dialed. 08:29:35 Pause. 08:30:43 Cancel (92 pending → not called).
- 5 calls were already connected and kept playing the message/gather until the callee hung up; 4 of them ended after
  the cancel and billed: lead 8 $0.30 (08:31:41), lead 6 $0.45, lead 9 $0.45, lead 5 $0.75 (08:33:48, 252 s) = **$1.95**.
- Root cause: `cancelCampaign` only stopped NEW dials ("calls in progress finish normally"), so the wallet kept
  dropping for ~3 min after "stop". Policy note (unchanged, per billing audit): every answered/busy call bills ≥1 min.

## Fix (owner choice: "End calls still playing the message")
- `js/bulk-call-service.js`: cancel now hangs up every in-flight Telnyx leg that is not already transferring/bridged to
  the customer's own line (`isLegTransferring` reads `voiceService.outboundIvrCalls[sid]`). Returns `ended` /
  `transferring`. Hung-up legs settle through the normal hangup webhook (billed only for time used, once).
- `js/_index.js`: cancel confirm + result texts explain this. `js/ai-support.js`: KB entry for this question.
- Test: `js/tests/test_bulk_cancel_hangup_2026-10.js` 10/10 (sandbox mongod :27999). Regression: bulk controls edge
  32/32, bulk telnyx 48/48, bulk telnyx edge 17/17.
- Refund (owner-approved): $1.95 credited 2026-10-23, txn `REFUND-BULKCANCEL-eafefe7c`, user notified
  (balance $33.63 → $35.58). Script: `js/ops/refund_bulk_cancel_2026-10-23.js` (idempotent).

## Carrier name hidden (owner: "everywhere, including admin and support alerts")
- `sanitize-provider.networkLabel()` → telnyx shown as "Speechcue". Applied to: support escalation account snapshot
  (2 builders in `_index.js`), number-verification/review admin alerts (`[NumberVerify]`, `[NumberReview]`,
  `[Numbers]`), PhoneMonitor suspended-number admin alert, BalanceMonitor alerts (portal link shown as
  "Open account portal"). Raw provider kept in DB/logs. Digital Products listings ("Telnyx Main Account" etc.) are
  real product names and intentionally unchanged.
