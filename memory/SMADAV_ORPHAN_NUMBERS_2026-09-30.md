# Smadav Telnyx orphaned numbers — 2026-09-30

Telnyx account key `KEY01A0D9F6E…` (Smadav / app-wl). Connection "Smadav Cloud Phone Voice".
The Smadav bot tracks phone ownership in `phoneNumbersOf` (smadav DB) — that collection is
EMPTY (0 docs). So per the bot's own `findNumberOwner`, ALL 34 numbers below are unowned.
None found in the Nomadly (`test`) DB either.

CAUTION: these may be active OUTBOUND caller-IDs (voice/OTP) rather than abandoned rentals.
Releasing is IRREVERSIBLE. Awaiting user decision before any release.

Total: 34 (6 local, 28 toll-free). Est. ~$62/mo rental + per-minute inbound (robocalls).

## The number that triggered the alert (rejects robocalls)
+18052615004 [local] purchased 2026-09-18  (Telnyx id 3052013467507623167)

## Full list (number | type | purchased)
+18775162951 toll-free 2026-09-18
+18052615004 local     2026-09-18   <-- orphan alert
+18772319740 toll-free 2026-09-16
+18776532205 toll-free 2026-09-16
+18058335920 local     2026-09-16
+15742351602 local     2026-09-15
+18778091411 toll-free 2026-09-14
+18888420351 toll-free 2026-09-14
+18779260618 toll-free 2026-09-14
+18556935840 toll-free 2026-09-14
+18337890974 toll-free 2026-09-14
+18336110843 toll-free 2026-09-14
+12702917620 local     2026-09-14
+18779208741 toll-free 2026-09-14
+18776760798 toll-free 2026-09-14
+18773893315 toll-free 2026-09-11
+18774170326 toll-free 2026-09-11
+18776720747 toll-free 2026-09-11
+18883920738 toll-free 2026-09-11
+18774100595 toll-free 2026-09-11
+18773972240 toll-free 2026-09-11
+18773304975 toll-free 2026-09-09
+18883304418 toll-free 2026-09-02
+18334120472 toll-free 2026-08-31
+18445831558 toll-free 2026-08-02
+18776724189 toll-free 2026-07-24
+18888261904 toll-free 2026-06-16
+13513540093 local     2026-06-16
+18777553674 toll-free 2026-05-12
+18723378412 local     2026-04-21
+18779758085 toll-free 2026-03-23
+18775877003 toll-free 2026-03-21
+18778570205 toll-free 2026-03-20
+18889020132 toll-free 2026-03-06

## To release one later (irreversible):
DELETE https://api.telnyx.com/v2/phone_numbers/{id}  (Authorization: Bearer <TELNYX_API_KEY>)
Look up {id} via GET /v2/phone_numbers?filter[phone_number]=+1805...
