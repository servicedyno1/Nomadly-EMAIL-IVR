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
